/**
 * Workforce scope integration tests (Phase 2, prompt 3): manager scope,
 * department scope, self path, and the IDOR-sensitive manager detail read.
 *
 * Run: pnpm test:integration (real Postgres; helpers truncate between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createEmployee,
  changeEmploymentStatus,
  createAssignment,
} from "@/modules/workforce/service/employee-service";
import {
  listEmployeesInReach,
  getEmployeeForManager,
  getOwnEmployeeSummary,
  updateOwnContactInfo,
} from "@/modules/workforce/service/roster-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  makeDepartmentGrant,
  makeManagerGrant,
  makeSensitiveGrant,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";

let ctx: TenantContext;
let hrAdmin: UserContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("scope");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
});

interface Seeded {
  employeeId: string;
  employmentId: string;
  departmentId: string;
}

async function seedEmployee(opts: {
  employeeNo: string;
  departmentCode: string;
  parentDepartmentCode?: string;
  managerEmploymentId?: string;
}): Promise<Seeded> {
  const parent = opts.parentDepartmentCode
    ? await prisma.department.create({
        data: {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          code: opts.parentDepartmentCode,
          name: `Parent ${opts.parentDepartmentCode}`,
        },
      })
    : null;
  const department = await prisma.department.create({
    data: {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      code: opts.departmentCode,
      name: `Dept ${opts.departmentCode}`,
      parentId: parent?.id,
    },
  });
  const { employeeId, employmentId } = await createEmployee(hrAdmin.subject, {
    person: { firstName: "Syn", lastName: opts.employeeNo },
    organizationId: ctx.organizationId,
    employeeNo: opts.employeeNo,
    employeeType: "REGULAR",
    employment: {
      employmentNo: opts.employeeNo,
      type: "PERMANENT",
      hireDate: new Date("2026-01-05"),
    },
  });
  await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, { to: "ACTIVE" });
  await createAssignment(hrAdmin.subject, {
    organizationId: ctx.organizationId,
    employmentId,
    departmentId: department.id,
    managerEmploymentId: opts.managerEmploymentId,
    effectiveFrom: new Date("2026-01-05"),
  });
  return { employeeId, employmentId, departmentId: department.id };
}

describe("manager scope (derived reach, IDOR-sensitive)", () => {
  it("manager sees only their direct reports; guessed ids outside reach are NOT_FOUND", async () => {
    const managerEmp = await seedEmployee({ employeeNo: "EMP-26-90001", departmentCode: "M-DEPT" });
    const report = await seedEmployee({
      employeeNo: "EMP-26-90002",
      departmentCode: "M-DEPT-R",
      managerEmploymentId: managerEmp.employmentId,
    });
    const stranger = await seedEmployee({
      employeeNo: "EMP-26-90003",
      departmentCode: "OTHER-DEPT",
    });

    // NO organization grant: the manager's only reach is the MANAGER grant.
    const manager = await makeUser(ctx, "mgr", [SYSTEM_ROLES.DEPARTMENT_MANAGER]);
    await makeManagerGrant(manager.userId, managerEmp.employmentId);

    // The manager's list contains the report (manager reach)…
    const roster = await listEmployeesInReach(manager.subject, ctx.organizationId);
    const ids = roster.map((r) => r.id);
    expect(ids).toContain(report.employeeId);
    // …but NOT the unrelated employee.
    expect(ids).not.toContain(stranger.employeeId);

    // Direct detail read of the report succeeds…
    const detail = await getEmployeeForManager(
      manager.subject,
      ctx.organizationId,
      report.employeeId,
    );
    expect(detail.id).toBe(report.employeeId);
    // …while the stranger's id (guessed or otherwise) is NOT_FOUND —
    // existence outside reach is never disclosed.
    await expect(
      getEmployeeForManager(manager.subject, ctx.organizationId, stranger.employeeId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      getEmployeeForManager(manager.subject, ctx.organizationId, "totally-made-up-id"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("manager without any grant sees an empty roster (default deny)", async () => {
    await seedEmployee({ employeeNo: "EMP-26-91001", departmentCode: "N-DEPT" });
    const manager = await makeUser(ctx, "mgr2", [SYSTEM_ROLES.DEPARTMENT_MANAGER]);
    const roster = await listEmployeesInReach(manager.subject, ctx.organizationId);
    expect(roster).toEqual([]);
  });
});

describe("department scope (subtree reach)", () => {
  it("DEPARTMENT grant reaches the subtree but not sibling departments", async () => {
    const parent = await prisma.department.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        code: "DSC-P",
        name: "Parent Dept",
      },
    });
    const child = await prisma.department.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        code: "DSC-C",
        name: "Child Dept",
        parentId: parent.id,
      },
    });
    const sibling = await prisma.department.create({
      data: {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        code: "DSC-S",
        name: "Sibling Dept",
      },
    });

    const inParent = await seedEmployee({ employeeNo: "EMP-26-92001", departmentCode: "DSC-EP" });
    const inChild = await seedEmployee({ employeeNo: "EMP-26-92002", departmentCode: "DSC-EC" });
    const inSibling = await seedEmployee({ employeeNo: "EMP-26-92003", departmentCode: "DSC-ES" });

    // (Rewire seeded employees onto the exact departments.)
    await prisma.employmentAssignment.updateMany({
      where: { employmentId: inParent.employmentId },
      data: { departmentId: parent.id },
    });
    await prisma.employmentAssignment.updateMany({
      where: { employmentId: inChild.employmentId },
      data: { departmentId: child.id },
    });
    await prisma.employmentAssignment.updateMany({
      where: { employmentId: inSibling.employmentId },
      data: { departmentId: sibling.id },
    });
    void inParent;
    void inChild;

    // NO organization grant: the only reach is the DEPARTMENT grant.
    const viewer = await makeUser(ctx, "deptviewer", [SYSTEM_ROLES.HR_OFFICER]);
    await makeDepartmentGrant(viewer.userId, parent.id);

    const roster = await listEmployeesInReach(viewer.subject, ctx.organizationId);
    const ids = roster.map((r) => r.id);
    expect(ids).toContain(inParent.employeeId);
    expect(ids).toContain(inChild.employeeId); // subtree reach
    expect(ids).not.toContain(inSibling.employeeId);
  });
});

describe("self path (identity linking boundary)", () => {
  it("returns linked:false while User↔Person linking is deferred (ADR-010)", async () => {
    const user = await makeUser(ctx, "self", [SYSTEM_ROLES.EMPLOYEE], {
      scopeOrgIds: [ctx.organizationId],
    });
    await expect(getOwnEmployeeSummary(user.subject)).resolves.toBeNull();
    await expect(
      updateOwnContactInfo(user.subject, { email: "me@example.invalid", expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: "NOT_LINKED" });
  });
});

describe("cross-tenant attempts through scope services", () => {
  it("a tenant-B manager grant cannot reach tenant-A employees", async () => {
    const seeded = await seedEmployee({ employeeNo: "EMP-26-93001", departmentCode: "T-DEPT" });
    const tenantB = await makeTenantContext("scopeB");
    const adminB = await makeUser(tenantB, "adminB", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [tenantB.organizationId],
    });
    // Even a MANAGER grant naming the tenant-A employment must not widen
    // reach: the grant resolves only inside the caller's own tenant+org.
    await prisma.userAccessScope.create({
      data: {
        userId: adminB.userId,
        scopeType: "MANAGER",
        scopeId: seeded.employmentId,
        grantedBy: "test",
      },
    });
    const roster = await listEmployeesInReach(adminB.subject, ctx.organizationId);
    expect(roster).toEqual([]);
    await expect(
      getEmployeeForManager(adminB.subject, ctx.organizationId, seeded.employeeId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("sensitive audit trail", () => {
  it("sensitive grant is tenant-scoped: tenant B grant does not unlock tenant A rows", async () => {
    const seeded = await seedEmployee({ employeeNo: "EMP-26-94001", departmentCode: "S-DEPT" });
    const tenantB = await makeTenantContext("scopeC");
    const adminB = await makeUser(tenantB, "adminB", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [tenantB.organizationId],
    });
    await makeSensitiveGrant(tenantB.tenantId, adminB.userId);
    await expect(
      getEmployeeForManager(adminB.subject, ctx.organizationId, seeded.employeeId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
