/**
 * Notifications domain (Phase 0 hardening; Slice 1.0; brief §89).
 *
 * Pure, I/O-free rules over in-app notification rows. Notifications are an
 * append-only journal (history preserved) plus a readAt marker — marking read
 * is idempotent, so no concurrency version is required (unlike stateful
 * task/approval rows, see workflows module).
 */
import type { WorkflowSourceType } from "@prisma/client";

/** Entity kinds a notification may reference (mirrors WorkflowSourceType). */
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export const NOTIFICATION_ENTITY_TYPES = [
  "EMPLOYEE",
  "POSITION",
  "CONTRACT",
  "CREDENTIAL",
  "LEAVE_REQUEST",
  "ONBOARDING",
  "SEPARATION",
  "TRANSFER",
  "PROMOTION",
] as const satisfies readonly WorkflowSourceType[];

/** Serialized row emitted across the service boundary (no Prisma types). */
export interface NotificationRow {
  id: string;
  notificationType: string;
  title: string;
  message: string | null;
  href: string | null;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  readAt: string | null; // ISO timestamp, null = unread
  createdAt: string; // ISO timestamp
}

export const MAX_NOTIFICATION_LIMIT = 50;

export function isRead(row: Pick<NotificationRow, "readAt">): boolean {
  return row.readAt !== null && row.readAt !== undefined;
}

/** Stable strings for the UI (never derived from ephemeral state). */
export function readState(row: Pick<NotificationRow, "readAt">): "read" | "unread" {
  return isRead(row) ? "read" : "unread";
}

export function unreadCountOf(rows: readonly Pick<NotificationRow, "readAt">[]): number {
  return rows.reduce((acc, row) => (isRead(row) ? acc : acc + 1), 0);
}

/**
 * Most-recent-first, capped at the UI-friendly window. Unread items stay
 * ahead of read ones within the same recency cohort so fresh attention
 * surfaces first.
 */
export function recentOf<T extends Pick<NotificationRow, "readAt" | "createdAt">>(
  rows: readonly T[],
  limit: number,
): T[] {
  const capped = Math.max(1, Math.min(MAX_NOTIFICATION_LIMIT, Math.floor(limit)));
  return [...rows]
    .sort((a, b) => {
      const aUnread = isRead(a) ? 1 : 0;
      const bUnread = isRead(b) ? 1 : 0;
      if (aUnread !== bUnread) return aUnread - bUnread;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, capped);
}
