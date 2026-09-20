import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { listCredentialsNearingExpiry } from "@/modules/credentials/service/credential-actions";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { AppShell } from "@/components/layout/app-shell";
import {
  roleLabel,
  type ShellAlertItem,
  type ShellNavSection,
  type ShellUser,
} from "@/components/layout/shell-types";

/**
 * App frame. Nav is permission-filtered server-side into serializable
 * payloads; expiry alerts are computed only for callers who may read
 * credentials (never more). All data crossing into the client is plain JSON.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const SYSTEM_ROLE = user.systemRoles;

  const main: ShellNavSection = {
    id: "main",
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      ...(rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.ORG_READ)
        ? [{ href: "/organization", label: "Organization", icon: "organization" as const }]
        : []),
      ...(rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.EMPLOYEE_READ)
        ? [{ href: "/employees", label: "Employees", icon: "employees" as const }]
        : []),
    ],
  };

  const compliance: ShellNavSection = {
    id: "compliance",
    label: "Compliance",
    items: [
      ...(rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.EMPLOYEE_READ)
        ? [{ href: "/employees/expiry", label: "Expiring & expired", icon: "expiry" as const }]
        : []),
      ...(rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.AUDIT_READ_ALL)
        ? [{ href: "/admin/audit", label: "Audit log", icon: "audit" as const }]
        : []),
    ],
  };

  const system: ShellNavSection = {
    id: "system",
    label: "System",
    items: [
      ...(rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.SYSTEM_ADMIN)
        ? [{ href: "/settings/system", label: "System health", icon: "system" as const }]
        : []),
    ],
  };

  const sections = [main, compliance, system].filter((section) => section.items.length > 0);

  let alerts: ShellAlertItem[] = [];
  if (rolesHavePermission(SYSTEM_ROLE, PERMISSIONS.EMPLOYEE_READ)) {
    try {
      const rows = await listCredentialsNearingExpiry(callerFromUser(user), {});
      alerts = rows.slice(0, 12).map((row) => ({
        id: row.id,
        kind: "credential" as const,
        title: row.name,
        subtitle: `${row.type}${row.issuer ? ` · ${row.issuer}` : ""}`,
        tone: row.derivedStatus === "EXPIRED" ? ("destructive" as const) : ("warning" as const),
        expiresOn: row.expiresOn ? row.expiresOn.toISOString() : null,
        href: "/employees/expiry",
      }));
    } catch {
      alerts = [];
    }
  }

  const shellUser: ShellUser = {
    name: user.name,
    email: user.email,
    roleLabel: roleLabel(user.systemRoles),
  };

  return (
    <AppShell sections={sections} alerts={alerts} user={shellUser}>
      {children}
    </AppShell>
  );
}