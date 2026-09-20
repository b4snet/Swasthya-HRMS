import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { getEmployeeForManager } from "@/modules/workforce/service/roster-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import {
  EmptyState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
} from "@/components/ui/states";
import { StatusBadge } from "@/components/org/status-actions";
import { EmployeeSectionNav } from "../employee-section-nav";

/**
 * Employee detail layout. Resolves the employee through the manager-safe
 * read: outside the caller's derived reach the service raises NOT_FOUND, so
 * a guessed id renders "not found" — never an existence disclosure.
 */
export default async function EmployeeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  let orgs: Array<{ id: string; code: string; name: string; status: string }> = [];
  try {
    orgs = await listAccessibleOrganizations(callerFromUser(user));
  } catch (err) {
    if (err instanceof OrgQueryError) return <PermissionDeniedState />;
    return <ErrorState />;
  }
  const active = orgs.find((o) => o.id === user.organizationId) ?? orgs[0];
  if (!active) {
    return (
      <EmptyState
        title="No organizations in your scope"
        description="Ask your administrator for an organization scope, or seed demo data with `pnpm db:seed`."
      />
    );
  }

  let summary: Awaited<ReturnType<typeof getEmployeeForManager>>;
  try {
    summary = await getEmployeeForManager(callerFromUser(user), active.id, id);
  } catch (err) {
    if (err instanceof WorkforceAppError) {
      if (err.code === "NOT_FOUND") {
        return (
          <NotFoundState
            title="Employee not found"
            message="This employee does not exist or is outside your access reach."
          />
        );
      }
      if (err.code === "AUTHORIZATION_DENIED") return <PermissionDeniedState />;
    }
    return <ErrorState />;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight">
            {summary.firstName} {summary.lastName}
            {summary.preferredName ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({summary.preferredName})
              </span>
            ) : null}
          </h2>
          <StatusBadge status={summary.employmentStatus} />
        </div>
        <p className="text-2xs text-muted-foreground">
          Employee No. <code className="font-semibold">{summary.employeeNo}</code> ·{" "}
          {summary.employeeType}
        </p>
      </header>

      <EmployeeSectionNav employeeId={id} />

      <div>{children}</div>
    </div>
  );
}
