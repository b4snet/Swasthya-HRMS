/**
 * Stable application errors for the Organization context (queued prompt 3).
 *
 * Contract (AGENTS.md / plan §error handling):
 * - Clients receive ONLY { code, message, field? } from OrgAppError.
 * - Database internals, SQL text, stack traces and secrets never cross the
 *   boundary; unexpected failures are logged server-side by the api layer
 *   and rethrown as a generic code.
 * - Domain (OrgDomainError) and known Prisma failures are mapped here so
 *   services throw exactly one error shape.
 */
import { OrgDomainError } from "../domain/errors";

export type OrgAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT_DUPLICATE"
  | "CONFLICT_EFFECTIVE_PERIOD_OVERLAP"
  | "HIERARCHY_INVALID"
  | "RELATIONSHIP_INVALID"
  | "REPORTING_CYCLE"
  | "LIFECYCLE_INVALID"
  | "RESOURCE_CONFLICT"
  | "UNEXPECTED";

/** Codes are stable API surface — UI and tests key on them. */
export const ORG_ERROR_STATUS: Record<OrgAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT_DUPLICATE: 409,
  CONFLICT_EFFECTIVE_PERIOD_OVERLAP: 409,
  HIERARCHY_INVALID: 422,
  RELATIONSHIP_INVALID: 422,
  REPORTING_CYCLE: 422,
  LIFECYCLE_INVALID: 422,
  RESOURCE_CONFLICT: 409,
  UNEXPECTED: 500,
};

export class OrgAppError extends Error {
  /** Server-side only diagnostic cause (never serialized to clients). */
  declare readonly cause?: unknown;

  constructor(
    public readonly code: OrgAppErrorCode,
    message: string,
    /** Optional client-safe field hint for form validation errors. */
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "OrgAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

/** Map a domain error to its stable application code. */
export function codeForDomainError(err: OrgDomainError): OrgAppErrorCode {
  switch (err.code) {
    case "EFFECTIVE_PERIOD_OVERLAP":
      return "CONFLICT_EFFECTIVE_PERIOD_OVERLAP";
    case "EFFECTIVE_PERIOD_INVALID":
      return "VALIDATION_FAILED";
    case "HIERARCHY_CYCLE":
    case "HIERARCHY_PARENT_MISMATCH":
    case "HIERARCHY_DEPTH_EXCEEDED":
      return "HIERARCHY_INVALID";
    case "LIFECYCLE_TRANSITION_INVALID":
      return "LIFECYCLE_INVALID";
    case "REPORTING_CYCLE":
      return "REPORTING_CYCLE";
    case "RELATIONSHIP_INVALID":
      return "RELATIONSHIP_INVALID";
  }
}

const PRISMA_UNIQUE = "P2002";

/**
 * Translate any thrown value into an OrgAppError. Non-Org errors are wrapped
 * as UNEXPECTED with a fixed message — callers log the original server-side.
 */
export function toOrgAppError(err: unknown): OrgAppError {
  if (err instanceof OrgAppError) return err;
  if (err instanceof OrgDomainError) {
    return new OrgAppError(codeForDomainError(err), err.message, undefined, err);
  }
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === PRISMA_UNIQUE) {
      return new OrgAppError(
        "CONFLICT_DUPLICATE",
        "A record with these unique values already exists.",
        undefined,
        err,
      );
    }
    // P2025 (record not found) and P2034 (write conflict) and everything else:
    // stable, non-leaking mapping.
    if (code === "P2025") {
      return new OrgAppError("NOT_FOUND", "The referenced record does not exist.", undefined, err);
    }
    if (code === "P2034") {
      return new OrgAppError(
        "RESOURCE_CONFLICT",
        "The record was modified concurrently; retry.",
        undefined,
        err,
      );
    }
  }
  return new OrgAppError("UNEXPECTED", "The request could not be completed.", undefined, err);
}

/** Client-safe projection of an OrgAppError (api layer serializes this). */
export function serializeOrgAppError(err: OrgAppError): {
  code: OrgAppErrorCode;
  message: string;
  field?: string;
} {
  return { code: err.code, message: err.message, field: err.field };
}
