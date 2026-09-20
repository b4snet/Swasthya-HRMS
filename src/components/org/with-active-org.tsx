import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { callerFromUser } from "@/modules/organization/service/caller";
import { listAccessibleOrganizations, OrgQueryError } from "@/modules/organization/service/queries";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import type { ReactNode } from "react";

/**
 * Server-side: resolve the caller's active organization and render children
 * with its id — or the canonical state (denied/error/empty) instead. Every
 * client data call re-verifies scope server-side; this only avoids copying
 * the same resolution block into ten page files.
 *
 * Least privilege (Phase 3 release gate): this helper backs the org CRUD
 * surfaces, so it gates on `org:manage` server-side. Read-only overview /
 * structure pages do NOT use this helper (they stay on `org:read`). Plain
 * employees — who hold `org:read` — get the permission-denied state on
 * direct URL access instead of management chrome; the services behind the
 * clients remain the authoritative boundary.
 */
export async function WithActiveOrg({
  children,
}: {
  children: (organizationId: string) => ReactNode;
}) {
  const user = await requireUser();
  if (!rolesHavePermission(user.systemRoles, PERMISSIONS.ORG_MANAGE)) {
    return <PermissionDeniedState message="Organization management requires the org:manage capability." />;
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
  return <>{children(active.id)}</>;
}
