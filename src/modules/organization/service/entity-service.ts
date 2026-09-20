/**
 * Organization services: the anchoring Organization record, LegalEntity,
 * CostCenter, Location and Facility.
 *
 * Conventions (AGENTS.md, verified against schema):
 * - LegalEntity + Location are tenant-scoped (unique [tenantId, code]);
 *   CostCenter + Facility are organization-scoped.
 * - Facility.N—1 Location (same tenant); Location has no organizationId.
 * - LifecycleStatus everywhere; archival sets status ARCHIVED + effectiveTo
 *   on the effective-dated entities (Facility); no destructive deletion.
 * - Optimistic concurrency on updates (expectedVersion).
 */
import type { Prisma } from "@prisma/client";
import type { RequestAuditContext } from "@/lib/audit";
import { OrgAppError, toOrgAppError } from "./app-errors";
import { assertCallerCanManageOrg, notFound, transactWithAudit } from "./mutations";
import type { OrgSubject } from "./validation-service";

type Tx = Prisma.TransactionClient;

const AUDIT_RESOURCE = {
  legalEntity: "LegalEntity",
  costCenter: "CostCenter",
  location: "Location",
  facility: "Facility",
} as const;

// ── LegalEntity (tenant-scoped) ──────────────────────────────────────────────

export interface LegalEntityInput {
  code: string;
  registeredName: string;
  registrationNumber?: string | null;
}

export async function createLegalEntity(
  caller: OrgSubject,
  input: LegalEntityInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.legalEntity.create",
        resourceType: AUDIT_RESOURCE.legalEntity,
        after: { code: input.code, registeredName: input.registeredName },
      },
      async (tx) =>
        tx.legalEntity.create({
          data: {
            tenantId: caller.tenantId,
            code: input.code,
            registeredName: input.registeredName,
            registrationNumber: input.registrationNumber ?? null,
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

export async function updateLegalEntity(
  caller: OrgSubject,
  id: string,
  input: { registeredName?: string; registrationNumber?: string | null; expectedVersion: number },
  ctx?: RequestAuditContext,
): Promise<void> {
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.legalEntity.update",
        resourceType: AUDIT_RESOURCE.legalEntity,
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await tx.legalEntity.findFirst({
          where: { id, tenantId: caller.tenantId },
          select: { id: true, version: true, status: true },
        });
        if (!current) notFound("LegalEntity");
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
        if (input.registeredName !== undefined) data.registeredName = input.registeredName;
        if (input.registrationNumber !== undefined) {
          data.registrationNumber = input.registrationNumber;
        }
        await tx.legalEntity.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function archiveLegalEntity(
  caller: OrgSubject,
  id: string,
  ctx?: RequestAuditContext,
): Promise<void> {
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.legalEntity.archive",
        resourceType: AUDIT_RESOURCE.legalEntity,
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await tx.legalEntity.findFirst({
          where: { id, tenantId: caller.tenantId },
          select: { id: true, status: true },
        });
        if (!current) notFound("LegalEntity");
        if (current.status === "ARCHIVED") return; // idempotent no-op — no duplicate audit event
        await tx.legalEntity.update({
          where: { id },
          data: { status: "ARCHIVED", updatedBy: caller.userId, version: { increment: 1 } },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── CostCenter (organization-scoped) ─────────────────────────────────────────

export async function createCostCenter(
  caller: OrgSubject,
  organizationId: string,
  input: { code: string; name: string },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.costCenter.create",
        resourceType: AUDIT_RESOURCE.costCenter,
        after: { code: input.code, name: input.name },
      },
      async (tx) =>
        tx.costCenter.create({
          data: {
            tenantId: caller.tenantId,
            organizationId,
            code: input.code,
            name: input.name,
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

export async function updateCostCenter(
  caller: OrgSubject,
  organizationId: string,
  id: string,
  input: { name?: string; expectedVersion: number },
  ctx?: RequestAuditContext,
): Promise<void> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.costCenter.update",
        resourceType: AUDIT_RESOURCE.costCenter,
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await tx.costCenter.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, version: true, status: true },
        });
        if (!current) notFound("CostCenter");
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
        await tx.costCenter.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function archiveCostCenter(
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
        action: "org.costCenter.archive",
        resourceType: AUDIT_RESOURCE.costCenter,
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await tx.costCenter.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, status: true },
        });
        if (!current) notFound("CostCenter");
        if (current.status === "ARCHIVED") return; // idempotent no-op — no duplicate audit event
        await tx.costCenter.update({
          where: { id },
          data: { status: "ARCHIVED", updatedBy: caller.userId, version: { increment: 1 } },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── Location (tenant-scoped) ─────────────────────────────────────────────────

export interface LocationInput {
  code: string;
  name: string;
  addressLine?: string | null;
  city?: string | null;
  district?: string | null;
  province?: string | null;
  /** ISO 3166-1 alpha-2; validated at the API boundary. */
  country: string;
  postalCode?: string | null;
}

export async function createLocation(
  caller: OrgSubject,
  input: LocationInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.location.create",
        resourceType: AUDIT_RESOURCE.location,
        after: { code: input.code, name: input.name, country: input.country },
      },
      async (tx) =>
        tx.location.create({
          data: {
            tenantId: caller.tenantId,
            code: input.code,
            name: input.name,
            addressLine: input.addressLine ?? null,
            city: input.city ?? null,
            district: input.district ?? null,
            province: input.province ?? null,
            country: input.country.toUpperCase(),
            postalCode: input.postalCode ?? null,
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

export async function updateLocation(
  caller: OrgSubject,
  id: string,
  input: {
    name?: string;
    addressLine?: string | null;
    city?: string | null;
    district?: string | null;
    province?: string | null;
    postalCode?: string | null;
    expectedVersion: number;
  },
  ctx?: RequestAuditContext,
): Promise<void> {
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.location.update",
        resourceType: AUDIT_RESOURCE.location,
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await tx.location.findFirst({
          where: { id, tenantId: caller.tenantId },
          select: { id: true, version: true, status: true },
        });
        if (!current) notFound("Location");
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
        for (const key of [
          "name",
          "addressLine",
          "city",
          "district",
          "province",
          "postalCode",
        ] as const) {
          if (input[key] !== undefined) data[key] = input[key];
        }
        await tx.location.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function archiveLocation(
  caller: OrgSubject,
  id: string,
  ctx?: RequestAuditContext,
): Promise<void> {
  try {
    await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.location.archive",
        resourceType: AUDIT_RESOURCE.location,
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await tx.location.findFirst({
          where: { id, tenantId: caller.tenantId },
          select: { id: true, status: true },
        });
        if (!current) notFound("Location");
        if (current.status === "ARCHIVED") return; // idempotent no-op — no duplicate audit event
        await tx.location.update({
          where: { id },
          data: { status: "ARCHIVED", updatedBy: caller.userId, version: { increment: 1 } },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

// ── Facility (organization-scoped, effective-dated) ──────────────────────────

export interface FacilityInput {
  code: string;
  name: string;
  type: "HOSPITAL" | "CLINIC" | "OFFICE" | "OTHER";
  /** Location must belong to the same tenant (checked, not just FK-enforced). */
  locationId: string;
  effectiveFrom?: Date;
}

export async function createFacility(
  caller: OrgSubject,
  organizationId: string,
  input: FacilityInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageOrg(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "org.facility.create",
        resourceType: AUDIT_RESOURCE.facility,
        after: { code: input.code, name: input.name, type: input.type },
      },
      async (tx) => {
        const location = await tx.location.findFirst({
          where: { id: input.locationId, tenantId: caller.tenantId },
          select: { id: true, status: true },
        });
        if (!location) {
          throw new OrgAppError(
            "VALIDATION_FAILED",
            "Location does not exist in this tenant.",
            "locationId",
          );
        }
        if (location.status === "ARCHIVED") {
          throw new OrgAppError(
            "VALIDATION_FAILED",
            "Cannot attach a facility to an archived location.",
            "locationId",
          );
        }
        return tx.facility.create({
          data: {
            tenantId: caller.tenantId,
            organizationId,
            code: input.code,
            name: input.name,
            type: input.type,
            locationId: input.locationId,
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

export async function updateFacility(
  caller: OrgSubject,
  organizationId: string,
  id: string,
  input: {
    name?: string;
    type?: "HOSPITAL" | "CLINIC" | "OFFICE" | "OTHER";
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
        action: "org.facility.update",
        resourceType: AUDIT_RESOURCE.facility,
        resourceId: id,
        before: { ...input },
      },
      async (tx) => {
        const current = await tx.facility.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, version: true, status: true },
        });
        if (!current) notFound("Facility");
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
        if (input.type !== undefined) data.type = input.type;
        await tx.facility.update({ where: { id }, data });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

export async function archiveFacility(
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
        action: "org.facility.archive",
        resourceType: AUDIT_RESOURCE.facility,
        resourceId: id,
        before: { status: "ACTIVE" },
        after: { status: "ARCHIVED" },
      },
      async (tx) => {
        const current = await tx.facility.findFirst({
          where: { id, tenantId: caller.tenantId, organizationId },
          select: { id: true, status: true },
        });
        if (!current) notFound("Facility");
        if (current.status === "ARCHIVED") return; // idempotent no-op — no duplicate audit event
        await tx.facility.update({
          where: { id },
          data: {
            status: "ARCHIVED",
            effectiveTo: new Date(),
            updatedBy: caller.userId,
            version: { increment: 1 },
          },
        });
      },
    );
  } catch (err) {
    throw toOrgAppError(err);
  }
}

/** Unused-but-required transaction type anchor for future composite ops. */
export type { Tx as OrgTransaction };
