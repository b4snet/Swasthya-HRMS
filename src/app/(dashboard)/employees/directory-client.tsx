"use client";

import * as React from "react";
import Link from "next/link";
import { Plus, UserRound } from "lucide-react";
import { TableToolbar } from "@/components/org/table-toolbar";
import { StatusBadge } from "@/components/org/status-actions";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import type { Column } from "@/components/ui/data-table";
import { listEmployeesInReachAction } from "@/modules/workforce/api/queries";
import { useQueryData } from "@/components/org/use-query-data";
import { getWorkforceOrganizationsAction } from "@/modules/workforce/api/queries";

type EmployeeRow = {
  id: string;
  employeeNo: string;
  employeeType: string;
  employmentStatus: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
};

const STATUS_OPTIONS = [
  "ACTIVE",
  "PENDING_ONBOARDING",
  "SUSPENDED",
  "INACTIVE",
  "DRAFT",
  "TERMINATED",
  "RESIGNED",
  "RETIRED",
] as const;

/**
 * Employee directory. Rows come from listEmployeesInReachAction — the
 * SERVER decides membership (org/department/manager reach); the client
 * only narrows the already-authorized set with search/filters. A guessed
 * id cannot widen what is listed (computed membership, not client filters).
 */
export function DirectoryClient({ organizationId }: { organizationId: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "denied" | "error">("loading");
  const [rows, setRows] = React.useState<EmployeeRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [statusFilter, setStatusFilter] = React.useState("ALL");
  const orgs = useQueryData(getWorkforceOrganizationsAction);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    listEmployeesInReachAction(organizationId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows((res.data ?? []) as EmployeeRow[]);
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
  }, [organizationId, reloadKey]);

  if (state === "loading") {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
        <p className="sr-only">Loading employees…</p>
      </div>
    );
  }
  if (state === "denied") {
    return <PermissionDeniedState />;
  }
  if (state === "error") {
    return <ErrorState onRetry={() => setReloadKey((k) => k + 1)} />;
  }

  const columns: Array<Column<EmployeeRow>> = [
    {
      key: "employeeNo",
      header: "Employee No.",
      sortable: true,
      render: (r) => (
        <Link
          href={`/employees/${r.id}`}
          className="font-medium text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {r.employeeNo}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (r) => (
        <span>
          {r.firstName} {r.lastName}
          {r.preferredName ? (
            <span className="text-muted-foreground"> · {r.preferredName}</span>
          ) : null}
        </span>
      ),
    },
    { key: "employeeType", header: "Type" },
    {
      key: "employmentStatus",
      header: "Status",
      render: (r) => <StatusBadge status={r.employmentStatus} />,
    },
    {
      key: "view",
      header: "",
      render: (r) => (
        <Link
          href={`/employees/${r.id}`}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-2xs text-accent underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View profile
        </Link>
      ),
    },
  ];

  const activeOrg = (orgs ?? []).find((o) => o.id === organizationId);

  return (
    <section aria-label="Employee directory" className="space-y-4">
      <h2 className="sr-only">Employee directory</h2>
      {activeOrg ? (
        <p className="text-2xs text-muted-foreground">
          Showing employees of{" "}
          <span className="font-semibold text-foreground">{activeOrg.name}</span>{" "}
          <code className="text-2xs">({activeOrg.code})</code> — only records within your access
          reach.
        </p>
      ) : null}
      <TableToolbar<EmployeeRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        searchValues={(r) => [
          r.employeeNo,
          r.firstName,
          r.lastName,
          r.preferredName ?? "",
          r.employeeType,
          r.employmentStatus,
        ]}
        caption="Employees"
        statusFilter={{
          label: "Status",
          options: [...STATUS_OPTIONS],
          value: statusFilter,
          onChange: setStatusFilter,
        }}
        exportColumns={[
          { key: "employeeNo", header: "Employee No.", value: (r) => r.employeeNo },
          { key: "name", header: "Name", value: (r) => `${r.firstName} ${r.lastName}` },
          { key: "type", header: "Type", value: (r) => r.employeeType },
          { key: "status", header: "Status", value: (r) => r.employmentStatus },
        ]}
        emptyState={
          statusFilter === "ALL" ? (
            <EmptyState
              icon={<UserRound aria-hidden="true" className="h-8 w-8" />}
              title="No employees yet"
              description="Create the first employee record to get started. Only employees within your access reach are shown."
              action={
                <Button asChild variant="primary" size="sm">
                  <Link href="/employees/new">
                    <Plus aria-hidden="true" className="h-4 w-4" />
                    New employee
                  </Link>
                </Button>
              }
            />
          ) : undefined
        }
        actions={
          <Button asChild variant="primary" size="sm">
            <Link href="/employees/new">
              <Plus aria-hidden="true" className="h-4 w-4" />
              New employee
            </Link>
          </Button>
        }
      />
    </section>
  );
}
