"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Download, Rows3 } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TableToolbarProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  getRowKey: (row: T) => string;
  /** Values considered for text search, per row. */
  searchValues: (row: T) => string[];
  caption: string;
  /** Filter rows by a status-like field before display. */
  statusFilter?: { label: string; options: string[]; value: string; onChange: (v: string) => void };
  /** CSV export uses these columns; omit to hide the export button. */
  exportColumns?: Array<{ key: string; header: string; value: (row: T) => string | number }>;
  /** Extra actions rendered right of the toolbar. */
  actions?: React.ReactNode;
  defaultHiddenColumns?: string[];
  emptyState?: React.ReactNode;
}

const PAGE_SIZES = [10, 25, 50] as const;

/**
 * Search + status filter + pagination + density + column visibility + export
 * around the shared DataTable. Column visibility is checkbox-driven and
 * keyboard accessible; density switches row padding; export emits
 * client-side CSV of the currently filtered rows; pagination is client-side
 * over the filtered set.
 */
export function TableToolbar<T>({
  columns,
  rows,
  getRowKey,
  searchValues,
  caption,
  statusFilter,
  exportColumns,
  actions,
  defaultHiddenColumns = [],
  emptyState,
}: TableToolbarProps<T>) {
  const uid = React.useId();
  const [query, setQuery] = React.useState("");
  const [density, setDensity] = React.useState<"compact" | "regular">("regular");
  const [hidden, setHidden] = React.useState<Set<string>>(new Set(defaultHiddenColumns));
  const [showColumns, setShowColumns] = React.useState(false);
  const [pageSize, setPageSize] = React.useState<number>(10);
  const [page, setPage] = React.useState(0); // 0-based

  const visibleColumns = React.useMemo(
    () => columns.filter((c) => !hidden.has(c.key)),
    [columns, hidden],
  );

  const filtered = React.useMemo(() => {
    let out = rows;
    if (statusFilter && statusFilter.value !== "ALL") {
      const want = statusFilter.value;
      out = out.filter((r) => {
        const rec = r as unknown as Record<string, unknown>;
        return String(rec["status"] ?? "") === want;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) => searchValues(r).some((v) => v.toLowerCase().includes(q)));
    }
    return out;
  }, [rows, query, statusFilter, searchValues]);

  // Reset to the first page whenever the filtered set shrinks below the
  // current window (search text, status filter, or data refresh).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  React.useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);
  const paged = React.useMemo(
    () => filtered.slice(page * pageSize, page * pageSize + pageSize),
    [filtered, page, pageSize],
  );

  function toggleColumn(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportCsv() {
    if (!exportColumns) return;
    const header = exportColumns.map((c) => c.header).join(",");
    const lines = filtered.map((r) =>
      exportColumns
        .map((c) => {
          const v = String(c.value(r) ?? "");
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${caption.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const firstRow = filtered.length === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min(filtered.length, (page + 1) * pageSize);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor={`${uid}-search`} className="text-2xs text-muted-foreground">
            Search
          </Label>
          <Input
            id={`${uid}-search`}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Type to filter rows…"
            className="h-8 text-2xs"
          />
        </div>
        {statusFilter ? (
          <div className="space-y-1">
            <Label htmlFor={`${uid}-status`} className="text-2xs text-muted-foreground">
              {statusFilter.label}
            </Label>
            <select
              id={`${uid}-status`}
              value={statusFilter.value}
              onChange={(e) => {
                statusFilter.onChange(e.target.value);
                setPage(0);
              }}
              className="h-8 rounded-lg border border-input bg-background px-2 text-2xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="ALL">All</option>
              {statusFilter.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDensity((d) => (d === "compact" ? "regular" : "compact"))}
        >
          <Rows3 aria-hidden="true" className="h-3.5 w-3.5" />
          {density === "compact" ? "Regular rows" : "Compact rows"}
        </Button>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={showColumns}
            aria-controls={`${uid}-columns`}
            onClick={() => setShowColumns((s) => !s)}
          >
            Columns
          </Button>
          {showColumns ? (
            <div
              id={`${uid}-columns`}
              role="group"
              aria-label="Column visibility"
              className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-border bg-background p-3 shadow-md"
            >
              <ul className="space-y-1.5">
                {columns.map((c) => (
                  <li key={c.key}>
                    <label className="flex items-center gap-2 text-2xs">
                      <input
                        type="checkbox"
                        checked={!hidden.has(c.key)}
                        onChange={() => toggleColumn(c.key)}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      {c.header}
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setHidden(new Set())}
              >
                Show all
              </Button>
            </div>
          ) : null}
        </div>
        {exportColumns ? (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download aria-hidden="true" className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        ) : null}
        {actions}
      </div>

      <DataTable
        columns={visibleColumns}
        rows={paged}
        getRowKey={getRowKey}
        getSortValue={(row, key) => {
          const rec = row as unknown as Record<string, unknown>;
          const v = rec[key];
          return typeof v === "number" ? v : String(v ?? "");
        }}
        caption={caption}
        emptyState={emptyState}
        className={cn(density === "compact" && "[&_td]:px-4 [&_td]:py-1 [&_th]:py-1.5")}
      />

      {/* Pagination + row counts are announced via role=status */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs text-muted-foreground" role="status">
          {firstRow}–{lastRow} of {filtered.length} rows
          {filtered.length !== rows.length ? ` (filtered from ${rows.length})` : ""}
        </p>
        <div className="flex items-center gap-2">
          <Label htmlFor={`${uid}-pagesize`} className="text-2xs text-muted-foreground">
            Rows per page
          </Label>
          <select
            id={`${uid}-pagesize`}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="h-8 rounded-lg border border-input bg-background px-2 text-2xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Prev
          </Button>
          <span className="text-2xs tabular-nums text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next
            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
