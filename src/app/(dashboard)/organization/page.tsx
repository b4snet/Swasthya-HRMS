import type { Metadata } from "next";
import Link from "next/link";
import {
  Banknote,
  Building2,
  Layers,
  LayoutGrid,
  Network,
  Tag,
  UserSquare2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/organization/service/caller";
import {
  getStructureView,
  listAccessibleOrganizations,
  OrgQueryError,
} from "@/modules/organization/service/queries";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusVariant } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Organization" };

const COUNT_LINKS: Array<{
  key: keyof Awaited<ReturnType<typeof getStructureView>>["counts"];
  href: string;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "orgUnits", href: "/organization/structure", label: "Org units", icon: LayoutGrid },
  { key: "departments", href: "/organization/departments", label: "Departments", icon: Layers },
  { key: "teams", href: "/organization/teams", label: "Teams", icon: Network },
  { key: "positions", href: "/organization/positions", label: "Positions", icon: UserSquare2 },
  { key: "designations", href: "/organization/designations", label: "Designations", icon: Tag },
  { key: "jobFamilies", href: "/organization/job-families", label: "Job families", icon: Waypoints },
  { key: "grades", href: "/organization/grades", label: "Grades", icon: Banknote },
  { key: "costCenters", href: "/organization/facilities", label: "Facilities & cost centers", icon: Building2 },
];

export default async function OrganizationOverviewPage() {
  const user = await requireUser();
  let orgs: Array<{ id: string; code: string; name: string; status: string }> = [];
  try {
    orgs = await listAccessibleOrganizations(callerFromUser(user));
  } catch (err) {
    if (err instanceof OrgQueryError) return <PermissionDeniedState />;
    return <ErrorState message="Organization data could not be loaded." />;
  }

  if (orgs.length === 0) {
    return (
      <EmptyState
        title="No organizations in your scope"
        description="You don't have access to any organization yet. Ask your administrator to grant you an organization scope, or seed the development data with `pnpm db:seed`."
      />
    );
  }

  const active = orgs.find((o) => o.id === user.organizationId) ?? orgs[0];
  if (!active) {
    return (
      <EmptyState
        title="No active organization"
        description="Your scope resolved to zero organizations."
      />
    );
  }

  let view: Awaited<ReturnType<typeof getStructureView>> | null = null;
  try {
    view = await getStructureView(callerFromUser(user), active.id);
  } catch (err) {
    if (err instanceof OrgQueryError) return <PermissionDeniedState />;
    return <ErrorState message="Organization data could not be loaded." />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-6">
      <PageHeader
        icon={Building2}
        title="Organization"
        description={`${active.name} (${active.code}) at a glance — structure, facilities and entities in your scope.`}
      />

      <section aria-labelledby="org-entities-heading" className="space-y-3">
        <h2 id="org-entities-heading" className="text-sm font-semibold">
          Structure
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          {COUNT_LINKS.map((item) => (
            <StatCard
              key={item.key}
              label={item.label}
              value={view.counts[item.key]}
              icon={item.icon}
              tone="primary"
              href={item.href}
            />
          ))}
          <StatCard
            label="Reporting relationships"
            value={view.counts.reportingEdges}
            icon={Network}
            tone="info"
            href="/organization/structure"
          />
        </div>
      </section>

      <section aria-labelledby="org-facilities-heading" className="space-y-3">
        <h2 id="org-facilities-heading" className="text-sm font-semibold">
          Facilities
        </h2>
        {view.facilities.length === 0 ? (
          <EmptyState
            title="No facilities yet"
            description="Facilities are operational sites such as hospitals, clinics and offices."
            action={
              <Link
                href="/organization/facilities"
                className="rounded-lg bg-primary px-4 py-2 text-2xs font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Manage facilities
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.facilities.map((f) => (
              <li key={f.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">{f.name}</CardTitle>
                    <CardDescription>
                      <code className="text-2xs">{f.code}</code>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2">
                    <Badge variant="neutral">{f.type}</Badge>
                    <Badge variant={statusVariant(f.status)}>{f.status}</Badge>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="org-orgs-heading" className="space-y-3">
        <h2 id="org-orgs-heading" className="text-sm font-semibold">
          Organizations in your scope
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background shadow-card">
          {orgs.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {o.name}{" "}
                  {o.id === active.id ? (
                    <Badge variant="primary" className="ml-1.5 align-middle">
                      Active
                    </Badge>
                  ) : null}
                </p>
                <p className="text-2xs text-muted-foreground">
                  <code>{o.code}</code>
                </p>
              </div>
              <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
