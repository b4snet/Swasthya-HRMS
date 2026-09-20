/**
 * Stable application errors for the Documents context (Phase 3, plan §13).
 * Same contract as Workforce/Organization: clients receive ONLY
 * { code, message, field? }; storage internals, paths and stack traces
 * never cross the boundary.
 */
import { DocumentsDomainError } from "../domain/errors";

export type DocumentsAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "NOT_LINKED"
  | "CONFLICT_DUPLICATE"
  | "RESOURCE_CONFLICT"
  | "DOCUMENT_TYPE_UNKNOWN"
  | "DOCUMENT_TOO_LARGE"
  | "DOCUMENT_CONTENT_TYPE_REJECTED"
  | "DOCUMENT_SCAN_FAILED"
  | "DOCUMENT_STATE_INVALID"
  | "SENSITIVE_FIELD_RESTRICTED"
  | "UNEXPECTED";

export const DOCUMENTS_ERROR_STATUS: Record<DocumentsAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  NOT_LINKED: 404,
  CONFLICT_DUPLICATE: 409,
  RESOURCE_CONFLICT: 409,
  DOCUMENT_TYPE_UNKNOWN: 400,
  DOCUMENT_TOO_LARGE: 413,
  DOCUMENT_CONTENT_TYPE_REJECTED: 415,
  DOCUMENT_SCAN_FAILED: 422,
  DOCUMENT_STATE_INVALID: 422,
  SENSITIVE_FIELD_RESTRICTED: 403,
  UNEXPECTED: 500,
};

export class DocumentsAppError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: DocumentsAppErrorCode,
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "DocumentsAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

const DOMAIN_CODE_MAP: Record<DocumentsDomainError["code"], DocumentsAppErrorCode> = {
  DOCUMENT_TOO_LARGE: "DOCUMENT_TOO_LARGE",
  DOCUMENT_CONTENT_TYPE_REJECTED: "DOCUMENT_CONTENT_TYPE_REJECTED",
  DOCUMENT_SCAN_FAILED: "DOCUMENT_SCAN_FAILED",
  DOCUMENT_TYPE_UNKNOWN: "DOCUMENT_TYPE_UNKNOWN",
  DOCUMENT_STORAGE_UNAVAILABLE: "UNEXPECTED",
};

export function toDocumentsAppError(err: unknown): DocumentsAppError {
  if (err instanceof DocumentsAppError) return err;
  if (err instanceof DocumentsDomainError) {
    return new DocumentsAppError(DOMAIN_CODE_MAP[err.code], err.message, undefined, err);
  }
  return new DocumentsAppError("UNEXPECTED", "An unexpected error occurred.", undefined, err);
}

export function serializeDocumentsAppError(err: DocumentsAppError): {
  ok: false;
  error: { code: DocumentsAppErrorCode; message: string; field?: string };
} {
  return {
    ok: false,
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  };
}
