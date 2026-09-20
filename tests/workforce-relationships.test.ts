/**
 * Unit tests — relationship validation (ADR-010 §3, plan §5/§13).
 * Pure domain: manager self/cycle rules, type coherence, document masking.
 */
import { describe, expect, it } from "vitest";
import {
  assertMaskedDocumentNumber,
  assertNoManagerCycle,
  assertNotSelfManager,
  assertSameOrganization,
  assertTypeClassificationCoherent,
} from "@/modules/workforce/domain/relationships";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";

describe("self-management", () => {
  it("rejects an employment managing itself", () => {
    expect(() => assertNotSelfManager("e1", "e1")).toThrow(WorkforceDomainError);
    try {
      assertNotSelfManager("e1", "e1");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WorkforceDomainError).code).toBe("ASSIGNMENT_MANAGER_INVALID");
    }
  });

  it("allows no-manager and distinct-manager cases", () => {
    expect(() => assertNotSelfManager("e1", null)).not.toThrow();
    expect(() => assertNotSelfManager("e1", "e2")).not.toThrow();
  });
});

describe("same-organization rule", () => {
  it("rejects cross-organization managers", () => {
    expect(() => assertSameOrganization("org-a", "org-b")).toThrow(/same organization/);
    expect(() => assertSameOrganization("org-a", "org-a")).not.toThrow();
  });
});

describe("manager cycle detection", () => {
  const edges = [
    { employmentId: "e1", managerEmploymentId: "e2" },
    { employmentId: "e2", managerEmploymentId: "e3" },
    { employmentId: "e3", managerEmploymentId: null },
  ];

  it("accepts an acyclic chain", () => {
    expect(() => assertNoManagerCycle("e1", "e2", edges)).not.toThrow();
    expect(() => assertNoManagerCycle("e3", null, edges)).not.toThrow();
  });

  it("rejects a direct two-cycle", () => {
    const cyclic = [...edges, { employmentId: "e2", managerEmploymentId: "e1" }];
    expect(() => assertNoManagerCycle("e1", "e2", cyclic)).toThrow(/cycle/);
  });

  it("rejects a self-loop via the graph", () => {
    const selfLoop = [{ employmentId: "e1", managerEmploymentId: "e1" }];
    expect(() => assertNoManagerCycle("e1", "e1", selfLoop)).toThrow(WorkforceDomainError);
  });

  it("rejects a longer cycle introduced by the candidate edge", () => {
    // e3 manages e1 already; making e1's manager e3 closes e1→e3→e1.
    const cyclic = [
      { employmentId: "e1", managerEmploymentId: "e2" },
      { employmentId: "e2", managerEmploymentId: null },
      { employmentId: "e3", managerEmploymentId: "e1" },
    ];
    expect(() => assertNoManagerCycle("e1", "e3", cyclic)).toThrow(/cycle/);
  });

  it("ignores unknown manager ids (treated as top of chain)", () => {
    expect(() => assertNoManagerCycle("e1", "external", edges)).not.toThrow();
  });
});

describe("employment type / classification coherence", () => {
  it("requires VOLUNTEER classification for VOLUNTEER employment", () => {
    expect(() => assertTypeClassificationCoherent("VOLUNTEER", "VOLUNTEER")).not.toThrow();
    expect(() => assertTypeClassificationCoherent("VOLUNTEER", "EMPLOYEE")).toThrow(
      /requires worker classification/,
    );
  });

  it("requires TRAINEE for INTERN and CONTRACTOR for LOCUM", () => {
    expect(() => assertTypeClassificationCoherent("INTERN", "TRAINEE")).not.toThrow();
    expect(() => assertTypeClassificationCoherent("INTERN", "EMPLOYEE")).toThrow(
      WorkforceDomainError,
    );
    expect(() => assertTypeClassificationCoherent("LOCUM", "CONTRACTOR")).not.toThrow();
    expect(() => assertTypeClassificationCoherent("LOCUM", "EMPLOYEE")).toThrow(
      WorkforceDomainError,
    );
  });

  it("imposes no restriction on unrestricted types", () => {
    expect(() => assertTypeClassificationCoherent("PERMANENT", "EMPLOYEE")).not.toThrow();
    expect(() => assertTypeClassificationCoherent("CONTRACT", "CONTRACTOR")).not.toThrow();
    expect(() => assertTypeClassificationCoherent("PROBATION", "EMPLOYEE")).not.toThrow();
  });
});

describe("masked document numbers", () => {
  it("accepts masked forms retaining the last 4", () => {
    expect(() => assertMaskedDocumentNumber("••••1234")).not.toThrow();
    expect(() => assertMaskedDocumentNumber("XXXXXX1234")).not.toThrow();
    expect(() => assertMaskedDocumentNumber("1234")).not.toThrow();
  });

  it("rejects too-short or over-long values", () => {
    expect(() => assertMaskedDocumentNumber("12")).toThrow(WorkforceDomainError);
    expect(() => assertMaskedDocumentNumber("12345678901234567890")).toThrow(WorkforceDomainError);
  });

  it("rejects values that look unmasked", () => {
    expect(() => assertMaskedDocumentNumber("12345678")).toThrow(/unmasked/);
    expect(() => assertMaskedDocumentNumber("AB12345678CD")).toThrow(WorkforceDomainError);
  });

  it("throws IDENTITY_DOCUMENT_INVALID", () => {
    try {
      assertMaskedDocumentNumber("12");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WorkforceDomainError).code).toBe("IDENTITY_DOCUMENT_INVALID");
    }
  });
});
