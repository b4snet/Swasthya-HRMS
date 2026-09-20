import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Building2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { requirePermission, requireUser } from "@/lib/auth/session";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { listCredentialsNearingExpiry } from "@/modules/credentials/service/credential-actions";
import { listEmployeesInReach } from "@/modules/workforce/service/roster-service";
import {
  callerFromUser as orgCallerFromUser,
} from "@/modules/organization/service/caller";
import {
  callerFromUser as workforceCallerFromUser,
} from "@/modules/workforce/service/caller";
import { listAccessibleOrganizations } from "@/modules/organization/service/queries";
import { PageHeader } from "@/components/layout/page-header";
import { roleLabel } from "@/components/layout/shell-types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

interface AlertRow {
  id: string;
  name: string;
  type: string;
  expiresOn: string | null;
  derivedStatus: string;
}

export default async function DashboardPage() {
  const user = await requireUser();
  const roles = user.systemRoles;

  let orgCount: number | null = null;
  let empCount: number | null = null;
  if (rolesHavePermission(roles, PERMISSIONS.ORG_READ)) {
    try {
      const orgs = await listAccessibleOrganizations(orgCallerFromUser(user));
      orgCount = orgs.length;
      let sum = 0;
      for (const org of orgs) {
        sum += (await listEmployeesInReach(workforceCallerFromUser(user), org.id)).length;
      }
      empCount = sum;
    } catch {
      // stats degrade to "—" when reach cannot be resolved
    }
  } else if (user.organizationId) {
    try {
      empCount = (await listEmployeesInReach(workforceCallerFromUser(user), user.organizationId))
        .length;
    } catch {
      empCount = null;
    }
  }

  let expiringCount: number | null = null;
  let expiredCount: number | null = null;
  let alerts: AlertRow[] = [];
  if (rolesHavePermission(roles, PERMISSIONS.EMPLOYEE_READ)) {
    try {
      const rows = await listCredentialsNearingExpiry(workforceCallerFromUser(user), {});
      expiredCount = rows.filter((r) => r.derivedStatus === "EXPIRED").length;
      expiringCount = rows.length - expiredCount;
      alerts = rows
        .slice(0, 6)
        .map((r) => ({
          id: r.id,
          name: r.name,
          type: r.type,
          expiresOn: r.expiresOn ? r.expiresOn.toISOString() : null,
          derivedStatus: r.derivedStatus,
        }));
    } catch {
      // alert tile degrades to "—"
    }
  }

  let auditRows: Array<{
    id: string;
    action: string;
    resourceType: string;
    actorEmail: string | null;
    occurredAt: string;
  }> = [];
  let auditScope: "all" | "own" | null = null;
  try {
    const all = await requirePermission(PERMISSIONS.AUDIT_READ_ALL);
    const own = await requirePermission(PERMISSIONS.AUDIT_READ_OWN);
    if (all.ok || own.ok) {
      auditScope = all.ok ? "all" : "own";
      const auditUser = all.ok ? all.user! : own.user!;
      const events = await prisma.auditEvent.findMany({
        where: auditScope === "all" ? { tenantId: auditUser.tenantId } : { actorUserId: auditUser.id },
        orderBy: { occurredAt: "desc" },
        take: 8,
      });
      auditRows = events.map((e) => ({
        id: e.id,
        action: e.action,
        resourceType: e.resourceType,
        actorEmail: e.actorEmail,
        occurredAt: e.occurredAt.toISOString(),
      }));
    }
  } catch {
    auditRows = [];
  }

  const quickActions: Array<{ label: string; href: string; icon: typeof Users; show: boolean }> = [
    {
      label: "Add employee",
      href: "/employees/new",
      icon: UserCog,
      show: rolesHavePermission(roles, PERMISSIONS.EMPLOYEE_MANAGE),
    },
    {
      label: "Organization",
      href: "/organization",
      icon: Building2,
      show: rolesHavePermission(roles, PERMISSIONS.ORG_READ),
    },
    {
      label: "Expiring & expired",
      href: "/employees/expiry",
      icon: ShieldAlert,
      show: rolesHavePermission(roles, PERMISSIONS.EMPLOYEE_READ),
    },
    {
      label: "Audit log",
      href: "/admin/audit",
      icon: ShieldCheck,
      show: rolesHavePermission(roles, PERMISSIONS.AUDIT_READ_ALL),
    },
    {
      label: "System health",
      href: "/settings/system",
      icon: Activity,
      show: rolesHavePermission(roles, PERMISSIONS.SYSTEM_ADMIN),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 lg:px-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${user.name}. Signed in as ${user.email} · ${roleLabel(roles)}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organizations"
          value={orgCount ?? "—"}
          icon={Building2}
          tone="info"
          href={orgCount ? "/organization" : undefined}
          helper={orgCount ? "in your reach" : "no org scope"}
        />
        <StatCard
          label="Employees in reach"
          value={empCount ?? "—"}
          icon={Users}
          tone="primary"
          href={empCount ? "/employees" : undefined}
          helper={empCount ? "active roster" : "no roster reach"}
        />
        <StatCard
          label="Expiring credentials"
          value={expiringCount ?? "—"}
          icon={ShieldAlert}
          tone="warning"
          href={expiringCount ? "/employees/expiry" : undefined}
          helper={expiringCount ? "inside renewal window" : "none in window"}
        />
        <StatCard
          label="Expired credentials"
          value={expiredCount ?? "—"}
          icon={ShieldAlert}
          tone="destructive"
          href={expiredCount ? "/employees/expiry" : undefined}
          helper={expiredCount ? "need immediate action" : "none expired"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section aria-labelledby="attention-heading" className="space-y-6 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            {quickActions.filter((a) => a.show).map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted hover:shadow-card"
              >
                <action.icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {action.label}
              </Link>
            ))}
          </div>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle id="attention-heading">Needs attention</CardTitle>
                <CardDescription>
                  Credentials inside their renewal window or already expired in your reach.
                </CardDescription>
              </div>
              <Link
                href="/employees/expiry"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View all <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent>
              {alerts.length === 0 ? (
                <EmptyState
                  title="All clear"
                  description="No credentials need attention right now."
                />
              ) : (
                <ul className="divide-y divide-border">
                  {alerts.map((alert) => (
                    <li key={alert.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{alert.name}</p>
                        <p className="text-2xs text-muted-foreground">
                          {alert.type} · {alert.expiresOn ? formatDate(alert.expiresOn) : "—"}
                        </p>
                      </div>
                      <Badge variant={alert.derivedStatus === "EXPIRED" ? "destructive" : "warning"}>
                        {alert.derivedStatus === "EXPIRED" ? "EXPIRED" : "EXPIRING"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>
                {auditScope === "all"
                  ? "Latest events across the tenant."
                  : auditScope === "own"
                    ? "Your latest audited actions."
                    : "Audit access is not granted for this account."}
              </CardDescription>
            </div>
            {auditScope ? (
              <Link
                href="/admin/audit"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            ) : null}
          </CardHeader>
          <CardContent>
            {auditRows.length === 0 ? (
              <EmptyState
                title={auditScope ? "No activity yet" : "Restricted"}
                description={
                  auditScope
                    ? "Audited events will appear here as they happen."
                    : "This account does not hold audit-read access."
                }
              />
            ) : (
              <ol className="space-y-4">
                {auditRows.map((event) => (
                  <li key={event.id} className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/40"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        <code className="text-2xs font-medium">{event.action}</code>{" "}
                        <span className="text-muted-foreground">on {event.resourceType}</span>
                      </p>
                      <p className="truncate text-2xs text-muted-foreground">
                        {event.actorEmail ?? "system"} · {formatDate(event.occurredAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Plus aria-hidden="true" className="size-3" />
        Stats reflect your server-side data reach (ABAC) at page load.
      </p>
    </div>
  );
}