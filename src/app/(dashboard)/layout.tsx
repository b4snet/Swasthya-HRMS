import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  Building2,
  ClipboardList,
  LayoutDashboard,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { Breadcrumbs } from "@/components/ui/breadcrumb";
import { NavLogoutButton } from "./nav-logout";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: null },
  {
    href: "/organization",
    label: "Organization",
    icon: Building2,
    permission: PERMISSIONS.ORG_READ,
  },
  {
    href: "/employees",
    label: "Employees",
    icon: Users,
    permission: PERMISSIONS.EMPLOYEE_READ,
  },
  {
    href: "/employees/expiry",
    label: "Expiring & expired",
    icon: ClipboardList,
    permission: PERMISSIONS.EMPLOYEE_READ,
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    icon: ClipboardList,
    permission: PERMISSIONS.AUDIT_READ_ALL,
  },
  {
    href: "/settings/system",
    label: "System health",
    icon: Activity,
    permission: PERMISSIONS.SYSTEM_ADMIN,
  },
] as const;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:shadow-md"
      >
        Skip to main content
      </a>

      <aside
        aria-label="Primary"
        className="hidden w-64 shrink-0 border-r border-border bg-muted md:block"
      >
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/dashboard" className="text-sm font-bold tracking-tight">
            Swasthya HRMS
          </Link>
        </div>
        <nav aria-label="Main navigation" className="p-3">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const allowed =
                item.permission === null || rolesHavePermission(user.systemRoles, item.permission);
              if (!allowed) return null;
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-auto p-3 text-2xs text-muted-foreground">
          <p className="flex items-center gap-1.5 px-3">
            <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
            All actions are audited
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <Breadcrumbs items={[{ label: "Swasthya HRMS", href: "/dashboard" }]} />
          <div className="flex items-center gap-3">
            <span className="text-2xs text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>
            </span>
            <NavLogoutButton />
          </div>
        </header>
        <main id="main-content" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
