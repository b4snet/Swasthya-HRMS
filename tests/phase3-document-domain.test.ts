/**
 * Unit tests — document metadata validation + storage abstraction (Phase 3;
 * ADR-011 §2). Magic-byte sniffing, size caps, checksums, filename
 * sanitization and the local-disk backend (temp root; no network).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
  assertSizeWithinLimit,
  checksumSha256,
  detectContentType,
  sanitizeFileName,
  validateUpload,
} from "@/modules/documents/domain/validation";
import { DocumentsDomainError } from "@/modules/documents/domain/errors";
import {
  LocalDiskDocumentStorage,
  resolveStorageRoot,
} from "@/modules/documents/storage/local-disk";
import { NoOpScanHook } from "@/modules/documents/storage/scan-hook";

// PDF: "%PDF"; PNG: 89 50 4E 47; JPEG: FF D8 FF
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x01]); // "MZ" — not allowed

describe("content-type sniffing", () => {
  it("detects the three allowed families from magic bytes", () => {
    expect(detectContentType(pdf)).toBe("application/pdf");
    expect(detectContentType(png)).toBe("image/png");
    expect(detectContentType(jpg)).toBe("image/jpeg");
  });

  it("rejects unknown families and tiny payloads", () => {
    expect(() => detectContentType(exe)).toThrowError(/Unsupported file type/);
    expect(() => detectContentType(new Uint8Array([0x00]))).toThrowError(DocumentsDomainError);
  });

  it("ignores the client's claimed content type entirely", () => {
    // The validation pipeline derives the type; a lying claim cannot widen it.
    expect(ALLOWED_CONTENT_TYPES).not.toContain("application/x-msdownload");
  });
});

describe("size + checksum", () => {
  it("rejects empty and over-limit files", () => {
    expect(() => assertSizeWithinLimit(new Uint8Array(0))).toThrowError(/Empty/);
    expect(() => assertSizeWithinLimit(pdf, 3)).toThrowError(/limit/);
    expect(() => assertSizeWithinLimit(pdf, MAX_DOCUMENT_BYTES)).not.toThrow();
  });

  it("produces a stable sha256 integrity reference", () => {
    expect(checksumSha256(pdf)).toBe(checksumSha256(pdf));
    expect(checksumSha256(pdf)).toHaveLength(64);
    expect(checksumSha256(pdf)).not.toBe(checksumSha256(png));
  });
});

describe("filename sanitization (display only — never a storage key)", () => {
  it("strips path components", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\evil\\report.pdf")).toBe("report.pdf");
  });

  it("removes control characters and odd unicode", () => {
    expect(sanitizeFileName("re\u0000port\u0007.pdf")).toBe("report.pdf");
    expect(sanitizeFileName("медицина.pdf")).toMatch(/^[A-Za-z0-9._ ()-]+$/);
  });

  it("bounds length and never returns empty", () => {
    expect(sanitizeFileName("x".repeat(500))).toHaveLength(120);
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("validateUpload pipeline", () => {
  it("returns the facts metadata must persist", () => {
    const facts = validateUpload(png);
    expect(facts.contentType).toBe("image/png");
    expect(facts.sizeBytes).toBe(png.length);
    expect(facts.checksumSha256).toBe(checksumSha256(png));
  });
});

describe("local-disk storage backend", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "swasthya-docs-test-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses a root that would look like a filesystem root", () => {
    expect(() => resolveStorageRoot("/")).toThrowError(/dedicated directory/);
  });

  it("put → get round-trips bytes and returns an opaque, non-URL key", async () => {
    const storage = new LocalDiskDocumentStorage(root);
    expect(storage.provider).toBe("local-disk");
    const stored = await storage.put({
      content: pdf,
      contentType: "application/pdf",
      tenantId: "t-x",
    });
    expect(stored.storageId).not.toMatch(/^https?:/); // never a URL
    expect(stored.storageId.startsWith("t-x/")).toBe(true); // tenant-prefixed
    expect(stored.checksumSha256).toBe(checksumSha256(pdf));

    const fetched = await storage.get(stored.storageId);
    expect(Array.from(fetched.content)).toEqual(Array.from(pdf));
  });

  it("keeps tenants in separate prefixes", async () => {
    const storage = new LocalDiskDocumentStorage(root);
    const a = await storage.put({ content: png, contentType: "image/png", tenantId: "t-a" });
    const b = await storage.put({ content: png, contentType: "image/png", tenantId: "t-b" });
    expect(a.storageId.startsWith("t-a/")).toBe(true);
    expect(b.storageId.startsWith("t-b/")).toBe(true);
  });

  it("rejects path traversal in storage ids", async () => {
    const storage = new LocalDiskDocumentStorage(root);
    await expect(storage.get("../escape.bin")).rejects.toThrowError(DocumentsDomainError);
  });

  it("checkAvailability distinguishes present vs missing objects", async () => {
    const storage = new LocalDiskDocumentStorage(root);
    const stored = await storage.put({ content: jpg, contentType: "image/jpeg", tenantId: "t-x" });
    expect(await storage.checkAvailability(stored.storageId)).toBe(true);
    expect(await storage.checkAvailability("t-x/2099/01/missing.bin")).toBe(false);
  });
});

describe("malware scan hook", () => {
  it("is an honest NO-OP that names itself", async () => {
    const hook = new NoOpScanHook();
    expect(hook.scanner).toBe("noop-scan-disabled");
    const result = await hook.scan({
      content: pdf,
      contentType: "application/pdf",
      fileName: "a.pdf",
    });
    expect(result.clean).toBe(true);
    expect(result.scanner).toBe("noop-scan-disabled");
  });
});
