/**
 * Read-side server actions for the Organization UI (queued prompt 4).
 *
 * Mirrors actions.ts: caller resolved from the SESSION only; stable,
 * client-safe results; no DB internals cross the boundary. Pages import
 * these instead of touching Prisma directly (AGENTS.md layering).
 */
"use server";

import { getSessionUser } from "@/lib/auth/session";
import { callerFromUser } from "../service/caller";
import {
  listAccessibleOrganizations,
  listOrgUnits,
  listDepartments,
  listTeams,
  listDesignations,
  listJobFamilies,
  listGrades,
  listCostCenters,
  listLocations,
  listFacilities,
  listPositions,
  listReportingEdges,
  getStructureView,
  getResourceAuditHistory,
  OrgQueryError,
  type StructureView,
} from "../service/queries";
import type { OrgCaller } from "../service/caller";

export interface QueryResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fail(err: unknown): QueryResult<never> {
  if (err instanceof OrgQueryError) {
    // Client-safe: the stable code drives which UI state renders
    // (permission-denied vs error); messages carry no DB internals.
    return {
      ok: false,
      error: { code: err.code, message: err.message },
    };
  }
  console.error("[org-queries] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

async function caller(): Promise<OrgCaller | null> {
  const user = await getSessionUser();
  return user ? callerFromUser(user) : null;
}

function deny(): QueryResult<never> {
  return {
    ok: false,
    error: { code: "AUTHORIZATION_DENIED", message: "Sign in to view this page." },
  };
}

async function scoped<T>(
  organizationId: string,
  run: (c: OrgCaller) => Promise<T>,
): Promise<QueryResult<T>> {
  const c = await caller();
  if (!c) return deny();
  try {
    return { ok: true, data: await run(c) };
  } catch (err) {
    return fail(err);
  }
}

export async function getAccessibleOrganizationsAction(): Promise<
  QueryResult<Array<{ id: string; code: string; name: string; status: string }>>
> {
  const c = await caller();
  if (!c) return deny();
  try {
    return { ok: true, data: await listAccessibleOrganizations(c) };
  } catch (err) {
    return fail(err);
  }
}

export async function getOrgUnitsAction(organizationId: string) {
  return scoped(organizationId, (c) => listOrgUnits(c, organizationId));
}

export async function getDepartmentsAction(organizationId: string) {
  return scoped(organizationId, (c) => listDepartments(c, organizationId));
}

export async function getTeamsAction(organizationId: string) {
  return scoped(organizationId, (c) => listTeams(c, organizationId));
}

export async function getDesignationsAction(organizationId: string) {
  return scoped(organizationId, (c) => listDesignations(c, organizationId));
}

export async function getJobFamiliesAction(organizationId: string) {
  return scoped(organizationId, (c) => listJobFamilies(c, organizationId));
}

export async function getGradesAction(organizationId: string) {
  return scoped(organizationId, (c) => listGrades(c, organizationId));
}

export async function getCostCentersAction(organizationId: string) {
  return scoped(organizationId, (c) => listCostCenters(c, organizationId));
}

export async function getLocationsAction() {
  const c = await caller();
  if (!c) return deny();
  try {
    return { ok: true, data: await listLocations(c) };
  } catch (err) {
    return fail(err);
  }
}

export async function getFacilitiesAction(organizationId: string) {
  return scoped(organizationId, (c) => listFacilities(c, organizationId));
}

export async function getPositionsAction(organizationId: string) {
  return scoped(organizationId, (c) => listPositions(c, organizationId));
}

export async function getReportingEdgesAction(organizationId: string) {
  return scoped(organizationId, (c) => listReportingEdges(c, organizationId));
}

export async function getStructureViewAction(
  organizationId: string,
): Promise<QueryResult<StructureView>> {
  return scoped(organizationId, (c) => getStructureView(c, organizationId));
}

export async function getOrgAuditHistoryAction(
  organizationId: string,
  resourceType: string,
  resourceId: string,
): Promise<QueryResult<OrgAuditEntry[]>> {
  return scoped(organizationId, async (c) => {
    const events = await getResourceAuditHistory(c, organizationId, resourceType, resourceId);
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      actorEmail: e.actorEmail,
      occurredAt: e.occurredAt.toISOString(),
      before: e.before,
      after: e.after,
    }));
  });
}

export interface OrgAuditEntry {
  id: string;
  action: string;
  actorEmail: string | null;
  occurredAt: string;
  before: unknown;
  after: unknown;
}
