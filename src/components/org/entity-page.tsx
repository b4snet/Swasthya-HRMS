"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { TableToolbar } from "@/components/org/table-toolbar";
import { CrudDialog, type FieldDef } from "@/components/org/crud-dialog";
import { StatusActions, AuditHistoryButton, StatusBadge } from "@/components/org/status-actions";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import type { Column } from "@/components/ui/data-table";
import type { OrgActionResult } from "@/modules/organization/api/actions";
import type { QueryResult } from "@/modules/organization/api/queries";

export interface EntityPageProps<Row> {
  organizationId: string;
  /** Load rows via the scoped read action. */
  load: () => Promise<QueryResult<Row[]>>;
  getRowKey: (row: Row) => string;
  getRowStatus: (row: Row) => string;
  getRowVersion: (row: Row) => number;
  columns: Array<Column<Row>>;
  searchValues: (row: Row) => string[];
  caption: string;
  entityLabel: string;
  resourceType: string;
  statusOptions: string[];
  createFields: FieldDef[];
  createAction: (input: Record<string, unknown>) => Promise<OrgActionResult<unknown>>;
  editFields?: (row: Row) => FieldDef[];
  editAction?: (input: Record<string, unknown>) => Promise<OrgActionResult<unknown>>;
  hiddenCreate?: Record<string, string>;
  statusActions?: {
    onActivate: (input: {
      organizationId: string;
      id: string;
    }) => Promise<OrgActionResult<unknown>>;
    onDeactivate: (input: {
      organizationId: string;
      id: string;
    }) => Promise<OrgActionResult<unknown>>;
    onArchive: (input: { organizationId: string; id: string }) => Promise<OrgActionResult<unknown>>;
  };
  terminalStatuses?: string[];
  /** Domain-appropriate lifecycle labels (e.g. positions: Mark filled). */
  statusLabels?: { activate?: string; deactivate?: string; archive?: string };
  exportColumns?: Array<{ key: string; header: string; value: (row: Row) => string | number }>;
  extraColumns?: (helpers: EntityHelpers<Row>) => Array<Column<Row>>;
  emptyHint?: string;
}

export interface EntityHelpers<Row> {
  statusCell: (row: Row) => React.ReactNode;
  actionsCell: (row: Row) => React.ReactNode;
}

/**
 * Full lifecycle entity page. All six canonical states are handled: loading
 * (skeleton), empty, error with retry, permission denied (server denies the
 * read), validation errors in dialogs, success via toast + refresh.
 */
export function EntityPage<Row>(props: EntityPageProps<Row>) {
  const router = useRouter();
  const [state, setState] = React.useState<"loading" | "ready" | "denied" | "error">("loading");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState("ALL");

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    props
      .load()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows(res.data ?? []);
          setState("ready");
        } else if (res.error?.code === "AUTHORIZATION_DENIED") {
          setState("denied");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.organizationId, reloadKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  if (state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <p className="sr-only">Loading {props.entityLabel.toLowerCase()}…</p>
      </div>
    );
  }
  if (state === "denied") {
    return <PermissionDeniedState />;
  }
  if (state === "error") {
    return <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  const helpers: EntityHelpers<Row> = {
    statusCell: (row) => <StatusBadge status={props.getRowStatus(row)} />,
    actionsCell: (row) => (
      <div className="flex flex-wrap items-center justify-end gap-1">
        <AuditHistoryButton
          organizationId={props.organizationId}
          resourceType={props.resourceType}
          resourceId={props.getRowKey(row)}
        />
        {props.editFields && props.editAction ? (
          <CrudDialog
            organizationId={props.organizationId}
            title={`Edit ${props.entityLabel.toLowerCase()}`}
            triggerLabel="Edit"
            triggerVariant="ghost"
            triggerIcon="pencil"
            fields={props.editFields(row)}
            initial={row as unknown as Record<string, string | number | null | undefined>}
            editId={props.getRowKey(row)}
            editVersion={props.getRowVersion(row)}
            action={props.editAction}
            onSuccess={refresh}
          />
        ) : null}
        {props.statusActions ? (
          <StatusActions
            organizationId={props.organizationId}
            id={props.getRowKey(row)}
            status={props.getRowStatus(row)}
            version={props.getRowVersion(row)}
            terminal={(props.terminalStatuses ?? ["ARCHIVED"]).includes(props.getRowStatus(row))}
            onActivate={props.statusActions.onActivate}
            onDeactivate={props.statusActions.onDeactivate}
            onArchive={props.statusActions.onArchive}
            resourceType={props.resourceType}
            onChanged={refresh}
            activateLabel={props.statusLabels?.activate}
            deactivateLabel={props.statusLabels?.deactivate}
            archiveLabel={props.statusLabels?.archive}
          />
        ) : null}
      </div>
    ),
  };

  const columns: Array<Column<Row>> = [
    ...props.columns,
    ...(props.extraColumns ? props.extraColumns(helpers) : []),
  ];

  return (
    <section aria-label={props.entityLabel} className="space-y-4">
      <h2 className="sr-only">{props.entityLabel}</h2>
      <TableToolbar
        columns={columns}
        rows={rows}
        getRowKey={props.getRowKey}
        searchValues={props.searchValues}
        caption={props.caption}
        statusFilter={{
          label: "Status",
          options: props.statusOptions,
          value: statusFilter,
          onChange: setStatusFilter,
        }}
        exportColumns={props.exportColumns}
        defaultHiddenColumns={[]}
        emptyState={
          statusFilter === "ALL" ? (
            <EmptyState
              title={`No ${props.entityLabel.toLowerCase()} yet`}
              description={
                props.emptyHint ??
                `Create the first ${props.entityLabel.toLowerCase()} to get started.`
              }
              action={
                <CrudDialog
                  organizationId={props.organizationId}
                  title={`New ${props.entityLabel.toLowerCase()}`}
                  triggerLabel={`New ${props.entityLabel.toLowerCase()}`}
                  fields={props.createFields}
                  hidden={props.hiddenCreate}
                  action={props.createAction}
                  onSuccess={refresh}
                />
              }
            />
          ) : undefined
        }
        actions={
          <CrudDialog
            organizationId={props.organizationId}
            title={`New ${props.entityLabel.toLowerCase()}`}
            triggerLabel={`New ${props.entityLabel.toLowerCase()}`}
            fields={props.createFields}
            hidden={props.hiddenCreate}
            action={props.createAction}
            onSuccess={refresh}
          />
        }
      />
    </section>
  );
}
