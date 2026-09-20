/**
 * Storage abstraction (ADR-011 §2): the business domain depends on THIS
 * interface, never on a provider. Phase 3 ships LocalDiskDocumentStorage;
 * S3/Azure backends swap in later with zero schema or service change.
 *
 * Security invariants every backend must honor:
 * - storageId is OPAQUE and never a URL; it is server-generated.
 * - Bytes are private by default; downloads flow through authorized,
 *   audited application routes only.
 * - Backends return the facts metadata must store (size, sha256) so the
 *   service can persist the integrity reference in the same transaction.
 */

export interface StoredObjectInfo {
  /** Opaque storage key returned by the backend. NEVER a URL. */
  storageId: string;
  sizeBytes: number;
  checksumSha256: string;
  /** Backend-detected content type (re-checked against magic bytes upstream). */
  contentType: string;
}

export interface DocumentStorage {
  readonly provider: string;
  put(input: {
    content: Uint8Array;
    contentType: string;
    /** Tenant prefix is server-derived from the caller — never client input. */
    tenantId: string;
  }): Promise<StoredObjectInfo>;
  get(storageId: string): Promise<{ content: Uint8Array; contentType: string }>;
  /**
   * Soft-delete inside the backend where supported; backends SHOULD retain
   * bytes per retention policy. Hard deletion is a Phase 13 compliance job.
   */
  delete(storageId: string): Promise<void>;
  /** Availability probe for the future monitoring service (not scheduled). */
  checkAvailability(storageId: string): Promise<boolean>;
}
