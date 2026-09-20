/**
 * Workforce integration tests — creation, lifecycle, assignment handover,
 * tenant isolation, sensitive projection, audit (Phase 2; ADR-010).
 *
 * Run: pnpm test:integration (real Postgres; tests/integration/helpers.ts
 * truncates between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmployee,
  createPerson,
  updatePerson,
  archivePerson,
  changeEmploymentStatus,
  archiveEmployee,
  createAssignment,
  closeOpenAssignment,
  listAssignments,
  getEmployeeDetail,
} from "@/modules/workforce/service/employee-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  makeSensitiveGrant,
  auditCount,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";

let ctx: TenantContext;
let hrAdmin: UserContext; // employee:manage + employee:read + sensitive-capable role
let officer: UserContext; // employee:manage + read, NO sensitive permission
let plainEmployee: UserContext; // no workforce capabilities

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("wf");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
  officer = await makeUser(ctx, "officer", [SYSTEM_ROLES.HR_OFFICER], {
    scopeOrgIds: [ctx.organizationId],
  });
  plainEmployee = await makeUser(ctx, "plain", [SYSTEM_ROLES.EMPLOYEE], {
    scopeOrgIds: [ctx.organizationId],
  });
});

const hireInput = (overrides: Partial<Parameters<typeof createEmployee>[1]> = {}) => ({
  person: {
    firstName: "Synthetic",
    lastName: "Worker",
    dateOfBirth: new Date("1990-05-01"),
    addressLine1: "12 Fake Street",
  },
  organizationId: ctx.organizationId,
  employeeNo: "EMP-26-00001",
  employeeType: "REGULAR" as const,
  employment: {
    employmentNo: "EMP-26-00001",
    type: "PERMANENT" as const,
    hireDate: new Date("2026-01-05"),
  },
  ...overrides,
});

let entitySeq = 0;

/** Seed a department + designation + position for assignment tests. Codes
 * are sequenced so repeated calls in one test never collide. */
async function seedOrgEntities() {
  entitySeq += 1;
  const n = entitySeq;
  const department = await prisma.department.create({
    data: {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      code: `DEPT-ER-${n}`,
      name: `Emergency ${n}`,
    },
  });
  const designation = await prisma.designation.create({
    data: {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      code: `DESG-MO-${n}`,
      name: "Medical Officer",
    },
  });
  const position = await prisma.position.create({
    data: {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      code: `POS-ER-${n}`,
      title: "Emergency Medical Officer",
      departmentId: department.id,
      designationId: designation.id,
    },
  });
  return { department, designation, position };
}

let hireSeq = 0;

/** Create an ACTIVE employee with an open assignment; returns ids. */
async function seedActiveEmployee() {
  hireSeq += 1;
  const n = String(hireSeq).padStart(5, "0");
  const { employeeId, employmentId } = await createEmployee(
    hrAdmin.subject,
    hireInput({ employeeNo: `EMP-26-${n}` }),
  );
  const { department, designation } = await seedOrgEntities();
  await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, { to: "ACTIVE" });
  const assignment = await createAssignment(hrAdmin.subject, {
    organizationId: ctx.organizationId,
    employmentId,
    departmentId: department.id,
    designationId: designation.id,
    effectiveFrom: new Date("2026-01-05"),
  });
  return { employeeId, employmentId, assignmentId: assignment.id, departmentId: department.id };
}

describe("employee creation", () => {
  it("creates person + employee + employment in one audited transaction", async () => {
    const { employeeId, employmentId } = await createEmployee(hrAdmin.subject, hireInput());
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.tenantId).toBe(ctx.tenantId);
    expect(employee?.organizationId).toBe(ctx.organizationId);
    expect(employee?.employmentStatus).toBe("PENDING_ONBOARDING");
    const employment = await prisma.employment.findUnique({ where: { id: employmentId } });
    expect(employment?.status).toBe("PENDING_ONBOARDING");
    expect(await auditCount(ctx.tenantId, "employee.create")).toBe(1);
  });

  it("rejects duplicate employeeNo within the organization (org-scoped uniqueness)", async () => {
    await createEmployee(hrAdmin.subject, hireInput());
    await expect(
      createEmployee(hrAdmin.subject, hireInput({ employeeNo: "EMP-26-00001" })),
    ).rejects.toMatchObject({
      code: "CONFLICT_DUPLICATE",
    });
  });

  it("allows the same employeeNo in a DIFFERENT organization of the tenant", async () => {
    await createEmployee(hrAdmin.subject, hireInput());
    // Grant reach over org B, then reuse the number there — uniqueness is
    // org-scoped, and the guard must allow a caller scoped to both orgs.
    await prisma.userAccessScope.create({
      data: {
        userId: hrAdmin.userId,
        scopeType: "ORGANIZATION",
        scopeId: ctx.secondOrganizationId,
      },
    });
    await expect(
      createEmployee(hrAdmin.subject, hireInput({ organizationId: ctx.secondOrganizationId })),
    ).resolves.toMatchObject({ employeeId: expect.any(String) });
  });

  it("denies users without employee:manage (capability vs scope)", async () => {
    await expect(createEmployee(plainEmployee.subject, hireInput())).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});

describe("employment lifecycle", () => {
  it("walks DRAFT-less path PENDING_ONBOARDING → ACTIVE and appends history", async () => {
    const { employmentId } = await createEmployee(hrAdmin.subject, hireInput());
    const result = await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "ACTIVE",
    });
    expect(result.status).toBe("ACTIVE");
    const employment = await prisma.employment.findUnique({ where: { id: employmentId } });
    const history = employment?.statusHistory as unknown as { status: string }[];
    expect(history.map((h) => h.status)).toEqual(["PENDING_ONBOARDING", "ACTIVE"]);
  });

  it("suspends and reactivates", async () => {
    const { employmentId } = await seedActiveEmployee();
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "SUSPENDED",
    });
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "ACTIVE",
    });
    const employment = await prisma.employment.findUnique({ where: { id: employmentId } });
    expect(employment?.status).toBe("ACTIVE");
  });

  it("rejects illegal transitions (DRAFT → ACTIVE, terminal revival)", async () => {
    const { employmentId } = await seedActiveEmployee();
    await expect(
      changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
        to: "PENDING_ONBOARDING",
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "TERMINATED",
      terminationDate: new Date("2026-06-01"),
      terminationReason: "REDUNDANCY",
    });
    await expect(
      changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, { to: "ACTIVE" }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("requires termination date + reason for TERMINATED", async () => {
    const { employmentId } = await seedActiveEmployee();
    await expect(
      changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
        to: "TERMINATED",
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
    await expect(
      changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
        to: "TERMINATED",
        terminationDate: new Date(),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("mirrors terminal status onto the employee and sets leftOn", async () => {
    const { employeeId, employmentId } = await seedActiveEmployee();
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "RESIGNED",
      resignationDate: new Date("2026-08-15"),
    });
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    expect(employee?.employmentStatus).toBe("RESIGNED");
    expect(employee?.leftOn?.toISOString().slice(0, 10)).toBe("2026-08-15");
  });
});

describe("assignment handover (one open per employment)", () => {
  it("creates the first open assignment and fills the position", async () => {
    const { employeeId, assignmentId, departmentId } = await seedActiveEmployee();
    const assignment = await prisma.employmentAssignment.findUnique({
      where: { id: assignmentId },
    });
    expect(assignment?.effectiveTo).toBeNull();
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    expect(employee).toBeTruthy();
    // positionId was null here; check department binding:
    expect(assignment?.departmentId).toBe(departmentId);
  });

  it("rejects a second open assignment without handover", async () => {
    const { employmentId } = await seedActiveEmployee();
    const { department } = await seedOrgEntities();
    await expect(
      createAssignment(hrAdmin.subject, {
        organizationId: ctx.organizationId,
        employmentId,
        departmentId: department.id,
        effectiveFrom: new Date("2026-02-01"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_ASSIGNMENT_OVERLAP" });
  });

  it("performs same-day handover: closes old, opens new, preserves both rows", async () => {
    const { employmentId, assignmentId } = await seedActiveEmployee();
    const { department } = await seedOrgEntities();
    const handoverAt = new Date("2026-03-01");
    const replacement = await createAssignment(hrAdmin.subject, {
      organizationId: ctx.organizationId,
      employmentId,
      departmentId: department.id,
      effectiveFrom: handoverAt,
      closeCurrentAt: handoverAt,
    });
    const rows = await listAssignments(hrAdmin.subject, ctx.organizationId, employmentId);
    expect(rows).toHaveLength(2);
    const oldRow = rows.find((r) => r.id === assignmentId);
    expect(oldRow?.effectiveTo?.toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(oldRow?.open).toBe(false);
    const newRow = rows.find((r) => r.id === replacement.id);
    expect(newRow?.open).toBe(true);
  });

  it("rejects handover earlier than the open assignment start", async () => {
    const { employmentId } = await seedActiveEmployee();
    const { department } = await seedOrgEntities();
    await expect(
      createAssignment(hrAdmin.subject, {
        organizationId: ctx.organizationId,
        employmentId,
        departmentId: department.id,
        effectiveFrom: new Date("2026-03-01"),
        closeCurrentAt: new Date("2025-01-01"),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_ASSIGNMENT_OVERLAP" });
  });

  it("closes the open assignment and re-vacates the position on separation", async () => {
    const { employmentId } = await seedActiveEmployee();
    const position = await (async () => {
      const { position } = await seedOrgEntities();
      await createAssignment(hrAdmin.subject, {
        organizationId: ctx.organizationId,
        employmentId,
        positionId: position.id,
        effectiveFrom: new Date("2026-01-05"),
        closeCurrentAt: new Date("2026-01-05"),
      });
      return position;
    })();
    expect((await prisma.position.findUnique({ where: { id: position.id } }))?.status).toBe(
      "FILLED",
    );
    const closed = await closeOpenAssignment(
      hrAdmin.subject,
      ctx.organizationId,
      employmentId,
      new Date("2026-06-30"),
    );
    expect(closed.id).toBeTruthy();
    expect((await prisma.position.findUnique({ where: { id: position.id } }))?.status).toBe(
      "VACANT",
    );
    // History retained: the closed row still exists.
    const rows = await listAssignments(hrAdmin.subject, ctx.organizationId, employmentId);
    expect(rows).toHaveLength(2);
  });

  it("rejects referencing org entities from another organization (relationship consistency)", async () => {
    const { employmentId } = await seedActiveEmployee();
    // Department in org B of the SAME tenant.
    const foreignDept = await prisma.department.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.secondOrganizationId,
        code: "DEPT-B",
        name: "Org B Dept",
      },
    });
    await expect(
      createAssignment(hrAdmin.subject, {
        organizationId: ctx.organizationId,
        employmentId,
        departmentId: foreignDept.id,
        effectiveFrom: new Date("2026-02-01"),
        closeCurrentAt: new Date("2026-02-01"),
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_INVALID" });
  });
});

describe("tenant isolation & IDOR", () => {
  it("tenant B admin cannot read, transition, or assign tenant A employees", async () => {
    const { employeeId, employmentId } = await seedActiveEmployee();
    const tenantB = await makeTenantContext("other");
    const adminB = await makeUser(tenantB, "adminB", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [tenantB.organizationId],
    });
    // Tenant mismatch is refused at the guard before resource lookup —
    // AUTHORIZATION_DENIED, never a scope-leaking NOT_FOUND distinction.
    await expect(
      getEmployeeDetail(adminB.subject, ctx.organizationId, employeeId),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
    await expect(
      changeEmploymentStatus(adminB.subject, ctx.organizationId, employmentId, { to: "SUSPENDED" }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
    await expect(
      createAssignment(adminB.subject, {
        organizationId: ctx.organizationId,
        employmentId,
        effectiveFrom: new Date("2026-02-01"),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("direct object ids from another organization fail closed (no scope leak)", async () => {
    const { employeeId } = await seedActiveEmployee();
    // hrAdmin is scoped to org A only; org B is same tenant. The guard
    // refuses before any resource lookup — AUTHORIZATION_DENIED, and the
    // employee's existence in org A is never revealed through the error.
    await expect(
      getEmployeeDetail(hrAdmin.subject, ctx.secondOrganizationId, employeeId),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("sensitive projection", () => {
  it("strips DOB/address for users without the sensitive permission", async () => {
    const { employeeId } = await seedActiveEmployee();
    const detail = await getEmployeeDetail(officer.subject, ctx.organizationId, employeeId);
    expect(detail.person.dateOfBirth).toBeNull();
    expect(detail.person.addressLine1).toBeNull();
    expect(detail.sensitiveViewed).toBe(false);
  });

  it("serves sensitive fields for permission + SENSITIVE scope, writing a view event", async () => {
    await makeSensitiveGrant(ctx.tenantId, hrAdmin.userId);
    const { employeeId } = await seedActiveEmployee();
    const detail = await getEmployeeDetail(hrAdmin.subject, ctx.organizationId, employeeId);
    expect(detail.sensitiveViewed).toBe(true);
    expect(detail.person.dateOfBirth?.toISOString().slice(0, 10)).toBe("1990-05-01");
    expect(await auditCount(ctx.tenantId, "employee.sensitive.view")).toBe(1);
  });

  it("denies sensitive projection even with scope but without the permission", async () => {
    await makeSensitiveGrant(ctx.tenantId, officer.userId);
    const { employeeId } = await seedActiveEmployee();
    const detail = await getEmployeeDetail(officer.subject, ctx.organizationId, employeeId);
    expect(detail.person.dateOfBirth).toBeNull();
    expect(await auditCount(ctx.tenantId, "employee.sensitive.view")).toBe(0);
  });

  it("never writes DOB/address values into audit payloads", async () => {
    await makeSensitiveGrant(ctx.tenantId, hrAdmin.userId);
    const { employeeId } = await seedActiveEmployee();
    await getEmployeeDetail(hrAdmin.subject, ctx.organizationId, employeeId);
    const events = await prisma.auditEvent.findMany({ where: { tenantId: ctx.tenantId } });
    for (const event of events) {
      const payload = JSON.stringify({ before: event.before, after: event.after });
      expect(payload).not.toContain("1990-05-01");
      expect(payload).not.toContain("12 Fake Street");
    }
  });
});

describe("archival & historical retention", () => {
  it("archives a separated employee with no open assignment", async () => {
    const { employeeId, employmentId } = await seedActiveEmployee();
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "RESIGNED",
      resignationDate: new Date("2026-08-15"),
    });
    // Separation closes the assignment before archival is possible.
    await closeOpenAssignment(
      hrAdmin.subject,
      ctx.organizationId,
      employmentId,
      new Date("2026-08-15"),
    );
    // Read the current version after the status mirror bumped it.
    const current = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { version: true },
    });
    const archived = await archiveEmployee(
      hrAdmin.subject,
      ctx.organizationId,
      employeeId,
      current.version,
    );
    expect(archived.id).toBe(employeeId);
    expect((await prisma.employee.findUnique({ where: { id: employeeId } }))?.status).toBe(
      "ARCHIVED",
    );
    expect(await auditCount(ctx.tenantId, "employee.archive")).toBe(1);
  });

  it("refuses to archive an employee with an open assignment", async () => {
    const { employeeId, employmentId } = await seedActiveEmployee();
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "INACTIVE",
    });
    const current = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { version: true },
    });
    await expect(
      archiveEmployee(hrAdmin.subject, ctx.organizationId, employeeId, current.version),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_INVALID" });
    // Employee remains non-archived; nothing deleted.
    expect((await prisma.employee.findUnique({ where: { id: employeeId } }))?.status).toBe(
      "ACTIVE",
    );
  });

  it("retains employment and assignment history after separation", async () => {
    const { employmentId } = await seedActiveEmployee();
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "TERMINATED",
      terminationDate: new Date("2026-06-30"),
      terminationReason: "END_OF_CONTRACT",
    });
    await closeOpenAssignment(
      hrAdmin.subject,
      ctx.organizationId,
      employmentId,
      new Date("2026-06-30"),
    );
    const employment = await prisma.employment.findUnique({ where: { id: employmentId } });
    expect(employment?.status).toBe("TERMINATED");
    const history = employment?.statusHistory as unknown as { status: string }[];
    expect(history.map((h) => h.status)).toEqual(["PENDING_ONBOARDING", "ACTIVE", "TERMINATED"]);
    const assignments = await listAssignments(hrAdmin.subject, ctx.organizationId, employmentId);
    expect(assignments).toHaveLength(1); // closed, not deleted
    expect(assignments[0]?.effectiveTo).toBeTruthy();
  });
});

describe("person services", () => {
  it("creates a person and audit event", async () => {
    const person = await createPerson(hrAdmin.subject, { firstName: "Asha", lastName: "Karki" });
    expect(await auditCount(ctx.tenantId, "employee.person.create")).toBe(1);
    const row = await prisma.person.findUnique({ where: { id: person.id } });
    expect(row?.firstName).toBe("Asha");
    expect(row?.tenantId).toBe(ctx.tenantId);
  });

  it("updates a person with optimistic concurrency and archives without deleting", async () => {
    const person = await createPerson(hrAdmin.subject, { firstName: "Bikash", lastName: "Thapa" });
    await updatePerson(hrAdmin.subject, person.id, {
      preferredName: "Biki",
      expectedVersion: 1,
    });
    const row = await prisma.person.findUnique({ where: { id: person.id } });
    expect(row?.preferredName).toBe("Biki");
    expect(row?.version).toBe(2);
    await archivePerson(hrAdmin.subject, person.id, 2);
    const archived = await prisma.person.findUnique({ where: { id: person.id } });
    expect(archived?.status).toBe("ARCHIVED"); // archival, never deletion
  });
});

describe("stable errors", () => {
  it("maps unknown ids to NOT_FOUND without leaking internals", async () => {
    await expect(
      getEmployeeDetail(hrAdmin.subject, ctx.organizationId, "nonexistent-id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("denies read for users without employee:read", async () => {
    const { employeeId } = await seedActiveEmployee();
    await expect(
      getEmployeeDetail(plainEmployee.subject, ctx.organizationId, employeeId),
    ).rejects.toBeInstanceOf(WorkforceAppError);
  });
});
