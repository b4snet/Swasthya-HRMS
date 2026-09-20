/**
 * Separation workflow integration tests (Slice 1.1; brief §44–46).
 *
 * Journey: HR requests a separation → assigned approver decides → executor
 * applies → terminal employment transition + exit-clearance tasks + audits.
 * Guards: non-HR denied, PENDING cannot be applied, self-approval refused,
 * double-apply refused, cross-tenant is NOT_FOUND (IDOR posture).
 *
 * Run: pnpm test:integration (real Postgres; helpers truncate between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmployee,
  changeEmploymentStatus,
} from "@/modules/workforce/service/employee-service";
import {
  applySeparation,
  decideSeparation,
  listSeparationRequests,
  requestSeparation,
} from "@/modules/workforce/service/separation-service";
import { SEPARATION_CLEARANCE_CATALOG } from "@/modules/workforce/domain/separation";
import { createApprovalRequest } from "@/modules/workflows/service/workflow-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  auditCount,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";

let ctx: TenantContext;
let hrAdmin: UserContext;
let secondHR: UserContext;

async function seedActiveEmployee(employeeNo: string): Promise<{ employeeId: string; employmentId: string }> {
  const created = await createEmployee(hrAdmin.subject, {
    person: { firstName: "Ayu", lastName: employeeNo },
    organizationId: ctx.organizationId,
    employeeNo,
    employeeType: "REGULAR",
    employment: {
      employmentNo: employeeNo,
      type: "PERMANENT",
      hireDate: new Date("2026-01-05"),
    },
  });
  await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, created.employmentId, {
    to: "ACTIVE",
  });
  return created;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("separation");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
  secondHR = await makeUser(ctx, "approver", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
});

describe("separation workflow journey", () => {
  it("request → decide APPROVED → apply executes the terminal transition, clearance tasks, notifications, audits", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S001");
    const terminationDate = new Date("2026-09-30");

    const { approvalId, status } = await requestSeparation(hrAdmin.subject, undefined, {
      employeeId,
      to: "TERMINATED",
      terminationDate,
      terminationReason: "REDUNDANCY",
      note: "Department decommissioned",
      approverUserId: secondHR.userId,
    });
    expect(status).toBe("PENDING");

    const approval = await prisma.approvalRequest.findFirstOrThrow({ where: { id: approvalId } });
    expect(approval.sourceType).toBe("SEPARATION");
    expect(approval.sourceId).toBe(employeeId);
    expect(approval.requestType).toBe("separation.TERMINATED");
    expect(approval.organizationId).toBe(ctx.organizationId);
    expect(approval.requesterUserId).toBe(hrAdmin.userId);
    expect(approval.approverUserId).toBe(secondHR.userId);
    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: secondHR.userId, notificationType: "separation.request" },
      }),
    ).toBe(1);
    expect(await auditCount(ctx.tenantId, "workflows.approval.create")).toBe(1);

    const decided = await decideSeparation(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    expect(decided.status).toBe("APPROVED");

    const result = await applySeparation(secondHR.subject, undefined, {
      approvalId,
      expectedVersion: 2,
      terminationDate,
      terminationReason: "REDUNDANCY",
    });
    expect(result.status).toBe("TERMINATED");
    expect(result.clearanceTaskIds).toHaveLength(SEPARATION_CLEARANCE_CATALOG.length);

    const employee = await prisma.employee.findFirstOrThrow({ where: { id: employeeId } });
    expect(employee.employmentStatus).toBe("TERMINATED");
    expect(employee.leftOn).toEqual(terminationDate);

    const employment = await prisma.employment.findFirstOrThrow({
      where: { id: result.employmentId },
    });
    expect(employment.status).toBe("TERMINATED");
    expect(employment.terminationDate).toEqual(terminationDate);
    expect(employment.terminationReason).toBe("REDUNDANCY");
    const history = employment.statusHistory as Array<{ status: string }>;
    expect(history.map((h) => h.status)).toEqual(
      expect.arrayContaining(["ACTIVE", "TERMINATED"]),
    );

    const tasks = await prisma.workflowTask.findMany({
      where: { sourceType: "SEPARATION", sourceId: employeeId, organizationId: ctx.organizationId },
    });
    expect(tasks).toHaveLength(SEPARATION_CLEARANCE_CATALOG.length);
    expect(
      tasks.every((t) => t.status === "PENDING" && t.assigneeUserId === secondHR.userId),
    ).toBe(true);
    const advances = tasks.find((t) => t.subject.includes("cash advances"));
    // Catalog offset +14 days from the separation date.
    expect(advances?.dueDate).toEqual(new Date("2026-10-14"));

    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: hrAdmin.userId, notificationType: "separation.applied" },
      }),
    ).toBe(1);
    // Decider notified the requester about the APPROVED decision.
    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: hrAdmin.userId, notificationType: "approval.decision" },
      }),
    ).toBe(1);

    expect(await auditCount(ctx.tenantId, "workflows.approval.decide")).toBe(1);
    expect(await auditCount(ctx.tenantId, "employee.employment.status_change")).toBe(2);
    expect(await auditCount(ctx.tenantId, "workflows.task.create")).toBe(
      SEPARATION_CLEARANCE_CATALOG.length,
    );
    expect(await auditCount(ctx.tenantId, "employee.separation.apply")).toBe(1);
  });

  it("RESIGNED round-trip carries the resignation date through approve → apply", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S002");
    const resignationDate = new Date("2026-11-15");

    const { approvalId } = await requestSeparation(secondHR.subject, undefined, {
      employeeId,
      to: "RESIGNED",
      resignationDate,
      approverUserId: hrAdmin.userId,
    });
    expect(
      await prisma.approvalRequest.findFirstOrThrow({ where: { id: approvalId } }),
    ).toMatchObject({ requestType: "separation.RESIGNED" });

    await decideSeparation(hrAdmin.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    const result = await applySeparation(hrAdmin.subject, undefined, {
      approvalId,
      expectedVersion: 2,
      resignationDate,
    });
    expect(result.status).toBe("RESIGNED");

    const employee = await prisma.employee.findFirstOrThrow({ where: { id: employeeId } });
    expect(employee.employmentStatus).toBe("RESIGNED");
    expect(employee.leftOn).toEqual(resignationDate);
    expect(
      await prisma.employment.findFirstOrThrow({ where: { id: result.employmentId } }),
    ).toMatchObject({ status: "RESIGNED", resignationDate });
  });
});

describe("separation workflow guards", () => {
  it("refuses non-HR requesters", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S003");
    const staff = await makeUser(ctx, "staff", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(
      requestSeparation(staff.subject, undefined, {
        employeeId,
        to: "RESIGNED",
        resignationDate: new Date("2026-11-01"),
      }),
    ).rejects.toThrow();
    await expect(
      requestSeparation(staff.subject, undefined, {
        employeeId,
        to: "RESIGNED",
        resignationDate: new Date("2026-11-01"),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
    expect(await auditCount(ctx.tenantId, "workflows.approval.create")).toBe(0);
  });

  it("refuses to apply a PENDING (undecided) separation", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S004");
    const { approvalId } = await requestSeparation(hrAdmin.subject, undefined, {
      employeeId,
      to: "TERMINATED",
      terminationDate: new Date("2026-10-01"),
      terminationReason: "MUTUAL_AGREEMENT",
      approverUserId: secondHR.userId,
    });
    await expect(
      applySeparation(secondHR.subject, undefined, {
        approvalId,
        expectedVersion: 1,
        terminationDate: new Date("2026-10-01"),
        terminationReason: "MUTUAL_AGREEMENT",
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
    const employee = await prisma.employee.findFirstOrThrow({ where: { id: employeeId } });
    expect(employee.employmentStatus).toBe("ACTIVE");
  });

  it("refuses to name yourself as approver", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S005");
    await expect(
      requestSeparation(hrAdmin.subject, undefined, {
        employeeId,
        to: "RESIGNED",
        resignationDate: new Date("2026-11-01"),
        approverUserId: hrAdmin.userId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("refuses to apply twice (terminal rows are immutable history)", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S006");
    const terminationDate = new Date("2026-10-05");
    const { approvalId } = await requestSeparation(hrAdmin.subject, undefined, {
      employeeId,
      to: "TERMINATED",
      terminationDate,
      terminationReason: "END_OF_CONTRACT",
      approverUserId: secondHR.userId,
    });
    await decideSeparation(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    const applied = await applySeparation(secondHR.subject, undefined, {
      approvalId,
      expectedVersion: 2,
      terminationDate,
      terminationReason: "END_OF_CONTRACT",
    });
    expect(applied.status).toBe("TERMINATED");
    await expect(
      applySeparation(secondHR.subject, undefined, {
        approvalId,
        expectedVersion: 3,
        terminationDate,
        terminationReason: "END_OF_CONTRACT",
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
  });

  it("cross-tenant access is NOT_FOUND, never a leak", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-S007");
    const foreign = await makeTenantContext("separation-foreign");
    const foreignHR = await makeUser(foreign, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [foreign.organizationId],
    });

    // Foreign tenant cannot even resolve our employee.
    await expect(
      requestSeparation(foreignHR.subject, undefined, {
        employeeId,
        to: "RESIGNED",
        resignationDate: new Date("2026-11-01"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // An approval produced here cannot be applied from another tenant.
    const { approvalId } = await requestSeparation(hrAdmin.subject, undefined, {
      employeeId,
      to: "RESIGNED",
      resignationDate: new Date("2026-11-01"),
      approverUserId: secondHR.userId,
    });
    await decideSeparation(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    await expect(
      applySeparation(foreignHR.subject, undefined, {
        approvalId,
        expectedVersion: 2,
        resignationDate: new Date("2026-11-01"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("separation HR queue", () => {
  it("lists only separation requests of the caller's org, not foreign orgs or other types", async () => {
    const orgB = ctx.secondOrganizationId;
    const orgBHR = await makeUser(ctx, "hradmin-b", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [orgB],
    });

    const { employeeId } = await seedActiveEmployee("EMP-26-S008");
    const { approvalId } = await requestSeparation(hrAdmin.subject, undefined, {
      employeeId,
      to: "RESIGNED",
      resignationDate: new Date("2026-12-01"),
      approverUserId: secondHR.userId,
    });

    // A non-separation approval in org A.
    await createApprovalRequest(hrAdmin.subject, undefined, {
      organizationId: ctx.organizationId,
      requestType: "leave.annual",
      subject: "Annual leave (probe)",
    });

    const orgBEmployee = await createEmployee(orgBHR.subject, {
      person: { firstName: "Bin", lastName: "OrgB" },
      organizationId: orgB,
      employeeNo: "EMP-26-S009",
      employeeType: "REGULAR",
      employment: { employmentNo: "S009", type: "PERMANENT", hireDate: new Date("2026-01-05") },
    });
    await changeEmploymentStatus(orgBHR.subject, orgB, orgBEmployee.employmentId, { to: "ACTIVE" });
    await requestSeparation(orgBHR.subject, undefined, {
      employeeId: orgBEmployee.employeeId,
      to: "RETIRED",
      retirementDate: new Date("2027-01-05"),
    });

    const queue = await listSeparationRequests(hrAdmin.subject, {});
    const ids = queue.map((a) => a.id);
    expect(ids).toContain(approvalId);
    expect(queue.every((a) => a.requestType.startsWith("separation."))).toBe(true);
    expect(queue.some((a) => a.organizationId === orgB)).toBe(false);
  });

  it("non-HR callers cannot read the pending queue", async () => {
    await seedActiveEmployee("EMP-26-S010");
    const staff = await makeUser(ctx, "staff2", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(listSeparationRequests(staff.subject, {})).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});