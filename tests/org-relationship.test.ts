import { describe, expect, it } from "vitest";
import {
  assertPositionPlacement,
  assertValidReportingEdge,
  assertNoPrimaryCycle,
} from "@/modules/organization/domain/relationship";
import { OrgDomainError } from "@/modules/organization/domain/errors";

const pos = (
  id: string,
  overrides: Partial<Parameters<typeof assertValidReportingEdge>[1]> = {},
) => ({
  id,
  tenantId: "t1",
  organizationId: "o1",
  departmentId: null,
  teamId: null,
  ...overrides,
});

const edge = (
  source: string,
  target: string,
  type: "PRIMARY" | "SECONDARY" | "MATRIX" = "PRIMARY",
) => ({
  sourcePositionId: source,
  targetPositionId: target,
  tenantId: "t1",
  organizationId: "o1",
  type,
});

describe("assertPositionPlacement", () => {
  it("accepts department-only or team-only placement", () => {
    expect(() => assertPositionPlacement({ departmentId: "d1", teamId: null })).not.toThrow();
    expect(() => assertPositionPlacement({ departmentId: null, teamId: "t1" })).not.toThrow();
  });
  it("rejects a position under both department and team", () => {
    expect(() => assertPositionPlacement({ departmentId: "d1", teamId: "t1" })).toThrow(
      OrgDomainError,
    );
  });
});

describe("assertValidReportingEdge", () => {
  it("accepts a same-org edge between distinct positions", () => {
    expect(() => assertValidReportingEdge(edge("p1", "p2"), pos("p1"), pos("p2"))).not.toThrow();
  });
  it("rejects self-edges", () => {
    expect(() => assertValidReportingEdge(edge("p1", "p1"), pos("p1"), pos("p1"))).toThrow(
      /itself/,
    );
  });
  it("rejects cross-tenant and cross-organization edges", () => {
    const otherTenant = pos("p2", { tenantId: "t2" });
    expect(() => assertValidReportingEdge(edge("p1", "p2"), pos("p1"), otherTenant)).toThrow(
      /tenant/,
    );
    const otherOrg = pos("p2", { organizationId: "o2" });
    expect(() => assertValidReportingEdge(edge("p1", "p2"), pos("p1"), otherOrg)).toThrow(
      /organization/,
    );
  });
});

describe("assertNoPrimaryCycle", () => {
  it("accepts a fresh edge in an acyclic forest", () => {
    // p2 -> p3 -> root; adding p1 -> p2 is fine.
    const managerOf = new Map([
      ["p2", "p3"],
      ["p3", "p9"],
    ]);
    managerOf.set("p1", "p2");
    expect(() => assertNoPrimaryCycle("p1", managerOf)).not.toThrow();
  });
  it("rejects an edge that closes a management loop", () => {
    // p2 -> p3 -> p1 exists; adding p1 -> p2 would cycle.
    const managerOf = new Map([
      ["p2", "p3"],
      ["p3", "p1"],
    ]);
    managerOf.set("p1", "p2");
    expect(() => assertNoPrimaryCycle("p1", managerOf)).toThrow(OrgDomainError);
  });
  it("detects a direct two-node cycle", () => {
    const managerOf = new Map([["p2", "p1"]]);
    managerOf.set("p1", "p2");
    expect(() => assertNoPrimaryCycle("p1", managerOf)).toThrow(/cycle/);
  });
});
