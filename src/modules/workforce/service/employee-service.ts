/**
 * Workforce services — Person / Employee / Employment (Phase 2; ADR-010).
 *
 * Layering (AGENTS.md): pure rules live in ../domain, DB-composed guards in
 * mutations.ts, and THIS module adds authorization, scoping, transactions,
 * audit and stable client-safe errors. Archival sets status ARCHIVED and
 * never deletes; employment separations are lifecycle states. Updates are
 * optimistic (expectedVersion required). Audit payloads pass already-masked
 * sensitive values (plan §7); redactForAudit is the second line of defense.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { maskNumber } from "../domain/employee-number";
import {
  appendStatusHistory,
  assertEmploymentTransition,
  assertSeparationRequirements,
  type EmploymentStatusValue,
  type StatusHistoryEntry,
} from "../domain/employment-status";
import { assertValidPeriod, isOpen } from "../domain/assignment-interval";
import { WorkforceAppError, toWorkforceAppError } from "./app-errors";
import {
  assertCallerCanManageEmployees,
  assertCallerCanReadEmployees,
  assertSensitiveAccess,
  assertVersionMatches,
  notFound,
  transactWithAudit,
} from "./mutations";
import type { WorkforceSubject } from "./types";

type Tx = Prisma.TransactionClient;

/**
 * Person rows are tenant-owned (no organizationId), but they must never be
 * writable without workforce-manage authorization: require employee:manage
 * with org reach SOMEWHERE in the caller's tenant. Org binding of a person
 * row is a documented ADR-010 future hook; until then this is the honest
 * tenant-level guard (deny-by-default).
 */
async function assertCallerCanManageEmployeesForTenant(caller: WorkforceSubject): Promise<void> {
  if (caller.status !== "ACTIVE") {
    throw new WorkforceAppError("AUTHORIZATION_DENIED", "User account is not active.");
  }
  const orgs = await prisma.organization.findMany({
    where: { tenantId: caller.tenantId },
    select: { id: true },
  });
  if (orgs.length === 0) {
    throw new WorkforceAppError(
      "AUTHORIZATION_DENIED",
      "You do not have permission to perform this action.",
    );
  }
  const errs: unknown[] = [];
  for (const org of orgs) {
    try {
      await assertCallerCanManageEmployees(caller, org.id);
      return; // reach in at least one org of the tenant
    } catch (err) {
      errs.push(err);
    }
  }
  throw new WorkforceAppError(
    "AUTHORIZATION_DENIED",
    "You do not have permission to manage workforce records.",
    undefined,
    errs[0],
  );
}

// ── Person ───────────────────────────────────────────────────────────────────

export interface PersonInput {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  preferredName?: string | null;
  /** SENSITIVE_PERSONAL — never logged, never in audit payloads (plan §7). */
  dateOfBirth?: Date | null;
  nationality?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  postalCode?: string | null;
}

export async function createPerson(
  caller: WorkforceSubject,
  input: PersonInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  try {
    const person = await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.person.create",
        resourceType: "Person",
        // Audit carries identity-free summary only; DOB/address are
        // SENSITIVE_PERSONAL and never enter payloads (plan §7).
        after: { firstName: input.firstName, lastName: input.lastName },
      },
      (tx) =>
        tx.person.create({
          data: {
            tenantId: caller.tenantId,
            firstName: input.firstName,
            middleName: input.middleName ?? null,
            lastName: input.lastName,
            preferredName: input.preferredName ?? null,
            dateOfBirth: input.dateOfBirth ?? null,
            nationality: input.nationality ?? null,
            email: input.email ?? null,
            phone: input.phone ?? null,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            province: input.province ?? null,
            country: input.country ?? null,
            postalCode: input.postalCode ?? null,
          },
          select: { id: true },
        }),
    );
    return person;
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function updatePerson(
  caller: WorkforceSubject,
  personId: string,
  input: Partial<PersonInput> & { expectedVersion: number },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  // Guard FIRST: person is tenant-owned, but the workforce record layer must
  // never be writable without employee:manage reach in SOME org of this
  // tenant (prompt-4 review fix; org binding of the person row itself is a
  // documented future hook, ADR-010).
  await assertCallerCanManageEmployeesForTenant(caller);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.person.update",
        resourceType: "Person",
        resourceId: personId,
        after: { firstName: input.firstName, lastName: input.lastName },
      },
      async (tx) => {
        const person = await tx.person.findFirst({
          // Tenant-scoped lookup: person is tenant-owned, not org-scoped.
          where: { id: personId, tenantId: caller.tenantId, status: { not: "ARCHIVED" } },
          select: { id: true, version: true, firstName: true, lastName: true },
        });
        if (!person) notFound("Person");
        assertVersionMatches(person, input.expectedVersion, "Person");
        const data: Prisma.PersonUpdateInput = {};
        for (const key of [
          "firstName",
          "middleName",
          "lastName",
          "preferredName",
          "dateOfBirth",
          "nationality",
          "email",
          "phone",
          "addressLine1",
          "addressLine2",
          "city",
          "province",
          "country",
          "postalCode",
        ] as const) {
          if (input[key] !== undefined) {
            (data as Record<string, unknown>)[key] = input[key];
          }
        }
        return tx.person.update({
          where: { id: person.id },
          data: { ...data, version: { increment: 1 }, updatedBy: caller.userId },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function archivePerson(
  caller: WorkforceSubject,
  personId: string,
  expectedVersion: number,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployeesForTenant(caller);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      { action: "employee.person.archive", resourceType: "Person", resourceId: personId },
      async (tx) => {
        const person = await tx.person.findFirst({
          where: { id: personId, tenantId: caller.tenantId, status: { not: "ARCHIVED" } },
          select: { id: true, version: true },
        });
        if (!person) notFound("Person");
        assertVersionMatches(person, expectedVersion, "Person");
        return tx.person.update({
          where: { id: person.id },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Employee + Employment creation ───────────────────────────────────────────

export interface CreateEmployeeInput {
  person: PersonInput;
  organizationId: string;
  employeeNo: string;
  employeeType: "REGULAR" | "CONTRACT" | "PROBATION" | "LOCUM" | "INTERN" | "VOLUNTEER" | "OTHER";
  employment: {
    employmentNo: string;
    type: "PERMANENT" | "PROBATION" | "CONTRACT" | "LOCUM" | "INTERN" | "VOLUNTEER";
    hireDate: Date;
    contractEndDate?: Date | null;
    probationEndDate?: Date | null;
    workLocationId?: string | null;
    facilityId?: string | null;
    workerClassification?: "EMPLOYEE" | "CONTRACTOR" | "TRAINEE" | "VOLUNTEER";
    noticePeriodDays?: number | null;
  };
}

/**
 * Create Person (or reuse an existing ACTIVE person with the same names in
 * this tenant? No — plan §13: dedup by (tenant, organization, person) at the
 * Employee level; person dedup is a UI search concern) + Employee +
 * first Employment in PENDING_ONBOARDING → the caller activates after
 * onboarding. One transaction, one audit event per row created.
 */
export async function createEmployee(
  caller: WorkforceSubject,
  input: CreateEmployeeInput,
  ctx?: RequestAuditContext,
): Promise<{ employeeId: string; employmentId: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "employee.create",
        resourceType: "Employee",
        resourceId: created.employeeId,
        after: {
          employeeNo: maskNumber(input.employeeNo),
          employmentNo: maskNumber(input.employment.employmentNo),
          employeeType: input.employeeType,
        },
      }),
      async (tx) => {
        const person = await tx.person.create({
          data: {
            tenantId: caller.tenantId,
            firstName: input.person.firstName,
            middleName: input.person.middleName ?? null,
            lastName: input.person.lastName,
            preferredName: input.person.preferredName ?? null,
            dateOfBirth: input.person.dateOfBirth ?? null,
            nationality: input.person.nationality ?? null,
            email: input.person.email ?? null,
            phone: input.person.phone ?? null,
            addressLine1: input.person.addressLine1 ?? null,
            addressLine2: input.person.addressLine2 ?? null,
            city: input.person.city ?? null,
            province: input.person.province ?? null,
            country: input.person.country ?? null,
            postalCode: input.person.postalCode ?? null,
          },
          select: { id: true },
        });
        const employee = await tx.employee.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            personId: person.id,
            employeeNo: input.employeeNo,
            employeeType: input.employeeType,
            employmentStatus: "PENDING_ONBOARDING",
            hiredOn: input.employment.hireDate,
          },
          select: { id: true },
        });
        const employment = await tx.employment.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employeeId: employee.id,
            employmentNo: input.employment.employmentNo,
            type: input.employment.type,
            status: "PENDING_ONBOARDING",
            hireDate: input.employment.hireDate,
            contractEndDate: input.employment.contractEndDate ?? null,
            probationEndDate: input.employment.probationEndDate ?? null,
            workLocationId: input.employment.workLocationId ?? null,
            facilityId: input.employment.facilityId ?? null,
            workerClassification: input.employment.workerClassification ?? "EMPLOYEE",
            noticePeriodDays: input.employment.noticePeriodDays ?? null,
            statusHistory: [
              {
                status: "PENDING_ONBOARDING",
                changedAt: new Date().toISOString(),
                changedBy: caller.userId,
              } satisfies StatusHistoryEntry,
            ],
          },
          select: { id: true },
        });
        return { employeeId: employee.id, employmentId: employment.id };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Employment lifecycle ─────────────────────────────────────────────────────

export interface EmploymentTransitionInput {
  to: EmploymentStatusValue;
  note?: string | null;
  terminationDate?: Date | null;
  terminationReason?:
    | "MISCONDUCT"
    | "PERFORMANCE"
    | "REDUNDANCY"
    | "END_OF_CONTRACT"
    | "MUTUAL_AGREEMENT"
    | "DEATH"
    | "OTHER"
    | null;
  resignationDate?: Date | null;
  retirementDate?: Date | null;
}

/**
 * Employment status transition: pure state machine validated first, then
 * persisted with an appended statusHistory entry (plan §4). Denormalizes
 * the current status onto Employee (single-writer: this function).
 * Terminal transitions require their matching dates/reason (ADR-010 §2).
 */
export async function changeEmploymentStatus(
  caller: WorkforceSubject,
  organizationId: string,
  employmentId: string,
  input: EmploymentTransitionInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string; status: EmploymentStatusValue }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.employment.status_change",
        resourceType: "Employment",
        resourceId: employmentId,
        before: { status: undefined as EmploymentStatusValue | undefined },
        after: { status: input.to, note: input.note ?? undefined },
      },
      async (tx) => {
        const employment = await tx.employment.findFirst({
          where: {
            id: employmentId,
            tenantId: caller.tenantId,
            organizationId, // org scoping from session context, never client
          },
          select: { id: true, status: true, version: true, employeeId: true },
        });
        if (!employment) notFound("Employment");
        const from = employment.status as EmploymentStatusValue;
        assertEmploymentTransition(from, input.to);
        assertSeparationRequirements(input.to, {
          terminationDate: input.terminationDate,
          terminationReason: input.terminationReason,
          resignationDate: input.resignationDate,
          retirementDate: input.retirementDate,
        });

        const history = await loadStatusHistory(tx, employment.id);
        const historyEntry: StatusHistoryEntry = {
          status: input.to,
          changedAt: new Date().toISOString(),
          changedBy: caller.userId,
          note: input.note ?? undefined,
        };

        await tx.employment.update({
          where: { id: employment.id },
          data: {
            status: input.to,
            statusHistory: appendStatusHistory(
              history,
              historyEntry,
            ) as unknown as Prisma.InputJsonValue,
            ...(input.to === "TERMINATED"
              ? {
                  terminationDate: input.terminationDate,
                  terminationReason: input.terminationReason,
                }
              : {}),
            ...(input.to === "RESIGNED" ? { resignationDate: input.resignationDate } : {}),
            ...(input.to === "RETIRED" ? { retirementDate: input.retirementDate } : {}),
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });

        // Denormalized employee status mirror (plan §2): updated only here.
        const employeeLeftOn = isTerminal(input.to)
          ? (input.terminationDate ?? input.resignationDate ?? input.retirementDate ?? null)
          : null;
        await tx.employee.update({
          where: { id: employment.employeeId },
          data: {
            employmentStatus: input.to,
            leftOn: employeeLeftOn,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });

        return { id: employment.id, status: input.to };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

function isTerminal(status: EmploymentStatusValue): boolean {
  return status === "TERMINATED" || status === "RESIGNED" || status === "RETIRED";
}

async function loadStatusHistory(tx: Tx, employmentId: string): Promise<StatusHistoryEntry[]> {
  const row = await tx.employment.findUnique({
    where: { id: employmentId },
    select: { statusHistory: true },
  });
  const history = (row?.statusHistory ?? []) as unknown;
  return Array.isArray(history) ? (history as StatusHistoryEntry[]) : [];
}

// ── Employee lifecycle (archival) ────────────────────────────────────────────

/**
 * Archive an employee record: only allowed when no OPEN assignment exists
 * and the employment is terminal or INACTIVE — an archived employee leaves
 * the active workforce without destroying history (plan §12/§14).
 */
export async function archiveEmployee(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
  expectedVersion: number,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      { action: "employee.archive", resourceType: "Employee", resourceId: employeeId },
      async (tx) => {
        const employee = await tx.employee.findFirst({
          where: {
            id: employeeId,
            tenantId: caller.tenantId,
            organizationId,
            status: { not: "ARCHIVED" },
          },
          select: { id: true, version: true, employmentStatus: true },
        });
        if (!employee) notFound("Employee");
        assertVersionMatches(employee, expectedVersion, "Employee");
        if (
          !isTerminal(employee.employmentStatus as EmploymentStatusValue) &&
          employee.employmentStatus !== "INACTIVE"
        ) {
          throw new WorkforceAppError(
            "EMPLOYMENT_STATE_INVALID",
            "Only separated (or inactive) employees can be archived; use employment status transitions first.",
          );
        }
        const openAssignment = await tx.employmentAssignment.findFirst({
          where: {
            tenantId: caller.tenantId,
            organizationId,
            employment: { employeeId },
            effectiveTo: null,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (openAssignment) {
          throw new WorkforceAppError(
            "RELATIONSHIP_INVALID",
            "Employee still has an open assignment; close it before archiving.",
          );
        }
        return tx.employee.update({
          where: { id: employee.id },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
          select: { id: true },
        });
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Sensitive projection (single choke point; plan §5.3) ────────────────────

export interface EmployeeDetail {
  id: string;
  employeeNo: string;
  employeeType: string;
  employmentStatus: string;
  person: {
    id: string;
    firstName: string;
    lastName: string;
    preferredName: string | null;
    email: string | null;
    phone: string | null;
    // Sensitive — null unless the sensitive projection ran:
    dateOfBirth: Date | null;
    addressLine1: string | null;
    addressLine2: string | null;
  };
  sensitiveViewed: boolean;
}

/**
 * The ONE function that may serve sensitive fields (plan §5.3): without the
 * employee:read:sensitive permission + SENSITIVE scope, dateOfBirth and
 * address are stripped to null BEFORE leaving the service; with them, an
 * employee.sensitive.view audit event is written (ADR-005 view-protected-
 * record class) recording WHO viewed WHOM — field values still never enter
 * the payload.
 */
export async function getEmployeeDetail(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
  ctx?: RequestAuditContext,
): Promise<EmployeeDetail> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    const employee = await prisma.employee.findFirst({
      // Tenant + org scoped: unique constraint includes both, so this can
      // never return another tenant's row (IDOR-safe deny-by-default).
      where: {
        id: employeeId,
        tenantId: caller.tenantId,
        organizationId,
        status: { not: "ARCHIVED" },
      },
      select: {
        id: true,
        employeeNo: true,
        employeeType: true,
        employmentStatus: true,
        personId: true,
      },
    });
    if (!employee) notFound("Employee");
    const person = await prisma.person.findFirst({
      where: { id: employee.personId, tenantId: caller.tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        addressLine1: true,
        addressLine2: true,
      },
    });
    if (!person) notFound("Person");

    // Sensitive gate AFTER existence check (no existence oracle through
    // error-code differences): decide projection, then write the view event.
    let sensitiveViewed = false;
    try {
      await assertSensitiveAccess(caller, organizationId);
      sensitiveViewed = true;
      await transactWithAudit(
        caller,
        ctx,
        {
          action: "employee.sensitive.view",
          resourceType: "Person",
          resourceId: person.id,
          after: { employeeId, fields: ["dateOfBirth", "addressLine1", "addressLine2"] },
        },
        async () => true,
      );
    } catch (err) {
      // Expected denial path — swallow only the specific restriction error;
      // anything else propagates (never accidentally widen access).
      if (!(err instanceof WorkforceAppError) || err.code !== "SENSITIVE_FIELD_RESTRICTED") {
        throw err;
      }
    }

    return {
      id: employee.id,
      employeeNo: employee.employeeNo,
      employeeType: employee.employeeType,
      employmentStatus: employee.employmentStatus,
      person: {
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        preferredName: person.preferredName,
        email: person.email,
        phone: person.phone,
        // Sensitive projection: stripped unless authorized above.
        dateOfBirth: sensitiveViewed ? person.dateOfBirth : null,
        addressLine1: sensitiveViewed ? person.addressLine1 : null,
        addressLine2: sensitiveViewed ? person.addressLine2 : null,
      },
      sensitiveViewed,
    };
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── Assignment handover (ADR-010 §3) ─────────────────────────────────────────

export interface CreateAssignmentInput {
  organizationId: string;
  employmentId: string;
  positionId?: string | null;
  departmentId?: string | null;
  teamId?: string | null;
  designationId?: string | null;
  workLocationId?: string | null;
  facilityId?: string | null;
  managerEmploymentId?: string | null;
  effectiveFrom: Date;
  /** Opening a replacement closes the current open assignment at this date. */
  closeCurrentAt?: Date | null;
}

/**
 * Create an assignment row. Enforces (plan §4, ADR-010 §3):
 *  - valid half-open period,
 *  - all referenced org entities belong to the same tenant + organization,
 *  - manager employment same org, not self, no cycle,
 *  - AT MOST ONE open assignment per employment: opening a second requires
 *    closeCurrentAt (handover) — the previous is closed in the SAME
 *    transaction and the DB partial unique index backs this up under
 *    concurrency.
 */
export async function createAssignment(
  caller: WorkforceSubject,
  input: CreateAssignmentInput,
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  await assertCallerCanManageEmployees(caller, input.organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.assignment.create",
        resourceType: "EmploymentAssignment",
        after: {
          employmentId: input.employmentId,
          positionId: input.positionId ?? null,
          departmentId: input.departmentId ?? null,
          teamId: input.teamId ?? null,
          managerEmploymentId: input.managerEmploymentId ?? null,
          effectiveFrom: input.effectiveFrom.toISOString(),
        },
      },
      async (tx) => {
        const employment = await tx.employment.findFirst({
          where: {
            id: input.employmentId,
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
          },
          select: { id: true, status: true, employeeId: true },
        });
        if (!employment) notFound("Employment");

        assertValidPeriod({
          effectiveFrom: input.effectiveFrom,
          effectiveTo: null,
        });

        // Scope-validate referenced entities: every FK must resolve inside
        // this tenant + organization (relationship consistency, plan §VALIDATION).
        await assertEntityInScope(
          tx,
          caller.tenantId,
          input.organizationId,
          "position",
          input.positionId,
        );
        await assertEntityInScope(
          tx,
          caller.tenantId,
          input.organizationId,
          "department",
          input.departmentId,
        );
        await assertEntityInScope(tx, caller.tenantId, input.organizationId, "team", input.teamId);
        await assertEntityInScope(
          tx,
          caller.tenantId,
          input.organizationId,
          "designation",
          input.designationId,
        );
        await assertLocationInScope(tx, caller.tenantId, input.workLocationId);
        await assertEntityInScope(
          tx,
          caller.tenantId,
          input.organizationId,
          "facility",
          input.facilityId,
        );

        if (input.managerEmploymentId) {
          if (input.managerEmploymentId === input.employmentId) {
            throw new WorkforceAppError(
              "RELATIONSHIP_INVALID",
              "An employment cannot be its own manager.",
            );
          }
          const manager = await tx.employment.findFirst({
            where: {
              id: input.managerEmploymentId,
              tenantId: caller.tenantId,
              organizationId: input.organizationId,
            },
            select: { id: true },
          });
          if (!manager) {
            throw new WorkforceAppError(
              "RELATIONSHIP_INVALID",
              "Manager employment must belong to the same organization.",
            );
          }
        }

        const currentOpen = await tx.employmentAssignment.findFirst({
          where: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employmentId: input.employmentId,
            status: "ACTIVE",
            effectiveTo: null,
          },
          select: { id: true, effectiveFrom: true },
        });

        if (currentOpen) {
          if (!input.closeCurrentAt) {
            throw new WorkforceAppError(
              "CONFLICT_ASSIGNMENT_OVERLAP",
              "Employment already has an open assignment; provide closeCurrentAt to hand over.",
            );
          }
          if (input.closeCurrentAt < currentOpen.effectiveFrom) {
            throw new WorkforceAppError(
              "CONFLICT_ASSIGNMENT_OVERLAP",
              "Handover date cannot precede the open assignment's start.",
            );
          }
          if (input.effectiveFrom < input.closeCurrentAt) {
            throw new WorkforceAppError(
              "CONFLICT_ASSIGNMENT_OVERLAP",
              "Replacement assignment cannot start before the handover date.",
            );
          }
          // Same-transaction handover (ADR-010 §3): close old, then open new.
          await tx.employmentAssignment.update({
            where: { id: currentOpen.id },
            data: {
              effectiveTo: input.closeCurrentAt,
              version: { increment: 1 },
              updatedBy: caller.userId,
            },
          });
        }

        const assignment = await tx.employmentAssignment.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employmentId: input.employmentId,
            positionId: input.positionId ?? null,
            departmentId: input.departmentId ?? null,
            teamId: input.teamId ?? null,
            designationId: input.designationId ?? null,
            workLocationId: input.workLocationId ?? null,
            facilityId: input.facilityId ?? null,
            managerEmploymentId: input.managerEmploymentId ?? null,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: null,
          },
          select: { id: true },
        });

        // Position occupancy derives from the OPEN assignment (ADR-010 §2):
        // flip referenced position to FILLED when the assignment opens.
        if (input.positionId) {
          await tx.position.update({
            where: { id: input.positionId },
            data: { status: "FILLED", version: { increment: 1 }, updatedBy: caller.userId },
          });
        }

        return assignment;
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/** Close the open assignment (e.g. on separation) without a replacement. */
export async function closeOpenAssignment(
  caller: WorkforceSubject,
  organizationId: string,
  employmentId: string,
  effectiveTo: Date,
  ctx?: RequestAuditContext,
): Promise<{ id: string | null }> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    return await transactWithAudit(
      caller,
      ctx,
      {
        action: "employee.assignment.close",
        resourceType: "EmploymentAssignment",
        after: { employmentId, effectiveTo: effectiveTo.toISOString() },
      },
      async (tx) => {
        const open = await tx.employmentAssignment.findFirst({
          where: {
            tenantId: caller.tenantId,
            organizationId,
            employmentId,
            status: "ACTIVE",
            effectiveTo: null,
          },
          select: { id: true, effectiveFrom: true, positionId: true },
        });
        if (!open) return { id: null };
        if (effectiveTo < open.effectiveFrom) {
          throw new WorkforceAppError(
            "CONFLICT_ASSIGNMENT_OVERLAP",
            "Close date cannot precede the assignment start.",
          );
        }
        await tx.employmentAssignment.update({
          where: { id: open.id },
          data: { effectiveTo, version: { increment: 1 }, updatedBy: caller.userId },
        });
        if (open.positionId) {
          await tx.position.update({
            where: { id: open.positionId },
            data: { status: "VACANT", version: { increment: 1 }, updatedBy: caller.userId },
          });
        }
        return { id: open.id };
      },
    );
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

export async function listAssignments(
  caller: WorkforceSubject,
  organizationId: string,
  employmentId: string,
): Promise<
  {
    id: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    open: boolean;
    positionId: string | null;
  }[]
> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    const rows = await prisma.employmentAssignment.findMany({
      where: {
        tenantId: caller.tenantId,
        organizationId,
        employmentId,
      },
      orderBy: { effectiveFrom: "desc" },
      select: { id: true, effectiveFrom: true, effectiveTo: true, positionId: true },
    });
    return rows.map((r) => ({
      id: r.id,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      positionId: r.positionId,
      open: isOpen(r),
    }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

// ── scope-check helpers ──────────────────────────────────────────────────────

type ScopedEntity = "position" | "department" | "team" | "designation" | "facility";

async function assertEntityInScope(
  tx: Tx,
  tenantId: string,
  organizationId: string,
  entity: ScopedEntity,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  const found = await (entity === "position"
    ? tx.position.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } })
    : entity === "department"
      ? tx.department.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } })
      : entity === "team"
        ? tx.team.findFirst({ where: { id, tenantId, organizationId }, select: { id: true } })
        : entity === "designation"
          ? tx.designation.findFirst({
              where: { id, tenantId, organizationId },
              select: { id: true },
            })
          : tx.facility.findFirst({
              where: { id, tenantId, organizationId },
              select: { id: true },
            }));
  if (!found) {
    throw new WorkforceAppError(
      "RELATIONSHIP_INVALID",
      `Referenced ${entity} does not exist in this organization.`,
      entity,
    );
  }
}

async function assertLocationInScope(
  tx: Tx,
  tenantId: string,
  id: string | null | undefined,
): Promise<void> {
  if (!id) return;
  const found = await tx.location.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });
  if (!found) {
    throw new WorkforceAppError(
      "RELATIONSHIP_INVALID",
      "Referenced location does not exist in this tenant.",
      "workLocationId",
    );
  }
}
