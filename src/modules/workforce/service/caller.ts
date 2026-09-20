/**
 * Caller identity for Workforce services (Phase 2, prompt 3).
 *
 * The ONLY sanctioned path into workforce services is a caller resolved
 * from the server-side session. Tenant and organization ids come from here
 * — never from client input (AGENTS.md authorization rules). Tests may
 * construct subjects directly; API code may not.
 */
import type { AuthenticatedUser } from "@/lib/auth/session";
import type { WorkforceSubject } from "./types";

export type WorkforceCaller = WorkforceSubject;

/** Build the service caller from an authenticated session user. */
export function callerFromUser(user: AuthenticatedUser): WorkforceCaller {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    systemRoles: user.systemRoles,
    status: user.status,
  };
}
