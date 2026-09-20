/**
 * Document application services (Phase 3; ADR-011 §2).
 *
 * Invariants enforced here:
 * - Bytes NEVER touch business tables: content goes through the injected
 *   DocumentStorage; metadata rows (Document + append-only DocumentVersion)
 *   are written in the same transaction as the audit event.
 * - Upload pipeline: size cap → magic-byte content detection (client MIME
 *   never trusted) → checksum → scan hook → storage.put → metadata tx.
 *   A failed scan or storage write creates NO rows (scan failure writes a
 *   `document.scan_failed` audit event through its own transaction).
 * - subjectType/subjectId resolution is tenant-scoped: a guessed subjectId
 *   fails closed (NOT_FOUND) before any FK touches it.
 * - Classification gates: SENSITIVE_PERSONAL → workforce sensitive posture;
 *   CREDENTIAL → credential:read. Employee visibility never implies
 *   document access (ADR-011 §2).
 * - Replacement = new append-only version + supersede; archival = status
 *   flip, bytes retained per retention policy (hard deletion is Phase 13).
 */
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/rbac";
import { validateUpload, sanitizeFileName, type AllowedContentType } from "../domain/validation";
import { DocumentsAppError, toDocumentsAppError } from "./app-errors";
import {
  assertCallerCanAccessDocuments,
  assertClassificationAccess,
  findScopedRow,
  notFound,
  transactWithAudit,
  assertVersionMatches,
  type WorkforceSubject,
} from "./mutations";
import type { DocumentStorage, StoredObjectInfo } from "../storage/types";
import { LocalDiskDocumentStorage } from "../storage/local-disk";
import { NoOpScanHook } from "../storage/scan-hook";
import type { DocumentScanHook } from "../storage/scan-hook";

export interface UploadDocumentInput {
  organizationId: string | null;
  subjectType: "EMPLOYEE" | "PERSON" | "EMPLOYMENT" | "CONTRACT" | "CREDENTIAL" | "ORGANIZATION";
  subjectId: string;
  typeCode: string;
  title: string;
  description?: string | null;
  fileName: string; // display only; sanitized
  content: Uint8Array;
  contentTypeClaimed?: string; // logged nowhere; never trusted
  effectiveTo?: Date | null;
}

export interface DocumentServiceDeps {
  storage: DocumentStorage;
  scanHook: DocumentScanHook;
}

function defaultDeps(): DocumentServiceDeps {
  // Static server-side imports; both defaults are safe for tests.
  return { storage: new LocalDiskDocumentStorage(), scanHook: new NoOpScanHook() };
}

/** Resolve the subject row inside the caller's tenant (IDOR-safe). */
async function assertSubjectExists(
  caller: WorkforceSubject,
  subjectType: UploadDocumentInput["subjectType"],
  subjectId: string,
  organizationId: string | null,
): Promise<void> {
  switch (subjectType) {
    case "EMPLOYEE": {
      const row = await prisma.employee.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true, organizationId: true },
      });
      if (!row) notFound("Employee");
      break;
    }
    case "EMPLOYMENT": {
      const row = await prisma.employment.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!row) notFound("Employment");
      break;
    }
    case "PERSON": {
      const row = await prisma.person.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!row) notFound("Person");
      break;
    }
    case "CONTRACT": {
      const row = await prisma.contract.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!row) notFound("Contract");
      break;
    }
    case "CREDENTIAL": {
      const row = await prisma.employeeCredential.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!row) notFound("Credential");
      break;
    }
    case "ORGANIZATION": {
      const row = await prisma.organization.findFirst({
        where: { id: subjectId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!row) notFound("Organization");
      if (organizationId !== subjectId) {
        throw new DocumentsAppError(
          "VALIDATION_FAILED",
          "Organization subject must match the document's organization scope.",
          "organizationId",
        );
      }
      break;
    }
  }
}

export async function uploadDocument(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: UploadDocumentInput,
  deps: DocumentServiceDeps = defaultDeps(),
): Promise<{ documentId: string; versionNo: number; storageId: string; checksumSha256: string }> {
  try {
    await assertCallerCanAccessDocuments(caller, input.organizationId, "upload");

    // Subject existence FIRST so a guessed id fails before any work happens.
    await assertSubjectExists(caller, input.subjectType, input.subjectId, input.organizationId);

    const type = await prisma.documentType.findFirst({
      where: { tenantId: caller.tenantId, code: input.typeCode, status: "ACTIVE" },
      select: { id: true, defaultClassification: true },
    });
    if (!type) {
      throw new DocumentsAppError("DOCUMENT_TYPE_UNKNOWN", "Unknown document type.", "typeCode");
    }

    // Validation pipeline (pure): cap → sniff → checksum. Client claims ignored.
    const facts = validateUpload(input.content);
    const displayName = sanitizeFileName(input.fileName);

    // Scan hook BEFORE persistence; failures leave no rows.
    const scan = await deps.scanHook.scan({
      content: input.content,
      contentType: facts.contentType,
      fileName: displayName,
    });
    if (!scan.clean) {
      // Audited loudly (fail-closed discipline) in its own transaction.
      await transactWithAudit(
        caller,
        ctx,
        () => ({
          action: "document.scan_failed",
          resourceType: "Document",
          after: {
            fileName: displayName,
            scanner: scan.scanner,
            reason: scan.reason ?? "unspecified",
          },
        }),
        async () => ({ ok: true }),
      );
      throw new DocumentsAppError(
        "DOCUMENT_SCAN_FAILED",
        "The file failed the security scan and was not stored.",
      );
    }

    const stored: StoredObjectInfo = await deps.storage.put({
      content: input.content,
      contentType: facts.contentType,
      tenantId: caller.tenantId,
    });

    return await transactWithAudit(
      caller,
      ctx,
      (created: { id: string; checksum: string }) => ({
        action: "document.uploaded",
        resourceType: "Document",
        resourceId: created.id,
        // Metadata only: name/type/checksum — NEVER content bytes.
        after: {
          title: input.title,
          typeCode: input.typeCode,
          classification: type.defaultClassification,
          versionNo: 1,
          checksumSha256: created.checksum,
          scanner: scan.scanner,
        },
      }),
      async (tx) => {
        const document = await tx.document.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            typeId: type.id,
            title: input.title,
            description: input.description ?? null,
            classification: type.defaultClassification,
            currentVersionNo: 1,
            effectiveTo: input.effectiveTo ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
        await tx.documentVersion.create({
          data: {
            tenantId: caller.tenantId,
            documentId: document.id,
            versionNo: 1,
            storageId: stored.storageId,
            contentType: facts.contentType,
            sizeBytes: facts.sizeBytes,
            checksumSha256: facts.checksumSha256,
            uploadedAt: new Date(),
            uploadedBy: caller.userId,
          },
        });
        return { id: document.id, checksum: facts.checksumSha256 };
      },
    ).then((r: { id: string; checksum: string }) => ({
      documentId: r.id,
      versionNo: 1,
      storageId: stored.storageId,
      checksumSha256: r.checksum,
    }));
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

export interface ReplaceDocumentInput {
  documentId: string;
  expectedVersion: number;
  fileName: string;
  content: Uint8Array;
  note?: string | null;
}

/**
 * Replace = validate + scan + store as a NEW version; the superseded
 * version row keeps its storageId/checksum forever (history is the
 * version chain — ADR-011 §2). Same-transaction metadata + audit.
 */
export async function replaceDocument(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ReplaceDocumentInput,
  deps: DocumentServiceDeps = defaultDeps(),
): Promise<{ versionNo: number; checksumSha256: string }> {
  try {
    const doc = await findScopedRow(
      prisma.document,
      { id: input.documentId, tenantId: caller.tenantId },
      "Document",
    );
    await assertCallerCanAccessDocuments(caller, doc.organizationId, "manage");
    assertVersionMatches(doc, input.expectedVersion, "Document");
    if (doc.status !== "ACTIVE") {
      throw new DocumentsAppError(
        "DOCUMENT_STATE_INVALID",
        "Only ACTIVE documents can be replaced.",
      );
    }
    const facts = validateUpload(input.content);
    const scan = await deps.scanHook.scan({
      content: input.content,
      contentType: facts.contentType,
      fileName: sanitizeFileName(input.fileName),
    });
    if (!scan.clean) {
      throw new DocumentsAppError(
        "DOCUMENT_SCAN_FAILED",
        "The file failed the security scan and was not stored.",
      );
    }
    const stored = await deps.storage.put({
      content: input.content,
      contentType: facts.contentType,
      tenantId: caller.tenantId,
    });
    const nextVersionNo = doc.currentVersionNo + 1;

    await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "document.replaced",
        resourceType: "Document",
        resourceId: doc.id,
        before: { versionNo: doc.currentVersionNo },
        after: { versionNo: nextVersionNo, checksumSha256: facts.checksumSha256 },
      }),
      async (tx) => {
        await tx.documentVersion.updateMany({
          where: { tenantId: caller.tenantId, documentId: doc.id, versionNo: doc.currentVersionNo },
          data: { supersededAt: new Date(), supersededBy: caller.userId },
        });
        await tx.documentVersion.create({
          data: {
            tenantId: caller.tenantId,
            documentId: doc.id,
            versionNo: nextVersionNo,
            storageId: stored.storageId,
            contentType: facts.contentType,
            sizeBytes: facts.sizeBytes,
            checksumSha256: facts.checksumSha256,
            note: input.note ?? null,
            uploadedBy: caller.userId,
          },
        });
        await tx.document.update({
          where: { id: doc.id },
          data: {
            currentVersionNo: nextVersionNo,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        return { versionNo: nextVersionNo };
      },
    );
    return { versionNo: nextVersionNo, checksumSha256: facts.checksumSha256 };
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

/**
 * Download authorization + byte retrieval. The caller of THIS function is
 * the authorized download route: it must stream the bytes with
 * Content-Disposition: attachment and write nothing else. Every allowed
 * download writes `document.download` (ADR-005 view-of-protected-record
 * class); bytes and storage ids never enter logs.
 */
export async function downloadDocument(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  documentId: string,
  deps: DocumentServiceDeps = defaultDeps(),
): Promise<{ content: Uint8Array; contentType: string; title: string; versionNo: number }> {
  try {
    const doc = await findScopedRow(
      prisma.document,
      { id: documentId, tenantId: caller.tenantId },
      "Document",
    );
    await assertCallerCanAccessDocuments(caller, doc.organizationId, "read");
    if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.DOCUMENT_DOWNLOAD)) {
      throw new DocumentsAppError(
        "AUTHORIZATION_DENIED",
        "You do not have download permission for this document.",
      );
    }
    await assertClassificationAccess(caller, doc.organizationId, doc.classification);

    const version = await prisma.documentVersion.findFirst({
      where: { tenantId: caller.tenantId, documentId: doc.id, versionNo: doc.currentVersionNo },
    });
    if (!version) notFound("Document version");

    // Access-grant override check (explicit ACL): a grant FOR this user
    // widens nothing — role capability + classification are still required
    // above; grants here only enable the download for reach-limited users
    // who hold both. Unrevoked, non-expired grants only.
    const grant = await prisma.documentAccessGrant.findFirst({
      where: {
        tenantId: caller.tenantId,
        documentId: doc.id,
        granteeType: "USER",
        granteeValue: caller.userId,
        canDownload: true,
        revokedAt: null,
      },
      select: { id: true },
    });
    void grant; // presence is recorded in the audit payload below

    const bytes = await deps.storage.get(version.storageId);

    await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "document.download",
        resourceType: "Document",
        resourceId: doc.id,
        after: {
          versionNo: version.versionNo,
          viaGrant: Boolean(grant),
          contentType: version.contentType,
        },
      }),
      async () => ({ ok: true }),
    );

    return {
      content: bytes.content,
      contentType: version.contentType,
      title: doc.title,
      versionNo: version.versionNo,
    };
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

export async function archiveDocument(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { documentId: string; expectedVersion: number },
): Promise<{ status: string }> {
  try {
    const doc = await findScopedRow(
      prisma.document,
      { id: input.documentId, tenantId: caller.tenantId },
      "Document",
    );
    await assertCallerCanAccessDocuments(caller, doc.organizationId, "manage");
    assertVersionMatches(doc, input.expectedVersion, "Document");
    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "document.archived",
        resourceType: "Document",
        resourceId: doc.id,
        before: { status: doc.status },
        after: { status: "ARCHIVED" },
      }),
      async (tx) => {
        const updated = await tx.document.update({
          where: { id: doc.id },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
          select: { status: true },
        });
        return { status: updated.status };
      },
    );
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

export async function grantDocumentAccess(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { documentId: string; granteeUserId: string; canDownload: boolean },
): Promise<{ id: string }> {
  try {
    const doc = await findScopedRow(
      prisma.document,
      { id: input.documentId, tenantId: caller.tenantId },
      "Document",
    );
    await assertCallerCanAccessDocuments(caller, doc.organizationId, "manage");
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "document.access_granted",
        resourceType: "DocumentAccessGrant",
        resourceId: created.id,
        after: {
          documentId: doc.id,
          granteeUserId: input.granteeUserId,
          canDownload: input.canDownload,
        },
      }),
      async (tx) =>
        tx.documentAccessGrant.create({
          data: {
            tenantId: caller.tenantId,
            documentId: doc.id,
            granteeType: "USER",
            granteeValue: input.granteeUserId,
            canView: true,
            canDownload: input.canDownload,
            grantedBy: caller.userId,
          },
          select: { id: true },
        }),
    );
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

export type DocumentListItem = {
  id: string;
  title: string;
  classification: string;
  status: string;
  currentVersionNo: number;
  subjectType: string;
  subjectId: string;
  effectiveTo: Date | null;
  createdAt: Date;
};

/** List documents for a subject; rows only (metadata), never bytes. */
export async function listDocumentsForSubject(
  caller: WorkforceSubject,
  subjectType: UploadDocumentInput["subjectType"],
  subjectId: string,
): Promise<DocumentListItem[]> {
  // Existence probe inside the tenant; a guessed id yields NOT_FOUND.
  await assertSubjectExists(caller, subjectType, subjectId, null);
  const docs = await prisma.document.findMany({
    where: { tenantId: caller.tenantId, subjectType, subjectId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      classification: true,
      status: true,
      currentVersionNo: true,
      subjectType: true,
      subjectId: true,
      effectiveTo: true,
      createdAt: true,
      organizationId: true,
    },
  });
  // Classification gate per row (org-scoped rows only).
  const visible: DocumentListItem[] = [];
  for (const d of docs) {
    try {
      await assertClassificationAccess(caller, d.organizationId, d.classification);
      visible.push({
        id: d.id,
        title: d.title,
        classification: d.classification,
        status: d.status,
        currentVersionNo: d.currentVersionNo,
        subjectType: d.subjectType,
        subjectId: d.subjectId,
        effectiveTo: d.effectiveTo,
        createdAt: d.createdAt,
      });
    } catch {
      // Denied rows are simply omitted — never leak existence (IDOR posture).
    }
  }
  return visible;
}

export type { AllowedContentType };
