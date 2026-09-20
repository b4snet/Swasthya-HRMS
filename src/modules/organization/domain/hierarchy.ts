/**
 * Hierarchy rules for structural trees (pure functions; ADR-009).
 *
 * Applies to OrgUnit, Department, and Team trees: the parent must be the
 * same entity type (enforced by construction — services pass same-table
 * rows), within the same tenant + organization, must not create a cycle,
 * and must not exceed the depth cap.
 */
import { OrgDomainError } from "./errors";

/** Depth cap for all structural trees (ADR-009). */
export const MAX_TREE_DEPTH = 10;

export interface HierarchyNode {
  id: string;
  parentId: string | null;
  tenantId: string;
  organizationId: string;
}

/**
 * Validate attaching `child` under `parent`:
 * same tenant, same organization, no self-parent, no cycle.
 * Cycle check walks the ancestor chain of the proposed parent.
 */
export function assertValidParent(
  child: HierarchyNode,
  parent: HierarchyNode,
  ancestorsOfParent: readonly HierarchyNode[], // parent's chain, nearest first
): void {
  if (child.tenantId !== parent.tenantId) {
    throw new OrgDomainError(
      "HIERARCHY_PARENT_MISMATCH",
      "Parent and child must belong to the same tenant",
    );
  }
  if (child.organizationId !== parent.organizationId) {
    throw new OrgDomainError(
      "HIERARCHY_PARENT_MISMATCH",
      "Parent and child must belong to the same organization",
    );
  }
  if (child.id === parent.id) {
    throw new OrgDomainError("HIERARCHY_CYCLE", "An entity cannot be its own parent");
  }
  if (ancestorsOfParent.some((a) => a.id === child.id)) {
    throw new OrgDomainError(
      "HIERARCHY_CYCLE",
      "Re-parenting would create a cycle in the structural tree",
    );
  }
}

/** Depth of a node given its ancestor chain (chain excludes the node itself). */
export function depthWithAncestors(ancestorCount: number): number {
  return ancestorCount + 1;
}

/**
 * Assert the resulting depth stays within the cap.
 * `newAncestorCount` = number of ancestors the node will have after the move.
 */
export function assertDepthWithinCap(newAncestorCount: number): void {
  if (depthWithAncestors(newAncestorCount) > MAX_TREE_DEPTH) {
    throw new OrgDomainError(
      "HIERARCHY_DEPTH_EXCEEDED",
      `Structural trees are limited to a depth of ${MAX_TREE_DEPTH}`,
    );
  }
}

/**
 * Build the ancestor chain from a flat node list (nearest parent first).
 * Pure so services can load the chain with a recursive CTE or loop.
 */
export function buildAncestorChain(
  nodes: readonly HierarchyNode[],
  startId: string,
  maxIterations = MAX_TREE_DEPTH + 1,
): HierarchyNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: HierarchyNode[] = [];
  let cursor = byId.get(startId)?.parentId ?? null;
  for (let i = 0; i < maxIterations && cursor; i++) {
    const node = byId.get(cursor);
    if (!node) break;
    chain.push(node);
    cursor = node.parentId;
  }
  return chain;
}

/** Depth guard while walking: protects against corrupted self-references. */
export function assertChainAcyclic(chain: readonly HierarchyNode[]): void {
  const seen = new Set<string>();
  for (const node of chain) {
    if (seen.has(node.id)) {
      throw new OrgDomainError("HIERARCHY_CYCLE", "Detected a cycle in stored ancestry data");
    }
    seen.add(node.id);
  }
}
