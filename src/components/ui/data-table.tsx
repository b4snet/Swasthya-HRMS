"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  /** Render cell content; defaults to String(value). */
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  /** Stable unique key per row. */
  getRowKey: (row: T) => string;
  /** Access the sortable primitive value for a column key. */
  getSortValue?: (row: T, key: string) => string | number;
  caption?: string;
  emptyState?: React.ReactNode;
  className?: string;
}

/**
 * Sortable data table with correct table semantics (caption, scope="col",
 * buttons in th). Sorting is client-side and keyboard-operable.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  getSortValue,
  caption,
  emptyState,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [dir, setDir] = React.useState<"asc" | "desc">("asc");

  const sortedRows = React.useMemo(() => {
    if (!sortKey || !getSortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      let cmp: number;
      if (typeof av === "number" && typeof bv === "number") {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, dir, getSortValue]);

  function toggleSort(col: Column<T>) {
    if (sortKey === col.key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setDir("asc");
    }
  }

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-muted">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  col.sortable && sortKey === col.key
                    ? dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className="px-4 py-2.5 text-left text-2xs font-semibold text-muted-foreground"
              >
                {col.sortable && getSortValue ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col)}
                    className="inline-flex items-center gap-1.5 rounded px-0.5 py-0.5 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {col.header}
                    {sortKey === col.key ? (
                      dir === "asc" ? (
                        <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                      )
                    ) : (
                      <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5 opacity-40" />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={getRowKey(row)}
              className="border-b border-border last:border-0 hover:bg-muted/50"
            >
              {columns.map((col) => (
                <td key={col.key} className={cn("px-4 py-2.5 align-top", col.className)}>
                  {col.render ? col.render(row) : String(getSortValue?.(row, col.key) ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
