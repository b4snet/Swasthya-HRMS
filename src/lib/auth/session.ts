/**
 * Database-backed session management (ADR-003).
 * - Raw session token lives only in an httpOnly cookie; DB stores SHA-256.
 * - Sessions are server-side revocable rows with expiry.
 * - All authorization resolution happens here, server-side only.
 *
 * Cookie name: `__Secure-` prefix is enabled when serving over HTTPS
 * (production). Locally (http://localhost) the plain name is required.
 */
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/audit";
import { env } from "@/lib/env";
import { hasPermission, type AuthorizationSubject, type Permission } from "@/lib/auth/rbac";

const INSECURE_COOKIE_NAME = "swasthya_session";
const SECURE_COOKIE_NAME = "__Secure-swasthya_session";

function cookieName(): string {
  return process.env.NODE_ENV === "production" ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  organizationId: string | null;
  email: string;
  name: string;
  status: string;
  systemRoles: string[];
  sessionId: string;
}

function toSubject(user: { status: string; systemRoles: string[] }): AuthorizationSubject {
  return {
    status: user.status,
    isActive: user.status === "ACTIVE",
    systemRoles: user.systemRoles,
  };
}

/** Create a session row and set the session cookie. */
export async function createSession(
  userId: string,
  opts: { ip?: string; userAgent?: string },
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_MAX_AGE_SECONDS * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    },
    select: { id: true },
  });

  const jar = await cookies();
  jar.set(cookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  void session; // id retained above for future device-management UI
}

/**
 * Resolve the current user from the session cookie, or null.
 * Checks: session exists, not expired, not revoked, user ACTIVE.
 */
export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  const now = new Date();
  if (session.expiresAt <= now || session.revokedAt) return null;
  if (session.user.status !== "ACTIVE") return null;

  return {
    id: session.user.id,
    tenantId: session.user.tenantId,
    organizationId: session.user.organizationId,
    email: session.user.email,
    name: session.user.name,
    status: session.user.status,
    systemRoles: session.user.systemRole.split(",").map((r) => r.trim()),
    sessionId: session.id,
  };
}

/** Redirect unauthenticated users to login. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export type PermissionResult =
  { ok: true; user: AuthenticatedUser } | { ok: false; user: AuthenticatedUser | null };

/**
 * Resolve the current user and check a permission server-side.
 * Returns ok=false (not a throw) so pages can render the
 * permission-denied state instead of an error.
 */
export async function requirePermission(permission: Permission): Promise<PermissionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, user: null };
  const allowed = hasPermission(toSubject(user), permission);
  if (!allowed) return { ok: false, user };
  return { ok: true, user };
}

/** Revoke the current session (logout). Safe to call when already signed out. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  jar.delete(cookieName());
}
