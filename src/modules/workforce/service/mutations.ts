/**
 * Workforce authorization guards + shared mutation plumbing (Phase 2).
 *
 * Mirrors the Organization module pattern (AGENTS.md: RBAC capability +
 * ABAC reach, decided server-side):
 *  - `assertCallerCanManageEmployees` — employee:manage + org reach,
 *  - `assertCallerCanReadEmployees`   — employee:read + org reach,
 *  - `assertSensitiveAccess`          — employee:read:sensitive + SENSITIVE
 *    scope grant (plan §5.3); the sensitive projection choke point calls
 *    this, so the API surface itself cannot leak sensitive fields.
 * Tenant isolation is checked BEFORE any scope grant is consulted; the
 * SUPER_ADMIN bypass is tenant-bound exactly as in Phase 1.
 *
 * All writes + the AuditEvent commit in ONE transaction (ADR-005,
 * fail-closed). Optimistic concurrency via assertVersionMatches. Errors are
 * stable (WorkforceAppError); Prisma internals never leak.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/rbac";
import { canAccessOrganization } from "@/lib/auth/scopes";
import { WorkforceAppError, toWorkforceAppError } from "./app-errors";
import type { WorkforceSubject } from "./types";

export type { WorkforceSubject };

type Capability = "read" | "manage";

/** Entry guard: ACTIVE user + RBAC permission + ABAC organization scope. */
export async function assertCallerCanAccessWorkforce(
  caller: WorkforceSubject,
  organizationId: string,
  capability: Capability,
): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new WorkforceAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
  const permission =
    capability === "manage" ? PERMISSIONS.EMPLOYEE_MANAGE : PERMISSIONS.EMPLOYEE_READ;
  if (!rolesHavePermission(caller.systemRoles, permission)) {
    throw new WorkforceAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action.",
      undefined,
      { reason: "PERMISSION_DENIED" },
    );
  }
  // Tenant isolation first: the organization must belong to the caller's
  // tenant. SUPER_ADMIN's bypass grants reach WITHIN the tenant, never
  // across tenants (Phase 1 assumption, preserved here).
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantId: true },
  });
  if (!org || org.tenantId !== caller.tenantId) {
    throw new WorkforceAppError(
      "AUTHORIZATION_DENIED",
      "Organization not in your tenant.",
      undefined,
      {
        reason: "ORG_TENANT_MISMATCH",
      },
    );
  }
  const decision = await canAccessOrganization(
    { userId: caller.userId, systemRoles: caller.systemRoles },
    organizationId,
  );
  if (!decision.allowed) {
    throw new WorkforceAppError(
      "AUTHORIZATION_DENIED",
      "You do not have access to this organization.",
      undefined,
      { reason: decision.reason },
    );
  }
}

export async function assertCallerCanManageEmployees(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessWorkforce(caller, organizationId, "manage");
}

export async function assertCallerCanReadEmployees(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessWorkforce(caller, organizationId, "read");
}

/**
 * Sensitive-field gate (plan §5.3): requires the dedicated
 * employee:read:sensitive permission AND an unrevoked SENSITIVE scope
 * grant. SUPER_ADMIN holds the permission by role map but still needs the
 * explicit SENSITIVE scope — deliberate break-glass posture (ADR-010 §5).
 */
export async function assertSensitiveAccess(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanReadEmployees(caller, organizationId);
  if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.EMPLOYEE_READ_SENSITIVE)) {
    throw new WorkforceAppError(
      "SENSITIVE_FIELD_RESTRICTED",
      "Sensitive personal fields require a dedicated sensitive-data grant.",
      undefined,
      { reason: "SENSITIVE_PERMISSION_MISSING" },
    );
  }
  const grant = await prisma.userAccessScope.findFirst({
    where: {
      userId: caller.userId,
      scopeType: "SENSITIVE",
      scopeId: caller.tenantId,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (!grant) {
    throw new WorkforceAppError(
      "SENSITIVE_FIELD_RESTRICTED",
      "Sensitive personal fields require a dedicated sensitive-data grant.",
      undefined,
      { reason: "SENSITIVE_SCOPE_MISSING" },
    );
  }
}

/**
 * Deny-by-default resource lookup: every unique constraint includes
 * tenantId (+ organizationId for org-scoped entities), so findFirst can
 * never return another tenant's row. A miss raises NOT_FOUND —
 * indistinguishable from missing scope at the boundary (IDOR-safe).
 */
export async function findScopedRow<T>(
  delegate: { findFirst: (args: unknown) => Promise<T | null> },
  where: Record<string, unknown>,
  what: string,
): Promise<T> {
  const row = await delegate.findFirst({ where });
  if (!row) notFound(what);
  return row;
}

export function notFound(what: string): never {
  throw new WorkforceAppError("NOT_FOUND", `${what} not found.`);
}

export interface MutationAudit {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Run `mutate` and the audit write in a single transaction. Audit is
 * fail-closed: if the event cannot be written the mutation rolls back
 * rather than mutating unaudited (ADR-005).
 *
 * `audit` may be a plain object or a function of the mutation result — the
 * function form lets CREATE operations attach the generated row id as
 * resourceId (ADR-005 requires resourceType/Id on every event).
 */
export async function transactWithAudit<T>(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  audit: MutationAudit | ((result: T) => MutationAudit),
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const result = await mutate(tx);
    const resolved = typeof audit === "function" ? audit(result) : audit;
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: resolved.action,
        resourceType: resolved.resourceType,
        resourceId: resolved.resourceId,
        before: resolved.before,
        after: resolved.after,
      },
      ctx ?? {},
      tx,
    );
    return result;
  });
}

/**
 * Optimistic concurrency: reject the update unless the stored row still
 * has the version the caller read. Pairs with `version: { increment: 1 }`.
 */
export function assertVersionMatches(
  current: { id: string; version: number },
  expectedVersion: number,
  what: string,
): void {
  if (current.version !== expectedVersion) {
    throw new WorkforceAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}

/** Re-export so services import one module for error translation. */
export { toWorkforceAppError };
