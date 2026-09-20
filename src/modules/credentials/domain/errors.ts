/**
 * Credential domain errors (Phase 3; ADR-011 §3).
 *
 * Pure-domain failures carry stable codes. The service layer translates
 * them into CredentialsAppError codes before they ever cross the API
 * boundary (never Prisma internals, never stack traces).
 */
export type CredentialsDomainErrorCode =
  | "CREDENTIAL_STATUS_DERIVED"
  | "CREDENTIAL_PROGRESSION_INVALID"
  | "CREDENTIAL_RENEWAL_INVALID"
  | "CREDENTIAL_LIFECYCLE_INVALID";

export class CredentialsDomainError extends Error {
  constructor(
    public readonly code: CredentialsDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CredentialsDomainError";
  }
}