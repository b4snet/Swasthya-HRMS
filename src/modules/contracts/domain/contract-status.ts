/**
 * Contract lifecycle state machine (pure functions; ADR-011 §1).
 *
 * DRAFT → PENDING_APPROVAL → ACTIVE → EXPIRED | TERMINATED; ARCHIVED from
 * any non-DRAFT state. EXPIRED is DERIVED (an activation with effectiveTo
 * in the past, or a date-driven sweep) — it is never a manual transition
 * target from ACTIVE; the service flips it via the sweep, not by user edit.
 *
 * Every state has a distinct domain consequence (plan §3):
 * - DRAFT: being assembled; invisible to ordinary reads (Phase 2 precedent).
 * - PENDING_APPROVAL: awaiting the approver (approvedBy/approvedAt metadata).
 * - ACTIVE: the governing agreement for the employment period.
 * - EXPIRED: past effectiveTo; immutable history.
 * - TERMINATED: ended before its term; immutable history.
 * - ARCHIVED: the only removal path; never deleted (Restrict FKs).
 */
import { ContractsDomainError } from "./errors";

export type ContractStatusValue =
  "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "EXPIRED" | "TERMINATED" | "ARCHIVED";

const TRANSITIONS: Record<ContractStatusValue, readonly ContractStatusValue[]> = {
  DRAFT: ["DRAFT", "PENDING_APPROVAL", "ACTIVE", "ARCHIVED"],
  PENDING_APPROVAL: ["PENDING_APPROVAL", "ACTIVE", "ARCHIVED"],
  ACTIVE: ["ACTIVE", "EXPIRED", "TERMINATED", "ARCHIVED"],
  EXPIRED: ["EXPIRED", "ARCHIVED"],
  TERMINATED: ["TERMINATED", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED"],
};

export function isContractTransitionAllowed(
  from: ContractStatusValue,
  to: ContractStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertContractTransition(from: ContractStatusValue, to: ContractStatusValue): void {
  if (!isContractTransitionAllowed(from, to)) {
    throw new ContractsDomainError(
      "CONTRACT_STATE_INVALID",
      `Cannot transition contract from ${from} to ${to}.`,
    );
  }
}

/** State changes that require approval metadata before they may proceed. */
export function assertApprovalRequirements(
  to: ContractStatusValue,
  meta: { approvedBy?: string | null; approvedAt?: Date | null },
): void {
  if (to === "ACTIVE" && (!meta.approvedBy || !meta.approvedAt)) {
    throw new ContractsDomainError(
      "CONTRACT_STATE_INVALID",
      "Activating a contract requires approvedBy and approvedAt metadata.",
    );
  }
}

/** States whose rows are immutable history (no further term edits). */
export const FROZEN_CONTRACT_STATUSES: readonly ContractStatusValue[] = [
  "EXPIRED",
  "TERMINATED",
  "ARCHIVED",
];

export function isContractFrozen(status: ContractStatusValue): boolean {
  return FROZEN_CONTRACT_STATUSES.includes(status);
}
