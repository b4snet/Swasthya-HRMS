"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ShellAlertItem } from "./shell-types";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export interface AlertsDropdownProps {
  alerts: ShellAlertItem[];
}

/**
 * Expiry alerts bell. Announces (aria-live) count changes and lists the next
 * expiring/expired items. Color is reinforced by text ("Expired"/"Expiring").
 */
export function AlertsDropdown({ alerts }: AlertsDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const critical = alerts.filter((a) => a.tone === "destructive").length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Expiry alerts: ${alerts.length} item${alerts.length === 1 ? "" : "s"} need attention`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
      >
        <Bell aria-hidden="true" className="size-4" />
        {alerts.length > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold leading-none text-white"
          >
            {alerts.length > 9 ? "9+" : alerts.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-background shadow-dialog animate-scale-in">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Expiry alerts</p>
            {critical > 0 ? (
              <Badge variant="destructive">{critical} expired</Badge>
            ) : (
              <Badge variant="success">All within window</Badge>
            )}
          </div>
          <ul aria-live="polite" className="max-h-80 overflow-y-auto py-1">
            {alerts.length === 0 ? (
              <li className="px-4 py-6 text-center text-2xs text-muted-foreground">
                Nothing is expiring right now.
              </li>
            ) : (
              alerts.slice(0, 6).map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={alert.href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-2.5 transition-colors hover:bg-muted"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{alert.title}</p>
                      <span
                        className={cn(
                          "shrink-0 text-2xs font-semibold uppercase tracking-wide",
                          alert.tone === "destructive" ? "text-destructive" : "text-warning",
                        )}
                      >
                        {alert.tone === "destructive" ? "Expired" : "Expiring"}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-2xs text-muted-foreground">{alert.subtitle}</p>
                    <p className="text-2xs text-muted-foreground">{fmtDate(alert.expiresOn ?? null)}</p>
                  </Link>
                </li>
              ))
            )}
          </ul>
          <div className="border-t border-border p-2">
            <Link
              href="/employees/expiry"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-muted"
            >
              View all expiring &amp; expired
              <ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}