/**
 * Serializable shape of the app shell data (nav, alerts, user) crossing the
 * server → client boundary. Payloads are plain JSON — no functions, no
 * Prisma types, no secrets.
 */

export interface ShellNavItem {
  href: string;
  label: string;
  icon: string;
}

export interface ShellNavSection {
  id: string;
  label?: string;
  items: ShellNavItem[];
}

export interface ShellAlertItem {
  id: string;
  title: string;
  subtitle: string;
  kind: "credential" | "contract";
  tone: "warning" | "destructive";
  expiresOn: string | null;
  href: string;
}

export interface ShellUser {
  name: string;
  email: string;
  roleLabel: string;
}

export const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ROLE_SUPER_ADMIN: "Super admin",
  SYSTEM_ROLE_HR_ADMIN: "HR admin",
  SYSTEM_ROLE_HR_OFFICER: "HR officer",
  SYSTEM_ROLE_PAYROLL_OFFICER: "Payroll officer",
  SYSTEM_ROLE_DEPARTMENT_MANAGER: "Department manager",
  SYSTEM_ROLE_EMPLOYEE: "Employee",
  SYSTEM_ROLE_AUDITOR: "Auditor",
};

export function roleLabel(systemRoles: string[]): string {
  for (const role of systemRoles) {
    if (ROLE_LABELS[role]) return ROLE_LABELS[role];
  }
  return "Member";
}