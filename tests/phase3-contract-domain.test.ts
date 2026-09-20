/**
 * Unit tests — contract domain (Phase 3; ADR-011 §1).
 * Pure domain: no database, no Prisma.
 */
import { describe, expect, it } from "vitest";
import {
  assertApprovalRequirements,
  assertContractTransition,
  isContractFrozen,
  isContractTransitionAllowed,
} from "@/modules/contracts/domain/contract-status";
import {
  assertClauseNames,
  assertContractNo,
  assertVersionChain,
  isValidContractNo,
} from "@/modules/contracts/domain/contract-number";
import { ContractsDomainError } from "@/modules/contracts/domain/errors";

describe("contract lifecycle state machine", () => {
  it("allows the documented forward path DRAFT → PENDING_APPROVAL → ACTIVE", () => {
    expect(isContractTransitionAllowed("DRAFT", "PENDING_APPROVAL")).toBe(true);
    expect(isContractTransitionAllowed("PENDING_APPROVAL", "ACTIVE")).toBe(true);
    expect(isContractTransitionAllowed("DRAFT", "ACTIVE")).toBe(true); // fast-track
  });

  it("lets an ACTIVE contract end as EXPIRED or TERMINATED", () => {
    expect(isContractTransitionAllowed("ACTIVE", "EXPIRED")).toBe(true);
    expect(isContractTransitionAllowed("ACTIVE", "TERMINATED")).toBe(true);
  });

  it("allows ARCHIVED from every non-DRAFT historical state and from DRAFT", () => {
    expect(isContractTransitionAllowed("DRAFT", "ARCHIVED")).toBe(true);
    expect(isContractTransitionAllowed("PENDING_APPROVAL", "ARCHIVED")).toBe(true);
    expect(isContractTransitionAllowed("ACTIVE", "ARCHIVED")).toBe(true);
    expect(isContractTransitionAllowed("EXPIRED", "ARCHIVED")).toBe(true);
    expect(isContractTransitionAllowed("TERMINATED", "ARCHIVED")).toBe(true);
  });

  it("forbids resurrection of immutable history", () => {
    expect(isContractTransitionAllowed("EXPIRED", "ACTIVE")).toBe(false);
    expect(isContractTransitionAllowed("TERMINATED", "ACTIVE")).toBe(false);
    expect(isContractTransitionAllowed("ARCHIVED", "ACTIVE")).toBe(false);
    expect(isContractTransitionAllowed("ARCHIVED", "DRAFT")).toBe(false);
  });

  it("rejects an ACTIVE contract returning to DRAFT/PENDING_APPROVAL", () => {
    expect(isContractTransitionAllowed("ACTIVE", "DRAFT")).toBe(false);
    expect(isContractTransitionAllowed("ACTIVE", "PENDING_APPROVAL")).toBe(false);
  });

  it("throws CONTRACT_STATE_INVALID on a forbidden transition", () => {
    expect(() => assertContractTransition("EXPIRED", "ACTIVE")).toThrowError(ContractsDomainError);
    try {
      assertContractTransition("ARCHIVED", "ACTIVE");
      expect.unreachable("transition should have thrown");
    } catch (err) {
      expect((err as ContractsDomainError).code).toBe("CONTRACT_STATE_INVALID");
    }
  });

  it("marks EXPIRED/TERMINATED/ARCHIVED as frozen history", () => {
    expect(isContractFrozen("EXPIRED")).toBe(true);
    expect(isContractFrozen("TERMINATED")).toBe(true);
    expect(isContractFrozen("ARCHIVED")).toBe(true);
    expect(isContractFrozen("ACTIVE")).toBe(false);
    expect(isContractFrozen("DRAFT")).toBe(false);
  });

  it("requires approval metadata before activation", () => {
    expect(() =>
      assertApprovalRequirements("ACTIVE", { approvedBy: null, approvedAt: null }),
    ).toThrowError(ContractsDomainError);
    expect(() =>
      assertApprovalRequirements("ACTIVE", { approvedBy: "u-1", approvedAt: new Date() }),
    ).not.toThrow();
    // Non-activation transitions never require metadata.
    expect(() => assertApprovalRequirements("TERMINATED", {})).not.toThrow();
  });
});

describe("contract number format", () => {
  it("accepts the canonical CONTRACT-<ORG>-YY-NNNNN shape", () => {
    expect(isValidContractNo("CONTRACT-HQ-26-00001")).toBe(true);
    expect(isValidContractNo("CONTRACT-ORG12-25-123")).toBe(true);
    expect(isValidContractNo("CONTRACT-AB-99-12345678")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidContractNo("contract-hq-26-00001")).toBe(false); // lowercase
    expect(isValidContractNo("CONTRACT-HQ-2026-00001")).toBe(false); // 4-digit year
    expect(isValidContractNo("CONTRACT-HQ-26-12")).toBe(false); // sequence too short
    expect(isValidContractNo("CONTRACT-HQ-26-")).toBe(false); // no sequence
    expect(isValidContractNo("CONTRACT--26-00001")).toBe(false); // empty org
    expect(isValidContractNo("CONTRACT-HQ26-00001")).toBe(false); // missing separator
    expect(isValidContractNo("EMP-26-00001")).toBe(false); // wrong domain prefix
    expect(isValidContractNo("")).toBe(false);
  });

  it("throws CONTRACT_NUMBER_INVALID via assertContractNo", () => {
    try {
      assertContractNo("nope");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as ContractsDomainError).code).toBe("CONTRACT_NUMBER_INVALID");
    }
  });
});

describe("contract version chain", () => {
  it("accepts an open-ended first version", () => {
    expect(() =>
      assertVersionChain(null, {
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: null,
      }),
    ).not.toThrow();
  });

  it("requires effectiveFrom < effectiveTo on dated versions", () => {
    expect(() =>
      assertVersionChain(
        { effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        { effectiveFrom: new Date("2026-02-01"), effectiveTo: new Date("2026-01-01") },
      ),
    ).toThrowError(ContractsDomainError);
  });

  it("refuses a version that starts before the one it amends", () => {
    expect(() =>
      assertVersionChain(
        { effectiveFrom: new Date("2026-06-01"), effectiveTo: null },
        { effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
      ),
    ).toThrowError(/cannot start before/);
  });

  it("accepts a chronological amendment chain", () => {
    expect(() =>
      assertVersionChain(
        { effectiveFrom: new Date("2026-01-01"), effectiveTo: null },
        { effectiveFrom: new Date("2026-07-01"), effectiveTo: new Date("2027-01-01") },
      ),
    ).not.toThrow();
  });
});

describe("clause-name vocabulary", () => {
  it("accepts NAME_ONLY uppercase identifiers (never amounts or prose)", () => {
    expect(() => assertClauseNames(["PROBATION_90_DAYS", "NOTICE_30", "XX"])).not.toThrow();
  });

  it("rejects amounts and free text — clause payloads live in artifacts", () => {
    expect(() => assertClauseNames(["salary 45,000"])).toThrowError(ContractsDomainError);
    expect(() => assertClauseNames(["SALARY=45000"])).toThrowError(ContractsDomainError);
    expect(() => assertClauseNames([""])).toThrowError(ContractsDomainError);
  });
});
