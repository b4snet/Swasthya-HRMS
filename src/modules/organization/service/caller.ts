/**
 * Caller identity for Organization services (queued prompt 3).
 *
 * The ONLY sanctioned path into org services is a caller resolved from the
 * server-side session. Tenant and organization ids come from here — never
 * from client input (AGENTS.md authorization rules). Tests may construct
 * subjects directly; API code may not.
 */
import type { AuthenticatedUser } from "@/lib/auth/session";
import type { OrgSubject } from "./validation-service";

export type OrgCaller = OrgSubject;

/** Build the service caller from an authenticated session user. */
export function callerFromUser(user: AuthenticatedUser): OrgCaller {
  return {
    userId: user.id,
    tenantId: user.tenantId,
    organizationId: user.organizationId,
    systemRoles: user.systemRoles,
    status: user.status,
  };
}
