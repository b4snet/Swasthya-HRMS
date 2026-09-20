import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { callerFromUser } from "@/modules/organization/service/caller";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { PositionsClient } from "./positions-client";

export const metadata: Metadata = { title: "Positions" };

export default async function PositionsPage() {
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
  return <PositionsClient organizationId={active.id} />;
}
