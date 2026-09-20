/**
 * Document read services (Phase 3, prompt 3).
 *
 * The upload/replace/download/archive/grant mutations live in
 * document-service.ts. This module adds the METADATA DETAIL read the API
 * layer needs: version history for one document, reach- and
 * classification-gated, metadata only — bytes flow exclusively through
 * downloadDocument (audited, authorized).
 *
 * DELETION POSTURE (prompt: "controlled deletion where permitted"):
 * there is NO employee-facing delete. Bytes + version rows are
 * retention-controlled (DocumentType.retentionDays; hard deletion is a
 * Phase 13 compliance job) and FKs are Restrict, so accidental history
 * destruction is impossible. ARCHIVED is the only removal-from-view state,
 * set by archiveDocument.
 */
import { prisma } from "@/lib/db";
import { DocumentsAppError, toDocumentsAppError } from "./app-errors";
import {
  assertCallerCanAccessDocuments,
  assertClassificationAccess,
  findScopedRow,
  type WorkforceSubject,
} from "./mutations";

export type DocumentVersionMeta = {
  versionNo: number;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  note: string | null;
  uploadedAt: Date;
  uploadedBy: string | null;
  supersededAt: Date | null;
};

export type DocumentDetail = {
  id: string;
  title: string;
  description: string | null;
  classification: string;
  status: string;
  subjectType: string;
  subjectId: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  currentVersionNo: number;
  createdAt: Date;
  versions: DocumentVersionMeta[];
};

/** storageId is deliberately NOT projected — it never leaves the service. */
export async function getDocumentDetail(
  caller: WorkforceSubject,
  documentId: string,
): Promise<DocumentDetail> {
  try {
    const doc = await findScopedRow(
      prisma.document,
      { id: documentId, tenantId: caller.tenantId },
      "Document",
    );
    await assertCallerCanAccessDocuments(caller, doc.organizationId, "read");
    await assertClassificationAccess(caller, doc.organizationId, doc.classification);

    const versions = await prisma.documentVersion.findMany({
      where: { tenantId: caller.tenantId, documentId: doc.id },
      orderBy: { versionNo: "asc" },
      select: {
        versionNo: true,
        contentType: true,
        sizeBytes: true,
        checksumSha256: true,
        note: true,
        uploadedAt: true,
        uploadedBy: true,
        supersededAt: true,
      },
    });

    return {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      classification: doc.classification,
      status: doc.status,
      subjectType: doc.subjectType,
      subjectId: doc.subjectId,
      effectiveFrom: doc.effectiveFrom,
      effectiveTo: doc.effectiveTo,
      currentVersionNo: doc.currentVersionNo,
      createdAt: doc.createdAt,
      versions,
    };
  } catch (err) {
    throw toDocumentsAppError(err);
  }
}

export { DocumentsAppError };
