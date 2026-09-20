/**
 * Stable application errors for the Credentials context (Phase 3; ADR-011).
 * Same contract as Contracts/Documents/Workforce: clients receive ONLY
 * { code, message, field? }; database internals never cross the boundary.
 */
import { CredentialsDomainError } from "../domain/errors";

export type CredentialsAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT_DUPLICATE"
  | "RESOURCE_CONFLICT"
  | "CREDENTIAL_STATE_INVALID"
  | "CREDENTIAL_SUBMISSION_INVALID"
  | "AUTHORITY_IN_USE"
  | "UNEXPECTED";

export const CREDENTIALS_ERROR_STATUS: Record<CredentialsAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT_DUPLICATE: 409,
  RESOURCE_CONFLICT: 409,
  CREDENTIAL_STATE_INVALID: 422,
  CREDENTIAL_SUBMISSION_INVALID: 422,
  AUTHORITY_IN_USE: 409,
  UNEXPECTED: 500,
};

export class CredentialsAppError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: CredentialsAppErrorCode,
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "CredentialsAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

const DOMAIN_CODE_MAP: Record<CredentialsDomainError["code"], CredentialsAppErrorCode> = {
  CREDENTIAL_STATUS_DERIVED: "CREDENTIAL_STATE_INVALID",
  CREDENTIAL_PROGRESSION_INVALID: "CREDENTIAL_STATE_INVALID",
  CREDENTIAL_RENEWAL_INVALID: "CREDENTIAL_STATE_INVALID",
  CREDENTIAL_LIFECYCLE_INVALID: "CREDENTIAL_STATE_INVALID",
};

export function toCredentialsAppError(err: unknown): CredentialsAppError {
  if (err instanceof CredentialsAppError) return err;
  if (err instanceof CredentialsDomainError) {
    return new CredentialsAppError(DOMAIN_CODE_MAP[err.code], err.message, undefined, err);
  }
  return new CredentialsAppError("UNEXPECTED", "An unexpected error occurred.", undefined, err);
}

export function serializeCredentialsAppError(err: CredentialsAppError): {
  ok: false;
  error: { code: CredentialsAppErrorCode; message: string; field?: string };
} {
  return {
    ok: false,
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  };
}