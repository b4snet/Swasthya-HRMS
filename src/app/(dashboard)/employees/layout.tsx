import { Users } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { Breadcrumbs } from "@/components/ui/breadcrumb";
import { PermissionDeniedState } from "@/components/ui/states";
import { EmployeeSectionNav } from "./employee-section-nav";

/**
 * Employees section layout. The active organization is resolved the same
 * way as the organization layout (session org, else first in scope); pages
 * re-derive it and services re-check scope server-side.
 *
 * Least privilege (Phase 3 release gate): this section is a workforce
 * ADMINISTRATION surface. It is gated server-side on `employee:read` —
 * plain employees hold only `employee:read:self`, so direct URL access
 * renders a permission-denied state instead of directory chrome. The
 * services behind every page/action remain the authoritative boundary.
 */
export default async function EmployeesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const canRead = rolesHavePermission(user.systemRoles, PERMISSIONS.EMPLOYEE_READ);

  if (!canRead) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: "Swasthya HRMS", href: "/dashboard" }, { label: "Employees" }]}
        />
        <PermissionDeniedState
          title="You don't have access to this section"
          message="Employee records are restricted to authorized workforce roles. If you believe you should have access, contact your HR administrator."
        />
      </div>
    );
  }

  // Detail pages embed the section nav with the active employee id; the
  // id is extracted from the URL by each page rendering the nav itself,
  // so the layout only renders shell + breadcrumbs.
  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: "Swasthya HRMS", href: "/dashboard" }, { label: "Employees" }]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Users aria-hidden="true" className="h-5 w-5 text-primary" />
            Employees
          </h1>
          <p className="mt-1 text-2xs text-muted-foreground">
            Workforce records: identity, employment, assignments and history.
          </p>
        </div>
      </header>

      <EmployeeSectionNav />

      <div>{children}</div>
    </div>
  );
}
