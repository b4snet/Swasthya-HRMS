"use server";

import { login, LoginError } from "@/modules/identity/service";
import { getRequestAuditContext } from "@/lib/request-context";
import { resetRateLimits } from "@/lib/rate-limit";
import { env } from "@/lib/env";

export interface LoginActionResult {
  error?: string;
}

/**
 * Server action wrapper. Returns user-facing messages only; internal error
 * details go to the audit/auth event streams, never to the client.
 */
export async function loginAction(input: {
  email: string;
  password: string;
}): Promise<LoginActionResult> {
  const ctx = await getRequestAuditContext();
  // E2E-only relief valve: Playwright drives many logins per second from one
  // loopback client with no proxy headers, so ctx.ip is undefined and ALL
  // automation attempts share one bucket, tripping LOGIN_RATE_LIMITED
  // mid-suite. Non-production + explicitly opted-in via env: clear buckets
  // BEFORE evaluating credentials (does not bypass authentication, lockouts,
  // or any per-email throttle — those keep running). Never active in prod.
  if (env.NODE_ENV !== "production" && process.env.E2E_RESET_RATE_LIMIT === "1") {
    resetRateLimits();
  }
  try {
    await login(input.email, input.password, ctx);
    return {};
  } catch (err) {
    if (err instanceof LoginError) {
      return { error: err.message };
    }
    // Unexpected failure: log server-side, generic message to client.
    console.error("login action failed", err);
    return { error: "Sign-in is temporarily unavailable. Please try again." };
  }
}
