/**
 * Zod schemas for the Documents API surface (Phase 3, prompt 3).
 *
 * Content bytes NEVER cross these schemas: upload actions receive bytes
 * through a separate multipart-capable action signature (Uint8Array is not
 * JSON-serializable, so the action wraps the raw schema). The client's
 * claimed content type is deliberately NOT accepted anywhere — the service
 * sniffs magic bytes (ADR-011 §2).
 */
import { z } from "zod";

const cuidSchema = z.string().cuid();

export const documentSubjectTypeSchema = z.enum([
  "EMPLOYEE",
  "PERSON",
  "EMPLOYMENT",
  "CONTRACT",
  "CREDENTIAL",
  "ORGANIZATION",
]);

/** Display filename only — sanitized server-side; never a storage key. */
const fileNameSchema = z.string().trim().min(1).max(255);

export const uploadDocumentSchema = z.object({
  organizationId: cuidSchema.nullish(),
  subjectType: documentSubjectTypeSchema,
  subjectId: cuidSchema,
  typeCode: z.string().trim().min(2).max(60),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullish(),
  fileName: fileNameSchema,
  effectiveTo: z
    .string()
    .min(8)
    .max(30)
    .transform((v, ctx) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "Invalid date." });
        return z.NEVER;
      }
      return d;
    })
    .nullish(),
});

export const replaceDocumentSchema = z.object({
  documentId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  fileName: fileNameSchema,
  note: z.string().trim().max(2000).nullish(),
});

export const archiveDocumentSchema = z.object({
  documentId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const grantDocumentAccessSchema = z.object({
  documentId: cuidSchema,
  granteeUserId: cuidSchema,
  canDownload: z.boolean(),
});

export const documentIdSchema = z.object({ documentId: cuidSchema });

export const listForSubjectSchema = z.object({
  subjectType: documentSubjectTypeSchema,
  subjectId: cuidSchema,
});
