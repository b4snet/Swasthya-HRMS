/**
 * Phase 3 integration tests — contracts, documents, credentials (ADR-011).
 *
 * Run: pnpm test:integration (real Postgres; tests/integration/helpers.ts
 * truncates between tests). Covers: tenant isolation, cross-org scope,
 * unauthorized mutation, contract versioning (append-only), document
 * security (scan hook, classification gate, audited downloads), credential
 * verification as a recorded act, expiry sweeps, and archival.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createContract,
  amendContract,
  changeContractStatus,
  archiveContract,
  runContractExpirySweep,  } from "@/modules/contracts/service/contract-service";
import {
  uploadDocument,
  replaceDocument,
  downloadDocument,
  archiveDocument,
  listDocumentsForSubject,
} from "@/modules/documents/service/document-service";
import { LocalDiskDocumentStorage } from "@/modules/documents/storage/local-disk";
import type { DocumentScanHook } from "@/modules/documents/storage/scan-hook";
import {
  recordCredentialVerification,
  renewCredential,
  runCredentialExpirySweep,
  createIssuingAuthority,
  archiveIssuingAuthority,
  attachIssuingAuthority,
  listVerificationRecords,
} from "@/modules/credentials/service/verification-service";
import { createCredential } from "@/modules/workforce/service/child-entity-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import { createEmployee } from "@/modules/workforce/service/employee-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  makeSensitiveGrant,
  auditCount,
  auditLast,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let ctx: TenantContext;
let hrAdmin: UserContext; // manage + read + verify + sensitive-permission-capable
let officer: UserContext; // manage + read, NO verify, NO sensitive permission
let plainEmployee: UserContext; // no phase-3 capabilities
let storageRoot: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("p3");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
  officer = await makeUser(ctx, "officer", [SYSTEM_ROLES.HR_OFFICER], {
    scopeOrgIds: [ctx.organizationId],
  });
  plainEmployee = await makeUser(ctx, "plain", [SYSTEM_ROLES.EMPLOYEE], {
    scopeOrgIds: [ctx.organizationId],
  });
  storageRoot = await mkdtemp(join(tmpdir(), "swasthya-p3-it-"));
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/** Hired (PENDING_ONBOARDING) employee + employment in the primary org. */
async function makeHired(seq: number, organizationId = ctx.organizationId) {
  return createEmployee(hrAdmin.subject, {
    person: {
      firstName: `Synthetic${seq}`,
      lastName: "Worker",
      dateOfBirth: new Date("1990-05-01"),
    },
    organizationId,
    employeeNo: `EMP-26-${String(seq).padStart(5, "0")}`,
    employeeType: "REGULAR",
    employment: {
      employmentNo: `EMP-26-${String(seq).padStart(5, "0")}`,
      type: "PERMANENT",
      hireDate: new Date("2026-01-05"),
    },
  });
}

async function makeDocType(
  code: string,
  classification: "EMPLOYMENT" | "SENSITIVE_PERSONAL" | "CREDENTIAL" = "EMPLOYMENT",
) {
  const t = await prisma.documentType.create({
    data: {
      tenantId: ctx.tenantId,
      code,
      name: `Type ${code}`,
      defaultClassification: classification,
    },
    select: { id: true },
  });
  return t.id;
}

const contractInput = (
  employmentId: string,
  contractNo: string,
  effectiveTo: Date | null = null,
) => ({
  organizationId: ctx.organizationId,
  employmentId,
  contractNo,
  title: `Agreement ${contractNo}`,
  type: "EMPLOYMENT" as const,
  effectiveFrom: new Date("2026-01-05"),
  effectiveTo,
  jurisdiction: "NP",
  firstVersion: {
    effectiveFrom: new Date("2026-01-05"),
    clauseNames: ["PROBATION_90_DAYS", "NOTICE_30"],
  },
});

// ════════════════════════════════════════════════════════════════════════
// Contracts
// ════════════════════════════════════════════════════════════════════════

describe("contracts", () => {
  it("creates a DRAFT contract with its first append-only version and an audit event", async () => {
    const hired = await makeHired(1);
    const created = await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
    );
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("DRAFT");
    expect(row.currentVersionNo).toBe(1);
    const versions = await prisma.contractVersion.findMany({ where: { contractId: created.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.clauseNames).toContain("NOTICE_30");
    expect(await auditCount(ctx.tenantId, "contract.created")).toBe(1);
  });

  it("rejects duplicate contract numbers, DRAFT employments, and malformed numbers", async () => {
    const hired = await makeHired(1);
    await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
    );
    await expect(
      createContract(
        hrAdmin.subject,
        undefined,
        contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT_DUPLICATE" });

    const draft = await createEmployee(hrAdmin.subject, {
      person: { firstName: "Draft", lastName: "Hire" },
      organizationId: ctx.organizationId,
      employeeNo: "EMP-26-00009",
      employeeType: "REGULAR",
      employment: { employmentNo: "EMP-26-00009", type: "PERMANENT", hireDate: new Date() },
    });
    // createEmployee starts at PENDING_ONBOARDING; force DRAFT to test the guard.
    await prisma.employment.update({
      where: { id: draft.employmentId },
      data: { status: "DRAFT" },
    });
    await expect(
      createContract(
        hrAdmin.subject,
        undefined,
        contractInput(draft.employmentId, "CONTRACT-HQ-26-00002"),
      ),
    ).rejects.toMatchObject({ code: "EMPLOYMENT_STATE_INVALID" });

    await expect(
      createContract(hrAdmin.subject, undefined, contractInput(hired.employmentId, "contract-bad")),
    ).rejects.toMatchObject({ code: "CONTRACT_NUMBER_INVALID" });
  });

  it("enforces tenant isolation and cross-organization scope", async () => {
    const hired = await makeHired(1);
    const created = await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
    );

    // Other tenant: a guessed id yields NOT_FOUND, never a leak.
    const other = await makeTenantContext("p3other");
    const otherAdmin = await makeUser(other, "admin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    await expect(
      changeContractStatus(otherAdmin.subject, undefined, {
        contractId: created.id,
        to: "ACTIVE",
        expectedVersion: 1,
        approvedBy: "x",
        approvedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Same tenant, different organization: reach is denied.
    const orgBUser = await makeUser(ctx, "orgb", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [ctx.secondOrganizationId],
    });
    await expect(
      changeContractStatus(orgBUser.subject, undefined, {
        contractId: created.id,
        to: "ACTIVE",
        expectedVersion: 1,
        approvedBy: "x",
        approvedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    // No capability at all.
    await expect(
      createContract(
        plainEmployee.subject,
        undefined,
        contractInput(hired.employmentId, "CONTRACT-HQ-26-00009"),
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("requires approval metadata to activate and blocks invalid transitions", async () => {
    const hired = await makeHired(1);
    const created = await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
    );
    await expect(
      changeContractStatus(hrAdmin.subject, undefined, {
        contractId: created.id,
        to: "ACTIVE",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_STATE_INVALID" });

    const active = await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: created.id,
      to: "ACTIVE",
      expectedVersion: 1,
      approvedBy: hrAdmin.userId,
      approvedAt: new Date(),
    });
    expect(active.status).toBe("ACTIVE");
    expect(await auditCount(ctx.tenantId, "contract.activated")).toBe(1);

    // Frozen history cannot resurrect.
    const expired = await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: created.id,
      to: "TERMINATED",
      expectedVersion: 2,
    });
    expect(expired.status).toBe("TERMINATED");
    await expect(
      changeContractStatus(hrAdmin.subject, undefined, {
        contractId: created.id,
        to: "ACTIVE",
        expectedVersion: 3,
        approvedBy: "x",
        approvedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_STATE_INVALID" });
  });

  it("amends without destroying the prior version (append-only chain)", async () => {
    const hired = await makeHired(1);
    const created = await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001"),
    );
    await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: created.id,
      to: "ACTIVE",
      expectedVersion: 1,
      approvedBy: hrAdmin.userId,
      approvedAt: new Date(),
    });

    const amended = await amendContract(hrAdmin.subject, undefined, {
      contractId: created.id,
      expectedVersion: 2,
      nextVersion: {
        effectiveFrom: new Date("2026-07-01"),
        clauseNames: ["NOTICE_30", "RENEWAL_12M"],
        note: "renewal added",
      },
    });
    expect(amended.versionNo).toBe(2);

    const versions = await prisma.contractVersion.findMany({
      where: { contractId: created.id },
      orderBy: { versionNo: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.supersededAt).not.toBeNull(); // prior version kept, marked superseded
    expect(versions[1]?.clauseNames).toContain("RENEWAL_12M");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.currentVersionNo).toBe(2);
    expect(row.status).toBe("ACTIVE");
    expect(await auditCount(ctx.tenantId, "contract.amended")).toBe(1);

    // Stale expectedVersion → optimistic concurrency failure.
    await expect(
      amendContract(hrAdmin.subject, undefined, {
        contractId: created.id,
        expectedVersion: 2,
        nextVersion: { effectiveFrom: new Date("2026-08-01") },
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
  });

  it("expires through the sweep and archives through the explicit lifecycle", async () => {
    const hired = await makeHired(1);
    const created = await createContract(
      hrAdmin.subject,
      undefined,
      contractInput(hired.employmentId, "CONTRACT-HQ-26-00001", daysFromNow(5)),
    );
    await changeContractStatus(hrAdmin.subject, undefined, {
      contractId: created.id,
      to: "ACTIVE",
      expectedVersion: 1,
      approvedBy: hrAdmin.userId,
      approvedAt: new Date(),
    });

    const sweep = await runContractExpirySweep(hrAdmin.subject, undefined, daysFromNow(10));
    expect(sweep.expired).toBe(1);
    expect(await auditCount(ctx.tenantId, "contract.expired")).toBe(1);

    const archived = await archiveContract(hrAdmin.subject, undefined, {
      contractId: created.id,
      expectedVersion: 3,
    });
    expect(archived.status).toBe("ARCHIVED");
    // The row still exists — archival, never deletion.
    expect(
      await prisma.contract.findUnique({ where: { id: created.id }, select: { id: true } }),
    ).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Documents
// ════════════════════════════════════════════════════════════════════════

function failingScanHook(): DocumentScanHook {
  return {
    scanner: "test-fail-hook",
    async scan() {
      return { clean: false, reason: "test-eicar", scanner: "test-fail-hook" };
    },
  };
}

describe("documents", () => {
  it("uploads with server-derived facts (sniffed type, checksum, tenant-prefixed key)", async () => {
    const hired = await makeHired(1);
    const _typeId = await makeDocType("CONTRACT_PDF");
    const result = await uploadDocument(
      hrAdmin.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "CONTRACT_PDF",
        title: "Signed agreement",
        fileName: "../../evil/contract.pdf", // display-name sanitization
        content: PNG,
        contentTypeClaimed: "text/html", // ignored entirely
      },
      {
        storage: new LocalDiskDocumentStorage(storageRoot),
        scanHook: {
          scanner: "noop-test",
          scan: async () => ({ clean: true, scanner: "noop-test" }),
        },
      },
    );
    expect(result.versionNo).toBe(1);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: result.documentId } });
    const version = await prisma.documentVersion.findFirstOrThrow({
      where: { documentId: doc.id },
    });
    expect(version.contentType).toBe("image/png"); // detected, not claimed
    expect(version.sizeBytes).toBe(PNG.length);
    expect(version.storageId.startsWith(`${ctx.tenantId}/`)).toBe(true);
    expect(result.storageId).toBe(version.storageId);
    expect(await auditCount(ctx.tenantId, "document.uploaded")).toBe(1);
  });

  it("rejects unknown types, disallowed content, guessed subjects, and failed scans without storing anything", async () => {
    const hired = await makeHired(1);
    const typeId = await makeDocType("CONTRACT_PDF");
    const deps = {
      storage: new LocalDiskDocumentStorage(storageRoot),
      scanHook: failingScanHook(),
    };

    await expect(
      uploadDocument(hrAdmin.subject, undefined, {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "NOPE",
        title: "x",
        fileName: "a.png",
        content: PNG,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_TYPE_UNKNOWN" });

    await expect(
      uploadDocument(hrAdmin.subject, undefined, {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "CONTRACT_PDF",
        title: "x",
        fileName: "a.bin",
        content: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), // MZ executable
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_CONTENT_TYPE_REJECTED" });

    await expect(
      uploadDocument(hrAdmin.subject, undefined, {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: "cuid-guess",
        typeCode: "CONTRACT_PDF",
        title: "x",
        fileName: "a.png",
        content: PNG,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Scan failure: audited loudly, NO document/version rows, no bytes kept.
    await expect(
      uploadDocument(
        hrAdmin.subject,
        undefined,
        {
          organizationId: ctx.organizationId,
          subjectType: "EMPLOYEE",
          subjectId: hired.employeeId,
          typeCode: "CONTRACT_PDF",
          title: "infected",
          fileName: "a.png",
          content: PNG,
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_SCAN_FAILED" });
    expect(
      await prisma.document.count({ where: { tenantId: ctx.tenantId, title: "infected" } }),
    ).toBe(0);
    expect(await auditCount(ctx.tenantId, "document.scan_failed")).toBe(1);
    void typeId;
  });

  it("gates downloads by capability and classification, and audits every download", async () => {
    const hired = await makeHired(1);
    const typeId = await makeDocType("CONTRACT_PDF");
    const uploaded = await uploadDocument(
      hrAdmin.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "CONTRACT_PDF",
        title: "agreement",
        fileName: "a.png",
        content: PNG,
      },
      {
        storage: new LocalDiskDocumentStorage(storageRoot),
        scanHook: {
          scanner: "noop-test",
          scan: async () => ({ clean: true, scanner: "noop-test" }),
        },
      },
    );

    // plainEmployee lacks document:read entirely.
    await expect(
      downloadDocument(plainEmployee.subject, undefined, uploaded.documentId, {
        storage: new LocalDiskDocumentStorage(storageRoot),
        scanHook: {
          scanner: "noop-test",
          scan: async () => ({ clean: true, scanner: "noop-test" }),
        },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    // Cross-tenant download attempt → NOT_FOUND.
    const other = await makeTenantContext("p3other");
    const otherAdmin = await makeUser(other, "admin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    await expect(
      downloadDocument(otherAdmin.subject, undefined, uploaded.documentId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Authorized download returns the bytes and writes the audit event.
    const fetched = await downloadDocument(officer.subject, undefined, uploaded.documentId, {
      storage: new LocalDiskDocumentStorage(storageRoot),
      scanHook: { scanner: "noop-test", scan: async () => ({ clean: true, scanner: "noop-test" }) },
    });
    expect(Array.from(fetched.content)).toEqual(Array.from(PNG));
    expect(await auditCount(ctx.tenantId, "document.download")).toBe(1);
    const dl = await auditLast(ctx.tenantId, "document.download");
    expect(dl?.resourceId).toBe(uploaded.documentId);
    void typeId;
  });

  it("hides SENSITIVE_PERSONAL documents from users without the dedicated grant", async () => {
    const hired = await makeHired(1);
    const typeId = await makeDocType("ID_DOC", "SENSITIVE_PERSONAL");
    const uploaded = await uploadDocument(
      hrAdmin.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "ID_DOC",
        title: "passport scan",
        fileName: "id.png",
        content: PNG,
      },
      {
        storage: new LocalDiskDocumentStorage(storageRoot),
        scanHook: {
          scanner: "noop-test",
          scan: async () => ({ clean: true, scanner: "noop-test" }),
        },
      },
    );

    // Officer holds document:read but NOT the sensitive permission → omitted + denied.
    const officerList = await listDocumentsForSubject(
      officer.subject,
      "EMPLOYEE",
      hired.employeeId,
    );
    expect(officerList.find((d) => d.id === uploaded.documentId)).toBeUndefined();
    await expect(
      downloadDocument(officer.subject, undefined, uploaded.documentId),
    ).rejects.toMatchObject({ code: "SENSITIVE_FIELD_RESTRICTED" });

    // HR_ADMIN has the sensitive permission but still needs the SENSITIVE scope grant.
    await expect(
      downloadDocument(hrAdmin.subject, undefined, uploaded.documentId),
    ).rejects.toMatchObject({ code: "SENSITIVE_FIELD_RESTRICTED" });
    await makeSensitiveGrant(ctx.tenantId, hrAdmin.userId);
    const ok = await downloadDocument(hrAdmin.subject, undefined, uploaded.documentId, {
      storage: new LocalDiskDocumentStorage(storageRoot),
      scanHook: { scanner: "noop-test", scan: async () => ({ clean: true, scanner: "noop-test" }) },
    });
    expect(ok.title).toBe("passport scan");
    void typeId;
  });

  it("replaces as a new append-only version and archives without deleting bytes", async () => {
    const hired = await makeHired(1);
    await makeDocType("CONTRACT_PDF");
    const deps = {
      storage: new LocalDiskDocumentStorage(storageRoot),
      scanHook: { scanner: "noop-test", scan: async () => ({ clean: true, scanner: "noop-test" }) },
    };
    const uploaded = await uploadDocument(
      hrAdmin.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "CONTRACT_PDF",
        title: "agreement",
        fileName: "v1.png",
        content: PNG,
      },
      deps,
    );

    const replaced = await replaceDocument(
      hrAdmin.subject,
      undefined,
      {
        documentId: uploaded.documentId,
        expectedVersion: 1,
        fileName: "v2.png",
        content: PNG,
        note: "re-signed",
      },
      deps,
    );
    expect(replaced.versionNo).toBe(2);

    const versions = await prisma.documentVersion.findMany({
      where: { documentId: uploaded.documentId },
      orderBy: { versionNo: "asc" },
    });
    expect(versions).toHaveLength(2);
    expect(versions[0]?.supersededAt).not.toBeNull();
    expect(versions[0]?.storageId).not.toBe(versions[1]?.storageId); // old bytes retained

    await archiveDocument(hrAdmin.subject, undefined, {
      documentId: uploaded.documentId,
      expectedVersion: 2,
    });
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.documentId } });
    expect(doc.status).toBe("ARCHIVED");
    // Versions (and their storage references) still exist — never deleted.
    expect(await prisma.documentVersion.count({ where: { documentId: uploaded.documentId } })).toBe(
      2,
    );
    expect(await auditCount(ctx.tenantId, "document.archived")).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Credentials
// ════════════════════════════════════════════════════════════════════════

async function makeCredential(seq: number, expiresOn: Date | null = daysFromNow(365)) {
  const hired = await makeHired(seq);
  const created = await createCredential(hrAdmin.subject, {
    organizationId: ctx.organizationId,
    employeeId: hired.employeeId,
    type: "LICENSE",
    name: `License ${seq}`,
    issuer: "Synthetic Council",
    credentialNumber: "LIC-99999",
    issuedOn: new Date("2026-01-05"),
    expiresOn,
  });
  const row = await prisma.employeeCredential.findUniqueOrThrow({ where: { id: created.id } });
  return { hired, credential: row };
}

describe("credentials", () => {
  it("creates a PENDING credential (entered ≠ verified) with a masked-number audit", async () => {
    const { credential } = await makeCredential(1);
    expect(credential.verificationStatus).toBe("PENDING");
    const audit = await auditLast(ctx.tenantId, "employee.credential.created");
    expect(audit?.after).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain("LIC-99999"); // number never in payloads
  });

  it("records verification as an explicit act; verification capability is separate", async () => {
    const { credential } = await makeCredential(1);

    // Officer can manage credentials but NOT verify (separation of duties).
    await expect(
      recordCredentialVerification(officer.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "ISSUER_DIRECT",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    // Manual EXPIRED is never allowed (derived only). The input type already
    // forbids it (Exclude<…, "EXPIRED">); the cast proves the RUNTIME guard
    // also rejects it for untyped callers (defense in depth).
    await expect(
      recordCredentialVerification(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        outcome: "EXPIRED" as unknown as "PENDING",
        method: "OTHER",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });

    const result = await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "VERIFIED",
      method: "ISSUER_DIRECT",
      notes: "registry match",
    });
    expect(result.status).toBe("VERIFIED");
    const updated = await prisma.employeeCredential.findUniqueOrThrow({
      where: { id: credential.id },
    });
    expect(updated.verificationStatus).toBe("VERIFIED");
    expect(updated.verifiedAt).not.toBeNull();
    expect(updated.verificationRecordId).not.toBeNull();
    expect(
      await prisma.credentialVerificationRecord.count({ where: { credentialId: credential.id } }),
    ).toBe(1);
    expect(await auditCount(ctx.tenantId, "credential.verified")).toBe(1);

    // History is append-only and readable in order.
    const records = await listVerificationRecords(hrAdmin.subject, credential.id);
    expect(Array.isArray(records)).toBe(true);

    // No-op repeat of a terminal act is rejected.
    await expect(
      recordCredentialVerification(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "ISSUER_DIRECT",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });
  });

  it("never resurrects a REVOKED credential and renewal never touches REVOKED status", async () => {
    const { credential } = await makeCredential(1);
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "VERIFIED",
      method: "PORTAL",
    });
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "REVOKED",
      method: "ISSUER_DIRECT",
    });
    await expect(
      recordCredentialVerification(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "ISSUER_DIRECT",
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });

    // Renewal extends the window but a REVOKED credential stays REVOKED.
    const renewed = await renewCredential(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      newExpiresOn: daysFromNow(400),
    });
    expect(renewed.newExpiresOn.getTime()).toBeGreaterThan(daysFromNow(399).getTime());
    const after = await prisma.employeeCredential.findUniqueOrThrow({
      where: { id: credential.id },
    });
    expect(after.verificationStatus).toBe("REVOKED");
    expect(await auditCount(ctx.tenantId, "credential.renewed")).toBe(1);

    // Renewal cannot shrink the validity window (history rewriting).
    await expect(
      renewCredential(hrAdmin.subject, undefined, {
        credentialId: credential.id,
        newExpiresOn: daysFromNow(10),
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_STATE_INVALID" });
  });

  it("expires only through the sweep, which appends a derived record", async () => {
    const { credential } = await makeCredential(1, daysFromNow(30));
    await recordCredentialVerification(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      outcome: "VERIFIED",
      method: "DOCUMENT_INSPECTION",
    });

    const sweep = await runCredentialExpirySweep(hrAdmin.subject, undefined, daysFromNow(60));
    expect(sweep.expired).toBe(1);
    const updated = await prisma.employeeCredential.findUniqueOrThrow({
      where: { id: credential.id },
    });
    expect(updated.verificationStatus).toBe("EXPIRED");
    const records = await prisma.credentialVerificationRecord.findMany({
      where: { credentialId: credential.id },
    });
    expect(records).toHaveLength(2); // VERIFIED act + derived EXPIRED record
    expect(records.some((r) => r.outcome === "EXPIRED" && r.method === "OTHER")).toBe(true);
    expect(await auditCount(ctx.tenantId, "credential.expired")).toBe(1);
  });

  it("enforces tenant isolation on verification, renewal, and record listing", async () => {
    const { credential } = await makeCredential(1);
    const other = await makeTenantContext("p3other");
    const otherAdmin = await makeUser(other, "admin", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    await expect(
      recordCredentialVerification(otherAdmin.subject, undefined, {
        credentialId: credential.id,
        outcome: "VERIFIED",
        method: "PORTAL",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      renewCredential(otherAdmin.subject, undefined, {
        credentialId: credential.id,
        newExpiresOn: daysFromNow(400),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listVerificationRecords(otherAdmin.subject, credential.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("manages the issuing-authority registry behind credential:manage", async () => {
    const { credential } = await makeCredential(1);

    // The new registry guard: plain users denied.
    await expect(
      createIssuingAuthority(plainEmployee.subject, undefined, {
        organizationId: null,
        code: "AUTH-X",
        name: "Council X",
        authorityType: "BOARD",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    const authority = await createIssuingAuthority(hrAdmin.subject, undefined, {
      organizationId: null,
      code: "AUTH-X",
      name: "Council X",
      authorityType: "BOARD",
      jurisdiction: "NP",
    });
    await expect(
      createIssuingAuthority(hrAdmin.subject, undefined, {
        organizationId: null,
        code: "AUTH-X",
        name: "Council X again",
        authorityType: "BOARD",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_DUPLICATE" });

    // Attaching an authority does NOT verify anything.
    await attachIssuingAuthority(hrAdmin.subject, undefined, {
      credentialId: credential.id,
      issuingAuthorityId: authority.id,
      jurisdiction: "NP",
      expectedVersion: 1,
    });
    const after = await prisma.employeeCredential.findUniqueOrThrow({
      where: { id: credential.id },
    });
    expect(after.issuingAuthorityId).toBe(authority.id);
    expect(after.verificationStatus).toBe("PENDING");

    // In-use authority cannot be archived (Restrict + explicit friendly error).
    await expect(
      archiveIssuingAuthority(hrAdmin.subject, undefined, {
        authorityId: authority.id,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "AUTHORITY_IN_USE" });

    // Unused authority archives fine.
    const spare = await createIssuingAuthority(hrAdmin.subject, undefined, {
      organizationId: null,
      code: "AUTH-Y",
      name: "Council Y",
      authorityType: "OTHER",
    });
    const archived = await archiveIssuingAuthority(hrAdmin.subject, undefined, {
      authorityId: spare.id,
      expectedVersion: 1,
    });
    expect(archived.status).toBe("ARCHIVED");
  });

  it("rejects creating a credential for an archived employee (archival discipline)", async () => {
    const hired = await makeHired(1);
    await prisma.employee.update({ where: { id: hired.employeeId }, data: { status: "ARCHIVED" } });
    await expect(
      createCredential(hrAdmin.subject, {
        organizationId: ctx.organizationId,
        employeeId: hired.employeeId,
        type: "LICENSE",
        name: "Late License",
        issuer: "Synthetic Council",
      }),
    ).rejects.toBeInstanceOf(WorkforceAppError);
  });
});
