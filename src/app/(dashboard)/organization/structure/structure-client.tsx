"use client";

import * as React from "react";
import { getStructureViewAction } from "@/modules/organization/api/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorState, PermissionDeniedState, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

type View =
  Awaited<ReturnType<typeof getStructureViewAction>> extends { data?: infer D } ? D : never;

interface Node {
  id: string;
  code: string;
  name: string;
  status: string;
  parentId: string | null;
  type?: string;
}

function buildForest(
  rows: Node[],
): Array<{ node: Node; children: Node[]; depth: number; orphaned: boolean }> {
  const byParent = new Map<string, Node[]>();
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows) {
    // Orphaned (parent missing) or cyclic nodes are surfaced as roots with a
    // warning rather than silently disappearing from the chart.
    const key = r.parentId === null || !ids.has(r.parentId) ? "__root__" : r.parentId;
    const list = byParent.get(key) ?? [];
    list.push(r);
    byParent.set(key, list);
  }
  const out: Array<{ node: Node; children: Node[]; depth: number; orphaned: boolean }> = [];
  const visit = (parentKey: string, depth: number, seen: Set<string>) => {
    for (const node of byParent.get(parentKey) ?? []) {
      if (seen.has(node.id)) continue; // cycle guard: render each node once
      seen.add(node.id);
      out.push({
        node,
        children: (byParent.get(node.id) ?? []).filter((c) => !seen.has(c.id)),
        depth,
        orphaned: node.parentId !== null && !rows.some((r) => r.id === node.parentId),
      });
      visit(node.id, depth + 1, seen);
    }
  };
  visit("__root__", 0, new Set());
  return out;
}

/** One hierarchical list; nested <ul>/<li> is the screen-reader-native tree. */
function TreePanel({
  title,
  description,
  rows,
  renderLabel,
}: {
  title: string;
  description: string;
  rows: Node[];
  renderLabel?: (n: Node) => string;
}) {
  const flat = buildForest(rows);
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xs text-muted-foreground">None defined yet.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-0.5" role="list">
          {flat.map(({ node, children, depth, orphaned }) => (
            <li
              key={node.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded px-2 py-1",
                depth > 0 && "border-l-2 border-border",
              )}
              style={{ marginLeft: `${depth * 1.25}rem` }}
            >
              <span className="text-sm font-medium">
                {renderLabel ? renderLabel(node) : node.name}
              </span>
              <code className="text-2xs text-muted-foreground">{node.code}</code>
              {node.type ? <Badge variant="neutral">{node.type}</Badge> : null}
              {node.status !== "ACTIVE" ? <Badge variant="info">{node.status}</Badge> : null}
              {orphaned ? <Badge variant="warning">parent missing</Badge> : null}
              {children.length > 0 ? (
                <span className="text-2xs text-muted-foreground">
                  ({children.length} {children.length === 1 ? "child" : "children"})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function StructureClient({ organizationId }: { organizationId: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "denied" | "error">("loading");
  const [view, setView] = React.useState<View | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    getStructureViewAction(organizationId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setView(res.data ?? null);
        setState("ready");
      } else if (res.error?.code === "AUTHORIZATION_DENIED") setState("denied");
      else setState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, reloadKey]);

  if (state === "loading") return <LoadingState label="Loading structure…" />;
  if (state === "denied") return <PermissionDeniedState />;
  if (state === "error" || !view) return <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />;

  const activeEdges = view.reportingEdges.filter((e) => !e.effectiveTo && e.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <section aria-labelledby="structural-heading" className="space-y-3">
        <h2 id="structural-heading" className="text-sm font-semibold">
          Structural hierarchy
        </h2>
        <p className="max-w-prose text-2xs text-muted-foreground">
          Business units, divisions, departments and teams form the structural trees. A position
          sits in exactly one department or team.
        </p>
        <div className="grid gap-4 xl:grid-cols-2">
          <TreePanel
            title="Org units"
            description="Business units and divisions."
            rows={view.orgUnits.map((o) => ({
              id: o.id,
              code: o.code,
              name: o.name,
              status: o.status,
              parentId: o.parentId,
              type: o.type,
            }))}
            renderLabel={(n) => `${n.name} (${n.type === "BUSINESS_UNIT" ? "BU" : "Division"})`}
          />
          <TreePanel
            title="Departments"
            description="Organizational units; teams may attach to a department."
            rows={view.departments.map((d) => ({
              id: d.id,
              code: d.code,
              name: d.name,
              status: d.status,
              parentId: d.parentId,
            }))}
          />
          <TreePanel
            title="Teams"
            description="Subdivisions/groups within the structure."
            rows={view.teams.map((t) => ({
              id: t.id,
              code: t.code,
              name: t.name,
              status: t.status,
              parentId: t.parentId,
            }))}
          />
        </div>
      </section>

      <section aria-labelledby="reporting-heading" className="space-y-3">
        <h2 id="reporting-heading" className="text-sm font-semibold">
          Reporting relationships
        </h2>
        <p className="max-w-prose text-2xs text-muted-foreground">
          Distinct from structure: position-to-position lines with type PRIMARY, SECONDARY or
          MATRIX, effective-dated and closable without deleting history.
        </p>
        {view.reportingEdges.length === 0 ? (
          <Card>
            <CardContent className="pt-5">
              <p className="text-2xs text-muted-foreground">No reporting relationships recorded.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-5">
              <ul role="list" className="space-y-1.5">
                {view.reportingEdges.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center gap-2 rounded px-2 py-1 text-sm"
                  >
                    <span>
                      <code className="text-2xs">{e.sourceCode}</code> {e.sourceTitle ?? ""}
                    </span>
                    <span aria-hidden="true" className="text-muted-foreground">
                      →
                    </span>
                    <span className="sr-only">reports to</span>
                    <span>
                      <code className="text-2xs">{e.targetCode}</code> {e.targetTitle ?? ""}
                    </span>
                    <Badge
                      variant={
                        e.type === "PRIMARY" ? "info" : e.type === "MATRIX" ? "warning" : "neutral"
                      }
                    >
                      {e.type}
                    </Badge>
                    {e.effectiveTo || e.status !== "ACTIVE" ? (
                      <Badge variant="info">{e.effectiveTo ? "CLOSED" : e.status}</Badge>
                    ) : null}
                    <span className="text-2xs text-muted-foreground">
                      {new Date(e.effectiveFrom).toLocaleDateString()}
                      {e.effectiveTo
                        ? ` – ${new Date(e.effectiveTo).toLocaleDateString()}`
                        : " – open"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-muted-foreground">
                {activeEdges.length} active of {view.reportingEdges.length} total.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="counts-heading" className="space-y-3">
        <h2 id="counts-heading" className="text-sm font-semibold">
          Composition
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="list">
          {[
            ["Positions", view.counts.positions],
            ["Designations", view.counts.designations],
            ["Grades", view.counts.grades],
            ["Job families", view.counts.jobFamilies],
            ["Cost centers", view.counts.costCenters],
            ["Facilities", view.counts.facilities],
          ].map(([label, count]) => (
            <li key={String(label)} className="rounded-lg border border-border bg-background p-4">
              <p className="text-2xl font-bold tabular-nums">{count}</p>
              <p className="mt-1 text-2xs text-muted-foreground">{label}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
