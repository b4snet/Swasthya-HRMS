import { Building2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { callerFromUser } from "@/modules/organization/service/caller";
import { listAccessibleOrganizations } from "@/modules/organization/service/queries";
import { Breadcrumbs } from "@/components/ui/breadcrumb";
import { SectionNav } from "./section-nav";

/**
 * Organization section layout. The active organization is resolved
 * server-side: session org when set, else the first org in the caller's
 * scope (SUPER_ADMIN → first org of their tenant). The id never comes from
 * the client; pages re-derive it the same way, and services re-check scope.
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const canRead = rolesHavePermission(user.systemRoles, PERMISSIONS.ORG_READ);

  let orgs: Array<{ id: string; code: string; name: string }> = [];
  if (canRead) {
    try {
      orgs = await listAccessibleOrganizations(callerFromUser(user));
    } catch {
      orgs = [];
    }
  }
  const activeOrg = orgs.find((o) => o.id === user.organizationId) ?? orgs[0];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: "Swasthya HRMS", href: "/dashboard" }, { label: "Organization" }]}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Building2 aria-hidden="true" className="h-5 w-5 text-primary" />
            Organization
          </h1>
          <p className="mt-1 text-2xs text-muted-foreground">
            Structure, classifications, sites and reporting relationships.
          </p>
        </div>
        {canRead ? (
          activeOrg ? (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-2xs text-muted-foreground">
              Active organization:{" "}
              <span className="font-semibold text-foreground">{activeOrg.name}</span>{" "}
              <code className="text-2xs">({activeOrg.code})</code>
            </p>
          ) : (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-2xs text-muted-foreground">
              No organizations in your scope yet.
            </p>
          )
        ) : null}
      </header>

      {canRead ? <SectionNav /> : null}

      <div>{children}</div>
    </div>
  );
}
