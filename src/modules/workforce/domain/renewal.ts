/**
 * Renewal workflow domain (Slice 1.1 continuation; Phase 1 roadmap:
 * "contract renewal workflow").
 *
 * Pure rules binding fixed-term contract and employee credential renewal to
 * the workflow primitives (approval → decision → apply), mirroring the
 * separation binding (separation.ts):
 *
 *  - A contract renewal targets the employment's current ACTIVE contract and
 *    must EXTEND its term: the new effective-to must be after the current
 *    effective-to (equal/reducing is an edit, not a renewal).
 *  - A credential renewal must land on an expiry strictly in the future, and
 *    the source credential must not be archived.
 *  - The intent is carried on the namespaced approval requestType
 *    (`contract.renewal` / `credential.renewal`) with sourceType
 *    CONTRACT / CREDENTIAL and sourceId of the target row.
 *  - Applying requires an APPROVED decision; renewing twice is refused
 *    against the immutable approved intent (the same approval has one effect).
 *
 * No I/O here; services enforce tenant scoping, authorization, audits.
 */
import { WorkforceDomainError } from "./errors";
import type { ApprovalStatus } from "@/modules/workflows/domain/workflow";

// --- request-type carriers ------------------------------------------------

export const CONTRACT_RENEWAL_REQUEST_TYPE = "contract.renewal";
export const CREDENTIAL_RENEWAL_REQUEST_TYPE = "credential.renewal";

export function isRenewalRequestType(requestType: string): boolean {
  return (
    requestType === CONTRACT_RENEWAL_REQUEST_TYPE ||
    requestType === CREDENTIAL_RENEWAL_REQUEST_TYPE
  );
}

/** The apply step may only act on an APPROVED decision. */
export function assertRenewalApplicable(status: ApprovalStatus): void {
  if (status !== "APPROVED") {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      `A renewal can only be applied from an APPROVED decision (got ${status}).`,
    );
  }
}

// --- contract renewal ------------------------------------------------------

export type ContractRenewalState = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "TERMINATED" | "ARCHIVED";

/** A renewal is only meaningful against the current ACTIVE contract. */
export function assertContractRenewalRequestAllowed(status: ContractRenewalState): void {
  if (status !== "ACTIVE") {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      `Only ACTIVE contracts can be renewed (got ${status}).`,
    );
  }
}

/** The new term must extend the current one: start before end, end strictly later. */
export function assertContractRenewalData(
  currentEffectiveTo: Date | null | undefined,
  data: { newEffectiveFrom?: Date | null; newEffectiveTo?: Date | null },
): void {
  if (!data.newEffectiveFrom || !data.newEffectiveTo) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "A contract renewal requires newEffectiveFrom and newEffectiveTo.",
    );
  }
  if (data.newEffectiveTo.getTime() <= data.newEffectiveFrom.getTime()) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "The renewed effectiveTo must be after the renewed effectiveFrom.",
    );
  }
  if (
    currentEffectiveTo &&
    data.newEffectiveTo.getTime() <= currentEffectiveTo.getTime()
  ) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "A renewal must extend the current term: newEffectiveTo after the current effectiveTo.",
    );
  }
}

// --- credential renewal ----------------------------------------------------

/** A credential renews only when it carries an expiry and is not archived. */
export function assertCredentialRenewalRequestAllowed(
  expiresOn: Date | null | undefined,
  status: "ACTIVE" | "ARCHIVED" | "INACTIVE",
): void {
  if (status !== "ACTIVE" || !expiresOn) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "Only an ACTIVE credential with an expiry can be renewed.",
    );
  }
}

/** The new expiry must be strictly in the future. */
export function assertCredentialRenewalData(
  newExpiresOn: Date | null | undefined,
  referenceDate: Date,
): void {
  if (!newExpiresOn) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "A credential renewal requires a new expiry date.",
    );
  }
  if (newExpiresOn.getTime() <= referenceDate.getTime()) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "The new credential expiry must be in the future.",
    );
  }
}