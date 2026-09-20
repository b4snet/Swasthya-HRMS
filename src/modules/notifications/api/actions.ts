/**
 * Thin server actions for in-app notifications (Slice 1.0).
 *
 * Mirrors the credentials API pattern: parse (Zod) → resolve the caller from
 * the SESSION (recipient/tenant never from input) → call the service →
 * return a typed result. Listing and marking read are self-scoped; the
 * service refuses any notification the caller does not own.
 */
"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { callerFromUser } from "@/modules/workforce/service/caller";
import type { RequestAuditContext } from "@/lib/audit";
import { NotificationsAppError, serializeNotificationsAppError } from "../service/app-errors";
import { listUserNotifications, markNotificationRead } from "../service/notifications-service";

export interface NotificationsActionResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

const listSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});
const markReadSchema = z.object({
  notificationId: z.string().min(1).max(100),
});

function ok<T>(data: T): NotificationsActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): NotificationsActionResult<never> {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: first?.message ?? "Invalid input.",
        field: first?.path?.map(String).join("."),
      },
    };
  }
  if (err instanceof NotificationsAppError) {
    const serialized = serializeNotificationsAppError(err);
    return { ok: false, error: serialized.error };
  }
  console.error("[notifications] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

async function requestContext(): Promise<RequestAuditContext> {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

export async function listNotificationsAction(input: unknown) {
  try {
    const parsed = listSchema.parse(input);
    const user = await getSessionUser();
    if (!user) {
      return fail(
        new NotificationsAppError(
          "AUTHORIZATION_DENIED",
          "You must sign in to perform this action.",
        ),
      );
    }
    return ok(await listUserNotifications(callerFromUser(user), { limit: parsed?.limit }));
  } catch (err) {
    return fail(err);
  }
}

export async function markNotificationReadAction(input: unknown) {
  try {
    const parsed = markReadSchema.parse(input);
    const user = await getSessionUser();
    if (!user) {
      return fail(
        new NotificationsAppError(
          "AUTHORIZATION_DENIED",
          "You must sign in to perform this action.",
        ),
      );
    }
    const caller = callerFromUser(user);
    const ctx = await requestContext();
    return ok(await markNotificationRead(caller, ctx, { notificationId: parsed.notificationId }));
  } catch (err) {
    return fail(err);
  }
}
