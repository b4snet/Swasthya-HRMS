/**
 * Credentials authorization guards + shared mutation plumbing (Phase 3;
 * ADR-003). Mirrors the contracts/workforce modules: RBAC capability +
 * ABAC reach decided server-side.
 *
 * - Credential/Licence lifecycle acts resolve the credential's organization
 *   via a tenant-scoped lookup first (IDOR posture) and then run the
 *   capability + reach guards against it.
 * - The issuing-authority registry is tenant-scoped (rows may be global or
 *   tenant-owned); its guard checks the CREDENTIAL_MANAGE capability and
 *   tenant membership without any organization scope requirement.
 * - All writes + the AuditEvent commit in ONE transaction (ADR-005,
 *   fail-closed). Optimistic concurrency via assertVersionMatches.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission, type Permission } from "@/lib/auth/rbac";
import { canAccessOrganization } from "@/lib/auth/scopes";
import { CredentialsAppError } from "./app-errors";
import type { WorkforceSubject } from "@/modules/workforce/service/types";

export type { WorkforceSubject };

type Capability = "read" | "manage" | "verify";

const CAPABILITY_PERMISSION: Record<Capability, Permission> = {
  read: PERMISSIONS.CREDENTIAL_READ,
  manage: PERMISSIONS.CREDENTIAL_MANAGE,
  verify: PERMISSIONS.CREDENTIAL_VERIFY,
};

/** Entry guard: ACTIVE user + RBAC permission + tenant/org reach. */
export async function assertCallerCanAccessCredentials(
  caller: WorkforceSubject,
  organizationId: string,
  capability: Capability,
): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new CredentialsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
  if (!rolesHavePermission(caller.systemRoles, CAPABILITY_PERMISSION[capability])) {
    throw new CredentialsAppError(
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
    throw new CredentialsAppError(
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
    throw new CredentialsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have access to this organization.",
      undefined,
      { reason: decision.reason },
    );
  }
}

export async function assertCallerCanReadCredentials(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessCredentials(caller, organizationId, "read");
}

export async function assertCallerCanManageCredentials(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessCredentials(caller, organizationId, "manage");
}

export async function assertCallerCanVerifyCredentials(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<void> {
  await assertCallerCanAccessCredentials(caller, organizationId, "verify");
}

/**
 * Registry guard: ACTIVE user + CREDENTIAL_MANAGE inside the caller's
 * tenant. Issuing authorities are tenant-wide (optionally global rows), so
 * no organization scope is required — but the tenant boundary is strict.
 */
export async function assertCallerCanManageCredentialConfig(
  caller: WorkforceSubject,
): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new CredentialsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
  if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.CREDENTIAL_MANAGE)) {
    throw new CredentialsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action.",
      undefined,
      { reason: "PERMISSION_DENIED" },
    );
  }
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
  throw new CredentialsAppError("NOT_FOUND", `${what} not found.`);
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
    throw new CredentialsAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}

/** Translate a Prisma unique (P2002) into a stable CONFLICT_DUPLICATE. */
export function asConflict(err: unknown): CredentialsAppError {
  if (err instanceof CredentialsAppError) return err;
  const prismaErr = err as { code?: string; meta?: { target?: string[] } };
  if (prismaErr?.code === "P2002") {
    const target = prismaErr.meta?.target?.join(", ");
    return new CredentialsAppError(
      "CONFLICT_DUPLICATE",
      `A row with the same ${target ?? "identifier"} already exists.`,
      undefined,
      err,
    );
  }
  return new CredentialsAppError("UNEXPECTED", "An unexpected error occurred.", undefined, err);
}