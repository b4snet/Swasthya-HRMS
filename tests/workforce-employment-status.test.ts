/**
 * Unit tests — employment lifecycle state machine (ADR-010 §2, plan §4).
 * Pure domain: no database, no Prisma.
 */
import { describe, expect, it } from "vitest";
import {
  appendStatusHistory,
  assertEmploymentTransition,
  assertSeparationRequirements,
  isEmploymentTransitionAllowed,
  isTerminalEmploymentStatus,
  type StatusHistoryEntry,
} from "@/modules/workforce/domain/employment-status";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";

describe("employment lifecycle transitions", () => {
  it("allows the happy-path progression to ACTIVE", () => {
    expect(isEmploymentTransitionAllowed("DRAFT", "PENDING_ONBOARDING")).toBe(true);
    expect(isEmploymentTransitionAllowed("PENDING_ONBOARDING", "ACTIVE")).toBe(true);
  });

  it("allows ACTIVE ⇄ SUSPENDED and ACTIVE → INACTIVE", () => {
    expect(isEmploymentTransitionAllowed("ACTIVE", "SUSPENDED")).toBe(true);
    expect(isEmploymentTransitionAllowed("SUSPENDED", "ACTIVE")).toBe(true);
    expect(isEmploymentTransitionAllowed("ACTIVE", "INACTIVE")).toBe(true);
    expect(isEmploymentTransitionAllowed("INACTIVE", "ACTIVE")).toBe(true);
  });

  it("allows every terminal separation from ACTIVE", () => {
    expect(isEmploymentTransitionAllowed("ACTIVE", "TERMINATED")).toBe(true);
    expect(isEmploymentTransitionAllowed("ACTIVE", "RESIGNED")).toBe(true);
    expect(isEmploymentTransitionAllowed("ACTIVE", "RETIRED")).toBe(true);
  });

  it("allows terminal separations from SUSPENDED/INACTIVE", () => {
    expect(isEmploymentTransitionAllowed("SUSPENDED", "TERMINATED")).toBe(true);
    expect(isEmploymentTransitionAllowed("INACTIVE", "RETIRED")).toBe(true);
  });

  it("rejects skipping the pre-employment gate", () => {
    expect(() => assertEmploymentTransition("DRAFT", "ACTIVE")).toThrow(WorkforceDomainError);
    expect(isEmploymentTransitionAllowed("DRAFT", "ACTIVE")).toBe(false);
  });

  it("rejects terminal states reviving (immutable history)", () => {
    expect(() => assertEmploymentTransition("TERMINATED", "ACTIVE")).toThrow(
      /terminal states are immutable/,
    );
    expect(() => assertEmploymentTransition("RESIGNED", "ACTIVE")).toThrow(WorkforceDomainError);
    expect(() => assertEmploymentTransition("RETIRED", "INACTIVE")).toThrow(WorkforceDomainError);
  });

  it("rejects jumping between unrelated states", () => {
    expect(() => assertEmploymentTransition("SUSPENDED", "PENDING_ONBOARDING")).toThrow(
      WorkforceDomainError,
    );
    expect(() => assertEmploymentTransition("DRAFT", "SUSPENDED")).toThrow(WorkforceDomainError);
  });

  it("classifies terminal statuses", () => {
    expect(isTerminalEmploymentStatus("TERMINATED")).toBe(true);
    expect(isTerminalEmploymentStatus("RETIRED")).toBe(true);
    expect(isTerminalEmploymentStatus("ACTIVE")).toBe(false);
    expect(isTerminalEmploymentStatus("DRAFT")).toBe(false);
  });

  it("exposes the error code EMPLOYMENT_STATE_INVALID", () => {
    try {
      assertEmploymentTransition("TERMINATED", "ACTIVE");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkforceDomainError);
      expect((err as WorkforceDomainError).code).toBe("EMPLOYMENT_STATE_INVALID");
    }
  });
});

describe("separation requirements", () => {
  it("requires date + reason for TERMINATED", () => {
    expect(() =>
      assertSeparationRequirements("TERMINATED", {
        terminationDate: new Date(),
        terminationReason: "MISCONDUCT",
      }),
    ).not.toThrow();
    expect(() =>
      assertSeparationRequirements("TERMINATED", { terminationDate: new Date() }),
    ).toThrow(/requires terminationDate and terminationReason/);
    expect(() =>
      assertSeparationRequirements("TERMINATED", { terminationReason: "MISCONDUCT" }),
    ).toThrow(WorkforceDomainError);
  });

  it("requires resignationDate for RESIGNED", () => {
    expect(() =>
      assertSeparationRequirements("RESIGNED", { resignationDate: new Date() }),
    ).not.toThrow();
    expect(() => assertSeparationRequirements("RESIGNED", {})).toThrow(/requires resignationDate/);
  });

  it("requires retirementDate for RETIRED", () => {
    expect(() =>
      assertSeparationRequirements("RETIRED", { retirementDate: new Date() }),
    ).not.toThrow();
    expect(() => assertSeparationRequirements("RETIRED", {})).toThrow(/requires retirementDate/);
  });

  it("imposes no extra requirements on non-terminal transitions", () => {
    expect(() => assertSeparationRequirements("ACTIVE", {})).not.toThrow();
    expect(() => assertSeparationRequirements("SUSPENDED", {})).not.toThrow();
  });
});

describe("status history", () => {
  it("appends transitions in order", () => {
    const history: StatusHistoryEntry[] = [];
    const h1 = appendStatusHistory(history, {
      status: "DRAFT",
      changedAt: "2026-01-01T00:00:00Z",
      changedBy: "hr",
    });
    const h2 = appendStatusHistory(h1, {
      status: "ACTIVE",
      changedAt: "2026-02-01T00:00:00Z",
      changedBy: "hr",
    });
    expect(h2.map((e) => e.status)).toEqual(["DRAFT", "ACTIVE"]);
  });

  it("does not append duplicate same-state entries", () => {
    const h: StatusHistoryEntry[] = [{ status: "ACTIVE", changedAt: "2026-01-01T00:00:00Z" }];
    const result = appendStatusHistory(h, { status: "ACTIVE", changedAt: "2026-02-01T00:00:00Z" });
    expect(result).toHaveLength(1);
  });

  it("never mutates the input history", () => {
    const h: StatusHistoryEntry[] = [{ status: "DRAFT", changedAt: "2026-01-01T00:00:00Z" }];
    appendStatusHistory(h, { status: "ACTIVE", changedAt: "2026-02-01T00:00:00Z" });
    expect(h).toHaveLength(1);
  });
});
