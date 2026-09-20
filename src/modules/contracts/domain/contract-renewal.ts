/**
 * Contract renewal rules (pure; Phase 3 prompt 3, ADR-011 §1).
 *
 * Renewal is a FORWARD-ONLY extension of the governing term: it moves the
 * contract's end date later, never earlier, and only applies to contracts
 * that actually have an end date. An open-ended contract has nothing to
 * extend — changing its shape is an amendment (new clause set), not a
 * renewal. Shrinking a validity window would rewrite history's meaning.
 */
import { ContractsDomainError } from "./errors";

export interface ContractRenewalBase {
  effectiveFrom: Date;
  effectiveTo: Date | null; // null = open-ended → not renewable
}

export function assertRenewalChain(
  current: ContractRenewalBase,
  newEffectiveTo: Date,
  today: Date,
): void {
  if (current.effectiveTo === null) {
    throw new ContractsDomainError(
      "CONTRACT_PERIOD_INVALID",
      "An open-ended contract has no end date to renew; amend it instead.",
    );
  }
  if (newEffectiveTo.getTime() <= today.getTime()) {
    throw new ContractsDomainError(
      "CONTRACT_PERIOD_INVALID",
      "Renewed end date must be in the future.",
    );
  }
  if (newEffectiveTo.getTime() < current.effectiveTo.getTime()) {
    throw new ContractsDomainError(
      "CONTRACT_PERIOD_INVALID",
      "Renewal cannot shorten the term; the end date can only move forward.",
    );
  }
}
