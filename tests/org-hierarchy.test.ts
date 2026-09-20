import { describe, expect, it } from "vitest";
import {
  assertValidParent,
  assertDepthWithinCap,
  buildAncestorChain,
  assertChainAcyclic,
  MAX_TREE_DEPTH,
  type HierarchyNode,
} from "@/modules/organization/domain/hierarchy";
import { OrgDomainError } from "@/modules/organization/domain/errors";

const node = (id: string, parentId: string | null): HierarchyNode => ({
  id,
  parentId,
  tenantId: "t1",
  organizationId: "o1",
});

describe("assertValidParent", () => {
  it("accepts a parent in the same tenant and organization", () => {
    expect(() => assertValidParent(node("c", null), node("p", null), [])).not.toThrow();
  });

  it("rejects cross-tenant parents", () => {
    const otherTenant = { ...node("p", null), tenantId: "t2" };
    expect(() => assertValidParent(node("c", null), otherTenant, [])).toThrow(OrgDomainError);
  });

  it("rejects cross-organization parents", () => {
    const otherOrg = { ...node("p", null), organizationId: "o2" };
    expect(() => assertValidParent(node("c", null), otherOrg, [])).toThrow(OrgDomainError);
  });

  it("rejects self-parenting", () => {
    expect(() => assertValidParent(node("x", null), node("x", null), [])).toThrow(/own parent/);
  });

  it("rejects cycles through the ancestor chain", () => {
    // Tree: a -> b -> c (a parents b, b parents c). Attaching a under c
    // would close the loop a -> c -> b -> a. The ancestor chain of the
    // proposed parent (c) is [b, a], nearest first.
    const chain = [node("b", "a"), node("a", null)];
    expect(() => assertValidParent(node("a", "b"), node("c", "b"), chain)).toThrow(/cycle/);
  });
});

describe("depth cap", () => {
  it(`allows depth up to ${MAX_TREE_DEPTH}`, () => {
    expect(() => assertDepthWithinCap(MAX_TREE_DEPTH - 1)).not.toThrow();
  });
  it("rejects depth beyond the cap", () => {
    expect(() => assertDepthWithinCap(MAX_TREE_DEPTH)).toThrow(OrgDomainError);
  });
});

describe("buildAncestorChain", () => {
  it("walks parents nearest-first and stops at the root", () => {
    const nodes = [node("a", null), node("b", "a"), node("c", "b"), node("d", "c")];
    const chain = buildAncestorChain(nodes, "d");
    expect(chain.map((n) => n.id)).toEqual(["c", "b", "a"]);
  });

  it("returns an empty chain for a root", () => {
    expect(buildAncestorChain([node("a", null)], "a")).toEqual([]);
  });

  it("survives corrupted self-referencing data via assertChainAcyclic", () => {
    // x and y point at each other; the bounded walk revisits nodes and the
    // chain guard must catch the duplicate.
    const corrupt = [node("x", "y"), node("y", "x")];
    const chain = buildAncestorChain(corrupt, "x");
    expect(chain.length).toBeGreaterThan(2); // walk looped
    expect(() => assertChainAcyclic(chain)).toThrow(OrgDomainError);
  });
});
