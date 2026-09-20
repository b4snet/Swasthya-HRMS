"use client";

import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { formatDate, truncate } from "@/lib/utils";

export interface AuditEventRow {
  id: string;
  action: string;
  resourceType: string;
  actorEmail: string | null;
  occurredAt: string;
  ip: string | null;
}

const columns: Array<Column<AuditEventRow>> = [
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

export function AuditTable({ rows }: { rows: AuditEventRow[] }) {
  return (
    <DataTable
      caption="Audit events"
      columns={columns}
      rows={rows}
      getRowKey={(r) => r.id}
      getSortValue={(r, key) =>
        key === "occurredAt" ? r.occurredAt : String(r[key as keyof AuditEventRow] ?? "")
      }
      emptyState={<EmptyState title="No events" />}
    />
  );
}