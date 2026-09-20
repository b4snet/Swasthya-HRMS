/**
 * ABAC data-scope resolution (ADR-003 complement).
 *
 * Roles grant capability; scopes grant reach. A caller may act on data in an
 * organization only when an active UserAccessScope row grants that
 * organization — unless the caller holds SYSTEM_ROLE_SUPER_ADMIN.
 *
 * Pure decision functions are separated from DB access so both are unit-
 * testable; the DB-backed resolver is a thin query over user_access_scopes.
 */
import { prisma } from "@/lib/db";
import { SYSTEM_ROLES } from "@/lib/auth/rbac";

export const SCOPE_TYPE_ORGANIZATION = "ORGANIZATION";

export interface ScopeSubject {
  userId: string;
  systemRoles: readonly string[];
}

export interface OrgAccessDecision {
  allowed: boolean;
  reason: "OK" | "NO_ORG_SCOPE" | "SCOPE_REVOKED" | "SUPERUSER_BYPASS";
}

/** Pure decision: does this subject hold an applicable grant set? */
export function decideOrgAccess(
  subject: ScopeSubject,
  grants: { scopeType: string; revokedAt: Date | null }[],
  organizationId: string,
): OrgAccessDecision {
  if (subject.systemRoles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    return { allowed: true, reason: "SUPERUSER_BYPASS" };
  }
  const orgGrant = grants.find(
    (g) => g.scopeType === SCOPE_TYPE_ORGANIZATION && g.revokedAt === null,
  );
  if (!orgGrant) return { allowed: false, reason: "NO_ORG_SCOPE" };
  // The queried grant set is already scoped to (userId, organizationId) by
  // the resolver; presence of an unrevoked ORGANIZATION grant = access.
  void organizationId;
  return { allowed: true, reason: "OK" };
}

/**
 * Resolve whether the user may access data in the given organization.
 * The organizationId must originate from the session/service context —
 * never from untrusted client input.
 */
export async function canAccessOrganization(
  subject: ScopeSubject,
  organizationId: string,
): Promise<OrgAccessDecision> {
  if (subject.systemRoles.includes(SYSTEM_ROLES.SUPER_ADMIN)) {
    return { allowed: true, reason: "SUPERUSER_BYPASS" };
  }
  const grants = await prisma.userAccessScope.findMany({
    where: { userId: subject.userId, scopeId: organizationId },
    select: { scopeType: true, revokedAt: true },
  });
  return decideOrgAccess(subject, grants, organizationId);
}

/** List of organization ids the user can reach (for filtered queries). */
export async function accessibleOrganizationIds(subject: ScopeSubject): Promise<string[] | "ALL"> {
  if (subject.systemRoles.includes(SYSTEM_ROLES.SUPER_ADMIN)) return "ALL";
  const grants = await prisma.userAccessScope.findMany({
    where: {
      userId: subject.userId,
      scopeType: SCOPE_TYPE_ORGANIZATION,
      revokedAt: null,
    },
    select: { scopeId: true },
  });
  return grants.map((g) => g.scopeId);
}
