/**
 * Contracts authorization guards + shared mutation plumbing (Phase 3).
 *
 * Mirrors the workforce module (RBAC capability + ABAC reach, decided
 * server-side; ADR-003). Contracts are employment-bound: reach is resolved
 * through the employment's organization, and tenant isolation is checked
 * BEFORE any scope grant is consulted.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission, type Permission } from "@/lib/auth/rbac";
import { canAccessOrganization } from "@/lib/auth/scopes";
import { ContractsAppError } from "./app-errors";
import type { WorkforceSubject } from "@/modules/workforce/service/types";

export type { WorkforceSubject };

type Capability = "read" | "manage";

const CAPABILITY_PERMISSION: Record<Capability, Permission> = {
  read: PERMISSIONS.CONTRACT_READ,
  manage: PERMISSIONS.CONTRACT_MANAGE,
};

/** Entry guard: ACTIVE user + RBAC permission + tenant/org reach. */
export async function assertCallerCanAccessContracts(
  caller: WorkforceSubject,
  organizationId: string,
  capability: Capability,
): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new ContractsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
  if (!rolesHavePermission(caller.systemRoles, CAPABILITY_PERMISSION[capability])) {
    throw new ContractsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action.",
      undefined,
      { reason: "PERMISSION_DENIED" },
    );
  }
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantId: true },
  });
  if (!org || org.tenantId !== caller.tenantId) {
    throw new ContractsAppError(
      "AUTHORIZATION_DENIED",
      "Organization not in your tenant.",
      undefined,
      { reason: "ORG_TENANT_MISMATCH" },
    );
  }
  const decision = await canAccessOrganization(
    { userId: caller.userId, systemRoles: caller.systemRoles },
    organizationId,
  );
  if (!decision.allowed) {
    throw new ContractsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have access to this organization.",
      undefined,
      { reason: decision.reason },
    );
  }
}

export async function assertCallerCanManageContracts(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessContracts(caller, organizationId, "manage");
}

export async function assertCallerCanReadContracts(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessContracts(caller, organizationId, "read");
}

/** Deny-by-default scoped row lookup (IDOR-safe; NOT_FOUND on miss). */
export async function findScopedRow<Where extends Record<string, unknown>, T>(
  delegate: { findFirst(args: { where: Where }): Promise<T | null> },
  where: Where,
  what: string,
): Promise<T> {
  const row = await delegate.findFirst({ where });
  if (!row) notFound(what);
  return row;
}

export function notFound(what: string): never {
  throw new ContractsAppError("NOT_FOUND", `${what} not found.`);
}

export interface MutationAudit {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Single-transaction mutation + audit (fail-closed; ADR-005). */
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

export function assertVersionMatches(
  current: { id: string; version: number },
  expectedVersion: number,
  what: string,
): void {
  if (current.version !== expectedVersion) {
    throw new ContractsAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}
