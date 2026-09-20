/**
 * Integration-test harness (queued prompt 3).
 *
 * Connects to the real Postgres named by DATABASE_URL (CI service or local
 * docker compose), truncates all tables between tests and provides
 * factories for tenants/organizations/users/scopes so suites can build
 * ISOLATED callers (the basis of tenant-isolation and IDOR assertions).
 *
 * Security: passwords here are random per run and never asserted against —
 * these tests exercise the service layer directly, not the login flow.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { OrgSubject } from "@/modules/organization/service/validation-service";

/** Delete all rows (child-first); tables are small in tests. */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    // Seed data links organizations.legalEntityId → legal_entities; clear the
    // reference first so the org delete (and everything after) can proceed.
    prisma.organization.updateMany({ data: { legalEntityId: null } }),
    prisma.auditEvent.deleteMany(),
    prisma.authEvent.deleteMany(),
    prisma.session.deleteMany(),
    prisma.userAccessScope.deleteMany(),
    // Slice 1.0 (workflows + notifications) — app_notifications restrict on
    // user (RESTRICT FK), so it must clear before user.deleteMany(); task and
    // approval FKs are SET NULL so they clear safely after.
    prisma.appNotification.deleteMany(),
    prisma.workflowTask.deleteMany(),
    prisma.approvalRequest.deleteMany(),
    // Phase 3 (contracts/documents/credentials) — children before the rows
    // they reference (all FKs are Restrict). Documents sit UNDER contracts,
    // template bodies, evidence records and employee document references, so
    // every referencing row clears before document.deleteMany(); the issuing
    // authority registry clears only after credentials/qualifications below.
    prisma.credentialRenewal.deleteMany(),
    prisma.credentialVerificationRecord.deleteMany(),
    prisma.qualificationVerificationRecord.deleteMany(),
    prisma.documentAccessGrant.deleteMany(),
    prisma.documentVersion.deleteMany(),
    prisma.contractParty.deleteMany(),
    prisma.contractVersion.deleteMany(),
    prisma.contract.deleteMany(),
    prisma.contractTemplateVersion.deleteMany(),
    prisma.contractTemplate.deleteMany(),
    prisma.employeeDocumentReference.deleteMany(),
    prisma.document.deleteMany(),
    prisma.documentType.deleteMany(),
    // Phase 2 (workforce) — assignment children before position/department
    // etc.; employee children before employee; employment before employee.
    prisma.employeeDependent.deleteMany(),
    prisma.employeeEmergencyContact.deleteMany(),
    prisma.employeeQualification.deleteMany(),
    prisma.employeeCredential.deleteMany(),
    // Phase 3 registry rows — only deletable once credentials/qualifications
    // no longer reference them (Restrict FKs).
    prisma.issuingAuthority.deleteMany(),
    prisma.credentialTypeConfig.deleteMany(),
    prisma.employmentAssignment.deleteMany(),
    prisma.employment.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.identityDocument.deleteMany(),
    prisma.person.deleteMany(),
    prisma.reportingEdge.deleteMany(),
    prisma.position.deleteMany(),
    prisma.facility.deleteMany(),
    prisma.location.deleteMany(),
    prisma.costCenter.deleteMany(),
    prisma.grade.deleteMany(),
    prisma.jobFamily.deleteMany(),
    prisma.designation.deleteMany(),
    prisma.team.deleteMany(),
    prisma.department.deleteMany(),
    prisma.orgUnit.deleteMany(),
    prisma.legalEntity.deleteMany(),
    prisma.organization.deleteMany(),
    prisma.user.deleteMany(),
    prisma.tenant.deleteMany(),
  ]);
}

export const SYSTEM_ROLES = {
  SUPER_ADMIN: "SYSTEM_ROLE_SUPER_ADMIN",
  HR_ADMIN: "SYSTEM_ROLE_HR_ADMIN",
  HR_OFFICER: "SYSTEM_ROLE_HR_OFFICER",
  PAYROLL_OFFICER: "SYSTEM_ROLE_PAYROLL_OFFICER",
  DEPARTMENT_MANAGER: "SYSTEM_ROLE_DEPARTMENT_MANAGER",
  EMPLOYEE: "SYSTEM_ROLE_EMPLOYEE",
  AUDITOR: "SYSTEM_ROLE_AUDITOR",
} as const;

export interface TenantContext {
  tenantId: string;
  organizationId: string;
  secondOrganizationId: string;
}

/** Tenant + two organizations (for cross-org scope assertions). */
export async function makeTenantContext(name: string): Promise<TenantContext> {
  const tenant = await prisma.tenant.create({
    data: { slug: `t-${name}-${randomUUID().slice(0, 8)}`, name: `Tenant ${name}` },
  });
  const orgA = await prisma.organization.create({
    data: { tenantId: tenant.id, code: "ORG-A", name: `Org A ${name}` },
  });
  const orgB = await prisma.organization.create({
    data: { tenantId: tenant.id, code: "ORG-B", name: `Org B ${name}` },
  });
  return { tenantId: tenant.id, organizationId: orgA.id, secondOrganizationId: orgB.id };
}

export interface UserContext {
  subject: OrgSubject;
  userId: string;
}

/** ACTIVE user with the given roles, optionally granted an ORGANIZATION scope. */
export async function makeUser(
  tenantCtx: TenantContext,
  name: string,
  roles: readonly string[],
  opts: { scopeOrgIds?: string[]; status?: "ACTIVE" | "SUSPENDED" | "INVITED" } = {},
): Promise<UserContext> {
  const email = `${name}-${randomUUID().slice(0, 8)}@test.invalid`;
  const user = await prisma.user.create({
    data: {
      tenantId: tenantCtx.tenantId,
      email,
      name: `User ${name}`,
      // Random per-run secret; tests never authenticate via this value.
      passwordHash: await bcrypt.hash(randomUUID(), 4),
      status: opts.status ?? "ACTIVE",
      systemRole: roles.join(","),
      accessScopes: {
        create: (opts.scopeOrgIds ?? []).map((scopeId) => ({
          scopeType: "ORGANIZATION",
          scopeId,
        })),
      },
    },
    include: { accessScopes: true },
  });
  return {
    userId: user.id,
    subject: {
      userId: user.id,
      tenantId: user.tenantId,
      organizationId: user.organizationId,
      systemRoles: roles,
      status: user.status,
    },
  };
}

export const auditCount = async (tenantId: string, action: string) =>
  prisma.auditEvent.count({ where: { tenantId, action } });

/**
 * Phase 2: a user with an ORGANIZATION grant plus (optionally) a SENSITIVE
 * grant for the tenant — the shape the workforce sensitive gate requires.
 */
export async function makeSensitiveGrant(tenantId: string, userId: string): Promise<void> {
  await prisma.userAccessScope.create({
    data: { userId, scopeType: "SENSITIVE", scopeId: tenantId, grantedBy: "test" },
  });
}

/** Phase 2: DEPARTMENT scope grant (reach = that subtree). */
export async function makeDepartmentGrant(userId: string, departmentId: string): Promise<void> {
  await prisma.userAccessScope.create({
    data: { userId, scopeType: "DEPARTMENT", scopeId: departmentId, grantedBy: "test" },
  });
}

/** Phase 2: MANAGER scope grant (scopeId = the manager's employment id). */
export async function makeManagerGrant(userId: string, managerEmploymentId: string): Promise<void> {
  await prisma.userAccessScope.create({
    data: { userId, scopeType: "MANAGER", scopeId: managerEmploymentId, grantedBy: "test" },
  });
}

export const auditLast = async (tenantId: string, action: string) =>
  prisma.auditEvent.findFirst({
    where: { tenantId, action },
    orderBy: { occurredAt: "desc" },
  });
