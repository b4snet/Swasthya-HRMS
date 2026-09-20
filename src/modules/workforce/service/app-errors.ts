/**
 * Stable application errors for the Workforce context (Phase 2, plan §8).
 *
 * Same contract as the Organization context (app-errors.ts): clients receive
 * ONLY { code, message, field? }; database internals, SQL text, stack traces
 * and secrets never cross the boundary. Domain (WorkforceDomainError) and
 * known Prisma failures are mapped so services throw exactly one shape.
 */
import { WorkforceDomainError } from "../domain/errors";

export type WorkforceAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "NOT_LINKED"
  | "CONFLICT_DUPLICATE"
  | "CONFLICT_ASSIGNMENT_OVERLAP"
  | "EMPLOYMENT_STATE_INVALID"
  | "HIERARCHY_INVALID"
  | "RELATIONSHIP_INVALID"
  | "RESOURCE_CONFLICT"
  | "SENSITIVE_FIELD_RESTRICTED"
  | "UNEXPECTED";

/** Codes are stable API surface — UI and tests key on them. */
export const WORKFORCE_ERROR_STATUS: Record<WorkforceAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  NOT_LINKED: 404,
  CONFLICT_DUPLICATE: 409,
  CONFLICT_ASSIGNMENT_OVERLAP: 409,
  EMPLOYMENT_STATE_INVALID: 422,
  HIERARCHY_INVALID: 422,
  RELATIONSHIP_INVALID: 422,
  RESOURCE_CONFLICT: 409,
  SENSITIVE_FIELD_RESTRICTED: 403,
  UNEXPECTED: 500,
};

export class WorkforceAppError extends Error {
  /** Server-side only diagnostic cause (never serialized to clients). */
  declare readonly cause?: unknown;

  constructor(
    public readonly code: WorkforceAppErrorCode,
    message: string,
    /** Optional client-safe field hint for form validation errors. */
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "WorkforceAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

/** Map a domain error to its stable application code. */
export function codeForWorkforceDomainError(err: WorkforceDomainError): WorkforceAppErrorCode {
  switch (err.code) {
    case "ASSIGNMENT_OVERLAP":
      return "CONFLICT_ASSIGNMENT_OVERLAP";
    case "ASSIGNMENT_PERIOD_INVALID":
      return "VALIDATION_FAILED";
    case "EMPLOYMENT_STATE_INVALID":
      return "EMPLOYMENT_STATE_INVALID";
    case "ASSIGNMENT_MANAGER_INVALID":
    case "RELATIONSHIP_INVALID":
      return "RELATIONSHIP_INVALID";
    case "EMPLOYEE_NUMBER_INVALID":
    case "EMPLOYMENT_NUMBER_INVALID":
    case "IDENTITY_DOCUMENT_INVALID":
      return "VALIDATION_FAILED";
  }
}

const PRISMA_UNIQUE = "P2002";

/**
 * Translate any thrown value into a WorkforceAppError. Non-workforce errors
 * are wrapped as UNEXPECTED with a fixed message — callers log the original
 * server-side only.
 */
export function toWorkforceAppError(err: unknown): WorkforceAppError {
  if (err instanceof WorkforceAppError) return err;
  if (err instanceof WorkforceDomainError) {
    return new WorkforceAppError(codeForWorkforceDomainError(err), err.message, undefined, err);
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === PRISMA_UNIQUE) {
      return new WorkforceAppError(
        "CONFLICT_DUPLICATE",
        "A record with these unique values already exists.",
        undefined,
        err,
      );
    }
    if (code === "P2025") {
      return new WorkforceAppError(
        "NOT_FOUND",
        "The referenced record does not exist.",
        undefined,
        err,
      );
    }
    if (code === "P2034") {
      return new WorkforceAppError(
        "RESOURCE_CONFLICT",
        "The record was modified concurrently; retry.",
        undefined,
        err,
      );
    }
  }
  return new WorkforceAppError("UNEXPECTED", "The request could not be completed.", undefined, err);
}

/** Client-safe projection of a WorkforceAppError (api layer serializes this). */
export function serializeWorkforceAppError(err: WorkforceAppError): {
  code: WorkforceAppErrorCode;
  message: string;
  field?: string;
} {
  return { code: err.code, message: err.message, field: err.field };
}
