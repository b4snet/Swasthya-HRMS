/**
 * Local-disk storage backend (Phase 3 default; ADR-011 §2).
 *
 * Keys: <root>/<tenantId>/<yyyy>/<mm>/<cuid> — tenant-prefixed so even a
 * future misconfiguration cannot serve one tenant's bytes to another, and
 * the root lives OUTSIDE any web-served directory (gitignored
 * `.document-storage/` locally). Files are never exposed as URLs: the only
 * read path is the authorized download route through the service layer.
 *
 * Single-node by design; the DocumentStorage interface is the scaling
 * escape hatch (S3-compatible backend later).
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { DocumentStorage, StoredObjectInfo } from "./types";
import { DocumentsDomainError } from "../domain/errors";

export function resolveStorageRoot(explicit?: string): string {
  const root = explicit ?? process.env.DOCUMENT_STORAGE_ROOT ?? ".document-storage";
  const resolved = resolve(root);
  if (resolved === resolve("/") || resolved.length < 3) {
    throw new DocumentsDomainError(
      "DOCUMENT_STORAGE_UNAVAILABLE",
      "DOCUMENT_STORAGE_ROOT must point to a dedicated directory.",
    );
  }
  return resolved;
}

export class LocalDiskDocumentStorage implements DocumentStorage {
  readonly provider = "local-disk";
  private readonly root: string;

  constructor(root?: string) {
    this.root = resolveStorageRoot(root);
  }

  private pathFor(storageId: string): string {
    // Defense in depth: reject traversal before joining.
    if (storageId.includes("..") || storageId.startsWith("/") || storageId.includes("\\")) {
      throw new DocumentsDomainError("DOCUMENT_STORAGE_UNAVAILABLE", "Invalid storage key.");
    }
    return join(this.root, storageId);
  }

  async put(input: {
    content: Uint8Array;
    contentType: string;
    tenantId: string;
  }): Promise<StoredObjectInfo> {
    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const storageId = `${input.tenantId}/${yyyy}/${mm}/${randomUUID()}.bin`;
    const absolute = join(this.root, storageId);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, input.content);
    return {
      storageId,
      sizeBytes: input.content.length,
      checksumSha256: createHash("sha256").update(input.content).digest("hex"),
      contentType: input.contentType,
    };
  }

  async get(storageId: string): Promise<{ content: Uint8Array; contentType: string }> {
    const absolute = this.pathFor(storageId);
    try {
      const content = await readFile(absolute);
      // Content type is not persisted in the backend; the authoritative
      // value lives on DocumentVersion and is supplied by the service.
      return { content: new Uint8Array(content), contentType: "application/octet-stream" };
    } catch {
      throw new DocumentsDomainError(
        "DOCUMENT_STORAGE_UNAVAILABLE",
        "Stored bytes are unavailable.",
      );
    }
  }

  async delete(storageId: string): Promise<void> {
    const absolute = this.pathFor(storageId);
    try {
      await unlink(absolute);
    } catch {
      // Soft-delete semantics: a missing file is already "gone".
    }
  }

  async checkAvailability(storageId: string): Promise<boolean> {
    try {
      const s = await stat(this.pathFor(storageId));
      return s.isFile();
    } catch {
      return false;
    }
  }
}
