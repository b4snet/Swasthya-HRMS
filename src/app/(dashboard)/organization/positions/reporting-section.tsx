"use client";

import * as React from "react";
import { getPositionsAction, getReportingEdgesAction } from "@/modules/organization/api/queries";
import {
  createReportingEdgeAction,
  closeReportingEdgeAction,
} from "@/modules/organization/api/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TableToolbar } from "@/components/org/table-toolbar";
import { CrudDialog, type FieldDef } from "@/components/org/crud-dialog";
import { StatusBadge } from "@/components/org/status-actions";
import { useQueryData } from "@/components/org/use-query-data";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";

type EdgeRow =
  Awaited<ReturnType<typeof getReportingEdgesAction>> extends { data?: infer D }
    ? D extends (infer R)[] | undefined
      ? R
      : never
    : never;

/**
 * Reporting relationships between POSITIONS (ADR-009) — deliberately
 * separate from the structural trees. PRIMARY cycles are rejected by the
 * server; MATRIX edges are exempt.
 */
export function ReportingSection({ organizationId }: { organizationId: string }) {
  const [reload, setReload] = React.useState(0);
  const positions = useQueryData(getPositionsAction, organizationId, ["VACANT", "FILLED"]);

  const posOpts = (positions ?? []).map((p) => ({
    value: p.id,
    label: `${p.code}${p.title ? ` — ${p.title}` : ""}`,
  }));

  const fields: FieldDef[] = [
    {
      name: "sourcePositionId",
      label: "Subordinate position",
      type: "select",
      required: true,
      options: [{ value: "", label: "— select position —" }, ...posOpts],
      description: "The position that reports to the lead.",
    },
    {
      name: "targetPositionId",
      label: "Lead position (reports to)",
      type: "select",
      required: true,
      options: [{ value: "", label: "— select position —" }, ...posOpts],
    },
    {
      name: "type",
      label: "Relationship type",
      type: "select",
      required: true,
      options: [
        { value: "PRIMARY", label: "Primary (solid line)" },
        { value: "SECONDARY", label: "Secondary (dotted line)" },
        { value: "MATRIX", label: "Matrix (cross-functional)" },
      ],
      description: "Primary chains may not form cycles; matrix edges are exempt.",
    },
    { name: "effectiveFrom", label: "Effective from", type: "date" },
  ];

  return (
    <section aria-labelledby="reporting-heading" className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle id="reporting-heading" className="text-sm">
            Reporting relationships
          </CardTitle>
          <CardDescription>
            Who reports to whom — modeled between positions, independent of the structural trees
            (departments/teams). Closing an edge keeps history; it is never deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EdgesTable
            key={reload}
            organizationId={organizationId}
            fields={fields}
            onSaved={() => setReload((r) => r + 1)}
            onClosed={() => setReload((r) => r + 1)}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function EdgesTable({
  organizationId,
  fields,
  onSaved,
  onClosed,
}: {
  organizationId: string;
  fields: FieldDef[];
  onSaved: () => void;
  onClosed: () => void;
}) {
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "denied" | "error">("loading");
  const [rows, setRows] = React.useState<EdgeRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    getReportingEdgesAction(organizationId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRows(res.data ?? []);
        setState("ready");
      } else if (res.error?.code === "AUTHORIZATION_DENIED") setState("denied");
      else setState("error");
    });
    return () => {
      cancelled = true;
    };
    // onSaved excluded: the parent remounts this table (key=reload) after a
    // create, which already refetches; adding it would double-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, reloadKey]);

  if (state === "loading")
    return <p className="p-4 text-2xs text-muted-foreground">Loading reporting relationships…</p>;
  if (state === "denied")
    return (
      <p className="text-2xs text-warning">
        You don&apos;t have permission to view reporting relationships.
      </p>
    );
  if (state === "error")
    return (
      <div className="space-y-2">
        <p className="text-2xs text-destructive">Reporting relationships could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </Button>
      </div>
    );

  return (
    <TableToolbar<EdgeRow>
      columns={[
        {
          key: "source",
          header: "Position",
          render: (r) => (
            <span>
              <code className="text-2xs">{r.sourcePosition.code}</code>{" "}
              {r.sourcePosition.title ?? ""}
            </span>
          ),
        },
        {
          key: "reportsTo",
          header: "Reports to",
          render: (r) => (
            <span>
              <code className="text-2xs">{r.targetPosition.code}</code>{" "}
              {r.targetPosition.title ?? ""}
            </span>
          ),
        },
        {
          key: "type",
          header: "Type",
          sortable: true,
          render: (r) => (
            <Badge
              variant={r.type === "PRIMARY" ? "info" : r.type === "MATRIX" ? "warning" : "neutral"}
            >
              {r.type}
            </Badge>
          ),
        },
        {
          key: "status",
          header: "Status",
          sortable: true,
          render: (r) => <StatusBadge status={r.status} />,
        },
        {
          key: "period",
          header: "Effective",
          render: (r) => (
            <span className="whitespace-nowrap text-2xs">
              {new Date(r.effectiveFrom).toLocaleDateString()} –{" "}
              {r.effectiveTo ? new Date(r.effectiveTo).toLocaleDateString() : "open"}
            </span>
          ),
        },
        {
          key: "actions",
          header: "Actions",
          className: "text-right",
          render: (r) =>
            r.effectiveTo || r.status === "ARCHIVED" ? null : (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const res = await closeReportingEdgeAction({ organizationId, id: r.id });
                  if (res.ok) {
                    onClosed();
                  } else {
                    toast({
                      title:
                        res.error?.code === "AUTHORIZATION_DENIED"
                          ? "Permission denied"
                          : "Action failed",
                      description: res.error?.message,
                      variant: "error",
                    });
                  }
                }}
              >
                Close
              </Button>
            ),
        },
      ]}
      rows={rows}
      getRowKey={(r) => r.id}
      searchValues={(r) => [
        r.sourcePosition.code,
        r.sourcePosition.title ?? "",
        r.targetPosition.code,
        r.targetPosition.title ?? "",
        r.type,
      ]}
      caption="Reporting relationships"
      actions={
        <CrudDialog
          organizationId={organizationId}
          title="New reporting relationship"
          triggerLabel="New relationship"
          fields={fields}
          action={createReportingEdgeAction}
          onSuccess={onSaved}
        />
      }
    />
  );
}
