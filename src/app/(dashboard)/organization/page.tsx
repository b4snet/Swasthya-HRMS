import type { Metadata } from "next";
import Link from "next/link";
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

export const metadata: Metadata = { title: "Organization" };

const COUNT_LINKS: Array<{
  key: keyof Awaited<ReturnType<typeof getStructureView>>["counts"];
  href: string;
  label: string;
}> = [
  { key: "orgUnits", href: "/organization/structure", label: "Org units" },
  { key: "departments", href: "/organization/departments", label: "Departments" },
  { key: "teams", href: "/organization/teams", label: "Teams" },
  { key: "positions", href: "/organization/positions", label: "Positions" },
  { key: "designations", href: "/organization/designations", label: "Designations" },
  { key: "jobFamilies", href: "/organization/job-families", label: "Job families" },
  { key: "grades", href: "/organization/grades", label: "Grades" },
  { key: "costCenters", href: "/organization/facilities", label: "Facilities & cost centers" },
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
    <div className="space-y-6">
      <section aria-labelledby="org-entities-heading" className="space-y-3">
        <h2 id="org-entities-heading" className="text-sm font-semibold">
          {active.name} at a glance
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {COUNT_LINKS.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="block rounded-lg border border-border bg-background p-4 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <p className="text-2xl font-bold tabular-nums">{view.counts[item.key]}</p>
                <p className="mt-1 text-2xs text-muted-foreground">{item.label}</p>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/organization/structure"
              className="block rounded-lg border border-border bg-background p-4 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <p className="text-2xl font-bold tabular-nums">{view.counts.reportingEdges}</p>
              <p className="mt-1 text-2xs text-muted-foreground">Reporting relationships</p>
            </Link>
          </li>
        </ul>
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
        <ul className="divide-y divide-border rounded-lg border border-border bg-background">
          {orgs.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {o.name} {o.id === active.id ? <span className="sr-only">(active)</span> : null}
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
