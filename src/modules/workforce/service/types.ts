/**
 * Shared workforce service types (no HTTP/React/Prisma client types leak
 * past this boundary — AGENTS.md layering).
 */

/** The session-resolved caller every service function requires. */
export interface WorkforceSubject {
  userId: string;
  tenantId: string;
  organizationId: string | null;
  systemRoles: readonly string[];
  status: string;
}
