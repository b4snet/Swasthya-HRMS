/**
 * Unit tests — credential verification + expiry domain (Phase 3; ADR-011 §3).
 * Pure domain: no database, no Prisma.
 */
import { describe, expect, it } from "vitest";
import {
  MANUAL_OUTCOMES,
  assertOutcomeProgression,
  assertRecordableOutcome,
  assertRenewalExpiry,
  deriveCredentialStatus,
  isExpiryActionNeeded,
} from "@/modules/credentials/domain/expiry";
import { CredentialsDomainError } from "@/modules/credentials/domain/errors";

describe("recordable verification outcomes", () => {
  it("permits every manual act and forbids manual EXPIRED", () => {
    for (const outcome of MANUAL_OUTCOMES) {
      expect(() => assertRecordableOutcome(outcome)).not.toThrow();
    }
    expect(MANUAL_OUTCOMES).not.toContain("EXPIRED");
    expect(() => assertRecordableOutcome("EXPIRED")).toThrowError(/derived state/);
  });
});

describe("outcome progression", () => {
  it("rejects a no-op repeat of a terminal act", () => {
    expect(() => assertOutcomeProgression("VERIFIED", "VERIFIED")).toThrowError(
      CredentialsDomainError,
    );
    expect(() => assertOutcomeProgression("REVOKED", "REVOKED")).toThrowError(
      CredentialsDomainError,
    );
  });

  it("rejects resurrection: REVOKED → VERIFIED requires a new credential", () => {
    expect(() => assertOutcomeProgression("REVOKED", "VERIFIED")).toThrowError(
      /revoked credential cannot return to VERIFIED/,
    );
  });

  it("allows a fresh act after REJECTED or PENDING", () => {
    expect(() => assertOutcomeProgression("REJECTED", "VERIFIED")).not.toThrow();
    expect(() => assertOutcomeProgression("PENDING", "VERIFIED")).not.toThrow();
    expect(() => assertOutcomeProgression("IN_PROGRESS", "VERIFIED")).not.toThrow();
    expect(() => assertOutcomeProgression("VERIFIED", "REVOKED")).not.toThrow();
  });
});

describe("derived credential status (EXPIRED/EXPIRING are never stored manually)", () => {
  const today = new Date("2026-09-19T00:00:00Z");

  it("returns the recorded status when there is no expiry", () => {
    expect(
      deriveCredentialStatus({ expiresOn: null, verificationStatus: "VERIFIED" }, today, 60),
    ).toBe("VERIFIED");
  });

  it("derives EXPIRED past expiresOn regardless of the recorded status", () => {
    expect(
      deriveCredentialStatus(
        { expiresOn: new Date("2026-09-18T00:00:00Z"), verificationStatus: "VERIFIED" },
        today,
        60,
      ),
    ).toBe("EXPIRED");
    expect(
      deriveCredentialStatus(
        { expiresOn: new Date("2026-09-18T00:00:00Z"), verificationStatus: "PENDING" },
        today,
        60,
      ),
    ).toBe("EXPIRED");
  });

  it("derives EXPIRING inside the renewal lead window only for VERIFIED", () => {
    const soon = new Date("2026-10-15T00:00:00Z"); // 26 days out, window 60
    expect(
      deriveCredentialStatus({ expiresOn: soon, verificationStatus: "VERIFIED" }, today, 60),
    ).toBe("EXPIRING");
    // Same dates, but never verified: the early warning does not apply.
    expect(
      deriveCredentialStatus({ expiresOn: soon, verificationStatus: "PENDING" }, today, 60),
    ).toBe("PENDING");
  });

  it("keeps the recorded status outside the renewal window", () => {
    const far = new Date("2027-09-19T00:00:00Z");
    expect(
      deriveCredentialStatus({ expiresOn: far, verificationStatus: "VERIFIED" }, today, 60),
    ).toBe("VERIFIED");
  });

  it("flags action needed exactly for EXPIRED/EXPIRING", () => {
    expect(
      isExpiryActionNeeded(
        { expiresOn: new Date("2026-09-01T00:00:00Z"), verificationStatus: "VERIFIED" },
        today,
        60,
      ),
    ).toBe(true);
    expect(
      isExpiryActionNeeded(
        { expiresOn: new Date("2026-10-01T00:00:00Z"), verificationStatus: "VERIFIED" },
        today,
        60,
      ),
    ).toBe(true);
    expect(
      isExpiryActionNeeded(
        { expiresOn: new Date("2027-09-01T00:00:00Z"), verificationStatus: "VERIFIED" },
        today,
        60,
      ),
    ).toBe(false);
  });
});

describe("renewal rules", () => {
  const today = new Date("2026-09-19T00:00:00Z");

  it("moves expiry forward only", () => {
    expect(() =>
      assertRenewalExpiry(
        { expiresOn: new Date("2026-06-01T00:00:00Z") },
        new Date("2027-06-01T00:00:00Z"),
        today,
      ),
    ).not.toThrow();
  });

  it("refuses a renewal date in the past or before today", () => {
    expect(() =>
      assertRenewalExpiry(
        { expiresOn: new Date("2026-06-01T00:00:00Z") },
        new Date("2026-01-01T00:00:00Z"),
        today,
      ),
    ).toThrowError(CredentialsDomainError);
  });

  it("refuses shrinking a validity window (history rewriting)", () => {
    expect(() =>
      assertRenewalExpiry(
        { expiresOn: new Date("2027-06-01T00:00:00Z") },
        new Date("2026-12-01T00:00:00Z"),
        today,
      ),
    ).toThrowError(/shorten the validity window/);
  });
});
