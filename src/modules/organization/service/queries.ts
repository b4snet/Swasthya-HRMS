/**
 * Organization read/query services (queued prompt 4).
 *
 * Server-side reads for the UI: every function takes an OrgSubject resolved
 * from the session and enforces ORG_READ + ABAC scope before touching the
 * database. Reads never expose records of organizations outside the caller's
 * scope; SUPER_ADMIN bypass is tenant-bounded (same rule as mutations).
 */
import { prisma } from "@/lib/db";
import { canAccessOrganization, accessibleOrganizationIds } from "@/lib/auth/scopes";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import type { OrgSubject } from "./validation-service";
import { OrgAppError } from "./app-errors";

export class OrgQueryError extends Error {
  readonly code: "AUTHORIZATION_DENIED";
  constructor(message: string) {
    super(message);
    this.name = "OrgQueryError";
    this.code = "AUTHORIZATION_DENIED";
  }
}

/** Assert the caller may READ org data for the given organization. */
export async function assertOrgRead(subject: OrgSubject, organizationId: string): Promise<void> {
  if (subject.status !== "ACTIVE") {
    throw new OrgQueryError("User account is not active.");
  }
  if (!rolesHavePermission(subject.systemRoles, PERMISSIONS.ORG_READ)) {
    throw new OrgQueryError("You don't have permission to view organization data.");
  }
  // Tenant isolation first: the org must exist in the caller's tenant.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { tenantId: true },
  });
  if (!org || org.tenantId !== subject.tenantId) {
    throw new OrgQueryError("Organization not found in your tenant.");
  }
  const allowed = await canAccessOrganization(
    { userId: subject.userId, systemRoles: subject.systemRoles },
    organizationId,
  );
  if (!allowed) {
    throw new OrgQueryError("You don't have access to this organization.");
  }
}

/** Select organizations visible to the caller (for the org switcher). */
export async function listAccessibleOrganizations(subject: OrgSubject) {
  if (subject.status !== "ACTIVE") {
    throw new OrgQueryError("User account is not active.");
  }
  if (!rolesHavePermission(subject.systemRoles, PERMISSIONS.ORG_READ)) {
    throw new OrgQueryError("You don't have permission to view organization data.");
  }
  // Tenant scope is always applied; "ALL" only widens *within the tenant*.
  const reach = await accessibleOrganizationIds({
    userId: subject.userId,
    systemRoles: subject.systemRoles,
  });
  const where: { tenantId: string; id?: { in: string[] } } = { tenantId: subject.tenantId };
  if (reach !== "ALL") {
    where.id = { in: reach.length > 0 ? reach : ["__none__"] };
  }
  return prisma.organization.findMany({
    where,
    select: { id: true, code: true, name: true, status: true },
    orderBy: { code: "asc" },
  });
}

// ── Tree entities ────────────────────────────────────────────────────────────

export async function listOrgUnits(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.orgUnit.findMany({
    where: { organizationId },
    orderBy: [{ code: "asc" }],
  });
}

export async function listDepartments(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.department.findMany({
    where: { organizationId },
    orderBy: [{ code: "asc" }],
    include: { parent: { select: { name: true } } },
  });
}

export async function listTeams(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.team.findMany({
    where: { organizationId },
    orderBy: [{ code: "asc" }],
    include: {
      parent: { select: { name: true } },
      department: { select: { code: true, name: true } },
    },
  });
}

// ── Classifications ──────────────────────────────────────────────────────────

export async function listDesignations(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.designation.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }] });
}

export async function listJobFamilies(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.jobFamily.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }] });
}

export async function listGrades(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.grade.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }] });
}

export async function listCostCenters(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.costCenter.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }] });
}

// ── Locations / Facilities ───────────────────────────────────────────────────

export async function listLocations(subject: OrgSubject) {
  if (subject.status !== "ACTIVE") {
    throw new OrgQueryError("User account is not active.");
  }
  if (!rolesHavePermission(subject.systemRoles, PERMISSIONS.ORG_READ)) {
    throw new OrgQueryError("You don't have permission to view organization data.");
  }
  return prisma.location.findMany({
    where: { tenantId: subject.tenantId },
    orderBy: [{ code: "asc" }],
  });
}

export async function listFacilities(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.facility.findMany({
    where: { organizationId },
    orderBy: [{ code: "asc" }],
    include: { location: { select: { name: true, city: true, country: true } } },
  });
}

// ── Positions / Reporting edges ──────────────────────────────────────────────

export async function listPositions(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.position.findMany({
    where: { organizationId },
    orderBy: [{ code: "asc" }],
    include: {
      department: { select: { code: true, name: true } },
      team: { select: { code: true, name: true } },
      designation: { select: { name: true } },
      grade: { select: { name: true } },
      jobFamily: { select: { name: true } },
      costCenter: { select: { code: true, name: true } },
    },
  });
}

export async function listReportingEdges(subject: OrgSubject, organizationId: string) {
  await assertOrgRead(subject, organizationId);
  return prisma.reportingEdge.findMany({
    where: { organizationId },
    orderBy: [{ effectiveFrom: "desc" }],
    include: {
      sourcePosition: {
        select: { code: true, title: true, department: { select: { name: true } } },
      },
      targetPosition: {
        select: { code: true, title: true, department: { select: { name: true } } },
      },
    },
  });
}

// ── Structure view ───────────────────────────────────────────────────────────

export interface TreeRow {
  id: string;
  code: string;
  name: string;
  type?: string;
  parentId: string | null;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface StructureView {
  orgUnits: TreeRow[];
  departments: TreeRow[];
  teams: TreeRow[];
  positions: Array<{
    id: string;
    code: string;
    title: string | null;
    status: string;
    departmentId: string | null;
    teamId: string | null;
  }>;
  reportingEdges: Array<{
    id: string;
    type: string;
    status: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    sourceCode: string;
    sourceTitle: string | null;
    targetCode: string;
    targetTitle: string | null;
  }>;
  facilities: Array<{ id: string; code: string; name: string; type: string; status: string }>;
  counts: {
    orgUnits: number;
    departments: number;
    teams: number;
    positions: number;
    facilities: number;
    reportingEdges: number;
    designations: number;
    grades: number;
    jobFamilies: number;
    costCenters: number;
  };
}

/**
 * One scoped read for the structure page: everything needed to draw the
 * hierarchy AND distinguish it from reporting relationships.
 */
export async function getStructureView(
  subject: OrgSubject,
  organizationId: string,
): Promise<StructureView> {
  await assertOrgRead(subject, organizationId);
  const [
    orgUnits,
    departments,
    teams,
    positions,
    reportingEdges,
    facilities,
    designations,
    grades,
    jobFamilies,
    costCenters,
  ] = await prisma.$transaction([
    prisma.orgUnit.findMany({ where: { organizationId }, orderBy: { code: "asc" } }),
    prisma.department.findMany({ where: { organizationId }, orderBy: { code: "asc" } }),
    prisma.team.findMany({ where: { organizationId }, orderBy: { code: "asc" } }),
    prisma.position.findMany({
      where: { organizationId },
      select: { id: true, code: true, title: true, status: true, departmentId: true, teamId: true },
      orderBy: { code: "asc" },
    }),
    prisma.reportingEdge.findMany({
      where: { organizationId },
      include: {
        sourcePosition: { select: { code: true, title: true } },
        targetPosition: { select: { code: true, title: true } },
      },
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.facility.findMany({
      where: { organizationId },
      select: { id: true, code: true, name: true, type: true, status: true },
    }),
    prisma.designation.count({ where: { organizationId } }),
    prisma.grade.count({ where: { organizationId } }),
    prisma.jobFamily.count({ where: { organizationId } }),
    prisma.costCenter.count({ where: { organizationId } }),
  ]);

  return {
    orgUnits,
    departments,
    teams,
    positions,
    reportingEdges: reportingEdges.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      effectiveFrom: e.effectiveFrom,
      effectiveTo: e.effectiveTo,
      sourceCode: e.sourcePosition.code,
      sourceTitle: e.sourcePosition.title,
      targetCode: e.targetPosition.code,
      targetTitle: e.targetPosition.title,
    })),
    facilities: facilities.map((f) => ({
      ...f,
      type: f.type as string,
      status: f.status as string,
    })),
    counts: {
      orgUnits: orgUnits.length,
      departments: departments.length,
      teams: teams.length,
      positions: positions.length,
      facilities: facilities.length,
      reportingEdges: reportingEdges.length,
      designations,
      grades,
      jobFamilies,
      costCenters,
    },
  };
}

// ── Audit history for a resource ─────────────────────────────────────────────

export async function getResourceAuditHistory(
  subject: OrgSubject,
  organizationId: string,
  resourceType: string,
  resourceId: string,
) {
  await assertOrgRead(subject, organizationId);
  // The resource must exist in this org; otherwise leak nothing.
  const known = await prisma.auditEvent.findFirst({
    where: { tenantId: subject.tenantId, resourceType, resourceId },
    select: { id: true },
  });
  if (!known) return [];
  return prisma.auditEvent.findMany({
    where: { tenantId: subject.tenantId, resourceType, resourceId },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: {
      id: true,
      action: true,
      actorEmail: true,
      occurredAt: true,
      before: true,
      after: true,
    },
  });
}

export { OrgAppError };
export { OrgQueryError as OrgAccessError };
