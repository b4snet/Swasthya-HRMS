import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { getEmployeeProfile } from "@/modules/workforce/service/roster-service";
import { listAssignments } from "@/modules/workforce/service/employee-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AuditHistoryButton } from "@/components/org/status-actions";
import {
  EmptyState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
} from "@/components/ui/states";

export const metadata: Metadata = { title: "Employee profile" };

function Restricted() {
  return (
    <Badge variant="warning" title="Requires the sensitive-data grant">
      Restricted
    </Badge>
  );
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();

  let organizationId: string;
  try {
    const orgs = await listAccessibleOrganizations(callerFromUser(user));
    const active = orgs.find((o) => o.id === user.organizationId) ?? orgs[0];
    if (!active) {
      return (
        <EmptyState
          title="No organizations in your scope"
          description="Ask your administrator for an organization scope, or seed demo data with `pnpm db:seed`."
        />
      );
    }
    organizationId = active.id;
  } catch (err) {
    if (err instanceof OrgQueryError) return <PermissionDeniedState />;
    return <ErrorState />;
  }

  let profile: Awaited<ReturnType<typeof getEmployeeProfile>>;
  try {
    profile = await getEmployeeProfile(callerFromUser(user), organizationId, id);
  } catch (err) {
    if (err instanceof WorkforceAppError) {
      if (err.code === "NOT_FOUND")
        return (
          <NotFoundState
            title="Employee not found"
            message="This employee does not exist or is outside your access reach."
          />
        );
      if (err.code === "AUTHORIZATION_DENIED") return <PermissionDeniedState />;
    }
    return <ErrorState />;
  }

  const { employee, employments } = profile;
  const current = employments[0];
  let openAssignment: Awaited<ReturnType<typeof listAssignments>>[number] | null = null;
  if (current) {
    const rows: Awaited<ReturnType<typeof listAssignments>> = await listAssignments(
      callerFromUser(user),
      organizationId,
      current.id,
    );
    openAssignment = rows.find((a) => a.open) ?? null;
  }

  const p = employee.person;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Person record behind this workforce entry.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
            <dt className="text-muted-foreground">Legal name</dt>
            <dd>
              {p.firstName} {p.lastName}
            </dd>
            <dt className="text-muted-foreground">Preferred name</dt>
            <dd>{p.preferredName ?? "—"}</dd>
            <dt className="text-muted-foreground">Date of birth</dt>
            <dd>
              {p.dateOfBirth ? (
                fmtDate(p.dateOfBirth)
              ) : profile.sensitiveViewed ? (
                "—"
              ) : (
                <Restricted />
              )}
            </dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Contact</CardTitle>
            <CardDescription>Work contact details.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/employees/${employee.id}/edit`}>
              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
              Edit
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{p.email ?? "—"}</dd>
            <dt className="text-muted-foreground">Phone</dt>
            <dd>{p.phone ?? "—"}</dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="space-x-1">
              {p.addressLine1 || p.addressLine2 || p.city || p.country ? (
                <>
                  {p.addressLine1 ? <span>{p.addressLine1}</span> : null}
                  {p.addressLine2 ? <span>{p.addressLine2}</span> : null}
                  {p.city ? <span>{p.city}</span> : null}
                  {p.country ? <span>{p.country}</span> : null}
                </>
              ) : profile.sensitiveViewed ? (
                "—"
              ) : (
                <Restricted />
              )}
            </dd>
          </dl>
          {!profile.sensitiveViewed ? (
            <p className="text-2xs text-muted-foreground">
              Sensitive fields render as Restricted unless your account holds the sensitive-data
              grant; every authorized view is audited.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
          <CardDescription>Current employment relationship.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {current ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Employment No.</dt>
              <dd>
                <code>{current.employmentNo}</code>
              </dd>
              <dt className="text-muted-foreground">Type / class</dt>
              <dd>
                {current.type} · {current.workerClassification}
              </dd>
              <dt className="text-muted-foreground">Hire date</dt>
              <dd>{fmtDate(current.hireDate)}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge>{current.status}</Badge>
              </dd>
              <dt className="text-muted-foreground">History</dt>
              <dd>
                <Link
                  href={`/employees/${employee.id}/employment`}
                  className="text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  View employment history →
                </Link>
              </dd>
            </dl>
          ) : (
            <EmptyState title="No employment yet" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current assignment</CardTitle>
          <CardDescription>The open effective-dated placement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {openAssignment ? (
            <dl className="grid grid-cols-[10rem_1fr] gap-y-2">
              <dt className="text-muted-foreground">Effective from</dt>
              <dd>{fmtDate(openAssignment.effectiveFrom)}</dd>
              <dt className="text-muted-foreground">Position</dt>
              <dd>{openAssignment.positionId ? "Assigned" : "—"}</dd>
              <dt className="text-muted-foreground">Details</dt>
              <dd>
                <Link
                  href={`/employees/${employee.id}/assignments`}
                  className="text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  View assignments →
                </Link>
              </dd>
            </dl>
          ) : (
            <EmptyState
              title="No open assignment"
              description="This employee has no current placement. Create one from the Assignments tab."
            />
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Audit history</CardTitle>
            <CardDescription>
              Every material change to this record is audited (ADR-005).
            </CardDescription>
          </div>
          <AuditHistoryButton
            organizationId={organizationId}
            resourceType="Employee"
            resourceId={employee.id}
          />
        </CardHeader>
      </Card>
    </div>
  );
}
