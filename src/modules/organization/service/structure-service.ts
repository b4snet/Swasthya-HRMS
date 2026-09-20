/**
 * Organization services: structural trees (OrgUnit, Department, Team) and
 * flat classifications (Designation, JobFamily).
 *
 * Layering (AGENTS.md): pure rules live in ../domain, DB-composed validation
 * in validation-service, and THIS module adds authorization, scoping,
 * transactions, audit and stable client-safe errors. Status values are the
 * schema enums (LifecycleStatus); archival sets status ARCHIVED + effectiveTo
 * and never deletes. Updates are optimistic (expectedVersion required).
 */
import type { Prisma } from "@prisma/client";
import type { OrgUnitType } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { OrgAppError, toOrgAppError } from "./app-errors";
import { assertCallerCanManageOrg, notFound, transactWithAudit } from "./mutations";
import { validateStructuralParent, validateStructuralParentForCreate } from "./validation-service";
import type { OrgSubject } from "./validation-service";

type Tx = Prisma.TransactionClient;
type TreeTable = "orgUnit" | "department" | "team";
type ClassificationTable = "designation" | "jobFamily";

const AUDIT_RESOURCE: Record<TreeTable | ClassificationTable, string> = {
  orgUnit: "OrgUnit",
  department: "Department",
  team: "Team",
  designation: "Designation",
  jobFamily: "JobFamily",
};

// ── Tree entities (OrgUnit, Department, Team) ────────────────────────────────

export interface TreeNodeInput {
  code: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
  /** Required when table is orgUnit (schema discriminator). */
  type?: "BUSINESS_UNIT" | "DIVISION";
}

export interface TreeNodeUpdateInput {
  code?: string;
  name?: string;
  description?: string | null;
  parentId?: string | null;
  /** Immutable after creation for orgUnit (type changes are not allowed). */
  expectedVersion: number;
}

export async function createTreeNode(
  table: TreeTable,
  caller: OrgSubject,
  organizationId: string,
  input: TreeNodeInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: `org.${table.toLowerCase()}.create`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: created.id,
        after: { code: input.code, name: input.name, parentId: input.parentId ?? null },
      }),
      async (tx) => {
        // Creation-time parent check: the child row does not exist yet, so
        // scope + archived-parent + depth are validated here; a new node
        // cannot create a cycle because nothing references it.
        await validateStructuralParentForCreate(
          table,
          caller.tenantId,
          organizationId,
          input.parentId ?? null,
        );
        if (table === "orgUnit" && input.type === undefined) {
          throw new OrgAppError(
            "VALIDATION_FAILED",
            "An org unit requires a type (BUSINESS_UNIT or DIVISION).",
            "type",
          );
        }
        if (table === "orgUnit") {
          // OrgUnit has no description column (schema); the field is
          // accepted for interface parity but ignored for this table.
          return tx.orgUnit.create({
            data: {
              tenantId: caller.tenantId,
              organizationId,
              code: input.code,
              name: input.name,
              parentId: input.parentId ?? null,
              type: input.type as OrgUnitType, // validated above
              createdBy: caller.userId,
              updatedBy: caller.userId,
            },
            select: { id: true },
          });
        }
        const data = {
          tenantId: caller.tenantId,
          organizationId,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          parentId: input.parentId ?? null,
          createdBy: caller.userId,
          updatedBy: caller.userId,
        };
        const created =
          table === "department"
            ? await tx.department.create({ data, select: { id: true } })
            : await tx.team.create({ data, select: { id: true } });
        return created;
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function updateTreeNode(
  table: TreeTable,
  caller: OrgSubject,
  organizationId: string,
  id: string,
  input: TreeNodeUpdateInput,
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.${table.toLowerCase()}.update`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await findScopedTreeNode(tx, table, caller.tenantId, organizationId, id);
        if (!current) notFound(AUDIT_RESOURCE[table]);
        if (current.version !== input.expectedVersion) {
          throw new OrgAppError(
            "RESOURCE_CONFLICT",
            "Record changed since it was read; reload and retry.",
          );
        }
        if (current.status === "ARCHIVED") {
          throw new OrgAppError(
            "LIFECYCLE_INVALID",
            "Archived records are immutable history and cannot be edited.",
          );
        }
        if (input.parentId !== undefined) {
          await validateStructuralParent(
            table,
            { id, tenantId: caller.tenantId, organizationId },
            input.parentId,
          );
        }
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        for (const key of ["code", "name", "description", "parentId"] as const) {
          if (input[key] !== undefined) data[key] = input[key];
        }
        await updateTreeNodeRow(tx, table, id, data);
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

/** Archival: status ARCHIVED + effectiveTo closed atomically; idempotent. */
export async function archiveTreeNode(
  table: TreeTable,
  caller: OrgSubject,
  organizationId: string,
  id: string,
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.${table.toLowerCase()}.archive`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await findScopedTreeNode(tx, table, caller.tenantId, organizationId, id);
        if (!current) notFound(AUDIT_RESOURCE[table]);
        if (current.status === "ARCHIVED") return; // idempotent no-op
        await updateTreeNodeRow(tx, table, id, {
          status: "ARCHIVED",
          effectiveTo: new Date(),
          updatedBy: caller.userId,
          // Archival is a material state change: bump version so a caller
          // holding a stale read cannot then "update" the archived row
          // under its old version (it must reload and hit LIFECYCLE_INVALID).
          version: { increment: 1 },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function setTreeNodeStatus(
  table: TreeTable,
  caller: OrgSubject,
  organizationId: string,
  id: string,
  status: "ACTIVE" | "INACTIVE",
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.${table.toLowerCase()}.${status === "ACTIVE" ? "activate" : "deactivate"}`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: id,
        after: { status },
      },
      async (tx) => {
        const current = await findScopedTreeNode(tx, table, caller.tenantId, organizationId, id);
        if (!current) notFound(AUDIT_RESOURCE[table]);
        if (current.status === "ARCHIVED") {
          throw new OrgAppError(
            "LIFECYCLE_INVALID",
            "Archived records are immutable history and cannot be reactivated.",
          );
        }
        await updateTreeNodeRow(tx, table, id, { status, updatedBy: caller.userId });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── Flat classifications (Designation, JobFamily) ────────────────────────────

export interface ClassificationInput {
  code: string;
  name: string;
  /** Designation only (schema: Designation.level Int?). */
  level?: number | null;
}

export async function createClassification(
  table: ClassificationTable,
  caller: OrgSubject,
  organizationId: string,
  input: ClassificationInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: `org.${table.toLowerCase()}.create`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: created.id,
        after: { code: input.code, name: input.name },
      }),
      async (tx) => {
        const data = {
          tenantId: caller.tenantId,
          organizationId,
          code: input.code,
          name: input.name,
          createdBy: caller.userId,
          updatedBy: caller.userId,
          ...(table === "designation" && input.level != null ? { level: input.level } : {}),
        };
        return table === "designation"
          ? tx.designation.create({ data, select: { id: true } })
          : tx.jobFamily.create({ data, select: { id: true } });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function updateClassification(
  table: ClassificationTable,
  caller: OrgSubject,
  organizationId: string,
  id: string,
  input: { name?: string; level?: number | null; expectedVersion: number },
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.${table.toLowerCase()}.update`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current =
          table === "designation"
            ? await tx.designation.findFirst({
                where: { id, tenantId: caller.tenantId, organizationId },
                select: { id: true, version: true, status: true },
              })
            : await tx.jobFamily.findFirst({
                where: { id, tenantId: caller.tenantId, organizationId },
                select: { id: true, version: true, status: true },
              });
        if (!current) notFound(AUDIT_RESOURCE[table]);
        if (current.version !== input.expectedVersion) {
          throw new OrgAppError(
            "RESOURCE_CONFLICT",
            "Record changed since it was read; reload and retry.",
          );
        }
        if (current.status === "ARCHIVED") {
          throw new OrgAppError(
            "LIFECYCLE_INVALID",
            "Archived records are immutable history and cannot be edited.",
          );
        }
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        if (input.name !== undefined) data.name = input.name;
        if (input.level !== undefined) data.level = input.level;
        if (table === "designation") {
          await tx.designation.update({ where: { id }, data });
        } else {
          await tx.jobFamily.update({ where: { id }, data });
        }
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function archiveClassification(
  table: ClassificationTable,
  caller: OrgSubject,
  organizationId: string,
  id: string,
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    // Pre-check inside a transaction so an already-archived row skips the
    // whole mutate+audit step (idempotent no-op, no duplicate audit event).
    const current =
      table === "designation"
        ? await prisma.designation.findFirst({
            where: { id, tenantId: caller.tenantId, organizationId },
            select: { id: true, status: true },
          })
        : await prisma.jobFamily.findFirst({
            where: { id, tenantId: caller.tenantId, organizationId },
            select: { id: true, status: true },
          });
    if (!current) notFound(AUDIT_RESOURCE[table]);
    if (current.status === "ARCHIVED") return;
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.${table.toLowerCase()}.archive`,
        resourceType: AUDIT_RESOURCE[table],
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const data = {
          status: "ARCHIVED" as const,
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        if (table === "designation") {
          await tx.designation.update({ where: { id }, data });
        } else {
          await tx.jobFamily.update({ where: { id }, data });
        }
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── private helpers ──────────────────────────────────────────────────────────

function findScopedTreeNode(
  tx: Tx,
  table: TreeTable,
  tenantId: string,
  organizationId: string,
  id: string,
): Promise<{ id: string; version: number; status: string } | null> {
  const where = { id, tenantId, organizationId };
  const select = { id: true, version: true, status: true } as const;
  return table === "orgUnit"
    ? tx.orgUnit.findFirst({ where, select })
    : table === "department"
      ? tx.department.findFirst({ where, select })
      : tx.team.findFirst({ where, select });
}

function updateTreeNodeRow(
  tx: Tx,
  table: TreeTable,
  id: string,
  data: Record<string, unknown>,
): Promise<unknown> {
  return table === "orgUnit"
    ? tx.orgUnit.update({ where: { id }, data })
    : table === "department"
      ? tx.department.update({ where: { id }, data })
      : tx.team.update({ where: { id }, data });
}
