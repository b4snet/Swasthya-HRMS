import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { callerFromUser } from "@/modules/organization/service/caller";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { DepartmentsClient } from "./departments-client";

export const metadata: Metadata = { title: "Departments" };

/**
 * Server wrapper: resolves the active organization server-side and hands the
 * id to the client composition. Every data access re-checks scope.
 */
export default async function DepartmentsPage() {
  const user = await requireUser();
  // CRUD surface: server-side least-privilege gate on org:manage (mirrors
  // WithActiveOrg; services remain the authoritative boundary).
  if (!rolesHavePermission(user.systemRoles, PERMISSIONS.ORG_MANAGE)) {
    return (
      <PermissionDeniedState message="Organization management requires the org:manage capability." />
    );
  }
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
  return <DepartmentsClient organizationId={active.id} />;
}
