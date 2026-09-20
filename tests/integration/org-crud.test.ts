/**
 * Organization service integration tests — CRUD, hierarchy, effective
 * dates, lifecycle/archival, and reporting edges.
 *
 * Run: pnpm test:integration (real Postgres; tests/integration/helpers.ts
 * truncates between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTreeNode,
  updateTreeNode,
  archiveTreeNode,
  setTreeNodeStatus,
  createClassification,
  archiveClassification,
} from "@/modules/organization/service/structure-service";
import {
  createLocation,
  createFacility,
  archiveFacility,
  createCostCenter,
} from "@/modules/organization/service/entity-service";
import {
  createPosition,
  setPositionStatus,
  createReportingEdge,
  closeReportingEdge,
} from "@/modules/organization/service/position-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  auditCount,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";

let ctx: TenantContext;
let admin: UserContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("crud");
  admin = await makeUser(ctx, "admin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
});

describe("tree CRUD + hierarchy", () => {
  it("creates org units with a required type and validates parent scope", async () => {
    const bu = await createTreeNode("orgUnit", admin.subject, ctx.organizationId, {
      code: "BU1",
      name: "Operations",
      type: "BUSINESS_UNIT",
    });
    const div = await createTreeNode("orgUnit", admin.subject, ctx.organizationId, {
      code: "DIV1",
      name: "Clinical Division",
      type: "DIVISION",
      parentId: bu.id,
    });
    const row = await prisma.orgUnit.findUnique({ where: { id: div.id } });
    expect(row?.parentId).toBe(bu.id);
    expect(row?.type).toBe("DIVISION");
  });

  it("rejects a parent from a different organization (scoped check, not just FK)", async () => {
    const other = await makeTenantContext("other");
    const otherAdmin = await makeUser(other, "oa", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    const foreign = await createTreeNode("department", otherAdmin.subject, other.organizationId, {
      code: "FOR",
      name: "Foreign Dept",
    });
    // Same tenant, different organization: the parent must be rejected.
    await expect(
      createTreeNode("department", admin.subject, ctx.organizationId, {
        code: "KID",
        name: "Child Dept",
        parentId: foreign.id,
      }),
    ).rejects.toMatchObject({ code: "HIERARCHY_INVALID" });
  });

  it("rejects cycles on department re-parenting", async () => {
    const root = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "R",
      name: "Root",
    });
    const child = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "C",
      name: "Child",
      parentId: root.id,
    });
    // Making the root a child of its own descendant would create a cycle.
    await expect(
      updateTreeNode("department", admin.subject, ctx.organizationId, root.id, {
        parentId: child.id,
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "HIERARCHY_INVALID" });
  });

  it("moves a department under a new parent, bumping version + auditing", async () => {
    const root = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "R2",
      name: "Root",
    });
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "D2",
      name: "Movable",
    });
    await updateTreeNode("department", admin.subject, ctx.organizationId, dept.id, {
      parentId: root.id,
      expectedVersion: 1,
    });
    const row = await prisma.department.findUnique({ where: { id: dept.id } });
    expect(row?.parentId).toBe(root.id);
    expect(row?.version).toBe(2);
    expect(await auditCount(ctx.tenantId, "org.department.update")).toBe(1);
  });
});

describe("effective dating", () => {
  it("sets effectiveFrom on creation and closes effectiveTo on archival", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "ED",
      name: "Ephemeral",
    });
    const created = await prisma.department.findUnique({ where: { id: dept.id } });
    expect(created?.effectiveFrom).toBeInstanceOf(Date);
    expect(created?.effectiveTo).toBeNull();

    await archiveTreeNode("department", admin.subject, ctx.organizationId, dept.id);
    const archived = await prisma.department.findUnique({ where: { id: dept.id } });
    expect(archived?.status).toBe("ARCHIVED");
    expect(archived?.effectiveTo).toBeInstanceOf(Date);
    expect(await auditCount(ctx.tenantId, "org.department.archive")).toBe(1);
  });
});

describe("lifecycle + archival", () => {
  it("deactivates and reactivates a department", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "LC",
      name: "Lifecycle",
    });
    await setTreeNodeStatus("department", admin.subject, ctx.organizationId, dept.id, "INACTIVE");
    expect((await prisma.department.findUnique({ where: { id: dept.id } }))?.status).toBe(
      "INACTIVE",
    );
    await setTreeNodeStatus("department", admin.subject, ctx.organizationId, dept.id, "ACTIVE");
    expect((await prisma.department.findUnique({ where: { id: dept.id } }))?.status).toBe("ACTIVE");
  });

  it("refuses to edit or reactivate an archived department", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "AR",
      name: "To Archive",
    });
    await archiveTreeNode("department", admin.subject, ctx.organizationId, dept.id);
    await expect(
      updateTreeNode("department", admin.subject, ctx.organizationId, dept.id, {
        name: "Zombie",
        expectedVersion: 1, // deliberately stale — archived rows must be reloaded, then refused
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
    await expect(
      setTreeNodeStatus("department", admin.subject, ctx.organizationId, dept.id, "ACTIVE"),
    ).rejects.toMatchObject({ code: "LIFECYCLE_INVALID" });
  });

  it("archives a designation idempotently (second call is a no-op)", async () => {
    const desig = await createClassification("designation", admin.subject, ctx.organizationId, {
      code: "NURSE",
      name: "Staff Nurse",
      level: 3,
    });
    await archiveClassification("designation", admin.subject, ctx.organizationId, desig.id);
    await archiveClassification("designation", admin.subject, ctx.organizationId, desig.id);
    expect(await auditCount(ctx.tenantId, "org.designation.archive")).toBe(1);
  });
});

describe("conflicts", () => {
  it("rejects duplicate department codes with CONFLICT_DUPLICATE", async () => {
    await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "DUP",
      name: "First",
    });
    await expect(
      createTreeNode("department", admin.subject, ctx.organizationId, {
        code: "DUP",
        name: "Second",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_DUPLICATE" });
  });

  it("rejects a stale expectedVersion on department update", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "CC",
      name: "Concurrent",
    });
    await updateTreeNode("department", admin.subject, ctx.organizationId, dept.id, {
      name: "Writer A",
      expectedVersion: 1,
    });
    await expect(
      updateTreeNode("department", admin.subject, ctx.organizationId, dept.id, {
        name: "Writer B",
        expectedVersion: 1, // stale
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
  });
});

describe("locations + facilities + cost centers", () => {
  it("creates a location (tenant-scoped) and a facility referencing it", async () => {
    const loc = await createLocation(admin.subject, {
      code: "KTM",
      name: "Kathmandu Main",
      city: "Kathmandu",
      country: "np", // lowercase input must be normalized
    });
    const fac = await createFacility(admin.subject, ctx.organizationId, {
      code: "HOSP1",
      name: "Pilot Hospital",
      type: "HOSPITAL",
      locationId: loc.id,
    });
    const row = await prisma.facility.findUnique({ where: { id: fac.id } });
    expect(row?.locationId).toBe(loc.id);
    expect(row?.type).toBe("HOSPITAL");
  });

  it("refuses a facility whose location belongs to another tenant", async () => {
    const other = await makeTenantContext("far");
    const otherAdmin = await makeUser(other, "fa", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [other.organizationId],
    });
    const foreignLoc = await createLocation(otherAdmin.subject, {
      code: "FAR",
      name: "Foreign Location",
      country: "NP",
    });
    await expect(
      createFacility(admin.subject, ctx.organizationId, {
        code: "F1",
        name: "Illicit Facility",
        type: "CLINIC",
        locationId: foreignLoc.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("archives a facility and closes its effective period", async () => {
    const cc = await createCostCenter(admin.subject, ctx.organizationId, {
      code: "CC-ER",
      name: "Emergency Cost Center",
    });
    expect(cc.id).toBeTruthy();
    const loc = await createLocation(admin.subject, {
      code: "L2",
      name: "Annex",
      country: "NP",
    });
    const fac = await createFacility(admin.subject, ctx.organizationId, {
      code: "F2",
      name: "Annex Clinic",
      type: "CLINIC",
      locationId: loc.id,
    });
    await archiveFacility(admin.subject, ctx.organizationId, fac.id);
    const row = await prisma.facility.findUnique({ where: { id: fac.id } });
    expect(row?.status).toBe("ARCHIVED");
    expect(row?.effectiveTo).not.toBeNull();
  });
});

describe("positions + reporting edges", () => {
  it("creates a position under exactly one owning unit and enforces the XOR", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "PD",
      name: "Position Dept",
    });
    const desig = await createClassification("designation", admin.subject, ctx.organizationId, {
      code: "MO",
      name: "Medical Officer",
    });
    const pos = await createPosition(admin.subject, ctx.organizationId, {
      code: "POS-1",
      departmentId: dept.id,
      designationId: desig.id,
    });
    const row = await prisma.position.findUnique({ where: { id: pos.id } });
    expect(row?.departmentId).toBe(dept.id);
    expect(row?.teamId).toBeNull();
    expect(row?.status).toBe("VACANT");

    // XOR: a position belongs to a department or a team — never both.
    const team = await createTreeNode("team", admin.subject, ctx.organizationId, {
      code: "PT",
      name: "Position Team",
    });
    await expect(
      createPosition(admin.subject, ctx.organizationId, {
        code: "POS-2",
        departmentId: dept.id,
        teamId: team.id,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP_INVALID" });
  });

  it("transitions position status and treats CLOSED as terminal", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "SD",
      name: "Status Dept",
    });
    const pos = await createPosition(admin.subject, ctx.organizationId, {
      code: "POS-3",
      departmentId: dept.id,
    });
    await setPositionStatus(admin.subject, ctx.organizationId, pos.id, "FILLED");
    await setPositionStatus(admin.subject, ctx.organizationId, pos.id, "VACANT");
    await setPositionStatus(admin.subject, ctx.organizationId, pos.id, "CLOSED");
    await expect(
      setPositionStatus(admin.subject, ctx.organizationId, pos.id, "FILLED"),
    ).rejects.toMatchObject({ code: "LIFECYCLE_INVALID" });
    // FILLED, VACANT, CLOSED each audited; the illegal CLOSED → FILLED
    // attempt is rejected BEFORE any event is written (fail-closed ledger).
    expect(await auditCount(ctx.tenantId, "org.position.status")).toBe(3);
  });

  it("creates a PRIMARY reporting edge and rejects cycles", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "RD",
      name: "Reporting Dept",
    });
    const head = await createPosition(admin.subject, ctx.organizationId, {
      code: "P-HEAD",
      departmentId: dept.id,
    });
    const staff = await createPosition(admin.subject, ctx.organizationId, {
      code: "P-STAFF",
      departmentId: dept.id,
    });
    await createReportingEdge(admin.subject, ctx.organizationId, {
      sourcePositionId: staff.id,
      targetPositionId: head.id,
      type: "PRIMARY",
    });
    // The manager reporting to their own subordinate would cycle.
    await expect(
      createReportingEdge(admin.subject, ctx.organizationId, {
        sourcePositionId: head.id,
        targetPositionId: staff.id,
        type: "PRIMARY",
      }),
    ).rejects.toMatchObject({ code: "REPORTING_CYCLE" });
  });

  it("closes a reporting edge by effectiveTo and keeps history", async () => {
    const dept = await createTreeNode("department", admin.subject, ctx.organizationId, {
      code: "RD2",
      name: "Edge Dept",
    });
    const a = await createPosition(admin.subject, ctx.organizationId, {
      code: "P-A",
      departmentId: dept.id,
    });
    const b = await createPosition(admin.subject, ctx.organizationId, {
      code: "P-B",
      departmentId: dept.id,
    });
    const edge = await createReportingEdge(admin.subject, ctx.organizationId, {
      sourcePositionId: a.id,
      targetPositionId: b.id,
      type: "PRIMARY",
    });
    await closeReportingEdge(admin.subject, ctx.organizationId, edge.id);
    const row = await prisma.reportingEdge.findUnique({ where: { id: edge.id } });
    expect(row?.effectiveTo).not.toBeNull();
    expect(row?.status).toBe("INACTIVE");
    expect(await auditCount(ctx.tenantId, "org.reportingEdge.close")).toBe(1);
  });
});
