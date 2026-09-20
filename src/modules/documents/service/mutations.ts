/**
 * Documents authorization guards + shared mutation plumbing (Phase 3).
 *
 * Mirrors the workforce module exactly (RBAC capability + ABAC reach,
 * decided server-side; ADR-003). Document-specific rules:
 *  - `document:upload` / `document:manage` / `document:read` +
 *    `document:download` capabilities from the role map;
 *  - reach = organization scope via canAccessOrganization (org-scoped docs)
 *    or tenant-wide reads for tenant-wide rows;
 *  - SENSITIVE_PERSONAL-classified documents additionally require the
 *    workforce sensitive gate (employee:read:sensitive + SENSITIVE scope) —
 *    employee visibility NEVER implies document access (ADR-011 §2).
 * Tenant isolation is checked BEFORE any scope grant is consulted.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission, type Permission } from "@/lib/auth/rbac";
import { canAccessOrganization } from "@/lib/auth/scopes";
import { DocumentsAppError } from "./app-errors";
import type { WorkforceSubject } from "@/modules/workforce/service/types";

export type { WorkforceSubject };

type Capability = "read" | "upload" | "manage";

const CAPABILITY_PERMISSION: Record<Capability, Permission> = {
  read: PERMISSIONS.DOCUMENT_READ,
  upload: PERMISSIONS.DOCUMENT_UPLOAD,
  manage: PERMISSIONS.DOCUMENT_MANAGE,
};

/** Entry guard: ACTIVE user + RBAC permission + tenant/org reach. */
export async function assertCallerCanAccessDocuments(
  caller: WorkforceSubject,
  organizationId: string | null,
  capability: Capability,
): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new DocumentsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
  if (!rolesHavePermission(caller.systemRoles, CAPABILITY_PERMISSION[capability])) {
    throw new DocumentsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action.",
      undefined,
      { reason: "PERMISSION_DENIED" },
    );
  }
  if (organizationId === null) {
    // Tenant-wide documents: any ACTIVE user inside the tenant with the
    // capability may reach them; the tenant binding is implicit because
    // every scoped lookup filters on tenantId.
    return;
  }
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantId: true },
  });
  if (!org || org.tenantId !== caller.tenantId) {
    throw new DocumentsAppError(
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
    throw new DocumentsAppError(
      "AUTHORIZATION_DENIED",
      "You do not have access to this organization.",
      undefined,
      { reason: decision.reason },
    );
  }
}

/**
 * Classification gate (ADR-011 §2): documents classified SENSITIVE_PERSONAL
 * require the same break-glass posture as workforce sensitive fields.
 * CREDENTIAL-classified documents require credential:read.
 */
export async function assertClassificationAccess(
  caller: WorkforceSubject,
  organizationId: string | null,
  classification: string,
): Promise<void> {
  if (classification === "SENSITIVE_PERSONAL") {
    if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.EMPLOYEE_READ_SENSITIVE)) {
      throw new DocumentsAppError(
        "SENSITIVE_FIELD_RESTRICTED",
        "This document is classified sensitive; a dedicated grant is required.",
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
      throw new DocumentsAppError(
        "SENSITIVE_FIELD_RESTRICTED",
        "This document is classified sensitive; a dedicated grant is required.",
      );
    }
  }
  if (classification === "CREDENTIAL") {
    if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.CREDENTIAL_READ)) {
      throw new DocumentsAppError(
        "SENSITIVE_FIELD_RESTRICTED",
        "This document is credential-classified; credential read access is required.",
      );
    }
  }
  // Base reach still applies for org-scoped rows.
  await assertCallerCanAccessDocuments(caller, organizationId, "read");
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
  throw new DocumentsAppError("NOT_FOUND", `${what} not found.`);
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
    throw new DocumentsAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}
