/**
 * Request context for audit events, derived from Next.js headers.
 * `headers()` is async in Next 15 — always await.
 */
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import type { RequestAuditContext } from "@/lib/audit";

export async function getRequestAuditContext(): Promise<RequestAuditContext> {
  const h = await headers();
  const requestId = h.get("x-request-id") ?? undefined;
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded
    ? (forwarded.split(",")[0]?.trim() ?? undefined)
    : (h.get("x-real-ip") ?? undefined);
  return {
    requestId: requestId ?? randomUUID(),
    ip,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
