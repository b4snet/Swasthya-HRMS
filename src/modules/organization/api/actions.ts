/**
 * Thin server actions for the Organization API (queued prompt 3).
 *
 * Every action: parse (Zod) → resolve caller from the SESSION (tenant/org
 * scope never from input) → call the service → return a typed result.
 * Services own authorization + transactions + audit; actions only translate
 * stable errors into client-safe results (no DB internals, no stack traces).
 */
"use server";

import { headers } from "next/headers";
import { ZodError, z, type ZodType } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { callerFromUser } from "../service/caller";
import { OrgAppError, serializeOrgAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";

// ── Result types (stable client surface) ─────────────────────────────────────

export interface OrgActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): OrgActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): OrgActionResult<never> {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: first?.message ?? "Invalid input.",
        field: first?.path?.map(String).join("."),
      },
    };
  }
  if (err instanceof OrgAppError) {
    return { ok: false, error: serializeOrgAppError(err) };
  }
  // Unexpected: log server-side, return a fixed message (no internals).
  console.error("[org] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

async function requestContext(): Promise<RequestAuditContext> {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

/**
 * Run a mutation with a session-resolved caller. AUTHORIZATION_DENIED and
 * NOT_FOUND are returned as results (UI shows the permission-denied state);
 * everything else flows through fail().
 */
async function withCaller<S extends ZodType, T>(
  schema: S,
  input: unknown,
  run: (
    caller: ReturnType<typeof callerFromUser>,
    parsed: ReturnType<S["parse"]>,
    ctx: RequestAuditContext,
  ) => Promise<T>,
): Promise<OrgActionResult<T>> {
  try {
    const parsed = schema.parse(input);
    const user = await getSessionUser();
    if (!user) {
      throw new OrgAppError("AUTHORIZATION_DENIED", "You must sign in to perform this action.");
    }
    const caller = callerFromUser(user);
    const ctx = await requestContext();
    return ok(await run(caller, parsed, ctx));
  } catch (err) {
    return fail(err);
  }
}

// ── Tree entities ────────────────────────────────────────────────────────────

import {
  createOrgUnitSchema,
  createDepartmentSchema,
  createTeamSchema,
  updateTreeNodeSchema,
  setTreeNodeStatusSchema,
  idInOrgSchema,
  createDesignationSchema,
  createJobFamilySchema,
  updateClassificationSchema,
  createLegalEntitySchema,
  updateLegalEntitySchema,
  createCostCenterSchema,
  updateCostCenterSchema,
  createLocationSchema,
  updateLocationSchema,
  createFacilitySchema,
  updateFacilitySchema,
  createPositionSchema,
  updatePositionSchema,
  setPositionStatusSchema,
  createReportingEdgeSchema,
  closeReportingEdgeSchema,
} from "./schemas";
import {
  createTreeNode,
  updateTreeNode,
  archiveTreeNode,
  setTreeNodeStatus,
  createClassification,
  updateClassification,
  archiveClassification,
} from "../service/structure-service";
import {
  createLegalEntity,
  updateLegalEntity,
  archiveLegalEntity,
  createCostCenter,
  updateCostCenter,
  archiveCostCenter,
  createLocation,
  updateLocation,
  archiveLocation,
  createFacility,
  updateFacility,
  archiveFacility,
} from "../service/entity-service";
import {
  createPosition,
  updatePosition,
  setPositionStatus,
  createReportingEdge,
  closeReportingEdge,
} from "../service/position-service";

export async function createOrgUnitAction(input: unknown) {
  return withCaller(createOrgUnitSchema, input, (caller, p, ctx) =>
    createTreeNode("orgUnit", caller, p.organizationId, p, ctx),
  );
}

export async function createDepartmentAction(input: unknown) {
  return withCaller(createDepartmentSchema, input, (caller, p, ctx) =>
    createTreeNode("department", caller, p.organizationId, p, ctx),
  );
}

export async function createTeamAction(input: unknown) {
  return withCaller(createTeamSchema, input, (caller, p, ctx) =>
    createTreeNode("team", caller, p.organizationId, p, ctx),
  );
}

export async function updateOrgUnitAction(input: unknown) {
  return withCaller(updateTreeNodeSchema, input, (caller, p, ctx) =>
    updateTreeNode("orgUnit", caller, p.organizationId, p.id, p, ctx),
  );
}

export async function updateDepartmentAction(input: unknown) {
  return withCaller(updateTreeNodeSchema, input, (caller, p, ctx) =>
    updateTreeNode("department", caller, p.organizationId, p.id, p, ctx),
  );
}

export async function updateTeamAction(input: unknown) {
  return withCaller(updateTreeNodeSchema, input, (caller, p, ctx) =>
    updateTreeNode("team", caller, p.organizationId, p.id, p, ctx),
  );
}

export async function archiveOrgUnitAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveTreeNode("orgUnit", caller, p.organizationId, p.id, ctx),
  );
}

export async function archiveDepartmentAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveTreeNode("department", caller, p.organizationId, p.id, ctx),
  );
}

export async function archiveTeamAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveTreeNode("team", caller, p.organizationId, p.id, ctx),
  );
}

const GENERIC_CLASSIFICATION = z.object({
  organizationId: z.string().cuid(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/, "Use uppercase letters, digits, - or _"),
  name: z.string().trim().min(2).max(120),
  level: z.number().int().min(1).max(99).nullish(),
  table: z.enum(["designation", "jobFamily", "grade"]),
});

/** Create a designation / job family / grade (grade has no service yet). */
export async function createClassificationAction(input: unknown) {
  return withCaller(GENERIC_CLASSIFICATION, input, (caller, p, ctx) => {
    const { table, organizationId, level, ...rest } = p;
    if (table === "designation") {
      return createClassification("designation", caller, organizationId, { ...rest, level }, ctx);
    }
    if (table === "jobFamily") {
      return createClassification("jobFamily", caller, organizationId, rest, ctx);
    }
    return createSimpleClassification("grade", caller, organizationId, rest, level, ctx);
  });
}

const GENERIC_CLASSIFICATION_UPDATE = z.object({
  organizationId: z.string().cuid(),
  id: z.string().cuid(),
  name: z.string().trim().min(2).max(120).optional(),
  level: z.number().int().min(1).max(99).nullish().optional(),
  expectedVersion: z.number().int().min(1),
  table: z.enum(["designation", "jobFamily", "grade"]),
});

/** Update a designation / job family / grade. */
export async function updateClassificationAction(input: unknown) {
  return withCaller(GENERIC_CLASSIFICATION_UPDATE, input, (caller, p, ctx) => {
    const { table, organizationId, id, ...rest } = p;
    if (table === "designation" || table === "jobFamily") {
      return updateClassification(table, caller, organizationId, id, rest, ctx);
    }
    return updateSimpleClassification("grade", caller, organizationId, id, rest, ctx);
  });
}

const GENERIC_ARCHIVE = z.object({
  organizationId: z.string().cuid(),
  id: z.string().cuid(),
  table: z.enum(["designation", "jobFamily", "grade", "costCenter"]),
});

/** Archive a designation / job family / grade / cost center. */
export async function archiveClassificationAction(input: unknown) {
  return withCaller(GENERIC_ARCHIVE, input, (caller, p, ctx) => {
    const { table, organizationId, id } = p;
    if (table === "designation" || table === "jobFamily") {
      return archiveClassification(table, caller, organizationId, id, ctx);
    }
    if (table === "grade")
      return archiveSimpleClassification("grade", caller, organizationId, id, ctx);
    return archiveCostCenter(caller, organizationId, id, ctx);
  });
}

// ── Grade support (schema exists; service is a thin variant of classification)

interface SimpleMeta {
  code: string;
  name: string;
}

async function createSimpleClassification(
  table: "grade",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  input: SimpleMeta,
  level: number | null | undefined,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { toOrgAppError } = await import("../service/app-errors");
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.grade.create",
        resourceType: "Grade",
        after: { code: input.code, name: input.name },
      },
      async (tx) =>
        tx.grade.create({
          data: {
            tenantId: caller.tenantId,
            organizationId,
            code: input.code,
            name: input.name,
            ...(level != null ? { level } : {}),
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

async function updateSimpleClassification(
  table: "grade",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  id: string,
  input: { name?: string; level?: number | null; expectedVersion: number },
  _ctx?: RequestAuditContext,
): Promise<void> {
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { OrgAppError, toOrgAppError } = await import("../service/app-errors");
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      _ctx,
      { action: "org.grade.update", resourceType: "Grade", resourceId: id, before: { ...input } },
      async (tx) => {
        const current = await tx.grade.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { version: true, status: true },
        });
        if (!current) throw new OrgAppError("NOT_FOUND", "Record not found.");
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
        await tx.grade.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

async function archiveSimpleClassification(
  table: "grade",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  id: string,
  ctx?: RequestAuditContext,
): Promise<void> {
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { OrgAppError, toOrgAppError } = await import("../service/app-errors");
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.grade.archive",
        resourceType: "Grade",
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await tx.grade.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { status: true },
        });
        if (!current) throw new OrgAppError("NOT_FOUND", "Record not found.");
        if (current.status === "ARCHIVED") return; // idempotent
        await tx.grade.update({
          where: { id },
          data: { status: "ARCHIVED", updatedBy: caller.userId },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

/**
 * Activate/deactivate any org-owned lifecycle entity by table name.
 * Trees route through setTreeNodeStatus; classifications map to the same
 * lifecycle semantics via their own service entry points.
 */
export async function setEntityStatusAction(input: unknown) {
  const schema = z.object({
    organizationId: z.string().cuid(),
    id: z.string().cuid(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    table: z.enum([
      "orgUnit",
      "department",
      "team",
      "designation",
      "jobFamily",
      "grade",
      "costCenter",
      "location",
      "facility",
    ]),
  });
  return withCaller(schema, input, (caller, p, ctx) => {
    const { table, organizationId, id, status } = p;
    if (table === "orgUnit" || table === "department" || table === "team") {
      return setTreeNodeStatus(table, caller, organizationId, id, status, ctx);
    }
    if (table === "designation" || table === "jobFamily") {
      return setClassificationLifecycle(table, caller, organizationId, id, status, ctx);
    }
    if (table === "grade" || table === "costCenter") {
      return setSimpleEntityLifecycle(table, caller, organizationId, id, status, ctx);
    }
    return setTenantEntityLifecycle(table, caller, organizationId, id, status, ctx);
  });
}

async function setClassificationLifecycle(
  table: "designation" | "jobFamily",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  id: string,
  status: "ACTIVE" | "INACTIVE",
  ctx: RequestAuditContext,
): Promise<void> {
  // updateClassification handles name/level; direct lifecycle update here.
  const { prisma } = await import("@/lib/db");
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { OrgAppError } = await import("../service/app-errors");
  await assertCallerCanManageOrg(caller, organizationId);
  await transactWithAudit(
    caller,
    ctx,
    {
      action: `org.${table}.${status === "ACTIVE" ? "activate" : "deactivate"}`,
      resourceType: table === "designation" ? "Designation" : "JobFamily",
      resourceId: id,
      after: { status },
    },
    async (tx) => {
      const where = { id, tenantId: caller.tenantId, organizationId };
      const current =
        table === "designation"
          ? await tx.designation.findFirst({ where, select: { status: true } })
          : await tx.jobFamily.findFirst({ where, select: { status: true } });
      if (!current) {
        throw new OrgAppError("NOT_FOUND", "Record not found.");
      }
      if (current.status === "ARCHIVED") {
        throw new OrgAppError("LIFECYCLE_INVALID", "Archived records are immutable history.");
      }
      const data = { status, updatedBy: caller.userId };
      if (table === "designation") await tx.designation.update({ where: { id }, data });
      else await tx.jobFamily.update({ where: { id }, data });
      void prisma;
    },
  );
}

async function setTenantEntityLifecycle(
  table: "location" | "facility",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  id: string,
  status: "ACTIVE" | "INACTIVE",
  ctx: RequestAuditContext,
): Promise<void> {
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { OrgAppError } = await import("../service/app-errors");
  if (table === "location") {
    // Locations are tenant-wide but org-managers administer them: require
    // manage permission on the caller's active organization, then scope by
    // tenant only. organizationId comes from the session-resolved UI.
    if (!organizationId) {
      throw new OrgAppError("AUTHORIZATION_DENIED", "No active organization in your session.");
    }
    await assertCallerCanManageOrg(caller, organizationId);
    await transactWithAudit(
      caller,
      ctx,
      {
        action: `org.location.${status === "ACTIVE" ? "activate" : "deactivate"}`,
        resourceType: "Location",
        resourceId: id,
        after: { status },
      },
      async (tx) => {
        const current = await tx.location.findFirst({
          where: { id, tenantId: caller.tenantId },
          select: { status: true },
        });
        if (!current) throw new OrgAppError("NOT_FOUND", "Record not found.");
        if (current.status === "ARCHIVED") {
          throw new OrgAppError("LIFECYCLE_INVALID", "Archived records are immutable history.");
        }
        await tx.location.update({ where: { id }, data: { status, updatedBy: caller.userId } });
      },
    );
    return;
  }
  // facility is org-scoped; use the organizationId the caller passed.
  if (!organizationId) {
    throw new OrgAppError("AUTHORIZATION_DENIED", "No active organization in your session.");
  }
  await assertCallerCanManageOrg(caller, organizationId);
  await transactWithAudit(
    caller,
    ctx,
    {
      action: `org.facility.${status === "ACTIVE" ? "activate" : "deactivate"}`,
      resourceType: "Facility",
      resourceId: id,
      after: { status },
    },
    async (tx) => {
      const current = await tx.facility.findFirst({
        where: { id, tenantId: caller.tenantId, organizationId },
        select: { status: true },
      });
      if (!current) throw new OrgAppError("NOT_FOUND", "Record not found.");
      if (current.status === "ARCHIVED") {
        throw new OrgAppError("LIFECYCLE_INVALID", "Archived records are immutable history.");
      }
      await tx.facility.update({ where: { id }, data: { status, updatedBy: caller.userId } });
    },
  );
}

async function setSimpleEntityLifecycle(
  table: "grade" | "costCenter",
  caller: ReturnType<typeof callerFromUser>,
  organizationId: string,
  id: string,
  status: "ACTIVE" | "INACTIVE",
  ctx: RequestAuditContext,
): Promise<void> {
  const { assertCallerCanManageOrg, transactWithAudit } = await import("../service/mutations");
  const { OrgAppError } = await import("../service/app-errors");
  await assertCallerCanManageOrg(caller, organizationId);
  await transactWithAudit(
    caller,
    ctx,
    {
      action: `org.${table}.${status === "ACTIVE" ? "activate" : "deactivate"}`,
      resourceType: table === "grade" ? "Grade" : "CostCenter",
      resourceId: id,
      after: { status },
    },
    async (tx) => {
      const where = { id, tenantId: caller.tenantId, organizationId };
      const current =
        table === "grade"
          ? await tx.grade.findFirst({ where, select: { status: true } })
          : await tx.costCenter.findFirst({ where, select: { status: true } });
      if (!current) {
        throw new OrgAppError("NOT_FOUND", "Record not found.");
      }
      if (current.status === "ARCHIVED") {
        throw new OrgAppError("LIFECYCLE_INVALID", "Archived records are immutable history.");
      }
      const data = { status, updatedBy: caller.userId };
      if (table === "grade") await tx.grade.update({ where: { id }, data });
      else await tx.costCenter.update({ where: { id }, data });
    },
  );
}

export async function setTreeNodeStatusAction(input: unknown) {
  return withCaller(setTreeNodeStatusSchema, input, (caller, p, ctx) =>
    setTreeNodeStatus("department", caller, p.organizationId, p.id, p.status, ctx),
  );
}

// ── Classifications ──────────────────────────────────────────────────────────

export async function createDesignationAction(input: unknown) {
  return withCaller(createDesignationSchema, input, (caller, p, ctx) =>
    createClassification("designation", caller, p.organizationId, p, ctx),
  );
}

export async function createJobFamilyAction(input: unknown) {
  return withCaller(createJobFamilySchema, input, (caller, p, ctx) =>
    createClassification("jobFamily", caller, p.organizationId, p, ctx),
  );
}

export async function updateDesignationAction(input: unknown) {
  return withCaller(updateClassificationSchema, input, (caller, p, ctx) =>
    updateClassification("designation", caller, p.organizationId, p.id, p, ctx),
  );
}

export async function updateJobFamilyAction(input: unknown) {
  return withCaller(updateClassificationSchema, input, (caller, p, ctx) =>
    updateClassification("jobFamily", caller, p.organizationId, p.id, p, ctx),
  );
}

export async function archiveDesignationAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveClassification("designation", caller, p.organizationId, p.id, ctx),
  );
}

export async function archiveJobFamilyAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveClassification("jobFamily", caller, p.organizationId, p.id, ctx),
  );
}

// ── LegalEntity / CostCenter / Location / Facility ──────────────────────────

export async function createLegalEntityAction(input: unknown) {
  return withCaller(createLegalEntitySchema, input, (caller, p, ctx) =>
    createLegalEntity(caller, p, ctx),
  );
}

export async function updateLegalEntityAction(input: unknown) {
  return withCaller(updateLegalEntitySchema, input, (caller, p, ctx) =>
    updateLegalEntity(caller, p.id, p, ctx),
  );
}

export async function archiveLegalEntityAction(input: unknown) {
  return withCaller(z.object({ id: z.string().cuid() }), input, (caller, p, ctx) =>
    archiveLegalEntity(caller, p.id, ctx),
  );
}

export async function createCostCenterAction(input: unknown) {
  return withCaller(createCostCenterSchema, input, (caller, p, ctx) =>
    createCostCenter(caller, p.organizationId, p, ctx),
  );
}

export async function updateCostCenterAction(input: unknown) {
  return withCaller(updateCostCenterSchema, input, (caller, p, ctx) =>
    updateCostCenter(caller, p.organizationId, p.id, p, ctx),
  );
}

export async function archiveCostCenterAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveCostCenter(caller, p.organizationId, p.id, ctx),
  );
}

export async function createLocationAction(input: unknown) {
  return withCaller(createLocationSchema, input, (caller, p, ctx) =>
    createLocation(caller, p, ctx),
  );
}

export async function updateLocationAction(input: unknown) {
  return withCaller(updateLocationSchema, input, (caller, p, ctx) =>
    updateLocation(caller, p.id, p, ctx),
  );
}

export async function archiveLocationAction(input: unknown) {
  return withCaller(z.object({ id: z.string().cuid() }), input, (caller, p, ctx) =>
    archiveLocation(caller, p.id, ctx),
  );
}

export async function createFacilityAction(input: unknown) {
  return withCaller(createFacilitySchema, input, (caller, p, ctx) =>
    createFacility(caller, p.organizationId, p, ctx),
  );
}

export async function updateFacilityAction(input: unknown) {
  return withCaller(updateFacilitySchema, input, (caller, p, ctx) =>
    updateFacility(caller, p.organizationId, p.id, p, ctx),
  );
}

export async function archiveFacilityAction(input: unknown) {
  return withCaller(idInOrgSchema, input, (caller, p, ctx) =>
    archiveFacility(caller, p.organizationId, p.id, ctx),
  );
}

// ── Position / ReportingEdge ─────────────────────────────────────────────────

export async function createPositionAction(input: unknown) {
  return withCaller(createPositionSchema, input, (caller, p, ctx) =>
    createPosition(caller, p.organizationId, p, ctx),
  );
}

export async function updatePositionAction(input: unknown) {
  return withCaller(updatePositionSchema, input, (caller, p, ctx) =>
    updatePosition(caller, p.organizationId, p.id, p, ctx),
  );
}

export async function setPositionStatusAction(input: unknown) {
  return withCaller(setPositionStatusSchema, input, (caller, p, ctx) =>
    setPositionStatus(caller, p.organizationId, p.id, p.status, ctx),
  );
}

export async function createReportingEdgeAction(input: unknown) {
  return withCaller(createReportingEdgeSchema, input, (caller, p, ctx) =>
    createReportingEdge(caller, p.organizationId, p, ctx),
  );
}

export async function closeReportingEdgeAction(input: unknown) {
  return withCaller(closeReportingEdgeSchema, input, (caller, p, ctx) =>
    closeReportingEdge(caller, p.organizationId, p.id, p.effectiveTo, ctx),
  );
}
