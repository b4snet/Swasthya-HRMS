/**
 * Zod schemas for the Workforce API surface (Phase 2, prompt 3).
 *
 * Every mutation is validated at the boundary BEFORE any service call.
 * Conventions follow the organization api/schemas.ts: strict codes, cuid
 * ids, length caps, date coercion at the boundary. Sensitive personal
 * fields are accepted (DOB/address) but services decide visibility; audit
 * never receives raw values.
 */
import { z } from "zod";

const cuidSchema = z.string().cuid();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === "" ? null : (v ?? null)));

/**
 * Optional-text for UPDATE payloads: presence-preserving. An absent key
 * stays undefined ("leave untouched") so partial edits never wipe fields;
 * an explicit empty string normalizes to null ("clear this field").
 * (Prompt-4 review fix: the previous nullish() collapsed undefined and
 * null, so a partial edit reset every omitted optional field.)
 */
const patchText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? null : v));

const isoDate = z
  .string()
  .min(8)
  .max(30)
  .transform((v, ctx) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const isoDateNullish = isoDate.nullish().transform((v) => v ?? null);

const nameSchema = z.string().trim().min(1).max(120);

const employeeNoSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/, "Use PREFIX-YY-NNNNN (e.g. EMP-26-00001)");

// ── Person ───────────────────────────────────────────────────────────────────

export const createPersonSchema = z.object({
  firstName: nameSchema,
  middleName: optionalText(80),
  lastName: nameSchema,
  preferredName: optionalText(80),
  // SENSITIVE_PERSONAL — accepted at the boundary, masked in audit.
  dateOfBirth: isoDateNullish,
  nationality: optionalText(2),
  email: z
    .string()
    .trim()
    .email()
    .max(160)
    .nullish()
    .transform((v) => v ?? null),
  phone: optionalText(40),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  city: optionalText(80),
  province: optionalText(80),
  country: optionalText(2),
  postalCode: optionalText(20),
});

export const updatePersonSchema = z.object({
  personId: cuidSchema,
  firstName: nameSchema.optional(),
  middleName: patchText(80),
  lastName: nameSchema.optional(),
  preferredName: patchText(80),
  dateOfBirth: isoDateNullish,
  nationality: patchText(2),
  email: z
    .string()
    .trim()
    .email()
    .max(160)
    .optional()
    .transform((v) => (v === "" ? null : v)),
  phone: patchText(40),
  addressLine1: patchText(200),
  addressLine2: patchText(200),
  city: patchText(80),
  province: patchText(80),
  country: patchText(2),
  postalCode: patchText(20),
  expectedVersion: z.number().int().min(1),
});

export const personIdSchema = z.object({
  personId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

// ── Employee + Employment ────────────────────────────────────────────────────

export const employeeTypeSchema = z.enum([
  "REGULAR",
  "CONTRACT",
  "PROBATION",
  "LOCUM",
  "INTERN",
  "VOLUNTEER",
  "OTHER",
]);

export const employmentTypeSchema = z.enum([
  "PERMANENT",
  "PROBATION",
  "CONTRACT",
  "LOCUM",
  "INTERN",
  "VOLUNTEER",
]);

export const workerClassificationSchema = z.enum([
  "EMPLOYEE",
  "CONTRACTOR",
  "TRAINEE",
  "VOLUNTEER",
]);

export const createEmployeeSchema = z.object({
  organizationId: cuidSchema,
  person: createPersonSchema,
  employeeNo: employeeNoSchema,
  employeeType: employeeTypeSchema,
  employment: z.object({
    employmentNo: employeeNoSchema,
    type: employmentTypeSchema,
    hireDate: isoDate,
    contractEndDate: isoDateNullish,
    probationEndDate: isoDateNullish,
    workLocationId: cuidSchema.nullish(),
    facilityId: cuidSchema.nullish(),
    workerClassification: workerClassificationSchema.default("EMPLOYEE"),
    noticePeriodDays: z.number().int().min(0).max(365).nullish(),
  }),
});

export const employeeIdInOrgSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
});

// ── Employment lifecycle ─────────────────────────────────────────────────────

export const employmentStatusSchema = z.enum([
  "DRAFT",
  "PENDING_ONBOARDING",
  "ACTIVE",
  "SUSPENDED",
  "INACTIVE",
  "TERMINATED",
  "RESIGNED",
  "RETIRED",
]);

export const terminationReasonSchema = z.enum([
  "MISCONDUCT",
  "PERFORMANCE",
  "REDUNDANCY",
  "END_OF_CONTRACT",
  "MUTUAL_AGREEMENT",
  "DEATH",
  "OTHER",
]);

export const changeEmploymentStatusSchema = z
  .object({
    organizationId: cuidSchema,
    employmentId: cuidSchema,
    to: employmentStatusSchema,
    note: optionalText(500),
    terminationDate: isoDateNullish,
    terminationReason: terminationReasonSchema.nullish(),
    resignationDate: isoDateNullish,
    retirementDate: isoDateNullish,
  })
  .superRefine((val, ctx) => {
    if (val.to === "TERMINATED") {
      if (!val.terminationDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "terminationDate is required",
          path: ["terminationDate"],
        });
      }
      if (!val.terminationReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "terminationReason is required",
          path: ["terminationReason"],
        });
      }
    }
    if (val.to === "RESIGNED" && !val.resignationDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resignationDate is required",
        path: ["resignationDate"],
      });
    }
    if (val.to === "RETIRED" && !val.retirementDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "retirementDate is required",
        path: ["retirementDate"],
      });
    }
  });

// ── Assignments ──────────────────────────────────────────────────────────────

export const createAssignmentSchema = z.object({
  organizationId: cuidSchema,
  employmentId: cuidSchema,
  positionId: cuidSchema.nullish(),
  departmentId: cuidSchema.nullish(),
  teamId: cuidSchema.nullish(),
  designationId: cuidSchema.nullish(),
  workLocationId: cuidSchema.nullish(),
  facilityId: cuidSchema.nullish(),
  managerEmploymentId: cuidSchema.nullish(),
  effectiveFrom: isoDate,
  closeCurrentAt: isoDateNullish,
});

export const closeAssignmentSchema = z.object({
  organizationId: cuidSchema,
  employmentId: cuidSchema,
  effectiveTo: isoDate,
});

export const listAssignmentsSchema = z.object({
  organizationId: cuidSchema,
  employmentId: cuidSchema,
});

// ── Employee lifecycle ───────────────────────────────────────────────────────

export const archiveEmployeeSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

// ── Child entities ───────────────────────────────────────────────────────────

export const createEmergencyContactSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  name: nameSchema,
  relationship: z.string().trim().min(2).max(60),
  phone: z.string().trim().min(5).max(40),
  email: z
    .string()
    .trim()
    .email()
    .max(160)
    .nullish()
    .transform((v) => v ?? null),
  isPrimary: z.boolean().default(false),
});

export const updateEmergencyContactSchema = z.object({
  organizationId: cuidSchema,
  contactId: cuidSchema,
  name: nameSchema.optional(),
  relationship: z.string().trim().min(2).max(60).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(160)
    .nullish()
    .transform((v) => v ?? null),
  isPrimary: z.boolean().optional(),
  expectedVersion: z.number().int().min(1),
});

export const dependentRelationshipSchema = z.enum(["SPOUSE", "CHILD", "PARENT", "OTHER"]);

export const createDependentSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  name: nameSchema,
  relationship: dependentRelationshipSchema,
  dateOfBirth: isoDateNullish, // SENSITIVE_PERSONAL
});

export const updateDependentSchema = z.object({
  organizationId: cuidSchema,
  dependentId: cuidSchema,
  name: nameSchema.optional(),
  relationship: dependentRelationshipSchema.optional(),
  dateOfBirth: isoDateNullish, // SENSITIVE_PERSONAL — service re-guards
  expectedVersion: z.number().int().min(1),
});

export const archiveDependentSchema = z.object({
  organizationId: cuidSchema,
  dependentId: cuidSchema,
  expectedVersion: z.number().int().min(1),
});

export const createCredentialSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  type: z.enum(["LICENSE", "CERTIFICATION", "REGISTRATION", "CLEARANCE"]),
  name: nameSchema,
  issuer: z.string().trim().min(2).max(160),
  code: optionalText(40),
  credentialNumber: optionalText(60),
  issuedOn: isoDateNullish,
  expiresOn: isoDateNullish,
  specialty: optionalText(120),
  facilityId: cuidSchema.nullish(),
});

// Phase 3 (ADR-011 §3): verification status is NEVER a free field on the
// update boundary — it changes only through explicit verification acts in
// the credentials module (credential:verify). The former
// credentialVerificationSchema on updateCredentialSchema is removed.
export const updateCredentialSchema = z.object({
  organizationId: cuidSchema,
  credentialId: cuidSchema,
  name: nameSchema.optional(),
  issuer: z.string().trim().min(2).max(160).optional(),
  code: optionalText(40),
  issuedOn: isoDateNullish,
  expiresOn: isoDateNullish,
  specialty: optionalText(120),
  expectedVersion: z.number().int().min(1),
});

export const createQualificationSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  type: z.enum(["DEGREE", "DIPLOMA", "TRAINING"]),
  name: nameSchema,
  institution: optionalText(160),
  completedOn: isoDateNullish,
  registrationNo: optionalText(60),
});

export const createDocumentReferenceSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  docType: z.string().trim().min(2).max(60),
  title: nameSchema,
  documentRef: z.string().trim().min(4).max(200),
  classification: z
    .enum(["PUBLIC", "INTERNAL", "PERSONAL", "SENSITIVE_PERSONAL", "EMPLOYMENT"])
    .default("EMPLOYMENT"),
});

// ── Reads ────────────────────────────────────────────────────────────────────

export const sensitiveAccessSchema = z.object({
  organizationId: cuidSchema,
  employeeId: cuidSchema,
  acknowledge: z.boolean(), // explicit break-glass acknowledgement, audited
});
