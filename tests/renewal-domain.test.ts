/**
 * Renewal workflow domain unit tests (Slice 1.1 continuation).
 *
 * Pure rules: contract renewal must extend an ACTIVE contract's term,
 * credential renewal must land on a future expiry, and neither applies
 * without an APPROVED decision.
 */
import { describe, expect, it } from "vitest";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";
import {
  CONTRACT_RENEWAL_REQUEST_TYPE,
  CREDENTIAL_RENEWAL_REQUEST_TYPE,
  assertContractRenewalData,
  assertContractRenewalRequestAllowed,
  assertCredentialRenewalData,
  assertCredentialRenewalRequestAllowed,
  assertRenewalApplicable,
  isRenewalRequestType,
} from "@/modules/workforce/domain/renewal";

describe("renewal request-type carriers", () => {
  it("recognizes exactly the two renewal request types", () => {
    expect(isRenewalRequestType(CONTRACT_RENEWAL_REQUEST_TYPE)).toBe(true);
    expect(isRenewalRequestType(CREDENTIAL_RENEWAL_REQUEST_TYPE)).toBe(true);
    expect(isRenewalRequestType("separation.TERMINATED")).toBe(false);
    expect(isRenewalRequestType("leave.annual")).toBe(false);
  });
});

describe("assertContractRenewalRequestAllowed", () => {
  it("permits renewal of the current ACTIVE contract only", () => {
    expect(() => assertContractRenewalRequestAllowed("ACTIVE")).not.toThrow();
    for (const status of ["DRAFT", "PENDING_APPROVAL", "EXPIRED", "TERMINATED", "ARCHIVED"] as const) {
      expect(() => assertContractRenewalRequestAllowed(status)).toThrow(WorkforceDomainError);
    }
  });
});

describe("assertContractRenewalData", () => {
  it("requires a well-formed, strictly-extending new term", () => {
    const current = new Date("2026-12-31");
    const start = new Date("2026-01-01");
    expect(() => assertContractRenewalData(current, {})).toThrow(WorkforceDomainError);
    expect(() =>
      assertContractRenewalData(current, { newEffectiveFrom: start, newEffectiveTo: null }),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertContractRenewalData(current, { newEffectiveFrom: start, newEffectiveTo: start }),
    ).toThrow(WorkforceDomainError);
    // Equal-to-current does not extend.
    expect(() =>
      assertContractRenewalData(current, { newEffectiveFrom: start, newEffectiveTo: current }),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertContractRenewalData(current, {
        newEffectiveFrom: start,
        newEffectiveTo: new Date("2027-12-31"),
      }),
    ).not.toThrow();
  });

  it("accepts a first term with no current effectiveTo", () => {
    expect(() =>
      assertContractRenewalData(null, {
        newEffectiveFrom: new Date("2027-01-01"),
        newEffectiveTo: new Date("2029-01-01"),
      }),
    ).not.toThrow();
  });
});

describe("assertCredentialRenewalRequestAllowed", () => {
  it("requires an ACTIVE credential that carries an expiry", () => {
    expect(() =>
      assertCredentialRenewalRequestAllowed(new Date("2026-09-30"), "ACTIVE"),
    ).not.toThrow();
    expect(() => assertCredentialRenewalRequestAllowed(null, "ACTIVE")).toThrow(
      WorkforceDomainError,
    );
    expect(() =>
      assertCredentialRenewalRequestAllowed(new Date("2026-09-30"), "ARCHIVED"),
    ).toThrow(WorkforceDomainError);
    expect(() =>
      assertCredentialRenewalRequestAllowed(new Date("2026-09-30"), "INACTIVE"),
    ).toThrow(WorkforceDomainError);
  });
});

describe("assertCredentialRenewalData", () => {
  it("requires a strictly-future new expiry", () => {
    const now = new Date("2026-09-20T00:00:00.000Z");
    expect(() => assertCredentialRenewalData(null, now)).toThrow(WorkforceDomainError);
    expect(() => assertCredentialRenewalData(new Date("2026-09-19"), now)).toThrow(
      WorkforceDomainError,
    );
    expect(() => assertCredentialRenewalData(new Date("2028-09-20"), now)).not.toThrow();
  });
});

describe("assertRenewalApplicable", () => {
  it("accepts only an APPROVED decision", () => {
    expect(() => assertRenewalApplicable("APPROVED")).not.toThrow();
    for (const status of ["REQUESTED", "PENDING", "REJECTED", "CANCELLED"] as const) {
      expect(() => assertRenewalApplicable(status)).toThrow(WorkforceDomainError);
    }
  });
});