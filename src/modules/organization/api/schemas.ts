/**
 * Zod schemas for the Organization API surface (queued prompt 3).
 *
 * Every mutation is validated at the boundary BEFORE any service call.
 * Code/name rules are deliberately strict (stable, uppercase-snake codes)
 * so that codes are safe identifiers across domains; length caps prevent
 * unbounded strings reaching the database.
 */
import { z } from "zod";

/** Stable uppercase-snake identifier (1–40 chars). */
const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/, "Use uppercase letters, digits, - or _");

const nameSchema = z.string().trim().min(2).max(120);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v ?? null);

const cuidSchema = z.string().cuid();

const uuidishId = z.string().min(20).max(40);

// ── Tree entities (OrgUnit, Department, Team) ────────────────────────────────

export const orgUnitTypeSchema = z.enum(["BUSINESS_UNIT", "DIVISION"]);

export const createOrgUnitSchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
  type: orgUnitTypeSchema,
  parentId: cuidSchema.nullish(),
});

export const createDepartmentSchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
  description: optionalText(400),
  parentId: cuidSchema.nullish(),
});

export const createTeamSchema = createDepartmentSchema; // same shape

export const updateTreeNodeSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  code: codeSchema.optional(),
  name: nameSchema.optional(),
  description: optionalText(400).optional(),
  parentId: cuidSchema.nullish(),
  expectedVersion: z.number().int().min(1),
});

export const lifecycleTargetSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const setTreeNodeStatusSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  status: lifecycleTargetSchema,
});

export const idInOrgSchema = z.object({ organizationId: cuidSchema, id: cuidSchema });

// ── Classifications (Designation, JobFamily) ─────────────────────────────────

export const createDesignationSchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
  level: z.number().int().min(1).max(99).nullish(),
});

export const createJobFamilySchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
});

export const updateClassificationSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  name: nameSchema.optional(),
  level: z.number().int().min(1).max(99).nullish().optional(),
  expectedVersion: z.number().int().min(1),
});

// ── LegalEntity / CostCenter / Location / Facility ──────────────────────────

export const createLegalEntitySchema = z.object({
  code: codeSchema,
  registeredName: z.string().trim().min(2).max(200),
  registrationNumber: optionalText(60),
});

export const updateLegalEntitySchema = z.object({
  id: cuidSchema,
  registeredName: z.string().trim().min(2).max(200).optional(),
  registrationNumber: optionalText(60).optional(),
  expectedVersion: z.number().int().min(1),
});

export const createCostCenterSchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
});

export const updateCostCenterSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  name: nameSchema.optional(),
  expectedVersion: z.number().int().min(1),
});

export const createLocationSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  addressLine: optionalText(200),
  city: optionalText(80),
  district: optionalText(80),
  province: optionalText(80),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/, "Use a two-letter ISO 3166-1 alpha-2 code")
    .transform((v) => v.toUpperCase()),
  postalCode: optionalText(20),
});

export const updateLocationSchema = z.object({
  id: cuidSchema,
  name: nameSchema.optional(),
  addressLine: optionalText(200).optional(),
  city: optionalText(80).optional(),
  district: optionalText(80).optional(),
  province: optionalText(80).optional(),
  postalCode: optionalText(20).optional(),
  expectedVersion: z.number().int().min(1),
});

export const facilityTypeSchema = z.enum(["HOSPITAL", "CLINIC", "OFFICE", "OTHER"]);

export const createFacilitySchema = z.object({
  organizationId: cuidSchema,
  code: codeSchema,
  name: nameSchema,
  type: facilityTypeSchema,
  locationId: cuidSchema,
  effectiveFrom: z.coerce.date().optional(),
});

export const updateFacilitySchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  name: nameSchema.optional(),
  type: facilityTypeSchema.optional(),
  expectedVersion: z.number().int().min(1),
});

// ── Position ─────────────────────────────────────────────────────────────────

const nullableId = cuidSchema.nullish();

export const createPositionSchema = z
  .object({
    organizationId: cuidSchema,
    code: codeSchema,
    title: optionalText(120),
    departmentId: nullableId,
    teamId: nullableId,
    designationId: nullableId,
    gradeId: nullableId,
    jobFamilyId: nullableId,
    costCenterId: nullableId,
    effectiveFrom: z.coerce.date().optional(),
  })
  .refine((v) => Boolean(v.departmentId) !== Boolean(v.teamId), {
    message: "A position belongs to exactly one of department or team",
    path: ["departmentId"],
  });

export const updatePositionSchema = z
  .object({
    organizationId: cuidSchema,
    id: cuidSchema,
    title: optionalText(120).optional(),
    departmentId: nullableId,
    teamId: nullableId,
    designationId: nullableId,
    gradeId: nullableId,
    jobFamilyId: nullableId,
    costCenterId: nullableId,
    expectedVersion: z.number().int().min(1),
  })
  .refine(
    (v) =>
      (v.departmentId === undefined && v.teamId === undefined) ||
      Boolean(v.departmentId) !== Boolean(v.teamId),
    { message: "A position belongs to exactly one of department or team", path: ["departmentId"] },
  );

export const positionStatusSchema = z.enum(["VACANT", "FILLED", "CLOSED"]);

export const setPositionStatusSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  status: positionStatusSchema,
});

// ── ReportingEdge ────────────────────────────────────────────────────────────

export const reportingEdgeTypeSchema = z.enum(["PRIMARY", "SECONDARY", "MATRIX"]);

export const createReportingEdgeSchema = z.object({
  organizationId: cuidSchema,
  sourcePositionId: uuidishId,
  targetPositionId: uuidishId,
  type: reportingEdgeTypeSchema,
  effectiveFrom: z.coerce.date().optional(),
});

export const closeReportingEdgeSchema = z.object({
  organizationId: cuidSchema,
  id: cuidSchema,
  effectiveTo: z.coerce.date().optional(),
});
