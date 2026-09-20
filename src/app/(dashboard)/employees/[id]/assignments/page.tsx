import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { getEmployeeProfile } from "@/modules/workforce/service/roster-service";
import { listAssignments } from "@/modules/workforce/service/employee-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import {
  EmptyState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
} from "@/components/ui/states";
import { AssignmentsClient } from "./assignments-client";

export const metadata: Metadata = { title: "Assignments" };

export default async function AssignmentsPage({ params }: { params: Promise<{ id: string }> }) {
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

  try {
    const profile = await getEmployeeProfile(callerFromUser(user), organizationId, id);
    // The primary employment carries the assignment timeline (single-
    // employment records are the Phase 2 norm; multi-employment shows the
    // latest by hire date).
    const employment = profile.employments[0];
    const assignments = employment
      ? await listAssignments(callerFromUser(user), organizationId, employment.id)
      : [];
    return (
      <AssignmentsClient
        organizationId={organizationId}
        employeeId={profile.employee.id}
        employmentId={employment?.id ?? null}
        assignments={assignments.map((a) => ({
          id: a.id,
          effectiveFrom: a.effectiveFrom.toISOString(),
          effectiveTo: a.effectiveTo ? a.effectiveTo.toISOString() : null,
          open: a.open,
          positionId: a.positionId,
        }))}
      />
    );
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
}
