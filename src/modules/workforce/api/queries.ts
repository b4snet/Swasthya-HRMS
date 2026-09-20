/**
 * Read-side server actions for the Workforce UI (Phase 2, prompt 3/4).
 *
 * Mirrors queries.ts in the organization module: caller resolved from the
 * SESSION only; stable, client-safe results; no DB internals cross the
 * boundary. The sensitive detail action funnels through the service-layer
 * projection choke point — this file adds no sensitive logic of its own.
 */
"use server";

import { getSessionUser } from "@/lib/auth/session";
import { getEmployeeDetail, listAssignments } from "../service/employee-service";
import {
  listEmergencyContacts,
  listDependents,
  listCredentials,
  listQualifications,
  listDocumentReferences,
} from "../service/child-entity-service";
import {
  listEmployeesInReach,
  getEmployeeForManager,
  getOwnEmployeeSummary,
  getEmployeeProfile,
  listManagerCandidates,
} from "../service/roster-service";
import { callerFromUser } from "../service/caller";
import { WorkforceAppError } from "../service/app-errors";
import { listAccessibleOrganizations } from "../../organization/service/queries";
import { OrgQueryError } from "../../organization/service/queries";

export interface QueryResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function fail(err: unknown): QueryResult<never> {
  if (err instanceof WorkforceAppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  if (err instanceof OrgQueryError) {
    // Reused org read service (org switcher) — same client-safe shape.
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  console.error("[workforce-queries] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

function deny(): QueryResult<never> {
  return {
    ok: false,
    error: { code: "AUTHORIZATION_DENIED", message: "Sign in to view this page." },
  };
}

async function caller(): Promise<WorkforceCaller | null> {
  const user = await getSessionUser();
  return user ? callerFromUser(user) : null;
}

type WorkforceCaller = ReturnType<typeof callerFromUser>;

/** Org-wide reads. organizationId is validated inside each service. */
async function scoped<T>(
  organizationId: string,
  run: (c: WorkforceCaller) => Promise<T>,
): Promise<QueryResult<T>> {
  const c = await caller();
  if (!c) return deny();
  try {
    return { ok: true, data: await run(c) };
  } catch (err) {
    return fail(err);
  }
}

/** Organizations the caller can reach (for the UI's org switcher). */
export async function getWorkforceOrganizationsAction(): Promise<
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

/** Roster: employees inside the caller's derived reach (org/dept/manager). */
export async function listEmployeesInReachAction(organizationId: string) {
  return scoped(organizationId, (c) => listEmployeesInReach(c, organizationId));
}

export interface EmployeeSearchHit {
  id: string;
  employeeNo: string;
  name: string;
  organizationId: string;
  organizationName: string;
  href: string;
}

/**
 * Global command-palette search: matches by name or employee number across
 * the organizations the caller may read. Reach is computed server-side for
 * each organization; a guessed id never widens results.
 */
export async function searchEmployeesAction(query: string): Promise<QueryResult<EmployeeSearchHit[]>> {
  const c = await caller();
  if (!c) return deny();
  const q = query.trim().toLowerCase();
  if (!q) return { ok: true, data: [] };
  try {
    const orgs = await listAccessibleOrganizations(c);
    const hits: EmployeeSearchHit[] = [];
    for (const org of orgs) {
      const rows = await listEmployeesInReach(c, org.id);
      for (const row of rows) {
        const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
        const lowerName = name.toLowerCase();
        const lowerNo = row.employeeNo.toLowerCase();
        if (lowerNo.includes(q) || lowerName.includes(q)) {
          hits.push({
            id: row.id,
            employeeNo: row.employeeNo,
            name: name || "Unnamed employee",
            organizationId: org.id,
            organizationName: org.name,
            href: `/employees/${row.id}`,
          });
          if (hits.length >= 8) break;
        }
      }
      if (hits.length >= 8) break;
    }
    return { ok: true, data: hits };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Manager-scoped detail read (IDOR-sensitive): the service returns
 * NOT_FOUND when the employee is outside the caller's derived reach —
 * existence is never disclosed through error differences.
 */
export async function getEmployeeForManagerAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => getEmployeeForManager(c, organizationId, employeeId));
}

/**
 * Full employee detail (HR path). Sensitive fields are stripped by the
 * service unless the caller holds the sensitive grant; `sensitiveViewed`
 * tells the UI whether to render values or Restricted placeholders.
 */
export async function getEmployeeDetailAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => getEmployeeDetail(c, organizationId, employeeId));
}

/** Assignment history for an employment (timeline UI in Prompt 4). */
export async function listAssignmentsAction(organizationId: string, employmentId: string) {
  return scoped(organizationId, (c) => listAssignments(c, organizationId, employmentId));
}

/**
 * Full profile for the employee UI. Sensitive fields pass only through the
 * service projection — without the grant they arrive as null and the UI
 * renders Restricted placeholders; nothing is hidden client-side.
 */
export async function getEmployeeProfileAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => getEmployeeProfile(c, organizationId, employeeId));
}

/** Manager candidates for the assignment dialog (manage permission required). */
export async function listManagerCandidatesAction(
  organizationId: string,
  excludeEmploymentId?: string,
) {
  return scoped(organizationId, (c) =>
    listManagerCandidates(c, organizationId, excludeEmploymentId),
  );
}

/** Child-entity reads (employee-scoped, org-guarded). */
export async function listEmergencyContactsAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => listEmergencyContacts(c, organizationId, employeeId));
}

export async function listDependentsAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => listDependents(c, organizationId, employeeId));
}

export async function listCredentialsAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => listCredentials(c, organizationId, employeeId));
}

export async function listQualificationsAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => listQualifications(c, organizationId, employeeId));
}

export async function listDocumentReferencesAction(organizationId: string, employeeId: string) {
  return scoped(organizationId, (c) => listDocumentReferences(c, organizationId, employeeId));
}

/** Self-service summary ("my record"); null until identity linking lands. */
export async function getOwnEmployeeSummaryAction(): Promise<
  QueryResult<{ employee: { id: string; employeeNo: string } | null; linked: boolean }>
> {
  const c = await caller();
  if (!c) return deny();
  try {
    const employee = await getOwnEmployeeSummary(c);
    return {
      ok: true,
      data: employee
        ? { employee: { id: employee.id, employeeNo: employee.employeeNo }, linked: true }
        : { employee: null, linked: false },
    };
  } catch (err) {
    return fail(err);
  }
}
