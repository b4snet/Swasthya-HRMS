/**
 * Organization services: Position (fillable seat) and ReportingEdge
 * (reporting/matrix relationships between positions).
 *
 * Rules enforced here (on top of the domain layer):
 * - Position placement: at most one owning unit (department XOR team); the
 *   referenced department/team/designation/grade/jobFamily/costCenter must
 *   exist within the caller's tenant + organization (scoped findFirst, not
 *   bare FK existence).
 * - Position lifecycle: VACANT ⇄ FILLED, → CLOSED (terminal); closed
 *   positions are immutable history.
 * - ReportingEdge: PRIMARY/SECONDARY/MATRIX, effective-dated, never deleted —
 *   closed by setting effectiveTo; PRIMARY edges form a forest (no cycles).
 * - The partial unique index reporting_edges_active_pair_type_key backs the
 *   one-ACTIVE-edge-per-(pair,type) rule; races surface as P2002 → mapped to
 *   CONFLICT_DUPLICATE by the error layer.
 */
import type { Prisma } from "@prisma/client";
import type { RequestAuditContext } from "@/lib/audit";
import { OrgAppError, toOrgAppError } from "./app-errors";
import { assertCallerCanManageOrg, notFound, transactWithAudit } from "./mutations";
import { validatePositionPlacement, validateReportingEdge } from "./validation-service";
import type { OrgSubject } from "./validation-service";

type Tx = Prisma.TransactionClient;

const AUDIT_RESOURCE = {
  position: "Position",
  reportingEdge: "ReportingEdge",
} as const;

// ── Position ─────────────────────────────────────────────────────────────────

export interface PositionInput {
  code: string;
  title?: string | null;
  /** Exactly one owning unit is required by the domain rule. */
  departmentId?: string | null;
  teamId?: string | null;
  designationId?: string | null;
  gradeId?: string | null;
  jobFamilyId?: string | null;
  costCenterId?: string | null;
  effectiveFrom?: Date;
}

export async function createPosition(
  caller: OrgSubject,
  organizationId: string,
  input: PositionInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await validatePositionPlacement({
      departmentId: input.departmentId ?? null,
      teamId: input.teamId ?? null,
      tenantId: caller.tenantId,
      organizationId,
    });
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.position.create",
        resourceType: AUDIT_RESOURCE.position,
        after: {
          code: input.code,
          departmentId: input.departmentId ?? null,
          teamId: input.teamId ?? null,
        },
      },
      async (tx) => {
        await assertReferencesInScope(tx, {
          tenantId: caller.tenantId,
          organizationId,
          designationId: input.designationId ?? null,
          gradeId: input.gradeId ?? null,
          jobFamilyId: input.jobFamilyId ?? null,
          costCenterId: input.costCenterId ?? null,
        });
        return tx.position.create({
          data: {
            tenantId: caller.tenantId,
            organizationId,
            code: input.code,
            title: input.title ?? null,
            departmentId: input.departmentId ?? null,
            teamId: input.teamId ?? null,
            designationId: input.designationId ?? null,
            gradeId: input.gradeId ?? null,
            jobFamilyId: input.jobFamilyId ?? null,
            costCenterId: input.costCenterId ?? null,
            effectiveFrom: input.effectiveFrom ?? new Date(),
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function updatePosition(
  caller: OrgSubject,
  organizationId: string,
  id: string,
  input: {
    title?: string | null;
    departmentId?: string | null;
    teamId?: string | null;
    designationId?: string | null;
    gradeId?: string | null;
    jobFamilyId?: string | null;
    costCenterId?: string | null;
    expectedVersion: number;
  },
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.position.update",
        resourceType: AUDIT_RESOURCE.position,
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await tx.position.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, version: true, status: true },
        });
        if (!current) notFound("Position");
        if (current.version !== input.expectedVersion) {
          throw new OrgAppError(
            "RESOURCE_CONFLICT",
            "Record changed since it was read; reload and retry.",
          );
        }
        if (current.status === "CLOSED") {
          throw new OrgAppError(
            "LIFECYCLE_INVALID",
            "Closed positions are immutable history and cannot be edited.",
          );
        }
        // Ownership re-assignment revalidates the XOR + scope rules.
        if (input.departmentId !== undefined || input.teamId !== undefined) {
          await validatePositionPlacement({
            departmentId:
              input.departmentId !== undefined
                ? input.departmentId
                : ((
                    await tx.position.findUnique({
                      where: { id },
                      select: { departmentId: true },
                    })
                  )?.departmentId ?? null),
            teamId:
              input.teamId !== undefined
                ? input.teamId
                : ((await tx.position.findUnique({ where: { id }, select: { teamId: true } }))
                    ?.teamId ?? null),
            tenantId: caller.tenantId,
            organizationId,
          });
        }
        await assertReferencesInScope(tx, {
          tenantId: caller.tenantId,
          organizationId,
          designationId: input.designationId ?? null,
          gradeId: input.gradeId ?? null,
          jobFamilyId: input.jobFamilyId ?? null,
          costCenterId: input.costCenterId ?? null,
        });
        const data: Record<string, unknown> = {
          updatedBy: caller.userId,
          version: { increment: 1 },
        };
        for (const key of [
          "title",
          "departmentId",
          "teamId",
          "designationId",
          "gradeId",
          "jobFamilyId",
          "costCenterId",
        ] as const) {
          if (input[key] !== undefined) data[key] = input[key];
        }
        await tx.position.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

/**
 * Position lifecycle: VACANT → FILLED → VACANT allowed; CLOSED terminal.
 * (Occupancy — which employee fills the seat — belongs to Workforce, Phase 2.)
 */
export async function setPositionStatus(
  caller: OrgSubject,
  organizationId: string,
  id: string,
  status: "VACANT" | "FILLED" | "CLOSED",
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.position.status",
        resourceType: AUDIT_RESOURCE.position,
        resourceId: id,
        after: { status },
      },
      async (tx) => {
        const current = await tx.position.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, status: true },
        });
        if (!current) notFound("Position");
        if (current.status === "CLOSED") {
          throw new OrgAppError(
            "LIFECYCLE_INVALID",
            "Closed positions are terminal and cannot change status.",
          );
        }
        await tx.position.update({
          where: { id },
          data: {
            status,
            updatedBy: caller.userId,
            // Lifecycle transitions are material: bump version for
            // optimistic-concurrency consistency with other mutations.
            version: { increment: 1 },
          },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── ReportingEdge ────────────────────────────────────────────────────────────

export interface ReportingEdgeInput {
  sourcePositionId: string; // reports to…
  targetPositionId: string; // …this manager/lead
  type: "PRIMARY" | "SECONDARY" | "MATRIX";
  effectiveFrom?: Date;
}

export async function createReportingEdge(
  caller: OrgSubject,
  organizationId: string,
  input: ReportingEdgeInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  const period = {
    effectiveFrom: input.effectiveFrom ?? new Date(),
    effectiveTo: null,
  };
  try {
    await validateReportingEdge({
      tenantId: caller.tenantId,
      organizationId,
      sourcePositionId: input.sourcePositionId,
      targetPositionId: input.targetPositionId,
      type: input.type,
      period,
    });
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.reportingEdge.create",
        resourceType: AUDIT_RESOURCE.reportingEdge,
        after: {
          sourcePositionId: input.sourcePositionId,
          targetPositionId: input.targetPositionId,
          type: input.type,
          effectiveFrom: period.effectiveFrom.toISOString(),
        },
      },
      async (tx) =>
        tx.reportingEdge.create({
          data: {
            tenantId: caller.tenantId,
            organizationId,
            sourcePositionId: input.sourcePositionId,
            targetPositionId: input.targetPositionId,
            type: input.type,
            effectiveFrom: period.effectiveFrom,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true },
        }),
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

/**
 * Close an ACTIVE edge by setting effectiveTo (history is never deleted).
 * Closing an already-closed edge is an idempotent no-op.
 */
export async function closeReportingEdge(
  caller: OrgSubject,
  organizationId: string,
  id: string,
  effectiveTo?: Date,
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.reportingEdge.close",
        resourceType: AUDIT_RESOURCE.reportingEdge,
        resourceId: id,
        after: { effectiveTo: (effectiveTo ?? new Date()).toISOString() },
      },
      async (tx) => {
        const current = await tx.reportingEdge.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, status: true, effectiveTo: true },
        });
        if (!current) notFound("ReportingEdge");
        if (current.effectiveTo !== null || current.status === "ARCHIVED") return; // idempotent
        await tx.reportingEdge.update({
          where: { id },
          data: {
            effectiveTo: effectiveTo ?? new Date(),
            status: "INACTIVE",
            updatedBy: caller.userId,
          },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── shared scope assertion for optional position references ─────────────────

const REF_SELECTORS = {
  designationId: (tx: Tx, id: string, tenantId: string, organizationId: string) =>
    tx.designation.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } }),
  gradeId: (tx: Tx, id: string, tenantId: string, organizationId: string) =>
    tx.grade.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } }),
  jobFamilyId: (tx: Tx, id: string, tenantId: string, organizationId: string) =>
    tx.jobFamily.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } }),
  costCenterId: (tx: Tx, id: string, tenantId: string, organizationId: string) =>
    tx.costCenter.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } }),
} as const;

async function assertReferencesInScope(
  tx: Tx,
  refs: {
    tenantId: string;
    organizationId: string;
    designationId: string | null;
    gradeId: string | null;
    jobFamilyId: string | null;
    costCenterId: string | null;
  },
): Promise<void> {
  const fields = ["designationId", "gradeId", "jobFamilyId", "costCenterId"] as const;
  const checks = fields
    .filter((f) => refs[f] !== null)
    .map(async (f) => {
      const found = await REF_SELECTORS[f](
        tx,
        refs[f] as string,
        refs.tenantId,
        refs.organizationId,
      );
      if (!found) {
        throw new OrgAppError(
          "VALIDATION_FAILED",
          `Referenced ${f.replace(/Id$/, "")} does not exist in this organization.`,
          f,
        );
      }
    });
  await Promise.all(checks);
}

/** Transaction-type anchor for future composite position/edge operations. */
export type { Tx as PositionTransaction };
