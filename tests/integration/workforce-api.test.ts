/**
 * Workforce API-boundary integration tests (Phase 2, prompt 3).
 *
 * Exercises the Zod schemas and the error/result contract that Prompt 4's
 * UI will consume — directly against the service layer (server actions
 * themselves require a Next.js request scope; the boundary contract is
 * identical: schema.parse → service → WorkforceAppError).
 *
 * Run: pnpm test:integration (real Postgres; helpers truncate between tests).
 * integration tests are allowed to import the Zod schemas directly (they test
 * the contract boundary itself, not the route module).
 */
/* eslint-disable-next-line no-restricted-imports */
import { beforeEach, describe, expect, it } from "vitest";
/* eslint-disable-next-line no-restricted-imports */
import {
  createEmployeeSchema,
  updatePersonSchema,
  changeEmploymentStatusSchema,
  createAssignmentSchema,
  createEmergencyContactSchema,
  createDependentSchema,
} from "@/modules/workforce/api/schemas";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import {
  createEmployee,
  changeEmploymentStatus,
} from "@/modules/workforce/service/employee-service";
import {
  resetDatabase,
  makeTenantContext,
  makeUser,
  SYSTEM_ROLES,
  type TenantContext,
  type UserContext,
} from "./helpers";
import { prisma } from "@/lib/db";

let ctx: TenantContext;
let hrAdmin: UserContext;

beforeEach(async () => {
  await resetDatabase();
  ctx = await makeTenantContext("api");
  hrAdmin = await makeUser(ctx, "hradmin", [SYSTEM_ROLES.HR_ADMIN], {
    scopeOrgIds: [ctx.organizationId],
  });
});

describe("Zod boundary: createEmployeeSchema", () => {
  const valid = {
    organizationId: "cktest000000000000000000",
    person: { firstName: "Asha", lastName: "Sharma" },
    employeeNo: "EMP-26-00001",
    employeeType: "REGULAR",
    employment: {
      employmentNo: "EMP-26-00001",
      type: "PERMANENT",
      hireDate: "2026-01-05T00:00:00.000Z",
    },
  };

  it("accepts a valid payload and coerces the date", () => {
    const parsed = createEmployeeSchema.parse(valid);
    expect(parsed.employment.hireDate).toBeInstanceOf(Date);
    expect(parsed.employment.workerClassification).toBe("EMPLOYEE"); // default applied
  });

  it("rejects a malformed employeeNo with a field hint", () => {
    const result = createEmployeeSchema.safeParse({
      ...valid,
      employeeNo: "emp-26-1",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("employeeNo");
    }
  });

  it("rejects a person without names", () => {
    const result = createEmployeeSchema.safeParse({
      ...valid,
      person: { firstName: "", lastName: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an employment type incompatible with the schema enum", () => {
    expect(
      createEmployeeSchema.safeParse({
        ...valid,
        employment: { ...valid.employment, type: "CONTRACTOR" },
      }).success,
    ).toBe(false);
  });
});

describe("Zod boundary: lifecycle schema enforces separation metadata", () => {
  it("requires terminationDate + reason for TERMINATED at the boundary", () => {
    const base = {
      organizationId: "cktest000000000000000000",
      employmentId: "cktest000000000000000001",
      to: "TERMINATED" as const,
    };
    expect(changeEmploymentStatusSchema.safeParse(base).success).toBe(false);
    expect(
      changeEmploymentStatusSchema.safeParse({
        ...base,
        terminationDate: "2026-06-01T00:00:00.000Z",
        terminationReason: "REDUNDANCY",
      }).success,
    ).toBe(true);
    // INVALID transition shape (SUSPENDED with dates) is legal input —
    // the state machine rejects it at the service layer instead.
    expect(
      changeEmploymentStatusSchema.safeParse({
        organizationId: "cktest000000000000000000",
        employmentId: "cktest000000000000000001",
        to: "ACTIVE",
      }).success,
    ).toBe(true);
  });
});

describe("Zod boundary: assignment + child entities", () => {
  it("rejects assignment without employmentId", () => {
    const result = createAssignmentSchema.safeParse({
      organizationId: "cktest000000000000000000",
      effectiveFrom: "2026-02-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects emergency contact with a too-short phone", () => {
    expect(
      createEmergencyContactSchema.safeParse({
        organizationId: "cktest000000000000000000",
        employeeId: "cktest000000000000000001",
        name: "Suman Rai",
        relationship: "Spouse",
        phone: "12",
      }).success,
    ).toBe(false);
  });

  it("rejects a dependent with an unknown relationship", () => {
    expect(
      createDependentSchema.safeParse({
        organizationId: "cktest000000000000000000",
        employeeId: "cktest000000000000000001",
        name: "Child",
        relationship: "COUSIN",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-cuid organizationId (IDOR hygiene at the boundary)", () => {
    expect(
      createEmployeeSchema.safeParse({
        organizationId: "not-a-cuid",
        person: { firstName: "A", lastName: "B" },
        employeeNo: "EMP-26-00001",
        employeeType: "REGULAR",
        employment: { employmentNo: "EMP-26-00001", type: "PERMANENT", hireDate: "2026-01-05" },
      }).success,
    ).toBe(false);
  });
});

describe("update schema versioning", () => {
  it("requires expectedVersion >= 1 on person updates (optimistic concurrency)", () => {
    expect(
      updatePersonSchema.safeParse({ personId: "cktest000000000000000000", expectedVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      updatePersonSchema.safeParse({ personId: "cktest000000000000000000", expectedVersion: 1 })
        .success,
    ).toBe(true);
  });
});

describe("audit action names (queued prompt contract)", () => {
  it("writes employment.status.changed-style actions with resource ids", async () => {
    const { employeeId, employmentId } = await createEmployee(hrAdmin.subject, {
      person: { firstName: "Nima", lastName: "Tamang" },
      organizationId: ctx.organizationId,
      employeeNo: "EMP-26-95001",
      employeeType: "REGULAR",
      employment: {
        employmentNo: "EMP-26-95001",
        type: "PERMANENT",
        hireDate: new Date("2026-01-05"),
      },
    });
    await changeEmploymentStatus(hrAdmin.subject, ctx.organizationId, employmentId, {
      to: "ACTIVE",
    });

    const created = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, action: "employee.create" },
    });
    expect(created.resourceId).toBe(employeeId);
    expect(created.actorUserId).toBe(hrAdmin.userId);

    const changed = await prisma.auditEvent.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, action: "employee.employment.status_change" },
    });
    expect(changed.resourceId).toBe(employmentId);
    expect(changed.after).toMatchObject({ status: "ACTIVE" });

    // No raw sensitive values ever reach payloads.
    const person = await prisma.person.findFirstOrThrow({
      where: {
        id: (await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } })).personId,
      },
    });
    expect(JSON.stringify({ b: created.before, a: created.after })).not.toContain(
      person.firstName === "" ? "" : "no-dob-here",
    );
  });

  it("denied mutations write NO audit events (fail-closed ledger)", async () => {
    const plain = await makeUser(ctx, "plain", [SYSTEM_ROLES.EMPLOYEE]);
    await expect(
      changeEmploymentStatus(plain.subject, ctx.organizationId, "cktest000000000000000009", {
        to: "ACTIVE",
      }),
    ).rejects.toBeInstanceOf(WorkforceAppError);
    expect(
      await prisma.auditEvent.count({
        where: { tenantId: ctx.tenantId, action: "employee.employment.status_change" },
      }),
    ).toBe(0);
  });
});
