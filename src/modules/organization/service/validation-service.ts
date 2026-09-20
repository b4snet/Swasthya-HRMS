/**
 * Organization validation services (application layer).
 *
 * Compose the pure domain rules with the database lookups they need, so
 * API/UI layers and future CRUD services call one auditable entry point per
 * concern. No HTTP or React types here (AGENTS.md).
 *
 * Scoping: every function takes tenantId (+ organizationId where
 * entity-scoped) explicitly — callers obtain these from the session, never
 * from client input.
 */
import { prisma } from "@/lib/db";
import { OrgDomainError } from "../domain/errors";
import {
  assertNoOverlap,
  isValidPeriodOrThrow,
  type EffectivePeriod,
} from "../domain/effective-period";
import {
  assertValidParent,
  assertDepthWithinCap,
  buildAncestorChain,
  assertChainAcyclic,
  MAX_TREE_DEPTH,
} from "../domain/hierarchy";
import { assertLifecycleTransition, assertPositionTransition } from "../domain/status";
import {
  assertPositionPlacement,
  assertValidReportingEdge,
  assertNoPrimaryCycle,
} from "../domain/relationship";
import { canAccessOrganization } from "@/lib/auth/scopes";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";

// ── Organization scope validation ────────────────────────────────────────────

export interface OrgSubject {
  userId: string;
  tenantId: string;
  organizationId: string | null;
  systemRoles: readonly string[];
  status: string;
}

export interface ScopeCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * The caller must: be an ACTIVE user, hold the RBAC permission for the
 * capability, and (unless SUPER_ADMIN) hold an ABAC scope over the
 * organization. Organization ids always come from the session/context.
 */
export async function assertOrgAccess(
  subject: OrgSubject,
  organizationId: string,
  capability: "read" | "manage",
): Promise<ScopeCheckResult> {
  if (subject.status !== "ACTIVE") {
    return { ok: false, reason: "USER_NOT_ACTIVE" };
  }
  const permission = capability === "manage" ? PERMISSIONS.ORG_MANAGE : PERMISSIONS.ORG_READ;
  if (!rolesHavePermission(subject.systemRoles, permission)) {
    return { ok: false, reason: "PERMISSION_DENIED" };
  }
  // Tenant isolation before any scope grant is consulted: the organization
  // must exist and belong to the CALLER's tenant. This holds even for
  // SUPER_ADMIN — the ABAC bypass grants reach within the tenant, never
  // across tenants (safest Phase 1 assumption; documented in the plan).
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantId: true },
  });
  if (!org || org.tenantId !== subject.tenantId) {
    return { ok: false, reason: "ORG_TENANT_MISMATCH" };
  }
  const decision = await canAccessOrganization(
    { userId: subject.userId, systemRoles: subject.systemRoles },
    organizationId,
  );
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  return { ok: true };
}

// ── Effective-date validation ────────────────────────────────────────────────

/**
 * Validate a candidate effective period and, where exclusivity is required,
 * reject overlap against the existing periods of the same record key
 * (organization-scoped, same table — callers pass pre-filtered rows).
 */
export async function validateEffectivePeriod(
  candidate: EffectivePeriod,
  existingPeriods: readonly EffectivePeriod[],
): Promise<void> {
  isValidPeriodOrThrow(candidate);
  assertNoOverlap(candidate, existingPeriods);
}

export async function loadActivePeriods(
  table: "orgUnit" | "department" | "team" | "position" | "facility",
  organizationId: string,
  excludeId?: string,
): Promise<EffectivePeriod[]> {
  // Per-model calls keep types concrete (Prisma delegates are not callable
  // as a union). Position uses PositionStatus (no ARCHIVED); the rest use
  // LifecycleStatus.
  const select = { effectiveFrom: true, effectiveTo: true } as const;
  const idFilter = excludeId ? { id: { not: excludeId } } : {};
  const rows =
    table === "orgUnit"
      ? await prisma.orgUnit.findMany({
          where: { organizationId, status: { not: "ARCHIVED" as const }, ...idFilter },
          select,
        })
      : table === "department"
        ? await prisma.department.findMany({
            where: { organizationId, status: { not: "ARCHIVED" as const }, ...idFilter },
            select,
          })
        : table === "team"
          ? await prisma.team.findMany({
              where: { organizationId, status: { not: "ARCHIVED" as const }, ...idFilter },
              select,
            })
          : table === "position"
            ? await prisma.position.findMany({
                where: { organizationId, status: { not: "CLOSED" as const }, ...idFilter },
                select,
              })
            : await prisma.facility.findMany({
                where: { organizationId, status: { not: "ARCHIVED" as const }, ...idFilter },
                select,
              });
  return rows.map((r) => ({ effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo }));
}

// ── Hierarchy validation (structural trees) ──────────────────────────────────

type TreeTable = "orgUnit" | "department" | "team";

/**
 * Validate re-parenting within a structural tree: loads the proposed
 * parent's ancestor chain and applies same-scope + cycle + depth rules.
 */
export async function validateStructuralParent(
  table: TreeTable,
  child: { id: string; tenantId: string; organizationId: string },
  proposedParentId: string | null,
): Promise<void> {
  if (proposedParentId === null) return; // root move is always safe

  // Per-model calls keep types concrete (Prisma delegates are not callable
  // as a union).
  const findNode = (id: string) =>
    table === "orgUnit"
      ? prisma.orgUnit.findUnique({
          where: { id },
          select: { id: true, tenantId: true, organizationId: true, parentId: true, status: true },
        })
      : table === "department"
        ? prisma.department.findUnique({
            where: { id },
            select: {
              id: true,
              tenantId: true,
              organizationId: true,
              parentId: true,
              status: true,
            },
          })
        : prisma.team.findUnique({
            where: { id },
            select: {
              id: true,
              tenantId: true,
              organizationId: true,
              parentId: true,
              status: true,
            },
          });

  const [childRow, parentRow] = await Promise.all([findNode(child.id), findNode(proposedParentId)]);
  if (!childRow || !parentRow) {
    throw new OrgDomainError("HIERARCHY_PARENT_MISMATCH", "validation target not found");
  }
  if (parentRow.status === "ARCHIVED") {
    throw new OrgDomainError("HIERARCHY_PARENT_MISMATCH", "cannot attach to an archived parent");
  }

  // Load the full node set of the org and derive the parent's ancestor
  // chain in memory.
  const all =
    table === "orgUnit"
      ? await prisma.orgUnit.findMany({
          where: { tenantId: childRow.tenantId, organizationId: childRow.organizationId },
          select: { id: true, parentId: true, tenantId: true, organizationId: true },
        })
      : table === "department"
        ? await prisma.department.findMany({
            where: { tenantId: childRow.tenantId, organizationId: childRow.organizationId },
            select: { id: true, parentId: true, tenantId: true, organizationId: true },
          })
        : await prisma.team.findMany({
            where: { tenantId: childRow.tenantId, organizationId: childRow.organizationId },
            select: { id: true, parentId: true, tenantId: true, organizationId: true },
          });
  const chain = buildAncestorChain(all, proposedParentId);
  assertChainAcyclic(chain);

  assertValidParent(
    {
      id: child.id,
      parentId: null,
      tenantId: childRow.tenantId,
      organizationId: childRow.organizationId,
    },
    parentRow,
    chain,
  );

  if (chain.length + 2 > MAX_TREE_DEPTH) {
    assertDepthWithinCap(chain.length + 1); // throws when exceeded
  }
}

/**
 * Creation-time parent validation (queued prompt 3).
 *
 * The child row does not exist yet, so the same-scope/cycle guarantees of
 * validateStructuralParent reduce to: (a) the proposed parent exists within
 * the caller's tenant + organization (scoped findFirst — a parent id from
 * another tenant or organization is rejected here, not by an FK), (b) it is
 * not ARCHIVED, (c) the resulting depth stays within the cap. A brand-new
 * node cannot create a cycle because nothing references it yet.
 */
export async function validateStructuralParentForCreate(
  table: TreeTable,
  tenantId: string,
  organizationId: string,
  proposedParentId: string | null,
): Promise<void> {
  if (proposedParentId === null) return;

  const parent =
    table === "orgUnit"
      ? await prisma.orgUnit.findFirst({
          where: { id: proposedParentId, tenantId, organizationId },
          select: { id: true, status: true },
        })
      : table === "department"
        ? await prisma.department.findFirst({
            where: { id: proposedParentId, tenantId, organizationId },
            select: { id: true, status: true },
          })
        : await prisma.team.findFirst({
            where: { id: proposedParentId, tenantId, organizationId },
            select: { id: true, status: true },
          });
  if (!parent) {
    throw new OrgDomainError(
      "HIERARCHY_PARENT_MISMATCH",
      "Proposed parent does not exist in this organization",
    );
  }
  if (parent.status === "ARCHIVED") {
    throw new OrgDomainError("HIERARCHY_PARENT_MISMATCH", "cannot attach to an archived parent");
  }

  const all = await loadTreeNodeSet(table, tenantId, organizationId);
  const chain = buildAncestorChain(all, proposedParentId);
  assertChainAcyclic(chain);
  assertDepthWithinCap(chain.length + 1); // new node adds one level under the parent
}

/** Load the full node set of one structural tree for an organization. */
async function loadTreeNodeSet(table: TreeTable, tenantId: string, organizationId: string) {
  const select = { id: true, parentId: true, tenantId: true, organizationId: true } as const;
  const where = { tenantId, organizationId };
  return table === "orgUnit"
    ? prisma.orgUnit.findMany({ where, select })
    : table === "department"
      ? prisma.department.findMany({ where, select })
      : prisma.team.findMany({ where, select });
}

// ── Lifecycle validation ─────────────────────────────────────────────────────

export function validateLifecycleChange(
  from: "ACTIVE" | "INACTIVE" | "ARCHIVED",
  to: "ACTIVE" | "INACTIVE" | "ARCHIVED",
): void {
  assertLifecycleTransition(from, to);
}

export function validatePositionStatusChange(
  from: "VACANT" | "FILLED" | "CLOSED",
  to: "VACANT" | "FILLED" | "CLOSED",
): void {
  assertPositionTransition(from, to);
}

// ── Relationship validation ──────────────────────────────────────────────────

export async function validatePositionPlacement(input: {
  departmentId: string | null;
  teamId: string | null;
  tenantId: string;
  organizationId: string;
}): Promise<void> {
  assertPositionPlacement(input);
  // Referential sanity + same-scope guarantee (FKs guarantee existence, not
  // scope, when ids arrive from DTOs).
  const checks: Promise<unknown>[] = [];
  if (input.departmentId) {
    checks.push(
      prisma.department.findFirst({
        where: {
          id: input.departmentId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
      }),
    );
  }
  if (input.teamId) {
    checks.push(
      prisma.team.findFirst({
        where: {
          id: input.teamId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
      }),
    );
  }
  const found = await Promise.all(checks);
  for (const row of found) {
    if (!row) {
      throw new OrgDomainError(
        "RELATIONSHIP_INVALID",
        "owning unit not found in organization scope",
      );
    }
  }
}

/** Validate + persist-check a reporting edge before creation. */
export async function validateReportingEdge(input: {
  tenantId: string;
  organizationId: string;
  sourcePositionId: string;
  targetPositionId: string;
  type: "PRIMARY" | "SECONDARY" | "MATRIX";
  period: EffectivePeriod;
}): Promise<void> {
  isValidPeriodOrThrow(input.period);

  const [source, target] = await Promise.all([
    prisma.position.findUnique({
      where: { id: input.sourcePositionId },
      select: {
        id: true,
        tenantId: true,
        organizationId: true,
        departmentId: true,
        teamId: true,
        status: true,
      },
    }),
    prisma.position.findUnique({
      where: { id: input.targetPositionId },
      select: {
        id: true,
        tenantId: true,
        organizationId: true,
        departmentId: true,
        teamId: true,
        status: true,
      },
    }),
  ]);
  if (!source || !target) {
    throw new OrgDomainError("RELATIONSHIP_INVALID", "position not found");
  }
  if (source.status === "CLOSED" || target.status === "CLOSED") {
    throw new OrgDomainError("RELATIONSHIP_INVALID", "cannot report to or from a closed position");
  }

  assertValidReportingEdge(input, source, target);

  // PRIMARY forest rule: walk existing ACTIVE primary managers from the
  // target side and ensure the new edge cannot loop back to the source.
  if (input.type === "PRIMARY") {
    const edges = await prisma.reportingEdge.findMany({
      where: {
        organizationId: input.organizationId,
        type: "PRIMARY",
        status: "ACTIVE",
        effectiveTo: null,
      },
      select: { sourcePositionId: true, targetPositionId: true },
    });
    const managerOf = new Map(edges.map((e) => [e.sourcePositionId, e.targetPositionId]));
    // Tentatively add the new edge, then check from the source.
    managerOf.set(input.sourcePositionId, input.targetPositionId);
    assertNoPrimaryCycle(input.sourcePositionId, managerOf);
  }
}
