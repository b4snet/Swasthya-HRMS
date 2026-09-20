/**
 * Documents bounded-context domain errors (Phase 3; ADR-011).
 * Stable codes; services map them into the module AppError vocabulary.
 */
export class DocumentsDomainError extends Error {
  constructor(
    public readonly code:
      | "DOCUMENT_TOO_LARGE"
      | "DOCUMENT_CONTENT_TYPE_REJECTED"
      | "DOCUMENT_SCAN_FAILED"
      | "DOCUMENT_TYPE_UNKNOWN"
      | "DOCUMENT_STORAGE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "DocumentsDomainError";
  }
}
