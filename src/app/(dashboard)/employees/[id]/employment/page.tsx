import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { getEmployeeProfile } from "@/modules/workforce/service/roster-service";
import { WorkforceAppError } from "@/modules/workforce/service/app-errors";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import {
  EmptyState,
  ErrorState,
  NotFoundState,
  PermissionDeniedState,
} from "@/components/ui/states";
import { EmploymentClient } from "./employment-client";

export const metadata: Metadata = { title: "Employment" };

export default async function EmploymentPage({ params }: { params: Promise<{ id: string }> }) {
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
    return <EmploymentClient organizationId={organizationId} employments={profile.employments} />;
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
