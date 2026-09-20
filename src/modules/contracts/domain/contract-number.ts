/**
 * Contract number format validation + version rules (pure; ADR-011 §1).
 *
 * Mirrors workforce employee-number discipline (ADR-010 §4): org-scoped,
 * format-validated, NOT DB-sequenced — a global sequence would leak
 * contract volume across tenants.
 *
 * Canonical shape: `CONTRACT-<ORG>-YY-NNNNN` where
 * - CONTRACT: literal prefix,
 * - ORG: 2–10 uppercase alphanumerics (org code context),
 * - YY: two-digit year context,
 * - NNNNN: 3–8 digit sequence.
 */
import { ContractsDomainError } from "./errors";

export const CONTRACT_NO_PATTERN = /^CONTRACT-[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/;

export function isValidContractNo(contractNo: string): boolean {
  return CONTRACT_NO_PATTERN.test(contractNo);
}

export function assertContractNo(contractNo: string): void {
  if (!isValidContractNo(contractNo)) {
    throw new ContractsDomainError(
      "CONTRACT_NUMBER_INVALID",
      "contractNo must match CONTRACT-<ORG>-YY-NNNNN (literal CONTRACT prefix, 2–10 uppercase alphanumerics, 2-digit year, 3–8 digit sequence).",
    );
  }
}

// ── Contract version rules ────────────────────────────────────────────────

export interface ContractVersionInterval {
  effectiveFrom: Date;
  effectiveTo: Date | null; // null = open-ended
}

export function isValidVersionInterval(p: ContractVersionInterval): boolean {
  return p.effectiveTo === null || p.effectiveFrom < p.effectiveTo;
}

/**
 * A new version's window must start at or after the previous version's
 * start, and not overlap an already-closed predecessor. Versions form a
 * chronological chain: [from1, from2) → [from2, from3) → … with the last
 * one open (or dated for fixed-term amendments).
 */
export function assertVersionChain(
  previous: ContractVersionInterval | null,
  next: ContractVersionInterval,
): void {
  if (!isValidVersionInterval(next)) {
    throw new ContractsDomainError(
      "CONTRACT_VERSION_INVALID",
      "Version effectiveFrom must be before effectiveTo.",
    );
  }
  if (previous && next.effectiveFrom < previous.effectiveFrom) {
    throw new ContractsDomainError(
      "CONTRACT_VERSION_INVALID",
      "A new contract version cannot start before the version it amends.",
    );
  }
}

/** Clause-name vocabulary sanity: names only, never amounts (ADR-011). */
const CLAUSE_NAME_PATTERN = /^[A-Z0-9_]{2,60}$/;

export function assertClauseNames(names: readonly string[]): void {
  for (const name of names) {
    if (!CLAUSE_NAME_PATTERN.test(name)) {
      throw new ContractsDomainError(
        "CONTRACT_VERSION_INVALID",
        `Clause name "${name}" must be 2–60 uppercase letters/digits/underscores (names only — never amounts or free text).`,
      );
    }
  }
}
