/**
 * Separation workflow domain unit tests (Slice 1.1).
 *
 * Pure rules: terminal-destination validation on top of the employment
 * lifecycle machine, the request-type destination carrier, APPROVED-only
 * apply, and the deterministic exit-clearance derivation.
 */
import { describe, expect, it } from "vitest";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";
import {
  SEPARATION_CLEARANCE_CATALOG,
  assertSeparationApplicable,
  assertSeparationRequestAllowed,
  assertSeparationRequirements,
  deriveSeparationClearance,
  isSeparationRequestType,
  separationDestinationFromRequestType,
  separationRequestType,
} from "@/modules/workforce/domain/separation";

describe("separation request-type destination carrier", () => {
  it("round-trips each terminal destination", () => {
    for (const dest of ["TERMINATED", "RESIGNED", "RETIRED"] as const) {
      const requestType = separationRequestType(dest);
      expect(isSeparationRequestType(requestType)).toBe(true);
      expect(separationDestinationFromRequestType(requestType)).toBe(dest);
    }
  });

  it("rejects foreign or malformed request types", () => {
    expect(separationDestinationFromRequestType("separation.PROMOTION")).toBeNull();
    expect(separationDestinationFromRequestType("separation.")).toBeNull();
    expect(separationDestinationFromRequestType("purchase.order")).toBeNull();
    expect(isSeparationRequestType("leave.request")).toBe(false);
  });
});

describe("assertSeparationRequestAllowed", () => {
  it("allows terminal transitions from live states", () => {
    expect(() => assertSeparationRequestAllowed("ACTIVE", "RESIGNED")).not.toThrow();
    expect(() => assertSeparationRequestAllowed("SUSPENDED", "TERMINATED")).not.toThrow();
    expect(() => assertSeparationRequestAllowed("INACTIVE", "RETIRED")).not.toThrow();
  });

  it("rejects non-terminal destinations", () => {
    expect(() => assertSeparationRequestAllowed("ACTIVE", "SUSPENDED")).toThrow(
      WorkforceDomainError,
    );
  });

  it("rejects terminal destinations the lifecycle machine does not permit", () => {
    // PENDING_ONBOARDING has no transitions to terminal states.
    expect(() => assertSeparationRequestAllowed("PENDING_ONBOARDING", "TERMINATED")).toThrow(
      WorkforceDomainError,
    );
    // A terminal row is immutable history — no separation can be re-requested from it.
    expect(() => assertSeparationRequestAllowed("TERMINATED", "RESIGNED")).toThrow(
      WorkforceDomainError,
    );
  });
});

describe("assertSeparationApplicable", () => {
  it("accepts only an APPROVED decision", () => {
    expect(() => assertSeparationApplicable("APPROVED")).not.toThrow();
    for (const status of ["REQUESTED", "PENDING", "REJECTED", "CANCELLED"] as const) {
      expect(() => assertSeparationApplicable(status)).toThrow(WorkforceDomainError);
    }
  });
});

describe("assertSeparationRequirements", () => {
  it("requires the right effect data per destination", () => {
    const when = new Date("2026-09-01");
    expect(() =>
      assertSeparationRequirements("TERMINATED", { terminationDate: when }),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertSeparationRequirements("TERMINATED", { terminationDate: when, terminationReason: "MISCONDUCT" }),
    ).not.toThrow();
    expect(() => assertSeparationRequirements("RESIGNED", {})).toThrow(WorkforceDomainError);
    expect(() => assertSeparationRequirements("RESIGNED", { resignationDate: when })).not.toThrow();
    expect(() => assertSeparationRequirements("RETIRED", { retirementDate: when })).not.toThrow();
  });
});

describe("deriveSeparationClearance", () => {
  it("derives one draft per catalog item, deterministically", () => {
    const reference = new Date("2026-09-15T00:00:00.000Z");
    const first = deriveSeparationClearance(reference);
    const second = deriveSeparationClearance(reference);
    expect(first).toHaveLength(SEPARATION_CLEARANCE_CATALOG.length);
    expect(first).toEqual(second);
    expect(first.every((d) => d.taskType === "separation.clearance")).toBe(true);
  });

  it("offsets due dates from the separation date", () => {
    const reference = new Date("2026-09-15T00:00:00.000Z");
    const drafts = deriveSeparationClearance(reference);
    const access = drafts.find((d) => d.subject.includes("access"));
    const advances = drafts.find((d) => d.subject.includes("cash advances"));
    const salary = drafts.find((d) => d.subject.includes("Final salary"));
    expect(access).toBeDefined();
    expect(advances).toBeDefined();
    expect(salary).toBeDefined();
    // Null offsets carry null due dates; access is due day-of, advances at +14, salary +45.
    const earlierThan = (a: Date | null, b: Date | null) =>
      a !== null && b !== null && a.getTime() <= b.getTime();
    expect(earlierThan(access!.dueDate, advances!.dueDate)).toBe(true);
    expect(earlierThan(advances!.dueDate, salary!.dueDate)).toBe(true);
  });
});