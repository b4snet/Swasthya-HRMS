/**
 * Shared mutation plumbing for Organization services (queued prompt 3).
 *
 * Guarantees every service mutation provides (queued prompt brief §VALIDATION):
 * 1. Authorization is decided BEFORE any read/write (assertOrgAccess at entry).
 * 2. Tenant + organization scope come from the caller (session), never input.
 * 3. All writes + the AuditEvent commit in ONE Prisma transaction (ADR-005).
 * 4. Optimistic concurrency: every UPDATE increments version (Prisma
 *    @updatedAt only covers timestamps); the expectedVersion guard is then
 *    meaningful on the next read.
 * 5. Errors are stable (OrgAppError); Prisma internals never leak.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { OrgAppError, toOrgAppError } from "./app-errors";
import { assertOrgAccess, type OrgSubject } from "./validation-service";

type Capability = "read" | "manage";

/** Entry guard: ACTIVE user + RBAC permission + ABAC organization scope. */
export async function assertCallerCanManageOrg(
  caller: OrgSubject,
  organizationId: string,
  capability: Capability = "manage",
): Promise<void> {
  const decision = await assertOrgAccess(caller, organizationId, capability);
  if (!decision.ok) {
    throw new OrgAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action in this organization.",
      undefined,
      decision.reason,
    );
  }
}

/**
 * Deny-by-default resource lookup: every unique constraint must include
 * tenantId (and organizationId for org-scoped entities), so findFirst can
 * never return another tenant's row. A miss raises NOT_FOUND, not a
 * scope-leaking error.
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

/**
 * NOT_FOUND carrying the entity label (client-safe). Resource misses are
 * indistinguishable from missing scope at the API boundary — both surface
 * as NOT_FOUND/AUTHORIZATION_DENIED, never as scope leaks.
 */
export function notFound(what: string): never {
  throw new OrgAppError("NOT_FOUND", `${what} not found.`);
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
 * fail-closed by default (AUDIT_FAIL_CLOSED): if the event cannot be written
 * the mutation rolls back rather than mutating unaudited (ADR-005).
 *
 * `audit` may be a plain object or a function of the mutation result — the
 * function form lets CREATE operations attach the generated row id as
 * resourceId (ADR-005 requires resourceType/Id on every event; object form
 * exists for updates where the id is known upfront).
 */
export async function transactWithAudit<T>(
  caller: OrgSubject,
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
 * Optimistic concurrency: reject the update unless the stored row still has
 * the version the caller read. Pairs with the `version: { increment: 1 }`
 * every UPDATE must apply (Prisma does not bump @default fields itself).
 */
export function assertVersionMatches(
  current: { id: string; version: number },
  expectedVersion: number,
  what: string,
): void {
  if (current.version !== expectedVersion) {
    throw new OrgAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}

/** Re-export so services import one module for error translation. */
export { toOrgAppError };
