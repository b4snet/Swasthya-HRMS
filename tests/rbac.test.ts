import { describe, expect, it } from "vitest";
import {
  hasPermission,
  rolesHavePermission,
  SYSTEM_ROLES,
  PERMISSIONS,
  type AuthorizationSubject,
} from "@/lib/auth/rbac";

const subject = (
  roles: string[],
  overrides: Partial<AuthorizationSubject> = {},
): AuthorizationSubject => ({
  systemRoles: roles,
  status: "ACTIVE",
  isActive: true,
  ...overrides,
});

describe("rolesHavePermission", () => {
  it("grants SUPER_ADMIN all permissions", () => {
    for (const permission of Object.values(PERMISSIONS)) {
      expect(rolesHavePermission([SYSTEM_ROLES.SUPER_ADMIN], permission)).toBe(true);
    }
  });

  it("grants HR_ADMIN audit:read:all and user management", () => {
    expect(rolesHavePermission([SYSTEM_ROLES.HR_ADMIN], PERMISSIONS.AUDIT_READ_ALL)).toBe(true);
    expect(rolesHavePermission([SYSTEM_ROLES.HR_ADMIN], PERMISSIONS.USER_MANAGE)).toBe(true);
  });

  it("does not grant HR_ADMIN payroll management (separation of duties)", () => {
    expect(rolesHavePermission([SYSTEM_ROLES.HR_ADMIN], PERMISSIONS.PAYROLL_MANAGE)).toBe(false);
  });

  it("grants AUDITOR only audit read permissions", () => {
    expect(rolesHavePermission([SYSTEM_ROLES.AUDITOR], PERMISSIONS.AUDIT_READ_ALL)).toBe(true);
    expect(rolesHavePermission([SYSTEM_ROLES.AUDITOR], PERMISSIONS.USER_MANAGE)).toBe(false);
    expect(rolesHavePermission([SYSTEM_ROLES.AUDITOR], PERMISSIONS.SYSTEM_ADMIN)).toBe(false);
  });

  it("returns false for unknown roles (default deny)", () => {
    expect(rolesHavePermission(["SYSTEM_ROLE_UNKNOWN"], PERMISSIONS.SYSTEM_ADMIN)).toBe(false);
    expect(rolesHavePermission([], PERMISSIONS.AUDIT_READ_OWN)).toBe(false);
  });
});

describe("hasPermission (subject-level)", () => {
  it("denies inactive users even with powerful roles", () => {
    expect(
      hasPermission(
        subject([SYSTEM_ROLES.SUPER_ADMIN], { isActive: false }),
        PERMISSIONS.SYSTEM_ADMIN,
      ),
    ).toBe(false);
  });

  it("denies users whose status is not ACTIVE", () => {
    expect(
      hasPermission(
        subject([SYSTEM_ROLES.SUPER_ADMIN], { status: "SUSPENDED" }),
        PERMISSIONS.SYSTEM_ADMIN,
      ),
    ).toBe(false);
  });

  it("allows active employee to read own records", () => {
    expect(hasPermission(subject([SYSTEM_ROLES.EMPLOYEE]), PERMISSIONS.EMPLOYEE_READ_SELF)).toBe(
      true,
    );
  });

  it("denies employee access to tenant-wide audit", () => {
    expect(hasPermission(subject([SYSTEM_ROLES.EMPLOYEE]), PERMISSIONS.AUDIT_READ_ALL)).toBe(false);
  });
});
