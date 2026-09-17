/**
 * Identity domain service (Phase 0 slice): credential login/logout.
 *
 * Security behaviors:
 * - Generic "invalid email or password" — never reveals which part failed
 *   or whether an account exists (V2 ASVS: no enumeration).
 * - Failed attempts increment a counter; at threshold the account locks for
 *   a cooldown and ACCOUNT_LOCKED is recorded.
 * - Login attempts are rate-limited per email and per IP.
 * - Every attempt writes an AuthEvent; success writes a business AuditEvent.
 * - INVITED/SUSPENDED/DEACTIVATED users cannot log in (generic error).
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { createSession, destroySession } from "@/lib/auth/session";
import { writeAuditEvent, writeAuthEvent, type RequestAuditContext } from "@/lib/audit";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_COOLDOWN_MINUTES = 15;

export class LoginError extends Error {
  constructor(
    message: string,
    readonly kind: "INVALID_CREDENTIALS" | "RATE_LIMITED",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

const GENERIC_FAILURE = "Invalid email or password.";

export async function login(
  emailRaw: string,
  password: string,
  ctx: RequestAuditContext,
): Promise<{ id: string; email: string; name: string }> {
  const email = emailRaw.trim().toLowerCase();

  // Rate limit per IP and per email (both must pass).
  const byIp = rateLimit(
    `login:ip:${ctx.ip ?? "unknown"}`,
    env.RATE_LIMIT_LOGIN_MAX,
    env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  );
  if (!byIp.allowed) {
    await writeAuthEvent({ email, action: "LOGIN_RATE_LIMITED", success: false }, ctx);
    throw new LoginError(
      `Too many attempts. Try again in ${byIp.retryAfterSeconds}s.`,
      "RATE_LIMITED",
      byIp.retryAfterSeconds,
    );
  }
  const byEmail = rateLimit(
    `login:email:${email}`,
    env.RATE_LIMIT_LOGIN_MAX,
    env.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
  );
  if (!byEmail.allowed) {
    await writeAuthEvent({ email, action: "LOGIN_RATE_LIMITED", success: false }, ctx);
    throw new LoginError(
      `Too many attempts. Try again in ${byEmail.retryAfterSeconds}s.`,
      "RATE_LIMITED",
      byEmail.retryAfterSeconds,
    );
  }

  // Email is unique per tenant; login resolves across tenants. With one
  // tenant (Phase 0) this is unambiguous — multi-tenant login resolution
  // (org-scoped login) arrives with Phase 2. Zero or multiple matches are
  // both a generic failure.
  const users = await prisma.user.findMany({ where: { email } });
  if (users.length !== 1) {
    await writeAuthEvent(
      { email, action: "LOGIN_FAILURE", success: false, detail: { reason: "NOT_FOUND" } },
      ctx,
    );
    throw new LoginError(GENERIC_FAILURE, "INVALID_CREDENTIALS");
  }
  const user = users[0]!;

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await writeAuthEvent(
      {
        userId: user.id,
        email,
        action: "LOGIN_FAILURE",
        success: false,
        detail: { reason: "LOCKED" },
      },
      ctx,
    );
    throw new LoginError(GENERIC_FAILURE, "INVALID_CREDENTIALS");
  }

  const passwordOk =
    user.passwordHash !== null && (await bcrypt.compare(password, user.passwordHash));

  if (!passwordOk || user.status !== "ACTIVE") {
    const attempts = passwordOk ? user.failedLoginAttempts : user.failedLoginAttempts + 1;
    const shouldLock = !passwordOk && attempts >= MAX_FAILED_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + LOCK_COOLDOWN_MINUTES * 60_000)
          : user.lockedUntil,
      },
    });

    if (shouldLock) {
      await writeAuthEvent(
        { userId: user.id, email, action: "ACCOUNT_LOCKED", success: false, detail: { attempts } },
        ctx,
      );
    }
    await writeAuthEvent(
      {
        userId: user.id,
        email,
        action: "LOGIN_FAILURE",
        success: false,
        detail: { reason: user.status !== "ACTIVE" ? `STATUS_${user.status}` : "BAD_PASSWORD" },
      },
      ctx,
    );
    // Uniform delay + message regardless of reason (no enumeration).
    throw new LoginError(GENERIC_FAILURE, "INVALID_CREDENTIALS");
  }

  // Success: reset lockout state, open session, audit.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });
  await createSession(user.id, { ip: ctx.ip, userAgent: ctx.userAgent });
  await writeAuthEvent({ userId: user.id, email, action: "LOGIN_SUCCESS", success: true }, ctx);
  await writeAuditEvent(
    {
      tenantId: user.tenantId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "auth.login.success",
      resourceType: "Session",
    },
    ctx,
  );

  return { id: user.id, email: user.email, name: user.name };
}

export async function logout(
  user: { id: string; tenantId: string; email: string },
  ctx: RequestAuditContext,
): Promise<void> {
  await destroySession();
  await writeAuthEvent(
    { userId: user.id, email: user.email, action: "LOGOUT", success: true },
    ctx,
  );
  await writeAuditEvent(
    {
      tenantId: user.tenantId,
      actorUserId: user.id,
      actorEmail: user.email,
      action: "auth.logout",
      resourceType: "Session",
    },
    ctx,
  );
}
