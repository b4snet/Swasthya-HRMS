/**
 * Read-side server actions for the Documents UI (Phase 3, prompt 4).
 *
 * Wraps the read services with date serialization for the RSC boundary.
 * storageId is never selected by the service and never crosses here —
 * bytes flow exclusively through the authorized download route.
 */
"use server";

import { getSessionUser } from "@/lib/auth/session";
import { DocumentsAppError, serializeDocumentsAppError } from "../service/app-errors";
import { callerFromUser } from "../../workforce/service/caller";
import { listDocumentsForSubject } from "../service/document-service";
import { getDocumentDetail } from "../service/document-queries";
import type { DocumentDetail } from "../service/document-queries";

export interface DocumentActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): DocumentActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): DocumentActionResult<never> {
  if (err instanceof DocumentsAppError) {
    return { ok: false, error: serializeDocumentsAppError(err).error };
  }
  console.error("[documents-queries] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

export interface DocumentListItemView {
  id: string;
  title: string;
  classification: string;
  status: string;
  currentVersionNo: number;
  subjectType: string;
  subjectId: string;
  effectiveTo: string | null;
  createdAt: string;
}

export async function listDocumentsForSubjectViewAction(
  subjectType: "EMPLOYEE" | "PERSON" | "EMPLOYMENT" | "CONTRACT" | "CREDENTIAL" | "ORGANIZATION",
  subjectId: string,
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      throw new DocumentsAppError("AUTHORIZATION_DENIED", "Sign in to view documents.");
    }
    const caller = callerFromUser(user);
    const rows = await listDocumentsForSubject(caller, subjectType, subjectId);
    return ok(
      rows.map((r) => ({
        ...r,
        effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })) satisfies DocumentListItemView[],
    );
  } catch (err) {
    return fail(err);
  }
}

export interface DocumentVersionMetaView {
  versionNo: number;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  note: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  supersededAt: string | null;
}

export interface DocumentDetailView {
  id: string;
  title: string;
  description: string | null;
  classification: string;
  status: string;
  subjectType: string;
  subjectId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  currentVersionNo: number;
  createdAt: string;
  versions: DocumentVersionMetaView[];
}

export async function getDocumentDetailViewAction(documentId: string) {
  try {
    const user = await getSessionUser();
    if (!user) {
      throw new DocumentsAppError("AUTHORIZATION_DENIED", "Sign in to view documents.");
    }
    const caller = callerFromUser(user);
    const d: DocumentDetail = await getDocumentDetail(caller, documentId);
    return ok({
      ...d,
      effectiveFrom: d.effectiveFrom.toISOString(),
      effectiveTo: d.effectiveTo ? d.effectiveTo.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
      versions: d.versions.map((v) => ({
        ...v,
        uploadedAt: v.uploadedAt.toISOString(),
        supersededAt: v.supersededAt ? v.supersededAt.toISOString() : null,
      })) satisfies DocumentVersionMetaView[],
    } satisfies DocumentDetailView);
  } catch (err) {
    return fail(err);
  }
}
