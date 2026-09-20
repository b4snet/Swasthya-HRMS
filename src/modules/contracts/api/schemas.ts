/**
 * Zod schemas for the Contracts API surface (Phase 3, prompt 3).
 *
 * Conventions follow the workforce api/schemas.ts: strict ids (cuid),
 * length caps, date coercion at the boundary, stable validation errors.
 * Contract numbers are format-checked here AND re-asserted in the domain
 * (defense in depth); clause names are NAME_ONLY uppercase identifiers —
 * never amounts or free text (ADR-011 §1).
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

const isoDateNullish = isoDate.nullish().transform((v) => v ?? null);

const clauseNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_]{2,60}$/, "Clause names must be 2–60 uppercase letters/digits/underscores.");

export const contractNoSchema = z
  .string()
  .trim()
  .regex(
    /^CONTRACT-[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/,
    "Contract number must match CONTRACT-<ORG>-YY-NNNNN.",
  );

export const createContractSchema = z.object({
  organizationId: cuidSchema,
  employmentId: cuidSchema,
  contractNo: contractNoSchema,
  title: z.string().trim().min(3).max(200),
  type: z.enum([
    "EMPLOYMENT",
    "SECONDMENT",
    "NDA",
    "CONFIDENTIALITY",
    "LOCUM",
    "CONSULTANCY",
    "INTERNSHIP",
    "OTHER",
  ]),
  effectiveFrom: isoDate,
  effectiveTo: isoDateNullish,
  templateId: cuidSchema.nullish(),
  templateVersionNo: z.number().int().min(1).nullish(),
  jurisdiction: z.string().trim().max(80).nullish(),
  documentId: cuidSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
  firstVersion: z.object({
    effectiveFrom: isoDate,
    effectiveTo: isoDateNullish,
    clauseNames: z.array(clauseNameSchema).max(50).default([]),
    note: z.string().trim().max(2000).nullish(),
  }),
});

export const amendContractSchema = z.object({
  contractId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  nextVersion: z.object({
    effectiveFrom: isoDate,
    effectiveTo: isoDateNullish,
    clauseNames: z.array(clauseNameSchema).max(50).default([]),
    note: z.string().trim().max(2000).nullish(),
  }),
});

export const renewContractSchema = z.object({
  contractId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  newEffectiveTo: isoDate,
  note: z.string().trim().max(2000).nullish(),
});

export const changeContractStatusSchema = z.object({
  contractId: cuidSchema,
  to: z.enum(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "TERMINATED", "ARCHIVED"]), // EXPIRED is sweep-derived only
  expectedVersion: z.number().int().min(1),
  approvedBy: z.string().trim().max(120).nullish(),
  approvedAt: isoDateNullish,
  signature: z
    .object({
      signedOn: isoDate,
      signedByEmployee: z.string().trim().max(120).optional(),
      signedByEmployer: z.string().trim().max(120).optional(),
    })
    .optional(),
});

export const updateContractMetadataSchema = z.object({
  contractId: cuidSchema,
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(3).max(200).optional(),
  notes: z.string().trim().max(2000).nullish().optional(),
  documentId: cuidSchema.nullish().optional(),
});

export const archiveContractSchema = z.object({
  contractId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const contractIdSchema = z.object({ contractId: cuidSchema });

export const expiryWindowSchema = z
  .object({
    windowDays: z.number().int().min(1).max(365).optional(),
  })
  .optional();
