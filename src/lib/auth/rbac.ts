/**
 * Phase 0 RBAC — system role constants and permission checks.
 *
 * Design (ADR-003):
 * - Static system roles are coarse; data-scoped permissions come from
 *   UserAccessScope (ABAC) checked alongside roles.
 * - Every authorization decision is made server-side. Client-side checks
 *   exist only to hide/enable UI and are never trusted.
 * - Checks compose: role grants the *capability*, scope grants the *data reach*.
 *
 * Roles are namespaced strings, not source-code magic scattered around.
 * They will move to a versioned, DB-backed role table in Phase 1 — the
 * permission map shape below is what persists.
 */

export const SYSTEM_ROLES = {
  SUPER_ADMIN: "SYSTEM_ROLE_SUPER_ADMIN",
  HR_ADMIN: "SYSTEM_ROLE_HR_ADMIN",
  HR_OFFICER: "SYSTEM_ROLE_HR_OFFICER",
  PAYROLL_OFFICER: "SYSTEM_ROLE_PAYROLL_OFFICER",
  DEPARTMENT_MANAGER: "SYSTEM_ROLE_DEPARTMENT_MANAGER",
  EMPLOYEE: "SYSTEM_ROLE_EMPLOYEE",
  AUDITOR: "SYSTEM_ROLE_AUDITOR",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const PERMISSIONS = {
  EMPLOYEE_READ_SELF: "employee:read:self",
  AUDIT_READ_OWN: "audit:read:own",
  AUDIT_READ_ALL: "audit:read:all",
  SYSTEM_ADMIN: "system:admin",
  USER_MANAGE: "user:manage",
  ORG_MANAGE: "org:manage",
  PAYROLL_READ: "payroll:read",
  PAYROLL_MANAGE: "payroll:manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  [SYSTEM_ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [SYSTEM_ROLES.HR_ADMIN]: [
    PERMISSIONS.EMPLOYEE_READ_SELF,
    PERMISSIONS.AUDIT_READ_ALL,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ORG_MANAGE,
  ],
  [SYSTEM_ROLES.HR_OFFICER]: [PERMISSIONS.EMPLOYEE_READ_SELF, PERMISSIONS.AUDIT_READ_OWN],
  [SYSTEM_ROLES.PAYROLL_OFFICER]: [
    PERMISSIONS.EMPLOYEE_READ_SELF,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.PAYROLL_MANAGE,
  ],
  [SYSTEM_ROLES.DEPARTMENT_MANAGER]: [PERMISSIONS.EMPLOYEE_READ_SELF, PERMISSIONS.AUDIT_READ_OWN],
  [SYSTEM_ROLES.EMPLOYEE]: [PERMISSIONS.EMPLOYEE_READ_SELF, PERMISSIONS.AUDIT_READ_OWN],
  [SYSTEM_ROLES.AUDITOR]: [PERMISSIONS.AUDIT_READ_ALL],
};

export interface AuthorizationSubject {
  systemRoles: readonly string[];
  status: string;
  isActive: boolean;
}

export function rolesHavePermission(roles: readonly string[], permission: Permission): boolean {
  return roles.some((role) => {
    const grants = (ROLE_PERMISSIONS as Record<string, readonly Permission[] | undefined>)[role];
    return grants?.includes(permission) ?? false;
  });
}

export function hasPermission(subject: AuthorizationSubject, permission: Permission): boolean {
  if (!subject.isActive || subject.status !== "ACTIVE") return false;
  return rolesHavePermission(subject.systemRoles, permission);
}
