/**
 * Audit support (ADR-005). Append-only events: WHO, WHAT, WHEN, WHERE,
 * BEFORE, AFTER, WHY, request context.
 *
 * Privacy-aware logging rules (docs/compliance/privacy.md):
 * - Never log passwords, tokens, secrets, or full national IDs.
 * - Redact sensitive fields from before/after payloads via redactForAudit().
 * - IP addresses are stored as received in Phase 0; retention policy is
 *   documented in docs/compliance/privacy.md.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "currentpassword",
  "newpassword",
  "secret",
  "mfa_secret",
  "mfasecret",
  "token",
  "tok_en",
  "tokenhash",
  "token_hash",
  "authorization",
  "cookie",
  "citizenshipno",
  "citizenship_no",
  "passportno",
  "passport_no",
  "ssn",
  "otp",
  "answer",
]);

/** Recursively drop sensitive keys; replace with "[redacted]" markers. */
export function redactForAudit(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (depth > 6) return { note: "[truncated]" };
  if (Array.isArray(value)) {
    return { items: value.map((v) => redactForAudit(v, depth + 1)) };
  }
  if (typeof value !== "object") {
    return { value: value as unknown };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
      out[k] = "[redacted]";
    } else if (v && typeof v === "object") {
      out[k] = redactForAudit(v, depth + 1) ?? null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface RequestAuditContext {
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

export interface AuditEventInput {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string; // namespaced: "auth.login.success", "leave.request.create", ...
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  why?: string | null;
}

export function newRequestId(): string {
  return randomUUID();
}

/** Hash session tokens for storage — raw tokens are never persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Write a business audit event. Audit is part of the request's transaction
 * where the caller has one (pass `tx`). Fail-closed behavior is enforced at
 * call sites in security-critical flows per env.AUDIT_FAIL_CLOSED.
 */
export async function writeAuditEvent(
  input: AuditEventInput,
  ctx: RequestAuditContext = {},
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.auditEvent.create({
    data: {
      tenantId: input.tenantId ?? null,
      actorUserId: input.actorUserId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before: redactForAudit(input.before) as Prisma.InputJsonValue | undefined,
      after: redactForAudit(input.after) as Prisma.InputJsonValue | undefined,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    },
  });
}

export interface AuthEventInput {
  userId?: string | null;
  email?: string | null;
  action:
    | "LOGIN_SUCCESS"
    | "LOGIN_FAILURE"
    | "LOGIN_RATE_LIMITED"
    | "LOGOUT"
    | "SESSION_EXPIRED"
    | "PASSWORD_CHANGE"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_UNLOCKED";
  success: boolean;
  detail?: Record<string, unknown>;
}

/** Write a structured auth/security event (never throws to the caller). */
export async function writeAuthEvent(
  input: AuthEventInput,
  ctx: RequestAuditContext = {},
): Promise<void> {
  try {
    await prisma.authEvent.create({
      data: {
        userId: input.userId ?? null,
        email: input.email ?? null,
        action: input.action,
        success: input.success,
        detail: (redactForAudit(input.detail) ?? undefined) as Prisma.InputJsonValue | undefined,
        requestId: ctx.requestId ?? null,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    });
  } catch {
    // Auth events must never break the auth flow itself; business audit
    // events use fail-closed semantics instead.
  }
}
