import { describe, expect, it } from "vitest";
import {
  isValidPeriod,
  periodsOverlap,
  isDateInPeriod,
  assertNoOverlap,
  PeriodOverlapError,
} from "@/modules/organization/domain/effective-period";

const d = (s: string) => new Date(s);
const p = (from: string, to: string | null) => ({
  effectiveFrom: d(from),
  effectiveTo: to ? d(to) : null,
});

describe("isValidPeriod", () => {
  it("accepts open-ended periods", () => {
    expect(isValidPeriod(p("2026-01-01", null))).toBe(true);
  });
  it("accepts from < to", () => {
    expect(isValidPeriod(p("2026-01-01", "2026-12-31"))).toBe(true);
  });
  it("rejects from == to and from > to", () => {
    expect(isValidPeriod(p("2026-01-01", "2026-01-01"))).toBe(false);
    expect(isValidPeriod(p("2026-06-01", "2026-01-01"))).toBe(false);
  });
});

describe("periodsOverlap (start-inclusive, end-exclusive)", () => {
  it("detects direct overlap", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-06-01"), p("2026-03-01", "2026-09-01"))).toBe(true);
  });
  it("detects overlap with an open-ended incumbent", () => {
    expect(periodsOverlap(p("2030-01-01", null), p("2026-01-01", null))).toBe(true);
  });
  it("allows adjacent periods (end == next start)", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-07-01"), p("2026-07-01", null))).toBe(false);
  });
  it("allows disjoint periods", () => {
    expect(periodsOverlap(p("2024-01-01", "2024-12-31"), p("2026-01-01", null))).toBe(false);
  });
});

describe("isDateInPeriod", () => {
  it("treats start as inclusive and end as exclusive", () => {
    const period = p("2026-01-01", "2026-07-01");
    expect(isDateInPeriod(period, d("2026-01-01"))).toBe(true);
    expect(isDateInPeriod(period, d("2026-06-30"))).toBe(true);
    expect(isDateInPeriod(period, d("2026-07-01"))).toBe(false);
  });
});

describe("assertNoOverlap (exclusivity where required)", () => {
  it("passes when the candidate fits between existing periods", () => {
    const existing = [p("2024-01-01", "2025-01-01"), p("2026-01-01", null)];
    expect(() => assertNoOverlap(p("2025-01-01", "2026-01-01"), existing)).not.toThrow();
  });
  it("throws PeriodOverlapError on any overlap", () => {
    const existing = [p("2026-01-01", null)];
    try {
      assertNoOverlap(p("2026-06-01", "2026-12-01"), existing);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PeriodOverlapError);
    }
  });
  it("rejects a second open-ended record for the same key", () => {
    expect(() => assertNoOverlap(p("2027-01-01", null), [p("2026-01-01", null)])).toThrow(
      PeriodOverlapError,
    );
  });
});
