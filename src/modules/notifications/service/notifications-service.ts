/**
 * Notifications application service (Slice 1.0; brief §89).
 *
 * Everything is self-scoped: a user can only ever read or mark-read their
 * OWN notifications, in THEIR tenant. Tenant and recipient ids come from the
 * session-derived caller — never from client input (AGENTS.md
 * authorization rules; IDOR posture).
 *
 * `createNotification` is the internal sink other domain services use to
 * emit durable in-app notifications (workflow decisions, expiry sweeps…). It
 * is deliberately not exposed as a server action: clients may not fabricate
 * notifications.
 */
import type { Prisma, WorkflowSourceType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "@/modules/workforce/service/types";
import { NotificationsAppError } from "./app-errors";
import {
  MAX_NOTIFICATION_LIMIT,
  recentOf,
  unreadCountOf,
  type NotificationEntityType,
  type NotificationRow,
} from "../domain/notifications";

export type { NotificationEntityType };

export function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function ensureActive(caller: WorkforceSubject): void {
  if (caller.status !== "ACTIVE") {
    throw new NotificationsAppError(
      "AUTHORIZATION_DENIED",
      "User account is not active.",
      undefined,
      {
        reason: "USER_NOT_ACTIVE",
      },
    );
  }
}

function notFound(what: string): never {
  throw new NotificationsAppError("NOT_FOUND", `${what} not found.`);
}

export interface ListNotificationsResult {
  rows: NotificationRow[];
  unread: number;
}

const DEFAULT_LIMIT = 20;

/** The signed-in user's own notifications, most-recent-first. */
export async function listUserNotifications(
  caller: WorkforceSubject,
  input: { limit?: number } = {},
): Promise<ListNotificationsResult> {
  ensureActive(caller);
  const limit = Math.max(1, Math.min(MAX_NOTIFICATION_LIMIT, input.limit ?? DEFAULT_LIMIT));
  const rows = await prisma.appNotification.findMany({
    where: { tenantId: caller.tenantId, recipientUserId: caller.userId },
    orderBy: { createdAt: "desc" },
  });
  const mapped = recentOf(
    rows.map((r) => ({
      id: r.id,
      notificationType: r.notificationType,
      title: r.title,
      message: r.message,
      href: r.href,
      entityType: (r.entityType ?? null) as NotificationEntityType | null,
      entityId: r.entityId,
      readAt: toIso(r.readAt),
      createdAt: r.createdAt.toISOString(),
    })),
    limit,
  );
  return { rows: mapped, unread: unreadCountOf(mapped) };
}

/** Mark one of the user's own notifications read (idempotent + audited). */
export async function markNotificationRead(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { notificationId: string },
): Promise<{ id: string }> {
  ensureActive(caller);
  const row = await prisma.appNotification.findFirst({
    where: { id: input.notificationId, tenantId: caller.tenantId },
  });
  if (!row) notFound("Notification");
  if (row.recipientUserId !== caller.userId) {
    throw new NotificationsAppError(
      "AUTHORIZATION_DENIED",
      "You can only interact with your own notifications.",
      undefined,
      { reason: "NOT_OWNER" },
    );
  }
  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.appNotification.update({
      where: { id: row.id },
      data: { readAt: row.readAt ?? new Date() },
      select: { readAt: true },
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "notifications.markRead",
        resourceType: "AppNotification",
        resourceId: row.id,
        after: { readAt: toIso(after.readAt) },
      },
      ctx ?? {},
      tx,
    );
    return after;
  });
  void updated;
  return { id: row.id };
}

export interface CreateNotificationInput {
  recipientUserId: string;
  tenantId: string;
  organizationId?: string | null;
  notificationType: string;
  title: string;
  message?: string | null;
  href?: string | null;
  entityType?: WorkflowSourceType | null;
  entityId?: string | null;
  createdBy?: string | null;
}

/**
 * Internal sink for domain services to emit notifications. May join the
 * caller's transaction (pass tx) so notification delivery is atomic with the
 * state change that produced it.
 */
export async function createNotification(
  input: CreateNotificationInput,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.appNotification.create({
    data: {
      tenantId: input.tenantId,
      organizationId: input.organizationId ?? null,
      recipientUserId: input.recipientUserId,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      createdBy: input.createdBy ?? null,
    },
  });
}
