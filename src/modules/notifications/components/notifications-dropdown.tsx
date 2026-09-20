"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  listNotificationsAction,
  markNotificationReadAction,
} from "@/modules/notifications/api/actions";
import type { NotificationRow } from "@/modules/notifications/domain/notifications";

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * In-app notification bell (Slice 1.0; brief §89). Reads the signed-in user's
 * own notifications via the server action; rows are plain serializable data.
 * Unread items carry a dot + bold text; colour is reinforced by "(Unread)".
 */
export function NotificationsDropdown() {
  const router = useRouter();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listNotificationsAction({ limit: 20 }).catch(() => null);
    if (res?.ok && res.data) {
      setRows(res.data.rows);
      setError(null);
    } else {
      setError("Could not load notifications.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const unread = rows.reduce((acc, r) => (r.readAt ? acc : acc + 1), 0);

  async function markRead(notificationId: string, navigate: string | null) {
    setBusy(true);
    const res = await markNotificationReadAction({ notificationId }).catch(() => null);
    if (res?.ok) {
      setRows((prev) =>
        prev.map((r) => (r.id === notificationId ? { ...r, readAt: new Date().toISOString() } : r)),
      );
      if (navigate) {
        setOpen(false);
        router.push(navigate);
      }
    }
    setBusy(false);
  }

  async function markAllRead() {
    const unreadIds = rows.filter((r) => !r.readAt).map((r) => r.id);
    if (unreadIds.length === 0) return;
    setBusy(true);
    await Promise.all(
      unreadIds.map((id) => markNotificationReadAction({ notificationId: id }).catch(() => null)),
    );
    setRows((prev) => prev.map((r) => ({ ...r, readAt: r.readAt ?? new Date().toISOString() })));
    setBusy(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Notifications: ${unread} unread`}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "bg-muted text-foreground",
        )}
      >
        <BellRing aria-hidden="true" className="size-4" />
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-xl border border-border bg-background shadow-dialog animate-scale-in">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              Notifications
              <span className="ml-2 text-2xs font-normal text-muted-foreground">
                {unread > 0 ? `${unread} unread` : "All caught up"}
              </span>
            </p>
            {unread > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-2xs text-primary"
                disabled={busy}
                onClick={() => void markAllRead()}
              >
                <CheckCheck aria-hidden="true" className="size-3.5" />
                Mark all read
              </Button>
            ) : null}
          </div>

          {loading ? (
            <p className="px-4 py-6 text-center text-2xs text-muted-foreground" role="status">
              Loading…
            </p>
          ) : error ? (
            <p className="px-4 py-6 text-center text-2xs text-destructive" role="status">
              {error}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-center text-2xs text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul aria-live="polite" className="max-h-80 overflow-y-auto py-1">
              {rows.map((row) => {
                const read = row.readAt !== null;
                const body = (
                  <>
                    <div className="flex items-center gap-2">
                      {read ? (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-border"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-primary"
                        />
                      )}
                      <p
                        className={cn("truncate text-sm text-foreground", !read && "font-semibold")}
                      >
                        {row.title}
                      </p>
                    </div>
                    <p className="mt-0.5 line-clamp-2 pl-3.5 text-2xs text-muted-foreground">
                      {row.message ?? row.notificationType}
                      <span
                        className={cn(
                          "ml-1.5 shrink-0 text-2xs",
                          read ? "text-muted-foreground" : "text-foreground",
                        )}
                      >
                        · {fmtWhen(row.createdAt)}
                        {!read ? " · (Unread)" : ""}
                      </span>
                    </p>
                  </>
                );
                const rowClass = "block px-4 py-2.5 transition-colors hover:bg-muted";
                return (
                  <li key={row.id}>
                    {row.href ? (
                      <Link
                        href={row.href}
                        className={rowClass}
                        onClick={() => void markRead(row.id, row.href)}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={cn(rowClass, "w-full text-left")}
                        onClick={() => void markRead(row.id, null)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-border px-4 py-2.5 text-2xs text-muted-foreground">
            Mark notifications read by selecting them.
          </div>
        </div>
      ) : null}
    </div>
  );
}
