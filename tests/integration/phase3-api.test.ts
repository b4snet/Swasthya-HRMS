/**
 * Phase 3 prompt-3 integration tests — contract renewal/metadata/expiry-read
 * services, credential submission/suspension/archival, document metadata
 * detail read, audit events and optimistic-concurrency conflicts.
 *
 * Run: pnpm test:integration (real Postgres; helpers truncate between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createContract, changeContractStatus } from "@/modules/contracts/service/contract-service";
import {
  renewContract,
  updateContractMetadata,
  listContractsNearingExpiry,
} from "@/modules/contracts/service/contract-renewals";
import { createCredential } from "@/modules/workforce/service/child-entity-service";
import { createEmployee } from "@/modules/workforce/service/employee-service";
import { recordCredentialVerification } from "@/modules/credentials/service/verification-service";
import {
  submitCredentialForVerification,
  suspendCredential,
  reinstateCredential,
  archiveCredential,
  listCredentialsNearingExpiry,
} from "@/modules/credentials/service/credential-actions";
import { getDocumentDetail } from "@/modules/documents/service/document-queries";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  auditCount,
  auditLast,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";

let ctx: TenantContext;
let hrAdmin: UserContext;
let officer: UserContext;
let plainEmployee: UserContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("p3api");
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

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/** Hired employee + employment in the primary org. */
async function makeHired(seq: number) {
  return createEmployee(hrAdmin.subject, {
    person: { firstName: `Api${seq}`, lastName: "Worker", dateOfBirth: new Date("1990-05-01") },
    organizationId: ctx.organizationId,
    employeeNo: `EMP-26-${String(seq).padStart(5, "0")}`,
    employeeType: "REGULAR",
    employment: {
      employmentNo: `EMP-26-${String(seq).padStart(5, "0")}`,
      type: "PERMANENT",
      hireDate: new Date("2026-01-05"),
    },
  });
}

/** Created + activated fixed-term contract; returns the fresh contract row. */
async function makeActiveContract(employmentId: string, seq: number, daysToExpiry: number) {
  const created = await createContract(hrAdmin.subject, undefined, {
    organizationId: ctx.organizationId,
    employmentId,
    contractNo: `CONTRACT-HQ-26-${String(seq).padStart(5, "0")}`,
    title: `Agreement ${seq}`,
    type: "EMPLOYMENT",
    effectiveFrom: new Date("2026-01-05"),
    effectiveTo: daysFromNow(daysToExpiry),
    jurisdiction: "NP",
    firstVersion: {
      effectiveFrom: new Date("2026-01-05"),
      effectiveTo: daysFromNow(daysToExpiry),
      clauseNames: ["NOTICE_30"],
    },
  });
  await changeContractStatus(hrAdmin.subject, undefined, {
    contractId: created.id,
    to: "ACTIVE",
    expectedVersion: 1,
    approvedBy: hrAdmin.userId,
    approvedAt: new Date(),
  });
  return prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
}

/** LICENSE credential for the given employee. */
async function makeCredential(
  employeeId: string,
  seq: number,
  expiresOn: Date | null = daysFromNow(365),
) {
  const created = await createCredential(hrAdmin.subject, {
    organizationId: ctx.organizationId,
    employeeId,
    type: "LICENSE",
    name: `License ${seq}`,
    issuer: "Synthetic Council",
    expiresOn,
  });
  return prisma.employeeCredential.findUniqueOrThrow({ where: { id: created.id } });
}

// ═════════════════════ contract renewal / metadata / expiry reads ═════════

describe("contract renewal, metadata and expiry reads", () => {
  it("renews by superseding the current version, forward-only, and audits contract.renewed", async () => {
    const hired = await makeHired(1);
    const contract = await makeActiveContract(hired.employmentId, 1, 30);

    const result = await renewContract(hrAdmin.subject, undefined, {
      contractId: contract.id,
      expectedVersion: 2,
      newEffectiveTo: daysFromNow(395),
      note: "extended 12 months",
    });
    expect(result.versionNo).toBe(2);

    const versions = await prisma.contractVersion.findMany({
      where: { contractId: contract.id },
      orderBy: { versionNo: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.supersededAt).not.toBeNull(); // prior version preserved
    expect(versions[1]?.clauseNames).toEqual(["RENEWAL"]);
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.effectiveTo!.getTime()).toBeGreaterThan(daysFromNow(394).getTime());
    expect(after.status).toBe("ACTIVE"); // renewal is not a lifecycle transition
    expect(await auditCount(ctx.tenantId, "contract.renewed")).toBe(1);
    const renewed = await auditLast(ctx.tenantId, "contract.renewed");
    expect(renewed?.before).toMatchObject({ effectiveTo: expect.any(String) });
    expect(JSON.stringify(renewed?.after)).toContain("versionNo");
  });

  it("refuses shrinking the term, past dates, stale versions and frozen contracts", async () => {
    const hired = await makeHired(1);
    const contract = await makeActiveContract(hired.employmentId, 1, 300);

    // Shrink → forbidden (forward-only).
    await expect(
      renewContract(hrAdmin.subject, undefined, {
        contractId: contract.id,
        expectedVersion: 2,
        newEffectiveTo: daysFromNow(10),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_PERIOD_INVALID" });

    // Past date → forbidden.
    await expect(
      renewContract(hrAdmin.subject, undefined, {
        contractId: contract.id,
        expectedVersion: 2,
        newEffectiveTo: daysFromNow(-1),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_PERIOD_INVALID" });

    // Stale expectedVersion → conflict.
    await expect(
      renewContract(hrAdmin.subject, undefined, {
        contractId: contract.id,
        expectedVersion: 99,
        newEffectiveTo: daysFromNow(400),
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });

    // Frozen state → forbidden.
    await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: contract.id,
      to: "TERMINATED",
      expectedVersion: 2,
    });
    await expect(
      renewContract(hrAdmin.subject, undefined, {
        contractId: contract.id,
        expectedVersion: 3,
        newEffectiveTo: daysFromNow(400),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_STATE_INVALID" });
  });

  it("updates metadata without touching historical fields, manage-gated, audited", async () => {
    const hired = await makeHired(1);
    const contract = await makeActiveContract(hired.employmentId, 1, 30);

    await updateContractMetadata(hrAdmin.subject, undefined, {
      contractId: contract.id,
      expectedVersion: contract.version,
      notes: "clarified renewal terms",
    });
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(after.notes).toContain("clarified renewal terms");
    expect(after.status).toBe(contract.status);
    expect(after.effectiveTo?.getTime()).toBe(contract.effectiveTo?.getTime());
    expect(after.currentVersionNo).toBe(contract.currentVersionNo);
    expect(await auditCount(ctx.tenantId, "contract.updated")).toBe(1);

    // Manage-gated: capability-less user denied.
    await expect(
      updateContractMetadata(plainEmployee.subject, undefined, {
        contractId: contract.id,
        expectedVersion: after.version,
        title: "hijacked title",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("expiry read derives EXPIRING, omits out-of-reach rows, surfaces EXPIRED", async () => {
    const hired = await makeHired(1);
    await makeActiveContract(hired.employmentId, 1, 20); // inside the 60d window
    const far = await makeHired(2);
    await makeActiveContract(far.employmentId, 2, 300); // outside the window

    const items = await listContractsNearingExpiry(hrAdmin.subject, { windowDays: 60 });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("EXPIRING");

    // Cross-org caller: sees nothing (omitted, not an error).
    const orgBUser = await makeUser(ctx, "orgb", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [ctx.secondOrganizationId],
    });
    expect(await listContractsNearingExpiry(orgBUser.subject, { windowDays: 60 })).toHaveLength(0);

    // Past effectiveTo → EXPIRED derived (query includes status EXPIRED rows).
    await prisma.contract.updateMany({
      where: { tenantId: ctx.tenantId },
      data: { effectiveTo: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    const expired = await listContractsNearingExpiry(hrAdmin.subject, { today: new Date() });
    expect(expired.length).toBeGreaterThan(0);
    expect(expired.every((c) => c.status === "EXPIRED" || c.status === "EXPIRING")).toBe(true);
  });
});

// ═════════════════════════ credential lifecycle actions ═══════════════════

describe("credential lifecycle actions", () => {
  it("submission records PENDING and can never self-verify", async () => {
    const hired = await makeHired(1);
    const credential = await makeCredential(hired.employeeId, 1);

    const result = await submitCredentialForVerification(plainEmployee.subject, undefined, {
      credentialId: credential.id,
      note: "Uploaded my certificate, please verify",
    });
    expect(result.recordId).toBeTruthy();
    const after = await prisma.employeeCredential.findUniqueOrThrow({
      where: { id: credential.id },
    });
    expect(after.verificationStatus).toBe("PENDING"); // NEVER VERIFIED by submission
    expect(await auditCount(ctx.tenantId, "credential.submitted")).toBe(1);

    // Duplicate submission by the same user → rejected.
    await expect(
      submitCredentialForVerification(plainEmployee.subject, undefined, {
        credentialId: credential.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_DUPLICATE" });

    // Submission grants no verification power (separation of duties).
    await expect(
      recordCredentialVerification(plainEmployee.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "ISSUER_DIRECT",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    // VERIFIED credentials refuse further submissions.
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "VERIFIED",
      method: "PORTAL",
    });
    await expect(
      submitCredentialForVerification(plainEmployee.subject, undefined, {
        credentialId: credential.id,
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });
  });

  it("suspends and reinstates as explicit acts gated by credential:verify", async () => {
    const hired = await makeHired(1);
    const credential = await makeCredential(hired.employeeId, 1);
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "VERIFIED",
      method: "ISSUER_DIRECT",
    });

    // Officer lacks credential:verify → cannot suspend.
    await expect(
      suspendCredential(officer.subject, undefined, {
        credentialId: credential.id,
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    const suspended = await suspendCredential(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      expectedVersion: 2,
      note: "under investigation",
    });
    expect(suspended.status).toBe("SUSPENDED");
    expect(await auditCount(ctx.tenantId, "credential.suspended")).toBe(1);
    expect(
      (
        await prisma.credentialVerificationRecord.findMany({
          where: { credentialId: credential.id },
        })
      ).some((r) => r.outcome === "SUSPENDED"),
    ).toBe(true);

    const reinstated = await reinstateCredential(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      expectedVersion: 3,
    });
    expect(reinstated.status).toBe("VERIFIED");
    expect(await auditCount(ctx.tenantId, "credential.reinstated")).toBe(1);

    // Terminal REVOKED cannot be suspended (domain progression guard).
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "REVOKED",
      method: "ISSUER_DIRECT",
    });
    await expect(
      suspendCredential(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });
  });

  it("archives without deleting; archived credentials refuse verification acts", async () => {
    const hired = await makeHired(1);
    const credential = await makeCredential(hired.employeeId, 1);

    const archived = await archiveCredential(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      expectedVersion: 1,
    });
    expect(archived.status).toBe("ARCHIVED");
    expect(
      await prisma.employeeCredential.findUnique({ where: { id: credential.id } }),
    ).not.toBeNull();
    expect(await auditCount(ctx.tenantId, "credential.archived")).toBe(1);

    await expect(
      recordCredentialVerification(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "PORTAL",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });
  });

  it("expiry read derives EXPIRING/EXPIRED with per-type leads; omits out-of-reach", async () => {
    const hired = await makeHired(1);
    await makeCredential(hired.employeeId, 1, daysFromNow(20)); // inside LICENSE lead (90d)
    await makeCredential(hired.employeeId, 2, daysFromNow(300)); // outside

    const items = await listCredentialsNearingExpiry(hrAdmin.subject);
    expect(items).toHaveLength(1);
    expect(items[0]?.derivedStatus).toBe("EXPIRING");

    // A past `today` derives EXPIRED.
    const later = await listCredentialsNearingExpiry(hrAdmin.subject, { today: daysFromNow(30) });
    expect(later.some((c) => c.derivedStatus === "EXPIRED")).toBe(true);

    // Capability-less caller: nothing visible.
    expect(await listCredentialsNearingExpiry(plainEmployee.subject)).toHaveLength(0);
  });
});

// ═══════════════════════ document detail + concurrency ════════════════════

describe("document metadata detail", () => {
  it("returns version history without storage ids; cross-tenant is NOT_FOUND", async () => {
    const hired = await makeHired(1);
    const docType = await prisma.documentType.create({
      data: { tenantId: ctx.tenantId, code: "DOC_X", name: "Test type" },
    });
    const doc = await prisma.document.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeId: docType.id,
        title: "Detail test",
        currentVersionNo: 2,
        versions: {
          create: [
            {
              tenantId: ctx.tenantId,
              versionNo: 1,
              storageId: "s/v1",
              contentType: "application/pdf",
              sizeBytes: 10,
              checksumSha256: "a".repeat(64),
              supersededAt: new Date(),
            },
            {
              tenantId: ctx.tenantId,
              versionNo: 2,
              storageId: "s/v2",
              contentType: "application/pdf",
              sizeBytes: 12,
              checksumSha256: "b".repeat(64),
            },
          ],
        },
      },
    });

    const detail = await getDocumentDetail(hrAdmin.subject, doc.id);
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions.every((v) => !("storageId" in v))).toBe(true);
    expect(detail.currentVersionNo).toBe(2);

    // Cross-tenant → NOT_FOUND (IDOR posture).
    const other = await makeTenantContext("p3apiother");
    const otherAdmin = await makeUser(other, "admin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    await expect(getDocumentDetail(otherAdmin.subject, doc.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // Capability-less caller → denied.
    await expect(getDocumentDetail(plainEmployee.subject, doc.id)).rejects.toMatchObject({
      code: "AUTHORIZATION_DENIED",
    });
  });
});

describe("concurrency and boundary", () => {
  it("rejects concurrent status changes via optimistic version checks", async () => {
    const hired = await makeHired(1);
    const contract = await makeActiveContract(hired.employmentId, 1, 30);

    // Two actors read the same version; the first write wins, the second conflicts.
    await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: contract.id,
      to: "ARCHIVED",
      expectedVersion: contract.version,
    });
    await expect(
      changeContractStatus(hrAdmin.subject, undefined, {
        contractId: contract.id,
        to: "TERMINATED",
        expectedVersion: contract.version,
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
  });
});
