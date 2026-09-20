/**
 * Zod schemas for the Credentials API surface (Phase 3, prompt 3).
 *
 * Conventions follow contracts/workforce api/schemas.ts: cuid ids, length
 * caps, date coercion at the boundary. Outcome/method enums accept only the
 * MANUAL outcomes — EXPIRED is DERIVED and never accepted from input
 * (ADR-011 §3); the service re-asserts it at runtime regardless.
 */
import { z } from "zod";

const cuidSchema = z.string().cuid();

const isoDate = z
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
  });

const methodSchema = z.enum(["ISSUER_DIRECT", "PORTAL", "DOCUMENT_INSPECTION", "PHONE", "OTHER"]);

const manualOutcomeSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "VERIFIED",
  "REJECTED",
  "REVOKED",
  "SUSPENDED",
]);

export const credentialIdSchema = z.object({ credentialId: cuidSchema });

export const submitForVerificationSchema = z.object({
  credentialId: cuidSchema,
  note: z.string().trim().max(2000).nullish(),
});

export const recordVerificationSchema = z.object({
  credentialId: cuidSchema,
  outcome: manualOutcomeSchema,
  method: methodSchema,
  notes: z.string().trim().max(2000).nullish(),
});

export const renewCredentialSchema = z.object({
  credentialId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  newExpiresOn: isoDate,
  notes: z.string().trim().max(2000).nullish(),
});

export const suspendCredentialSchema = z.object({
  credentialId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  note: z.string().trim().max(2000).nullish(),
});

export const reinstateCredentialSchema = z.object({
  credentialId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const archiveCredentialSchema = z.object({
  credentialId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const attachIssuingAuthoritySchema = z.object({
  credentialId: cuidSchema,
  issuingAuthorityId: cuidSchema,
  jurisdiction: z.string().trim().max(120).nullish(),
  expectedVersion: z.number().int().min(1),
});

const authorityTypeSchema = z.enum([
  "MEDICAL_COUNCIL",
  "NURSING_COUNCIL",
  "GOVERNMENT",
  "UNIVERSITY",
  "BOARD",
  "OTHER",
]);

export const createIssuingAuthoritySchema = z.object({
  organizationId: cuidSchema.nullish(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(200),
  authorityType: authorityTypeSchema,
  jurisdiction: z.string().trim().max(120).nullish(),
  website: z.string().trim().url().nullish(),
});

export const archiveIssuingAuthoritySchema = z.object({
  authorityId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const listVerificationRecordsSchema = z.object({ credentialId: cuidSchema });

export const expiryWindowSchema = z
  .object({
    today: isoDate.optional(),
  })
  .optional();