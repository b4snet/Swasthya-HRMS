/**
 * Unit tests — assignment interval math (ADR-010 §3, plan §4).
 * Pure domain: half-open [from, to) intervals, one open per employment.
 */
import { describe, expect, it } from "vitest";
import {
  assertContiguousHandover,
  assertNoAssignmentOverlap,
  assertValidPeriod,
  findOpenAssignment,
  isDateInPeriod,
  isOpen,
  periodEnd,
} from "@/modules/workforce/domain/assignment-interval";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";

const d = (iso: string) => new Date(iso);

describe("period validity", () => {
  it("accepts open-ended and ordered periods", () => {
    expect(() => assertValidPeriod({ effectiveFrom: d("2026-01-01"), effectiveTo: null })).not.toThrow();
    expect(() =>
      assertValidPeriod({ effectiveFrom: d("2026-01-01"), effectiveTo: d("2027-01-01") }),
    ).not.toThrow();
  });

  it("rejects inverted periods", () => {
    expect(() =>
      assertValidPeriod({ effectiveFrom: d("2027-01-01"), effectiveTo: d("2026-01-01") }),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertValidPeriod({ effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-01-01") }),
    ).toThrow(/half-open interval/);
  });

  it("treats null effectiveTo as the far end", () => {
    const open = { effectiveFrom: d("2026-01-01"), effectiveTo: null };
    expect(periodEnd(open).getUTCFullYear()).toBe(9999);
    expect(isOpen(open)).toBe(true);
    expect(isOpen({ effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-01") })).toBe(false);
  });
});

describe("overlap detection", () => {
  const existing = { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-01") };

  it("detects overlaps inside a closed period", () => {
    expect(() =>
      assertNoAssignmentOverlap({ effectiveFrom: d("2026-03-01"), effectiveTo: d("2026-09-01") }, [
        existing,
      ]),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertNoAssignmentOverlap({ effectiveFrom: d("2025-01-01"), effectiveTo: d("2026-02-01") }, [
        existing,
      ]),
    ).toThrow(/overlaps an existing assignment/);
  });

  it("allows same-instant handover (half-open semantics)", () => {
    // Starts exactly when the previous ends — no overlap.
    expect(() =>
      assertNoAssignmentOverlap({ effectiveFrom: d("2026-06-01"), effectiveTo: null }, [existing]),
    ).not.toThrow();
  });

  it("rejects two OPEN assignments for the same employment", () => {
    const open = { effectiveFrom: d("2026-01-01"), effectiveTo: null };
    expect(() =>
      assertNoAssignmentOverlap({ effectiveFrom: d("2026-02-01"), effectiveTo: null }, [open]),
    ).toThrow(WorkforceDomainError);
  });

  it("rejects the candidate itself being invalid before comparing", () => {
    expect(() =>
      assertNoAssignmentOverlap(
        { effectiveFrom: d("2026-09-01"), effectiveTo: d("2026-01-01") },
        [],
      ),
    ).toThrow(/half-open/);
  });
});

describe("contiguous handover", () => {
  const closing = { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-01") };

  it("allows same-day and later starts", () => {
    expect(() =>
      assertContiguousHandover(closing, { effectiveFrom: d("2026-06-01"), effectiveTo: null }),
    ).not.toThrow();
    expect(() =>
      assertContiguousHandover(closing, { effectiveFrom: d("2026-07-01"), effectiveTo: null }),
    ).not.toThrow();
  });

  it("rejects starting before the closed assignment ends", () => {
    expect(() =>
      assertContiguousHandover(closing, { effectiveFrom: d("2026-05-31"), effectiveTo: null }),
    ).toThrow(/cannot start before/);
  });

  it("allows handing over from an open assignment closing now", () => {
    const openClosingNow = { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-09-18") };
    expect(() =>
      assertContiguousHandover(openClosingNow, {
        effectiveFrom: d("2026-09-18"),
        effectiveTo: null,
      }),
    ).not.toThrow();
  });
});

describe("point-in-time lookup", () => {
  const period = { effectiveFrom: d("2026-01-01"), effectiveTo: d("2026-06-01") };

  it("is inclusive-start, exclusive-end", () => {
    expect(isDateInPeriod(period, d("2026-01-01"))).toBe(true);
    expect(isDateInPeriod(period, d("2026-05-31T23:59:59Z"))).toBe(true);
    expect(isDateInPeriod(period, d("2026-06-01"))).toBe(false);
  });

  it("answers point-in-time for open periods", () => {
    const open = { effectiveFrom: d("2026-01-01"), effectiveTo: null };
    expect(isDateInPeriod(open, d("2099-01-01"))).toBe(true);
  });
});

describe("findOpenAssignment", () => {
  it("returns the only open assignment", () => {
    const rows = [
      { id: "a", effectiveFrom: d("2025-01-01"), effectiveTo: d("2025-06-01") },
      { id: "b", effectiveFrom: d("2025-06-01"), effectiveTo: null },
    ];
    expect(findOpenAssignment(rows)?.id).toBe("b");
  });

  it("returns undefined when everything is closed", () => {
    const rows = [{ id: "a", effectiveFrom: d("2025-01-01"), effectiveTo: d("2025-06-01") }];
    expect(findOpenAssignment(rows)).toBeUndefined();
  });
});
