"use server";

import { login, LoginError } from "@/modules/identity/service";
import { getRequestAuditContext } from "@/lib/request-context";

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
