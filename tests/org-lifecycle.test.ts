import { describe, expect, it } from "vitest";
import {
  assertLifecycleTransition,
  assertPositionTransition,
  archivalPatch,
} from "@/modules/organization/domain/status";
import { OrgDomainError } from "@/modules/organization/domain/errors";

describe("LifecycleStatus transitions", () => {
  it("allows ACTIVE ⇄ INACTIVE", () => {
    expect(() => assertLifecycleTransition("ACTIVE", "INACTIVE")).not.toThrow();
    expect(() => assertLifecycleTransition("INACTIVE", "ACTIVE")).not.toThrow();
  });
  it("allows deactivation and archival from any live state", () => {
    expect(() => assertLifecycleTransition("ACTIVE", "ARCHIVED")).not.toThrow();
    expect(() => assertLifecycleTransition("INACTIVE", "ARCHIVED")).not.toThrow();
  });
  it("treats ARCHIVED as terminal", () => {
    expect(() => assertLifecycleTransition("ARCHIVED", "ACTIVE")).toThrow(OrgDomainError);
    expect(() => assertLifecycleTransition("ARCHIVED", "INACTIVE")).toThrow(OrgDomainError);
  });
});

describe("PositionStatus transitions", () => {
  it("allows VACANT → FILLED and FILLED → VACANT", () => {
    expect(() => assertPositionTransition("VACANT", "FILLED")).not.toThrow();
    expect(() => assertPositionTransition("FILLED", "VACANT")).not.toThrow();
  });
  it("allows closure from VACANT or FILLED", () => {
    expect(() => assertPositionTransition("VACANT", "CLOSED")).not.toThrow();
    expect(() => assertPositionTransition("FILLED", "CLOSED")).not.toThrow();
  });
  it("treats CLOSED as terminal", () => {
    expect(() => assertPositionTransition("CLOSED", "VACANT")).toThrow(OrgDomainError);
    expect(() => assertPositionTransition("CLOSED", "FILLED")).toThrow(OrgDomainError);
  });
});

describe("archivalPatch", () => {
  it("sets ARCHIVED with an explicit effectiveTo when provided", () => {
    const at = new Date("2026-09-17T00:00:00Z");
    expect(archivalPatch(at)).toEqual({ status: "ARCHIVED", effectiveTo: at });
  });
  it("defaults effectiveTo to now when not provided", () => {
    const patch = archivalPatch(null);
    expect(patch.status).toBe("ARCHIVED");
    expect(patch.effectiveTo.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
