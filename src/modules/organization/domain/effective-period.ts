/**
 * Effective-dating rules (pure functions; unit-testable without a database).
 *
 * Conventions (AGENTS.md): time-variant organizational state carries
 * effectiveFrom/effectiveTo. Where the domain requires exclusivity — one
 * current record per key — overlapping active periods are rejected.
 */
import { OrgDomainError } from "./errors";

export interface EffectivePeriod {
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export function isValidPeriod(p: EffectivePeriod): boolean {
  return p.effectiveTo === null || p.effectiveFrom < p.effectiveTo;
}

export function isValidPeriodOrThrow(p: EffectivePeriod): void {
  if (!isValidPeriod(p)) {
    throw new OrgDomainError(
      "EFFECTIVE_PERIOD_INVALID",
      "effectiveFrom must be earlier than effectiveTo",
    );
  }
}

export function periodEnd(p: EffectivePeriod): Date {
  return p.effectiveTo ?? new Date("9999-12-31T23:59:59.999Z");
}

/** Inclusive-start, exclusive-end overlap of two periods. */
export function periodsOverlap(a: EffectivePeriod, b: EffectivePeriod): boolean {
  return a.effectiveFrom < periodEnd(b) && b.effectiveFrom < periodEnd(a);
}

export function isDateInPeriod(p: EffectivePeriod, at: Date): boolean {
  return p.effectiveFrom <= at && at < periodEnd(p);
}

/**
 * Overlap rejection where exclusivity is required: the new period must not
 * overlap any existing period for the same (tenant, organization, entity).
 */
export function assertNoOverlap(
  candidate: EffectivePeriod,
  existing: readonly EffectivePeriod[],
): void {
  for (const p of existing) {
    if (periodsOverlap(candidate, p)) {
      throw new PeriodOverlapError(candidate, p);
    }
  }
}

export class PeriodOverlapError extends OrgDomainError {
  constructor(
    public readonly candidate: EffectivePeriod,
    public readonly conflicting: EffectivePeriod,
  ) {
    super(
      "EFFECTIVE_PERIOD_OVERLAP",
      "Effective period overlaps an existing record for the same scope; history must not be silently superseded",
    );
  }
}
