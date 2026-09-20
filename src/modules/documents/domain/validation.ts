/**
 * Document content validation (pure where possible; ADR-011 §2).
 *
 * Security posture: the client NEVER dictates what a file is. Content type
 * is detected from magic bytes; size is capped before persistence; the
 * checksum is the integrity reference stored alongside the storage id.
 * Filenames are sanitized for display only — the storage key is
 * server-generated and never derived from client input.
 */
import { createHash } from "node:crypto";
import { DocumentsDomainError } from "./errors";

/** Accepted content families (detected, never client-claimed). */
export const ALLOWED_CONTENT_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** Default upload cap: 25 MB (documents, not media). */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** Detect content type from magic bytes; reject unknown families. */
export function detectContentType(bytes: Uint8Array): AllowedContentType {
  if (bytes.length < 4) {
    throw new DocumentsDomainError(
      "DOCUMENT_CONTENT_TYPE_REJECTED",
      "File is too small to identify.",
    );
  }
  // PDF: "%PDF" at offset 0 (spec allows a 1024-byte header window; we keep
  // offset 0 for simplicity and stricter posture).
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  throw new DocumentsDomainError(
    "DOCUMENT_CONTENT_TYPE_REJECTED",
    "Unsupported file type. Accepted: PDF, PNG, JPEG.",
  );
}

export function assertSizeWithinLimit(bytes: Uint8Array, maxBytes = MAX_DOCUMENT_BYTES): void {
  if (bytes.length === 0) {
    throw new DocumentsDomainError("DOCUMENT_TOO_LARGE", "Empty files are not accepted.");
  }
  if (bytes.length > maxBytes) {
    throw new DocumentsDomainError(
      "DOCUMENT_TOO_LARGE",
      `File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`,
    );
  }
}

export function checksumSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sanitize a client-supplied filename for DISPLAY (title fallback, audit
 * notes). Never used to build storage keys. Strips path components,
 * control characters, and bounds length.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^A-Za-z0-9._ ()-]/g, "_")
    .trim();
  return (cleaned.length > 0 ? cleaned : "file").slice(0, 120);
}

/** Full upload validation pipeline; returns the facts metadata must store. */
export function validateUpload(
  bytes: Uint8Array,
  opts: { maxBytes?: number } = {},
): { contentType: AllowedContentType; sizeBytes: number; checksumSha256: string } {
  assertSizeWithinLimit(bytes, opts.maxBytes);
  const contentType = detectContentType(bytes);
  return { contentType, sizeBytes: bytes.length, checksumSha256: checksumSha256(bytes) };
}
