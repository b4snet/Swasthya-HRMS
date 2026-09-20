import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { NewEmployeeClient } from "./new-employee-client";

export const metadata: Metadata = { title: "New employee" };

export default async function NewEmployeePage() {
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
  return <NewEmployeeClient organizationId={active.id} />;
}
