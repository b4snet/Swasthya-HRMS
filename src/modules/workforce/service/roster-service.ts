/**
 * Workforce roster/management-scope services (Phase 2, prompt 3).
 *
 * Manager-scoped and department-scoped reads (plan §5): a manager sees the
 * employees whose OPEN assignment names one of the manager's own employments
 * as managerEmploymentId; a department-scoped grant (scopeType DEPARTMENT)
 * reaches the department subtree. Every path resolves ids from the CALLER's
 * session-resolved context — an arbitrary guessed employeeId can never
 * widen reach (the employee must be provably inside the caller's derived
 * reach set, otherwise NOT_FOUND).
 */
import { prisma } from "@/lib/db";
import { WorkforceAppError, toWorkforceAppError } from "./app-errors";
import {
  assertCallerCanManageEmployees,
  assertCallerCanReadEmployees,
  assertSensitiveAccess,
  notFound,
} from "./mutations";
import { transactWithAudit } from "./mutations";
import type { RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "./types";

export interface EmployeeListItem {
  id: string;
  employeeNo: string;
  employeeType: string;
  employmentStatus: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

export interface RosterReach {
  /** Org-wide reach (employee:read + ORGANIZATION grant). */
  organizationWide: boolean;
  /** Department ids the caller may see (DEPARTMENT grants, resolved to subtrees). */
  departmentIds: string[];
  /** Employment ids the caller manages (manager reach). */
  managedEmploymentIds: string[];
}

/**
 * Derive the caller's reach WITHOUT trusting any client input:
 *  - SUPER_ADMIN or an ORGANIZATION grant → whole org,
 *  - DEPARTMENT grants → those departments + their subtrees,
 *  - manager reach → employments whose OPEN assignment names an employment
 *    belonging to one of the caller's own (via the caller's linked person,
 *    if any; otherwise empty — managers without an employee record have no
 *    manager reach and fall back to grants).
 */
export async function deriveRosterReach(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<RosterReach> {
  const isSuper = caller.systemRoles.includes("SYSTEM_ROLE_SUPER_ADMIN");
  const orgGrant = await prisma.userAccessScope.findFirst({
    where: {
      userId: caller.userId,
      scopeType: "ORGANIZATION",
      scopeId: organizationId,
      revokedAt: null,
    },
    select: { id: true },
  });

  // Department reach: DEPARTMENT scope rows; scopeIds are validated against
  // departments of THIS organization (a grant for another org's department
  // never widens reach here), then expanded to each subtree.
  const deptGrants = await prisma.userAccessScope.findMany({
    where: {
      userId: caller.userId,
      scopeType: "DEPARTMENT",
      revokedAt: null,
    },
    select: { scopeId: true },
  });
  const deptGrantIds = deptGrants.map((g) => g.scopeId);
  const validDeptGrants = deptGrantIds.length
    ? await prisma.department.findMany({
        where: {
          id: { in: deptGrantIds },
          tenantId: caller.tenantId,
          organizationId,
          status: { not: "ARCHIVED" },
        },
        select: { id: true },
      })
    : [];
  const departmentIds = await expandDepartmentSubtrees(
    caller.tenantId,
    organizationId,
    validDeptGrants.map((d) => d.id),
  );

  // Manager reach: MANAGER scope rows whose scopeId is an employment of
  // this organization (User.personId linking is a documented future hook,
  // so manager reach is granted explicitly rather than inferred).
  const managerGrants = await prisma.userAccessScope.findMany({
    where: {
      userId: caller.userId,
      scopeType: "MANAGER",
      revokedAt: null,
    },
    select: { scopeId: true },
  });
  const managerEmploymentIds = managerGrants.length
    ? (
        await prisma.employment.findMany({
          where: {
            id: { in: managerGrants.map((g) => g.scopeId) },
            tenantId: caller.tenantId,
            organizationId,
          },
          select: { id: true },
        })
      ).map((e) => e.id)
    : [];

  return {
    organizationWide: isSuper || orgGrant !== null,
    departmentIds,
    managedEmploymentIds: managerEmploymentIds,
  };
}

async function expandDepartmentSubtrees(
  tenantId: string,
  organizationId: string,
  rootIds: string[],
): Promise<string[]> {
  if (rootIds.length === 0) return [];
  const all = await prisma.department.findMany({
    where: { tenantId, organizationId, status: { not: "ARCHIVED" } },
    select: { id: true, parentId: true },
  });
  const byParent = new Map<string | null, string[]>();
  for (const d of all) {
    const list = byParent.get(d.parentId) ?? [];
    list.push(d.id);
    byParent.set(d.parentId, list);
  }
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop();
    if (!id || out.has(id)) continue;
    out.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return [...out];
}

/**
 * List employees inside the caller's derived reach. IDs come only from the
 * caller's grants — a guessed employeeId is irrelevant here because list
 * membership is computed, never filtered by client-supplied ids.
 */
export async function listEmployeesInReach(
  caller: WorkforceSubject,
  organizationId: string,
): Promise<EmployeeListItem[]> {
  try {
    const reach = await deriveRosterReach(caller, organizationId);
    if (
      !reach.organizationWide &&
      reach.departmentIds.length === 0 &&
      reach.managedEmploymentIds.length === 0
    ) {
      return []; // default deny: no reach, no rows
    }

    const where = {
      tenantId: caller.tenantId,
      organizationId,
      status: { not: "ARCHIVED" as const },
      ...(reach.organizationWide
        ? {}
        : {
            OR: [
              // Department reach: OPEN (or any non-archived) assignment in a reached department.
              {
                employments: {
                  some: {
                    assignments: {
                      some: { departmentId: { in: reach.departmentIds } },
                    },
                  },
                },
              },
              // Manager reach: OPEN assignment naming the caller's employments.
              {
                employments: {
                  some: {
                    assignments: {
                      some: {
                        managerEmploymentId: { in: reach.managedEmploymentIds },
                        status: "ACTIVE" as const,
                        effectiveTo: null,
                      },
                    },
                  },
                },
              },
            ],
          }),
    };

    const rows = await prisma.employee.findMany({
      where,
      orderBy: [{ employeeNo: "asc" }],
      select: {
        id: true,
        employeeNo: true,
        employeeType: true,
        employmentStatus: true,
        person: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      employeeNo: r.employeeNo,
      employeeType: r.employeeType,
      employmentStatus: r.employmentStatus,
      firstName: r.person.firstName,
      lastName: r.person.lastName,
      preferredName: r.person.preferredName,
    }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/**
 * Manager-scoped detail read: allowed only when the target employee's OPEN
 * assignment names one of the caller's managed employments, or the caller
 * has ordinary read reach. This is the IDOR-sensitive path — direct object
 * ids outside the derived reach surface as NOT_FOUND.
 */
export async function getEmployeeForManager(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
): Promise<EmployeeListItem> {
  try {
    const employee = await prisma.employee.findFirst({
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
        person: { select: { firstName: true, lastName: true, preferredName: true } },
      },
    });
    if (!employee) notFound("Employee");

    const reach = await deriveRosterReach(caller, organizationId);
    if (reach.organizationWide) {
      return shape(employee);
    }

    // OPEN assignment check: does the caller manage this employee?
    if (reach.managedEmploymentIds.length > 0) {
      const managed = await prisma.employmentAssignment.findFirst({
        where: {
          tenantId: caller.tenantId,
          organizationId,
          managerEmploymentId: { in: reach.managedEmploymentIds },
          status: "ACTIVE",
          effectiveTo: null,
          employment: { employeeId },
        },
        select: { id: true },
      });
      if (managed) return shape(employee);
    }

    // Department reach: is the employee assigned inside a reached department?
    if (reach.departmentIds.length > 0) {
      const inDept = await prisma.employmentAssignment.findFirst({
        where: {
          tenantId: caller.tenantId,
          organizationId,
          departmentId: { in: reach.departmentIds },
          employment: { employeeId },
        },
        select: { id: true },
      });
      if (inDept) return shape(employee);
    }

    // Default deny: existence outside reach is never disclosed.
    notFound("Employee");
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

type EmployeeRow = {
  id: string;
  employeeNo: string;
  employeeType: string;
  employmentStatus: string;
  person: { firstName: string; lastName: string; preferredName: string | null };
};

function shape(row: EmployeeRow): EmployeeListItem {
  return {
    id: row.id,
    employeeNo: row.employeeNo,
    employeeType: row.employeeType,
    employmentStatus: row.employmentStatus,
    firstName: row.person.firstName,
    lastName: row.person.lastName,
    preferredName: row.person.preferredName,
  };
}

/**
 * Self-record read: maps the session user to their OWN employee record.
 *
 * ADR-010 defers User↔Person identity linking (an additive `User.personId`
 * migration is the planned hook), so NO user has a linked record in Phase 2
 * and this returns null by construction — never another person's record.
 * When the linking migration lands, this function lights up without any
 * API change (Prompt 4 renders the "not linked" state meanwhile).
 */
export async function getOwnEmployeeSummary(
  _caller: WorkforceSubject,
): Promise<EmployeeListItem | null> {
  try {
    // Identity linking hook (ADR-010): User.personId does not exist yet.
    // Deliberately no name/email heuristic — matching login identity to HR
    // identity by mutable fields would be an authorization hole.
    return null;
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/**
 * Self-service contact update (own record only). Same identity-linking
 * boundary as getOwnEmployeeSummary: until the linking migration lands,
 * every caller receives NOT_LINKED rather than touching any person row.
 */
export async function updateOwnContactInfo(
  caller: WorkforceSubject,
  input: { email?: string; phone?: string; expectedVersion: number },
  ctx?: RequestAuditContext,
): Promise<{ id: string }> {
  void input;
  void ctx;
  void caller;
  throw new WorkforceAppError("NOT_LINKED", "No employee record is linked to your account yet.");
}

/** Self-record reach never depends on client ids — export for API layer. */
export type { WorkforceSubject };

// ── Profile aggregation + manager candidates (Prompt 4 UI reads) ────────────

export interface EmployeeProfile {
  employee: {
    id: string;
    employeeNo: string;
    employeeType: string;
    employmentStatus: string;
    hiredOn: Date | null;
    leftOn: Date | null;
    status: string;
    version: number;
    person: {
      id: string;
      version: number;
      firstName: string;
      lastName: string;
      preferredName: string | null;
      email: string | null;
      phone: string | null;
      // Sensitive — null unless the sensitive grant was honored (plan §5.3).
      dateOfBirth: Date | null;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      province: string | null;
      country: string | null;
      postalCode: string | null;
    };
  };
  employments: Array<{
    id: string;
    employmentNo: string;
    type: string;
    status: string;
    hireDate: Date;
    contractEndDate: Date | null;
    probationEndDate: Date | null;
    workerClassification: string;
    noticePeriodDays: number | null;
    terminationDate: Date | null;
    resignationDate: Date | null;
    retirementDate: Date | null;
    workLocationId: string | null;
    facilityId: string | null;
    statusHistory: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
  }>;
  /** Person-level SENSITIVE data view was granted and audited. */
  sensitiveViewed: boolean;
}

/**
 * Full profile read for the employee UI (Prompt 4). Same sensitive posture
 * as getEmployeeDetail: DOB/address pass ONLY through the audited
 * sensitive projection; identity/contact fields are org-guarded reads.
 */
export async function getEmployeeProfile(
  caller: WorkforceSubject,
  organizationId: string,
  employeeId: string,
  ctx?: RequestAuditContext,
): Promise<EmployeeProfile> {
  await assertCallerCanReadEmployees(caller, organizationId);
  try {
    const employee = await prisma.employee.findFirst({
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
        hiredOn: true,
        leftOn: true,
        status: true,
        version: true,
        personId: true,
      },
    });
    if (!employee) notFound("Employee");

    const person = await prisma.person.findFirst({
      where: { id: employee.personId, tenantId: caller.tenantId },
      select: {
        id: true,
        version: true,
        firstName: true,
        lastName: true,
        preferredName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        province: true,
        country: true,
        postalCode: true,
      },
    });
    if (!person) notFound("Person");

    const employments = await prisma.employment.findMany({
      where: { tenantId: caller.tenantId, organizationId, employeeId: employee.id },
      orderBy: { hireDate: "desc" },
      select: {
        id: true,
        employmentNo: true,
        type: true,
        status: true,
        hireDate: true,
        contractEndDate: true,
        probationEndDate: true,
        workerClassification: true,
        noticePeriodDays: true,
        terminationDate: true,
        resignationDate: true,
        retirementDate: true,
        workLocationId: true,
        facilityId: true,
        statusHistory: true,
      },
    });

    // Sensitive projection — the ONE gate, audited (same contract as
    // getEmployeeDetail; expected denial is swallowed, never widened).
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
          after: {
            employeeId,
            fields: ["dateOfBirth", "addressLine1", "addressLine2"],
          },
        },
        async () => true,
      );
    } catch (err) {
      if (!(err instanceof WorkforceAppError) || err.code !== "SENSITIVE_FIELD_RESTRICTED") {
        throw err;
      }
    }

    return {
      employee: {
        id: employee.id,
        employeeNo: employee.employeeNo,
        employeeType: employee.employeeType as string,
        employmentStatus: employee.employmentStatus as string,
        hiredOn: employee.hiredOn,
        leftOn: employee.leftOn,
        status: employee.status as string,
        version: employee.version,
        person: {
          id: person.id,
          version: person.version,
          firstName: person.firstName,
          lastName: person.lastName,
          preferredName: person.preferredName,
          email: person.email,
          phone: person.phone,
          dateOfBirth: sensitiveViewed ? person.dateOfBirth : null,
          addressLine1: sensitiveViewed ? person.addressLine1 : null,
          addressLine2: sensitiveViewed ? person.addressLine2 : null,
          city: person.city,
          province: person.province,
          country: person.country,
          postalCode: person.postalCode,
        },
      },
      employments: employments.map((e) => ({
        id: e.id,
        employmentNo: e.employmentNo,
        type: e.type as string,
        status: e.status as string,
        hireDate: e.hireDate,
        contractEndDate: e.contractEndDate,
        probationEndDate: e.probationEndDate,
        workerClassification: e.workerClassification as string,
        noticePeriodDays: e.noticePeriodDays,
        terminationDate: e.terminationDate,
        resignationDate: e.resignationDate,
        retirementDate: e.retirementDate,
        workLocationId: e.workLocationId,
        facilityId: e.facilityId,
        statusHistory: Array.isArray(e.statusHistory)
          ? (e.statusHistory as EmployeeProfile["employments"][number]["statusHistory"])
          : [],
      })),
      sensitiveViewed,
    };
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}

/**
 * Manager candidates for the assignment dialog: ACTIVE employments of this
 * org, excluding the employment being assigned. Self-assignment is also
 * rejected in the domain layer; this narrows the picker honestly.
 */
export async function listManagerCandidates(
  caller: WorkforceSubject,
  organizationId: string,
  excludeEmploymentId?: string,
): Promise<
  Array<{
    employmentId: string;
    employeeId: string;
    label: string;
  }>
> {
  await assertCallerCanManageEmployees(caller, organizationId);
  try {
    const rows = await prisma.employment.findMany({
      where: {
        tenantId: caller.tenantId,
        organizationId,
        status: "ACTIVE",
        ...(excludeEmploymentId ? { id: { not: excludeEmploymentId } } : {}),
      },
      orderBy: { employmentNo: "asc" },
      select: {
        id: true,
        employee: {
          select: {
            id: true,
            employeeNo: true,
            person: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      employmentId: r.id,
      employeeId: r.employee.id,
      label: `${r.employee.person.firstName} ${r.employee.person.lastName} (${r.employee.employeeNo})`,
    }));
  } catch (err) {
    throw toWorkforceAppError(err);
  }
}
