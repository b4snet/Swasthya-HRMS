import { describe, expect, it } from "vitest";
import { hasPermission, rolesHavePermission, SYSTEM_ROLES, PERMISSIONS } from "@/lib/auth/rbac";
import { decideOrgAccess, SCOPE_TYPE_ORGANIZATION } from "@/lib/auth/scopes";

const subject = (roles: string[], status = "ACTIVE") => ({
  systemRoles: roles,
  status,
  isActive: status === "ACTIVE",
});

describe("org permissions (Phase 1 additions)", () => {
  it("maps ORG_READ for read-capable roles", () => {
    for (const role of [
      SYSTEM_ROLES.SUPER_ADMIN,
      SYSTEM_ROLES.HR_ADMIN,
      SYSTEM_ROLES.HR_OFFICER,
      SYSTEM_ROLES.DEPARTMENT_MANAGER,
      SYSTEM_ROLES.EMPLOYEE,
    ]) {
      expect(rolesHavePermission([role], PERMISSIONS.ORG_READ)).toBe(true);
    }
  });

  it("does not grant ORG_READ to payroll officers or auditors", () => {
    expect(rolesHavePermission([SYSTEM_ROLES.PAYROLL_OFFICER], PERMISSIONS.ORG_READ)).toBe(false);
    expect(rolesHavePermission([SYSTEM_ROLES.AUDITOR], PERMISSIONS.ORG_READ)).toBe(false);
  });

  it("keeps ORG_MANAGE limited to admin roles (separation of duties)", () => {
    expect(rolesHavePermission([SYSTEM_ROLES.HR_ADMIN], PERMISSIONS.ORG_MANAGE)).toBe(true);
    expect(rolesHavePermission([SYSTEM_ROLES.HR_OFFICER], PERMISSIONS.ORG_MANAGE)).toBe(false);
    expect(rolesHavePermission([SYSTEM_ROLES.DEPARTMENT_MANAGER], PERMISSIONS.ORG_MANAGE)).toBe(
      false,
    );
    expect(rolesHavePermission([SYSTEM_ROLES.EMPLOYEE], PERMISSIONS.ORG_MANAGE)).toBe(false);
  });

  it("denies inactive users regardless of role", () => {
    expect(
      hasPermission(subject([SYSTEM_ROLES.SUPER_ADMIN], "SUSPENDED"), PERMISSIONS.ORG_READ),
    ).toBe(false);
  });
});

describe("decideOrgAccess (pure ABAC decision)", () => {
  const scope = { userId: "u1", systemRoles: [SYSTEM_ROLES.HR_OFFICER] };

  it("allows an unrevoked ORGANIZATION grant", () => {
    const grants = [{ scopeType: SCOPE_TYPE_ORGANIZATION, revokedAt: null }];
    expect(decideOrgAccess(scope, grants, "o1")).toEqual({ allowed: true, reason: "OK" });
  });

  it("denies when no grant exists (default deny)", () => {
    expect(decideOrgAccess(scope, [], "o1").allowed).toBe(false);
  });

  it("denies a revoked grant", () => {
    const grants = [{ scopeType: SCOPE_TYPE_ORGANIZATION, revokedAt: new Date("2026-01-01") }];
    expect(decideOrgAccess(scope, grants, "o1")).toEqual({
      allowed: false,
      reason: "NO_ORG_SCOPE",
    });
  });

  it("ignores grants of other scope types", () => {
    const grants = [{ scopeType: "PAYROLL", revokedAt: null }];
    expect(decideOrgAccess(scope, grants, "o1").allowed).toBe(false);
  });

  it("bypasses scopes for SUPER_ADMIN", () => {
    const admin = { userId: "u1", systemRoles: [SYSTEM_ROLES.SUPER_ADMIN] };
    expect(decideOrgAccess(admin, [], "o1")).toEqual({
      allowed: true,
      reason: "SUPERUSER_BYPASS",
    });
  });
});
