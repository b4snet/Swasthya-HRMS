/**
 * Organization service integration tests — authorization & isolation.
 *
 * Covers the queued prompt's explicit matrix: allowed access, denied access,
 * cross-tenant denial, cross-organization denial, unauthorized mutation,
 * IDOR-style direct object access, plus audit generation.
 *
 * Run: pnpm test:integration (real Postgres; tests/integration/helpers.ts
 * truncates between tests).
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTreeNode,
  updateTreeNode,
  archiveTreeNode,
  createClassification,
} from "@/modules/organization/service/structure-service";
import {
  createLegalEntity,
  updateLegalEntity,
} from "@/modules/organization/service/entity-service";
import { OrgAppError } from "@/modules/organization/service/app-errors";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  auditCount,
  type TenantContext,
  type UserContext,
  SYSTEM_ROLES,
} from "./helpers";
import { prisma } from "@/lib/db";

let tenantA: TenantContext;
let tenantB: TenantContext;
let adminA: UserContext; // HR_ADMIN scoped to org A of tenant A
let officerA: UserContext; // HR_OFFICER scoped to org A of tenant A
let adminB: UserContext; // HR_ADMIN of tenant B (own org only)

beforeEach(async () => {
  await resetDatabase();
  tenantA = await makeTenantContext("a");
  tenantB = await makeTenantContext("b");
  adminA = await makeUser(tenantA, "adminA", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [tenantA.organizationId],
  });
  officerA = await makeUser(tenantA, "officerA", [SYSTEM_ROLES.HR_OFFICER], {
    scopeOrgIds: [tenantA.organizationId],
  });
  adminB = await makeUser(tenantB, "adminB", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [tenantB.organizationId],
  });
});

describe("authorization: allowed access", () => {
  it("lets a scoped HR_ADMIN create a department in their organization", async () => {
    const { id } = await createTreeNode("department", adminA.subject, tenantA.organizationId, {
      code: "CARD",
      name: "Cardiology",
    });
    const row = await prisma.department.findUnique({ where: { id } });
    expect(row?.tenantId).toBe(tenantA.tenantId);
    expect(row?.organizationId).toBe(tenantA.organizationId);
    expect(row?.status).toBe("ACTIVE");
  });

  it("denies a scoped HR_OFFICER any mutation (capability vs scope)", async () => {
    const { id } = await createTreeNode("department", adminA.subject, tenantA.organizationId, {
      code: "EMR",
      name: "Emergency",
    });
    await expect(
      updateTreeNode("department", officerA.subject, tenantA.organizationId, id, {
        name: "Emergency & Trauma",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("authorization: denied access", () => {
  it("denies a user with NO organization scope (default deny)", async () => {
    const noScope = await makeUser(tenantA, "noScope", [SYSTEM_ROLES.HR_ADMIN]);
    await expect(
      createTreeNode("department", noScope.subject, tenantA.organizationId, {
        code: "X1",
        name: "Nope",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("denies a role without ORG_MANAGE even when scoped (HR_OFFICER create)", async () => {
    await expect(
      createTreeNode("department", officerA.subject, tenantA.organizationId, {
        code: "X2",
        name: "Nope",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("denies cross-organization: scope is per-organization, not per-tenant", async () => {
    await expect(
      createTreeNode("department", adminA.subject, tenantA.secondOrganizationId, {
        code: "X3",
        name: "Wrong Org",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("denies cross-tenant access even with matching scope shape (IDOR)", async () => {
    await expect(
      createTreeNode("department", adminA.subject, tenantB.organizationId, {
        code: "X4",
        name: "Evil",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });

  it("denies suspended users regardless of role or scope", async () => {
    const suspended = await makeUser(tenantA, "susp", [SYSTEM_ROLES.HR_ADMIN], {
      scopeOrgIds: [tenantA.organizationId],
      status: "SUSPENDED",
    });
    await expect(
      createTreeNode("department", suspended.subject, tenantA.organizationId, {
        code: "X5",
        name: "Nope",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" });
  });
});

describe("IDOR-style direct object access", () => {
  it("cannot update or archive a resource in another organization by guessing its id", async () => {
    const { id } = await createTreeNode("department", adminA.subject, tenantA.organizationId, {
      code: "SEC",
      name: "Secret Dept",
    });

    // Direct update from tenant B: the scoped lookup must miss → NOT_FOUND.
    await expect(
      updateTreeNode("department", adminB.subject, tenantB.organizationId, id, {
        name: "Hijacked",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Direct archive from tenant B: same story.
    await expect(
      archiveTreeNode("department", adminB.subject, tenantB.organizationId, id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The row is untouched.
    const row = await prisma.department.findUnique({ where: { id } });
    expect(row?.name).toBe("Secret Dept");
    expect(row?.status).toBe("ACTIVE");
  });
});

describe("audit generation", () => {
  it("writes a create audit event with actor, tenant and after-state", async () => {
    const { id } = await createTreeNode("department", adminA.subject, tenantA.organizationId, {
      code: "AUD",
      name: "Audited Dept",
    });
    expect(await auditCount(tenantA.tenantId, "org.department.create")).toBe(1);
    const evt = await prisma.auditEvent.findFirst({
      where: { tenantId: tenantA.tenantId, action: "org.department.create" },
    });
    expect(evt?.actorUserId).toBe(adminA.userId);
    expect(evt?.resourceId).toBe(id);
    expect(evt?.after).toMatchObject({ code: "AUD" });
    expect(evt?.before).toBeNull();
  });

  it("writes NO audit event when authorization denies the mutation", async () => {
    await expect(
      createTreeNode("department", adminB.subject, tenantA.organizationId, {
        code: "NO",
        name: "Denied",
      }),
    ).rejects.toBeInstanceOf(OrgAppError);
    expect(await auditCount(tenantA.tenantId, "org.department.create")).toBe(0);
    expect(await auditCount(tenantB.tenantId, "org.department.create")).toBe(0);
  });

  it("keeps the audit ledger consistent on conflicting creates (fail-closed)", async () => {
    await createTreeNode("department", adminA.subject, tenantA.organizationId, {
      code: "DUP",
      name: "First",
    });
    await expect(
      createTreeNode("department", adminA.subject, tenantA.organizationId, {
        code: "DUP",
        name: "Second",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT_DUPLICATE" });
    // Exactly one event; no partial second row.
    expect(await auditCount(tenantA.tenantId, "org.department.create")).toBe(1);
    expect(await prisma.department.count({ where: { code: "DUP" } })).toBe(1);
  });
});

describe("optimistic concurrency (LegalEntity)", () => {
  it("updates with version checks and writes an audit event", async () => {
    const le = await createLegalEntity(adminA.subject, {
      code: "LE1",
      registeredName: "Pilot Hospital Pvt. Ltd.",
    });
    await updateLegalEntity(adminA.subject, le.id, {
      registeredName: "Pilot Hospital Renamed",
      expectedVersion: 1,
    });
    const row = await prisma.legalEntity.findUnique({ where: { id: le.id } });
    expect(row?.registeredName).toBe("Pilot Hospital Renamed");
    expect(row?.version).toBe(2);
    expect(await auditCount(tenantA.tenantId, "org.legalEntity.update")).toBe(1);
  });

  it("rejects a stale expectedVersion with RESOURCE_CONFLICT", async () => {
    const le = await createLegalEntity(adminA.subject, {
      code: "LE2",
      registeredName: "Original Name",
    });
    await updateLegalEntity(adminA.subject, le.id, {
      registeredName: "First Rename",
      expectedVersion: 1,
    });
    await expect(
      updateLegalEntity(adminA.subject, le.id, {
        registeredName: "Second Rename",
        expectedVersion: 1, // stale — the row is at v2 now
      }),
    ).rejects.toMatchObject({ code: "RESOURCE_CONFLICT" });
  });

  it("refuses a stale update from another tenant (NOT_FOUND before conflict)", async () => {
    const le = await createLegalEntity(adminA.subject, {
      code: "LE3",
      registeredName: "Tenant A Entity",
    });
    await expect(
      updateLegalEntity(adminB.subject, le.id, {
        registeredName: "Tenant B Hijack",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("classification audit surface", () => {
  it("audits designation creation with the actor identity", async () => {
    const d = await createClassification("designation", adminA.subject, tenantA.organizationId, {
      code: "MO",
      name: "Medical Officer",
      level: 5,
    });
    expect(d.id).toBeTruthy();
    const evt = await prisma.auditEvent.findFirst({
      where: { tenantId: tenantA.tenantId, action: "org.designation.create" },
    });
    expect(evt?.actorUserId).toBe(adminA.userId);
    expect(evt?.after).toMatchObject({ code: "MO" });
  });
});
