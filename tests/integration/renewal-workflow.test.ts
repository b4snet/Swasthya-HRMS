/**
 * Renewal workflow integration tests (Slice 1.1 continuation; Phase 1
 * roadmap "contract renewal workflow" + credential renewal on the same
 * primitives).
 *
 * Journeys: HR requests a contract/credential renewal → assigned approver
 * decides → executor applies the dated effect (contract term + employment
 * contractEndDate; credential expiry + append-only renewal ledger row),
 * all with audits and notifications. Guards mirror the separation suite:
 * non-HR denied, non-ACTIVE/non-expiring sources rejected, non-extending or
 * past dates rejected, self-approval refused, PENDING cannot apply,
 * cross-tenant NOT_FOUND.
 *
 * Run: pnpm test:integration (real Postgres; helpers truncate between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmployee,
  changeEmploymentStatus,
} from "@/modules/workforce/service/employee-service";
import { createCredential } from "@/modules/workforce/service/child-entity-service";
import {
  applyContractRenewal,
  applyCredentialRenewal,
  decideRenewal,
  listRenewalRequests,
  requestContractRenewal,
  requestCredentialRenewal,
} from "@/modules/workforce/service/renewal-service";
import { createApprovalRequest } from "@/modules/workflows/service/workflow-service";
import { isRenewalRequestType } from "@/modules/workforce/domain/renewal";
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

async function seedActiveEmployee(
  employeeNo: string,
): Promise<{ employeeId: string; employmentId: string }> {
  const created = await createEmployee(hrAdmin.subject, {
    person: { firstName: "Ren", lastName: employeeNo },
    organizationId: ctx.organizationId,
    employeeNo,
    employeeType: "REGULAR",
    employment: { employmentNo: employeeNo, type: "CONTRACT", hireDate: new Date("2026-01-05") },
  });
  await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, created.employmentId, {
    to: "ACTIVE",
  });
  return created;
}

async function seedActiveContract(employmentId: string, contractNo: string) {
  return prisma.contract.create({
    data: {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      employmentId,
      contractNo,
      title: `Contract ${contractNo}`,
      type: "EMPLOYMENT",
      status: "ACTIVE",
      effectiveFrom: new Date("2026-01-05"),
      effectiveTo: new Date("2026-12-31"),
    },
  });
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("renewal");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
  secondHR = await makeUser(ctx, "approver", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
});

describe("contract renewal journey", () => {
  it("request → decide APPROVED → apply extends the contract term and employment contractEndDate", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R001");
    const contract = await seedActiveContract(employmentId, "CT-1");

    const requested = await requestContractRenewal(hrAdmin.subject, undefined, {
      employmentId,
      newEffectiveFrom: new Date("2027-01-01"),
      newEffectiveTo: new Date("2027-12-31"),
      note: "Second term",
      approverUserId: secondHR.userId,
    });
    expect(requested.approvalStatus).toBe("PENDING");

    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: { id: requested.approvalId },
    });
    expect(approval.sourceType).toBe("CONTRACT");
    expect(approval.sourceId).toBe(contract.id);
    expect(approval.requestType).toBe("contract.renewal");
    expect(approval.organizationId).toBe(ctx.organizationId);
    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: secondHR.userId, notificationType: "contract.renewal.request" },
      }),
    ).toBe(1);

    const decided = await decideRenewal(secondHR.subject, undefined, {
      approvalId: requested.approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    expect(decided.status).toBe("APPROVED");

    const newEnd = new Date("2027-12-31");
    const applied = await applyContractRenewal(secondHR.subject, undefined, {
      approvalId: requested.approvalId,
      expectedVersion: 2,
      newEffectiveTo: newEnd,
    });
    expect(applied.effectiveTo).toEqual(newEnd);

    const contractRow = await prisma.contract.findFirstOrThrow({ where: { id: contract.id } });
    expect(contractRow.effectiveTo).toEqual(newEnd);
    expect(contractRow.version).toBe(2);
    const employment = await prisma.employment.findFirstOrThrow({ where: { id: employmentId } });
    expect(employment.contractEndDate).toEqual(newEnd);

    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: hrAdmin.userId, notificationType: "contract.renewal.applied" },
      }),
    ).toBe(1);
    expect(await auditCount(ctx.tenantId, "workflows.approval.create")).toBe(1);
    expect(await auditCount(ctx.tenantId, "workflows.approval.decide")).toBe(1);
    expect(await auditCount(ctx.tenantId, "contract.renewal.apply")).toBe(1);
  });
});

describe("contract renewal guards", () => {
  it("refuses non-HR requesters", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R002");
    await seedActiveContract(employmentId, "CT-2");
    const staff = await makeUser(ctx, "staff", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(
      requestContractRenewal(staff.subject, undefined, {
        employmentId,
        newEffectiveFrom: new Date("2027-01-01"),
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("refuses to renew a non-ACTIVE contract", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R003");
    await prisma.contract.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        employmentId,
        contractNo: "CT-DRAFT",
        title: "Draft contract",
        type: "EMPLOYMENT",
        status: "DRAFT",
        effectiveFrom: new Date("2026-01-05"),
        effectiveTo: new Date("2026-12-31"),
      },
    });
    await expect(
      requestContractRenewal(hrAdmin.subject, undefined, {
        employmentId,
        newEffectiveFrom: new Date("2027-01-01"),
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("refuses a non-extending term", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R004");
    await seedActiveContract(employmentId, "CT-3");
    await expect(
      requestContractRenewal(hrAdmin.subject, undefined, {
        employmentId,
        newEffectiveFrom: new Date("2027-01-01"),
        newEffectiveTo: new Date("2026-06-30"),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("refuses to name yourself as approver", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R005");
    await seedActiveContract(employmentId, "CT-4");
    await expect(
      requestContractRenewal(hrAdmin.subject, undefined, {
        employmentId,
        newEffectiveFrom: new Date("2027-01-01"),
        newEffectiveTo: new Date("2027-12-31"),
        approverUserId: hrAdmin.userId,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("refuses to apply a PENDING renewal and refuses a second (non-extending) apply", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R006");
    await seedActiveContract(employmentId, "CT-5");
    const { approvalId } = await requestContractRenewal(hrAdmin.subject, undefined, {
      employmentId,
      newEffectiveFrom: new Date("2027-01-01"),
      newEffectiveTo: new Date("2027-12-31"),
      approverUserId: secondHR.userId,
    });
    await expect(
      applyContractRenewal(secondHR.subject, undefined, {
        approvalId,
        expectedVersion: 1,
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });

    await decideRenewal(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    await applyContractRenewal(secondHR.subject, undefined, {
      approvalId,
      expectedVersion: 2,
      newEffectiveTo: new Date("2027-12-31"),
    });
    await expect(
      applyContractRenewal(secondHR.subject, undefined, {
        approvalId,
        expectedVersion: 3,
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("cross-tenant access is NOT_FOUND, never a leak", async () => {
    const { employmentId } = await seedActiveEmployee("EMP-26-R007");
    await seedActiveContract(employmentId, "CT-6");
    const foreign = await makeTenantContext("renewal-foreign");
    const foreignHR = await makeUser(foreign, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [foreign.organizationId],
    });
    const { approvalId } = await requestContractRenewal(hrAdmin.subject, undefined, {
      employmentId,
      newEffectiveFrom: new Date("2027-01-01"),
      newEffectiveTo: new Date("2027-12-31"),
      approverUserId: secondHR.userId,
    });
    await decideRenewal(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    await expect(
      applyContractRenewal(foreignHR.subject, undefined, {
        approvalId,
        expectedVersion: 2,
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("credential renewal journey", () => {
  it("request → decide APPROVED → apply moves expiry and records the append-only renewal", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-R020");
    const credential = await createCredential(hrAdmin.subject, {
      organizationId: ctx.organizationId,
      employeeId,
      type: "LICENSE",
      name: "NMC License",
      issuer: "NMC",
      credentialNumber: "NM-0001",
      issuedOn: new Date("2024-09-30"),
      expiresOn: new Date("2026-09-30"),
    });

    const requested = await requestCredentialRenewal(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      note: "Recertified",
      approverUserId: secondHR.userId,
    });
    expect(requested.approvalStatus).toBe("PENDING");
    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: { id: requested.approvalId },
    });
    expect(approval.sourceType).toBe("CREDENTIAL");
    expect(approval.sourceId).toBe(credential.id);
    expect(approval.requestType).toBe("credential.renewal");
    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: secondHR.userId, notificationType: "credential.renewal.request" },
      }),
    ).toBe(1);

    const decided = await decideRenewal(secondHR.subject, undefined, {
      approvalId: requested.approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    expect(decided.status).toBe("APPROVED");

    const newExpiry = new Date("2028-09-30");
    const applied = await applyCredentialRenewal(secondHR.subject, undefined, {
      approvalId: requested.approvalId,
      expectedVersion: 2,
      newExpiresOn: newExpiry,
    });
    expect(applied.expiresOn).toEqual(newExpiry);

    const credentialRow = await prisma.employeeCredential.findFirstOrThrow({
      where: { id: credential.id },
    });
    expect(credentialRow.expiresOn).toEqual(newExpiry);
    const renewals = await prisma.credentialRenewal.findMany({
      where: { credentialId: credential.id },
    });
    expect(renewals).toHaveLength(1);
    expect(renewals[0].newExpiresOn).toEqual(newExpiry);
    expect(renewals[0].notes).toBe("Recertified");

    expect(
      await prisma.appNotification.count({
        where: { recipientUserId: hrAdmin.userId, notificationType: "credential.renewal.applied" },
      }),
    ).toBe(1);
    expect(await auditCount(ctx.tenantId, "credential.renewal.apply")).toBe(1);
  });
});

describe("credential renewal guards", () => {
  it("refuses a credential without an expiry and past new expiry dates", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-R021");
    const noExpiry = await createCredential(hrAdmin.subject, {
      organizationId: ctx.organizationId,
      employeeId,
      type: "CERTIFICATION",
      name: "BLS",
      issuer: "AHA",
    });
    await expect(
      requestCredentialRenewal(hrAdmin.subject, undefined, { credentialId: noExpiry.id }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });

    const nearExpiry = await createCredential(hrAdmin.subject, {
      organizationId: ctx.organizationId,
      employeeId,
      type: "LICENSE",
      name: "State License",
      issuer: "State",
      expiresOn: new Date("2026-09-30"),
    });
    const { approvalId } = await requestCredentialRenewal(hrAdmin.subject, undefined, {
      credentialId: nearExpiry.id,
      approverUserId: secondHR.userId,
    });
    await decideRenewal(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    await expect(
      applyCredentialRenewal(secondHR.subject, undefined, {
        approvalId,
        expectedVersion: 2,
        newExpiresOn: new Date("2026-01-01"),
      }),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });
  });

  it("refuses non-HR requesters and foreign-tenant apply", async () => {
    const { employeeId } = await seedActiveEmployee("EMP-26-R022");
    const credential = await createCredential(hrAdmin.subject, {
      organizationId: ctx.organizationId,
      employeeId,
      type: "REGISTRATION",
      name: "Council Reg",
      issuer: "Council",
      expiresOn: new Date("2026-10-31"),
    });
    const staff = await makeUser(ctx, "staff", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(
      requestCredentialRenewal(staff.subject, undefined, { credentialId: credential.id }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    const foreign = await makeTenantContext("renewal-cred-foreign");
    const foreignHR = await makeUser(foreign, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [foreign.organizationId],
    });
    const { approvalId } = await requestCredentialRenewal(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      approverUserId: secondHR.userId,
    });
    await decideRenewal(secondHR.subject, undefined, {
      approvalId,
      decision: "APPROVED",
      expectedVersion: 1,
    });
    await expect(
      applyCredentialRenewal(foreignHR.subject, undefined, {
        approvalId,
        expectedVersion: 2,
        newExpiresOn: new Date("2028-10-31"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("renewal HR queue", () => {
  it("lists only contract/credential renewals of the caller's org, not foreign orgs or other types", async () => {
    const orgB = ctx.secondOrganizationId;
    const orgBHR = await makeUser(ctx, "hradmin-b", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [orgB],
    });

    const { employmentId } = await seedActiveEmployee("EMP-26-R040");
    await seedActiveContract(employmentId, "CT-7");
    const { approvalId } = await requestContractRenewal(hrAdmin.subject, undefined, {
      employmentId,
      newEffectiveFrom: new Date("2027-01-01"),
      newEffectiveTo: new Date("2027-12-31"),
      approverUserId: secondHR.userId,
    });

    await createApprovalRequest(hrAdmin.subject, undefined, {
      organizationId: ctx.organizationId,
      requestType: "leave.annual",
      subject: "Annual leave (probe)",
    });

    const orgBEmployee = await createEmployee(orgBHR.subject, {
      person: { firstName: "Bin", lastName: "OrgB" },
      organizationId: orgB,
      employeeNo: "EMP-26-R041",
      employeeType: "REGULAR",
      employment: { employmentNo: "R041", type: "CONTRACT", hireDate: new Date("2026-01-05") },
    });
    await changeEmploymentStatus(orgBHR.subject, orgB, orgBEmployee.employmentId, { to: "ACTIVE" });
    await prisma.contract.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: orgB,
        employmentId: orgBEmployee.employmentId,
        contractNo: "CT-B1",
        title: "OrgB contract",
        type: "EMPLOYMENT",
        status: "ACTIVE",
        effectiveFrom: new Date("2026-01-05"),
        effectiveTo: new Date("2026-12-31"),
      },
    });
    await requestContractRenewal(orgBHR.subject, undefined, {
      employmentId: orgBEmployee.employmentId,
      newEffectiveFrom: new Date("2027-01-01"),
      newEffectiveTo: new Date("2027-12-31"),
    });

    const queue = await listRenewalRequests(hrAdmin.subject, {});
    const ids = queue.map((a) => a.id);
    expect(ids).toContain(approvalId);
    expect(queue.every((a) => isRenewalRequestType(a.requestType))).toBe(true);
    expect(queue.some((a) => a.organizationId === orgB)).toBe(false);
  });

  it("non-HR callers cannot read the pending queue", async () => {
    const staff = await makeUser(ctx, "staff2", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(listRenewalRequests(staff.subject, {})).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});