import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumb";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, PermissionDeniedState } from "@/components/ui/states";
import { truncate } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };

interface AuditRow {
  id: string;
  action: string;
  resourceType: string;
  actorEmail: string | null;
  occurredAt: string;
  ip: string | null;
}

const columns: Array<Column<AuditRow>> = [
  {
    key: "occurredAt",
    header: "When",
    sortable: true,
    render: (row) => <span className="whitespace-nowrap">{formatDate(row.occurredAt)}</span>,
  },
  {
    key: "action",
    header: "Action",
    sortable: true,
    render: (r) => <code className="text-2xs">{r.action}</code>,
  },
  { key: "resourceType", header: "Resource", sortable: true },
  {
    key: "actorEmail",
    header: "Actor",
    sortable: true,
    render: (r) => truncate(r.actorEmail ?? "system", 40),
  },
  {
    key: "ip",
    header: "IP",
    render: (r) => <span className="font-mono text-2xs">{r.ip ?? "—"}</span>,
  },
];

export default async function AuditPage() {
  const all = await requirePermission(PERMISSIONS.AUDIT_READ_ALL);
  const own = await requirePermission(PERMISSIONS.AUDIT_READ_OWN);

  if (!all.ok && !own.ok) {
    return <PermissionDeniedState />;
  }

  const scopeAll = all.ok;
  const user = scopeAll ? all.user : own.user!;

  const events = await prisma.auditEvent.findMany({
    where: scopeAll ? { tenantId: user.tenantId } : { actorUserId: user.id },
    orderBy: { occurredAt: "desc" },
    take: 100,
  });

  const rows: AuditRow[] = events.map((e) => ({
    id: e.id,
    action: e.action,
    resourceType: e.resourceType,
    actorEmail: e.actorEmail,
    occurredAt: e.occurredAt.toISOString(),
    ip: e.ip,
  }));

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Swasthya HRMS", href: "/dashboard" },
          { label: scopeAll ? "Audit log" : "My activity" },
        ]}
      />
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          {scopeAll ? "Audit log" : "My activity"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {scopeAll
            ? "Tenant-wide audit trail. Append-only; entries can never be edited or removed."
            : "Your own audited actions across the system."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
          <CardDescription>
            Showing the most recent {rows.length} event{rows.length === 1 ? "" : "s"}.
            WHO/WHAT/WHEN/WHERE with redacted payloads per privacy policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="No audit events yet"
              description={
                scopeAll
                  ? "Events appear here as users sign in and perform actions."
                  : "Sign in activity and your actions will appear here."
              }
            />
          ) : (
            <DataTable
              caption="Audit events"
              columns={columns}
              rows={rows}
              getRowKey={(r) => r.id}
              getSortValue={(r, key) =>
                key === "occurredAt" ? r.occurredAt : String(r[key as keyof AuditRow] ?? "")
              }
              emptyState={<EmptyState title="No events" />}
            />
          )}
        </CardContent>
      </Card>

      <p className="text-2xs text-muted-foreground">
        Retention and privacy handling are defined in docs/compliance/privacy.md.
        {scopeAll
          ? " Viewing tenant-wide audit data is itself access-logged at the DB level in Phase 13."
          : null}
      </p>
      {!scopeAll ? <Badge variant={statusVariant("ACTIVE")}>Read-only view</Badge> : null}
    </div>
  );
}
