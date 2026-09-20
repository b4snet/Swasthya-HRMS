/**
 * Credential verification + expiry domain (Phase 3; ADR-011 §3).
 *
 * Pure logic, no I/O. Enforced invariants:
 * - EXPIRED is a DERIVED state — never written manually. The expiry sweep
 *   appends an EXPIRED record when the recorded expiry passes.
 * - Verification outcomes progress in a directed manner: a terminal act
 *   (VERIFIED/REVOKED) is never repeated as a no-op, and a REVOKED
 *   credential can never return to VERIFIED ("resurrection") — issue a new
 *   credential instead.
 * - Renewals move the expiry window FORWARD ONLY: past dates are refused
 *   and the validity window never shrinks (that would be history rewrite).
 */
import { CredentialsDomainError } from "./errors";

export type VerificationOutcome =
  | "PENDING"
  | "IN_PROGRESS"
  | "VERIFIED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED"
  | "SUSPENDED";

/**
 * Outcomes an actor may explicitly record. EXPIRED is deliberately absent —
 * it is derived by the expiry engine, never asserted by hand.
 */
export const MANUAL_OUTCOMES: readonly VerificationOutcome[] = [
  "PENDING",
  "IN_PROGRESS",
  "VERIFIED",
  "REJECTED",
  "REVOKED",
  "SUSPENDED",
];

/** Recorded states from which no further favouring act is legal. */
const TERMINAL_STATES = new Set<VerificationOutcome>(["VERIFIED", "REVOKED"]);

export function assertRecordableOutcome(outcome: VerificationOutcome): void {
  if (outcome === "EXPIRED") {
    throw new CredentialsDomainError(
      "CREDENTIAL_STATUS_DERIVED",
      "EXPIRED is a derived state and cannot be recorded manually. It is derived by the expiry engine from the recorded expiry date.",
    );
  }
}

/** Reject a verification progression that repeats a terminal act or revives a revoked one. */
export function assertOutcomeProgression(
  from: VerificationOutcome,
  to: VerificationOutcome,
): void {
  if (from === to && TERMINAL_STATES.has(from)) {
    throw new CredentialsDomainError(
      "CREDENTIAL_PROGRESSION_INVALID",
      `Repeating the ${from} outcome is a no-op. A fresh act may only follow a non-terminal state.`,
    );
  }
  if (from === "REVOKED" && to === "VERIFIED") {
    throw new CredentialsDomainError(
      "CREDENTIAL_PROGRESSION_INVALID",
      "A revoked credential cannot return to VERIFIED; a new credential must be issued.",
    );
  }
}

export interface ExpiryCandidate {
  expiresOn: Date | null;
  verificationStatus: string;
}

/**
 * Derive the CURRENT status of a credential from its recorded state + expiry:
 * - EXPIRED when the recorded expiry has passed (regardless of recorded status).
 * - EXPIRING when a VERIFIED credential's expiry falls inside the renewal
 *   lead window. Never-verified credentials inside the window stay at their
 *   recorded status (the early warning presumes it was ever good).
 * - Otherwise the recorded status.
 */
export function deriveCredentialStatus(
  input: ExpiryCandidate,
  today: Date,
  renewalLeadDays: number,
): string {
  const expiresOn = input.expiresOn;
  if (expiresOn && expiresOn.getTime() <= today.getTime()) return "EXPIRED";
  if (expiresOn && input.verificationStatus === "VERIFIED") {
    const horizon = new Date(today.getTime() + renewalLeadDays * 24 * 60 * 60 * 1000);
    if (expiresOn.getTime() <= horizon.getTime()) return "EXPIRING";
  }
  return input.verificationStatus;
}

/** True when the derived status now demands an action (renew or replace). */
export function isExpiryActionNeeded(
  input: ExpiryCandidate,
  today: Date,
  renewalLeadDays: number,
): boolean {
  const status = deriveCredentialStatus(input, today, renewalLeadDays);
  return status === "EXPIRED" || status === "EXPIRING";
}

/**
 * Renewal moves the expiry window forward only. Refuses:
 * - a renewal date at or before today (past/void dates),
 * - any date that would shorten the current validity window (history rewrite).
 */
export function assertRenewalExpiry(
  current: { expiresOn: Date | null },
  newExpiresOn: Date,
  today: Date,
): void {
  if (newExpiresOn.getTime() <= today.getTime()) {
    throw new CredentialsDomainError(
      "CREDENTIAL_RENEWAL_INVALID",
      "The renewal date must be in the future.",
    );
  }
  if (current.expiresOn && newExpiresOn.getTime() <= current.expiresOn.getTime()) {
    throw new CredentialsDomainError(
      "CREDENTIAL_RENEWAL_INVALID",
      "Renewal cannot shorten the validity window.",
    );
  }
}

/** Per-type default renewal-lead windows (fallback when no config rows exist). */
export const DEFAULT_RENEWAL_LEAD_DAYS: Record<string, number> = {
  LICENSE: 90,
  CERTIFICATION: 60,
  REGISTRATION: 60,
  CLEARANCE: 60,
};

export const DEFAULT_RENEWAL_LEAD_DAYS_FALLBACK = 60;

export function renewalLeadDaysFor(
  type: string,
  configs: Record<string, number>,
): number {
  return configs[type] ?? DEFAULT_RENEWAL_LEAD_DAYS[type] ?? DEFAULT_RENEWAL_LEAD_DAYS_FALLBACK;
}