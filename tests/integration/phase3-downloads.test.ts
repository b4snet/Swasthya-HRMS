/**
 * Phase 3 prompt-3 integration tests — document byte path (upload →
 * authorized download) plus the download-audit and capability posture.
 *
 * Uses a temp storage root so no test bytes ever land in the repo.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { uploadDocument, downloadDocument } from "@/modules/documents/service/document-service";
import { LocalDiskDocumentStorage } from "@/modules/documents/storage/local-disk";
import { NoOpScanHook } from "@/modules/documents/storage/scan-hook";
import { createEmployee } from "@/modules/workforce/service/employee-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  auditCount,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4

let ctx: TenantContext;
let hrAdmin: UserContext;
let officer: UserContext;
let plainEmployee: UserContext;
let storageRoot: string;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("p3dl");
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

afterAll(async () => {
  if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
});

function deps() {
  return { storage: new LocalDiskDocumentStorage(storageRoot), scanHook: new NoOpScanHook() };
}

async function makeHired(seq: number) {
  return createEmployee(hrAdmin.subject, {
    person: { firstName: `Dl${seq}`, lastName: "Worker", dateOfBirth: new Date("1991-03-03") },
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

async function makeDocType(code: string) {
  return prisma.documentType.create({
    data: { tenantId: ctx.tenantId, code, name: `Type ${code}` },
    select: { id: true },
  });
}

describe("document byte path", () => {
  it("roundtrips upload → authorized download with the stored bytes intact", async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "hrms-p3-dl-"));
    const hired = await makeHired(1);
    await makeDocType("DL_TEST");

    const uploaded = await uploadDocument(
      officer.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "DL_TEST",
        title: "Roundtrip doc",
        fileName: "roundtrip.pdf",
        content: PDF,
      },
      deps(),
    );

    const fetched = await downloadDocument(officer.subject, undefined, uploaded.documentId, deps());
    expect(Buffer.from(fetched.content).equals(Buffer.from(PDF))).toBe(true);
    expect(fetched.contentType).toBe("application/pdf");
    expect(fetched.title).toBe("Roundtrip doc");
    expect(fetched.versionNo).toBe(1);

    // Download is audited with version + transport facts, never storage ids.
    expect(await auditCount(ctx.tenantId, "document.download")).toBe(1);
  });

  it("denies download without the document:download capability even when read succeeds", async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "hrms-p3-dl-"));
    const hired = await makeHired(1);
    await makeDocType("DL_TEST2");

    const uploaded = await uploadDocument(
      hrAdmin.subject,
      undefined,
      {
        organizationId: ctx.organizationId,
        subjectType: "EMPLOYEE",
        subjectId: hired.employeeId,
        typeCode: "DL_TEST2",
        title: "Capability gate",
        fileName: "gate.pdf",
        content: PDF,
      },
      deps(),
    );

    // plainEmployee holds employee:read:self only — no document:download.
    await expect(
      downloadDocument(plainEmployee.subject, undefined, uploaded.documentId, deps()),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });

    // Zero byte reads occurred for the denied user.
    expect(await auditCount(ctx.tenantId, "document.download")).toBe(0);
  });

  it("rejects client-disguised payloads outright: sniffing wins over claims", async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "hrms-p3-dl-"));
    const hired = await makeHired(1);
    await makeDocType("DL_TEST3");

    // HTML/script bytes claiming to be a PDF are REJECTED, not re-typed:
    // the allowlist only admits pdf/png/jpeg from magic bytes.
    await expect(
      uploadDocument(
        hrAdmin.subject,
        undefined,
        {
          organizationId: ctx.organizationId,
          subjectType: "EMPLOYEE",
          subjectId: hired.employeeId,
          typeCode: "DL_TEST3",
          title: "Disguised",
          fileName: "evil.pdf",
          content: new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]), // <script>
          contentTypeClaimed: "application/pdf",
        },
        deps(),
      ),
    ).rejects.toMatchObject({ code: "DOCUMENT_CONTENT_TYPE_REJECTED" });

    // Nothing was persisted for the rejected payload.
    expect(await prisma.document.count({ where: { title: "Disguised" } })).toBe(0);
  });
});
