/**
 * Assignment interval math (pure functions; ADR-010 §3).
 *
 * Assignments are half-open intervals [effectiveFrom, effectiveTo):
 * effectiveTo === null means open. Exactly one OPEN assignment per
 * employment — enforced in the database by the partial unique index
 * `assignments_open_per_employment_key` and here for earlier, clearer
 * failures. Handover is contiguous: the new assignment starts the same
 * instant the old one ends; nothing is ever deleted.
 */
import { WorkforceDomainError } from "./errors";

export interface AssignmentPeriod {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

const OPEN_END = new Date("9999-12-31T23:59:59.999Z");

export function periodEnd(p: AssignmentPeriod): Date {
  return p.effectiveTo ?? OPEN_END;
}

export function isValidPeriod(p: AssignmentPeriod): boolean {
  return p.effectiveTo === null || p.effectiveFrom < p.effectiveTo;
}

export function assertValidPeriod(p: AssignmentPeriod): void {
  if (!isValidPeriod(p)) {
    throw new WorkforceDomainError(
      "ASSIGNMENT_PERIOD_INVALID",
      "effectiveFrom must be earlier than effectiveTo (half-open interval)",
    );
  }
}

export function isOpen(p: AssignmentPeriod): boolean {
  return p.effectiveTo === null;
}

/** Inclusive-start, exclusive-end overlap of two periods. */
export function periodsOverlap(a: AssignmentPeriod, b: AssignmentPeriod): boolean {
  return a.effectiveFrom < periodEnd(b) && b.effectiveFrom < periodEnd(a);
}

/**
 * Overlap rejection for assignments of the same employment (plan §4).
 * A candidate that is OPEN conflicts with any other OPEN assignment —
 * callers close the previous assignment in the same transaction (handover).
 */
export function assertNoAssignmentOverlap(
  candidate: AssignmentPeriod,
  existing: readonly AssignmentPeriod[],
): void {
  if (!isValidPeriod(candidate)) {
    throw new WorkforceDomainError(
      "ASSIGNMENT_PERIOD_INVALID",
      "effectiveFrom must be earlier than effectiveTo (half-open interval)",
    );
  }
  for (const p of existing) {
    if (periodsOverlap(candidate, p)) {
      throw new WorkforceDomainError(
        "ASSIGNMENT_OVERLAP",
        "Assignment period overlaps an existing assignment for the same employment; history must not be silently superseded",
      );
    }
  }
}

/**
 * Handover contiguity (ADR-010 §3): a replacement assignment must start at
 * or after the end of the assignment it replaces, with no gap beyond the
 * same instant (same-day handover allowed, backwards restarts are not).
 */
export function assertContiguousHandover(
  closing: AssignmentPeriod,
  replacement: AssignmentPeriod,
): void {
  const end = periodEnd(closing);
  if (replacement.effectiveFrom < end) {
    throw new WorkforceDomainError(
      "ASSIGNMENT_OVERLAP",
      "Replacement assignment cannot start before the assignment it replaces ends",
    );
  }
}

export function isDateInPeriod(p: AssignmentPeriod, at: Date): boolean {
  return p.effectiveFrom <= at && at < periodEnd(p);
}

/**
 * The OPEN assignment is the "current picture" (ADR-010 consequence §1):
 * headcount, org charts and payroll context all derive from it.
 */
export function findOpenAssignment<T extends AssignmentPeriod>(
  assignments: readonly T[],
): T | undefined {
  return assignments.find((a) => isOpen(a));
}
