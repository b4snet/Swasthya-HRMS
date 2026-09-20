import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { Breadcrumbs } from "@/components/ui/breadcrumb";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PermissionDeniedState } from "@/components/ui/states";

export const metadata: Metadata = { title: "System health" };

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started, error: "Database unreachable" };
  }
}

export default async function SystemHealthPage() {
  const check = await requirePermission(PERMISSIONS.SYSTEM_ADMIN);
  if (!check.ok) {
    return <PermissionDeniedState />;
  }
  const user = check.user;

  const db = await checkDatabase();
  const [sessionCount, auditCount, userCount] = await Promise.all([
    db.ok
      ? prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } })
      : null,
    db.ok ? prisma.auditEvent.count() : null,
    db.ok ? prisma.user.count({ where: { tenantId: user.tenantId } }) : null,
  ]);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Swasthya HRMS", href: "/dashboard" },
          { label: "Settings" },
          { label: "System health" },
        ]}
      />
      <div>
        <h1 className="text-xl font-bold tracking-tight">System health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Local verification surface for the Phase 0 platform slice.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>PostgreSQL connectivity via Prisma</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="flex items-center gap-2 text-sm">
              <Badge variant={db.ok ? statusVariant("ACTIVE") : statusVariant("REJECTED")}>
                {db.ok ? "CONNECTED" : "UNREACHABLE"}
              </Badge>
              <span className="text-2xs text-muted-foreground">{db.latencyMs} ms</span>
            </p>
            {db.error ? <p className="text-2xs text-destructive">{db.error}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Environment</CardTitle>
            <CardDescription>Runtime configuration summary</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1.5 text-2xs">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">NODE_ENV</dt>
                <dd className="font-medium">{process.env.NODE_ENV}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">MFA enforcement</dt>
                <dd className="font-medium">
                  {process.env.FEATURE_MFA === "true" ? "enabled" : "disabled (Phase 0)"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Audit fail-closed</dt>
                <dd className="font-medium">
                  {process.env.AUDIT_FAIL_CLOSED === "false" ? "disabled" : "enabled"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Rate limiter</dt>
                <dd className="font-medium">in-memory (single process)</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active sessions</CardTitle>
            <CardDescription>Tenant-wide, non-revoked, unexpired</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{sessionCount ?? "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenant data</CardTitle>
            <CardDescription>Users and audit volume</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p>
              Users: <span className="font-semibold">{userCount ?? "—"}</span>
            </p>
            <p>
              Audit events: <span className="font-semibold">{auditCount ?? "—"}</span>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
