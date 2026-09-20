import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS, SYSTEM_ROLES } from "@/lib/auth/rbac";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();

  const cards: Array<{ title: string; description: string; href?: string }> = [];

  if (rolesHavePermission(user.systemRoles, PERMISSIONS.SYSTEM_ADMIN)) {
    cards.push({
      title: "System health",
      description: "Database connectivity, session counts, service status.",
      href: "/settings/system",
    });
  }
  if (rolesHavePermission(user.systemRoles, PERMISSIONS.AUDIT_READ_ALL)) {
    cards.push({
      title: "Audit log",
      description: "Every security-relevant action with who/what/when/where.",
      href: "/admin/audit",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome back, {user.name}.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your access</CardTitle>
          <CardDescription>
            Role capabilities and data reach, resolved server-side from your session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {user.systemRoles.map((role) => (
              <li key={role} className="flex items-center gap-2">
                <Badge variant={role === SYSTEM_ROLES.SUPER_ADMIN ? "success" : "neutral"}>
                  {role.replace("SYSTEM_ROLE_", "")}
                </Badge>
              </li>
            ))}
            <li className="text-2xs text-muted-foreground">
              Data scopes are checked per-resource by services (ABAC). Phase 0 grants reach over
              your own records only.
              {user.organizationId
                ? " Organization scope: granted."
                : " No organization scope yet."}
            </li>
          </ul>
        </CardContent>
      </Card>

      <section aria-labelledby="quick-links-heading">
        <h2 id="quick-links-heading" className="mb-3 text-sm font-semibold">
          Quick links
        </h2>
        {cards.length === 0 ? (
          <EmptyState
            title="No additional modules yet"
            description="Phase 1 will add organization and employee management. You'll see your available modules here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((card) => (
              <a
                key={card.href}
                href={card.href}
                className="rounded-lg border border-border p-4 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <p className="text-sm font-semibold">{card.title}</p>
                <p className="mt-1 text-2xs text-muted-foreground">{card.description}</p>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
