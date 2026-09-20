/**
 * Separation workflow application service (Slice 1.1; brief Â§44â€“46).
 *
 * Binds the employment lifecycle (employment-status.ts) to the workflow
 * primitives (Slice 1.0): requesting a separation creates an ApprovalRequest
 * (sourceType SEPARATION, destination carried on the namespaced requestType);
 * once APPROVED, applySeparation executes the terminal transition and
 * materializes the exit-clearance tasks (Â§46) plus notifications.
 *
 * Authorization (default deny): every entry point requires EMPLOYEE_MANAGE
 * (assertCallerCanManageEmployees) against the EMPLOYEE's organization row â€”
 * the org id comes from the database (authoritative), never from client
 * input (AGENTS.md). Approvers can never approve their own request (domain
 * separation of duties in the workflow engine).
 *
 * Tenancy: all id resolution is tenant-scoped first (IDOR posture); applying
 * a foreign approval is a NOT_FOUND, never a leak.
 */
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "./types";
import {
  WorkforceAppError,
  toWorkforceAppError,
  type WorkforceAppErrorCode,
} from "./app-errors";
import {
  WorkflowsAppError,
  type WorkflowsAppErrorCode,
} from "@/modules/workflows/service/app-errors";
import { assertCallerCanManageEmployees } from "./mutations";
import { accessibleOrganizationIds } from "@/lib/auth/scopes";
import { changeEmploymentStatus } from "./employee-service";
import {
  createApprovalRequest,
  decideApproval,
  listPendingApprovals,
  createTask,
  type ApprovalView,
} from "@/modules/workflows/service/workflow-service";
import type { ApprovalStatus } from "@/modules/workflows/domain/workflow";
import { createNotification } from "@/modules/notifications/service/notifications-service";
import {
  assertSeparationApplicable,
  assertSeparationRequestAllowed,
  assertSeparationRequirements,
  deriveSeparationClearance,
  isSeparationRequestType,
  separationDestinationFromRequestType,
  separationRequestType,
  type SeparationDestination,
} from "../domain/separation";
import type { EmploymentStatusValue } from "../domain/employment-status";

export type { SeparationDestination };

export interface RequestSeparationInput {
  employeeId: string;
  to: SeparationDestination;
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
  note?: string | null;
  approverUserId?: string | null;
}

export interface ApplySeparationInput {
  approvalId: string;
  expectedVersion: number;
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
  note?: string | null;
}

interface EmploymentRef {
  id: string;
  status: EmploymentStatusValue;
}

/** The employee's live (non-terminal) employment, else the most recent. */
async function findSeparationEmployment(
  client: Pick<typeof prisma, "employment">,
  tenantId: string,
  employeeId: string,
): Promise<EmploymentRef | null> {
  const employments = await client.employment.findMany({
    where: { tenantId, employeeId },
    orderBy: { createdAt: "asc" },
    select: { id: true, status: true },
  });
  if (employments.length === 0) return null;
  const live = employments.find(
    (e) => e.status !== "TERMINATED" && e.status !== "RESIGNED" && e.status !== "RETIRED",
  );
  return live ?? employments[employments.length - 1] ?? null;
}

function effectData(input: RequestSeparationInput | ApplySeparationInput) {
  return {
    terminationDate: ("terminationDate" in input ? input.terminationDate : undefined) ?? null,
    terminationReason: ("terminationReason" in input ? input.terminationReason : undefined) ?? null,
    resignationDate: ("resignationDate" in input ? input.resignationDate : undefined) ?? null,
    retirementDate: ("retirementDate" in input ? input.retirementDate : undefined) ?? null,
  };
}

const WORKFLOWS_CODE_MAP: Partial<Record<WorkflowsAppErrorCode, WorkforceAppErrorCode>> = {
  VALIDATION_FAILED: "EMPLOYMENT_STATE_INVALID",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
  NOT_FOUND: "NOT_FOUND",
  RESOURCE_CONFLICT: "RESOURCE_CONFLICT",
  STATE_INVALID: "EMPLOYMENT_STATE_INVALID",
  UNEXPECTED: "UNEXPECTED",
};

/**
 * Error unification for this cross-context service: workforce errors pass
 * through untouched, workflow-engine errors (createApprovalRequest/createTask/
 * decideApproval) map into the workforce vocabulary so clients always get the
 * stable WorkforceAppError shape.
 */
function toWorkforceErr(err: unknown): WorkforceAppError {
  if (err instanceof WorkflowsAppError) {
    return new WorkforceAppError(
      WORKFLOWS_CODE_MAP[err.code] ?? "UNEXPECTED",
      err.message,
      err.field,
      err,
    );
  }
  return toWorkforceAppError(err);
}

/**
 * Request a separation: validated against the lifecycle machine, then raised
 * as an ApprovalRequest (PENDING when an approver is given, else queued
 * REQUESTED for the HR pool). The approver is notified of the pending call.
 */
export async function requestSeparation(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: RequestSeparationInput,
): Promise<{ approvalId: string; status: ApprovalStatus }> {
  try {
    const employee = await prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId: caller.tenantId },
      select: { id: true, organizationId: true, employeeNo: true },
    });
    if (!employee) {
      throw new WorkforceAppError("NOT_FOUND", "Employee not found.");
    }
    await assertCallerCanManageEmployees(caller, employee.organizationId);

    const employment = await findSeparationEmployment(prisma, caller.tenantId, employee.id);
    if (!employment) {
      throw new WorkforceAppError("NOT_FOUND", "No employment found for this employee.");
    }
    assertSeparationRequestAllowed(employment.status, input.to);
    assertSeparationRequirements(input.to, effectData(input));
    if (input.approverUserId && input.approverUserId === caller.userId) {
      throw new WorkforceAppError(
        "AUTHORIZATION_DENIED",
        "An approver cannot be the requester of the same separation.",
      );
    }

    const approval = await createApprovalRequest(caller, ctx, {
      organizationId: employee.organizationId,
      requestType: separationRequestType(input.to),
      subject: `Separation ${employee.employeeNo} â†’ ${input.to}`,
      rationale: input.note ?? input.terminationReason ?? null,
      approverUserId: input.approverUserId ?? null,
      sourceType: "SEPARATION",
      sourceId: employee.id,
    });

    if (input.approverUserId && input.approverUserId !== caller.userId) {
      await createNotification({
        recipientUserId: input.approverUserId,
        tenantId: caller.tenantId,
        organizationId: employee.organizationId,
        notificationType: "separation.request",
        title: `Separation approval needed: ${employee.employeeNo} â†’ ${input.to}`,
        message: input.note ?? null,
        entityType: "EMPLOYEE",
        entityId: employee.id,
        createdBy: caller.userId,
      });
    }

    return { approvalId: approval.id, status: approval.status };
  } catch (err) {
    throw toWorkforceErr(err);
  }
}

/**
 * Apply an APPROVED separation approval: execute the terminal employment
 * transition (changeEmploymentStatus â€” verified again inside), materialize
 * exit-clearance tasks, notify the requester, and emit the apply audit.
 */
export async function applySeparation(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ApplySeparationInput,
): Promise<{ employeeId: string; employmentId: string; status: SeparationDestination; clearanceTaskIds: string[] }> {
  try {
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: input.approvalId, tenantId: caller.tenantId },
    });
    if (!approval || approval.sourceType !== "SEPARATION" || !approval.sourceId) {
      throw new WorkforceAppError("NOT_FOUND", "Separation approval not found.");
    }
    assertSeparationApplicable(approval.status);
    const destination = separationDestinationFromRequestType(approval.requestType);
    if (!destination) {
      throw new WorkforceAppError(
        "EMPLOYMENT_STATE_INVALID",
        "Approval does not carry a separation destination.",
      );
    }
    assertSeparationRequirements(destination, effectData(input));

    const employee = await prisma.employee.findFirst({
      where: { id: approval.sourceId, tenantId: caller.tenantId },
      select: { id: true, organizationId: true, employeeNo: true },
    });
    if (!employee) {
      throw new WorkforceAppError("NOT_FOUND", "Employee not found.");
    }
    await assertCallerCanManageEmployees(caller, employee.organizationId);

    const employment = await findSeparationEmployment(prisma, caller.tenantId, employee.id);
    if (!employment) {
      throw new WorkforceAppError("NOT_FOUND", "No employment found for this employee.");
    }
    if (employment.status === destination) {
      throw new WorkforceAppError(
        "RESOURCE_CONFLICT",
        `Employee employment is already ${destination}; separations are applied once.`,
      );
    }

    const transition = await changeEmploymentStatus(caller, employee.organizationId, employment.id, {
      to: destination,
      note: input.note ?? approval.rationale ?? null,
      terminationDate: effectData(input).terminationDate,
      terminationReason: effectData(input).terminationReason,
      resignationDate: effectData(input).resignationDate,
      retirementDate: effectData(input).retirementDate,
    });

    const clearanceReference =
      effectData(input).terminationDate ??
      effectData(input).resignationDate ??
      effectData(input).retirementDate ??
      new Date();
    const drafts = deriveSeparationClearance(clearanceReference);
    const clearanceTaskIds: string[] = [];
    for (const draft of drafts) {
      const task = await createTask(caller, ctx, {
        organizationId: employee.organizationId,
        taskType: draft.taskType,
        subject: draft.subject,
        description: draft.description,
        priority: draft.priority,
        assigneeUserId: caller.userId,
        sourceType: "SEPARATION",
        sourceId: employee.id,
        dueDate: draft.dueDate,
      });
      clearanceTaskIds.push(task.id);
    }

    if (approval.requesterUserId && approval.requesterUserId !== caller.userId) {
      await createNotification({
        recipientUserId: approval.requesterUserId,
        tenantId: caller.tenantId,
        organizationId: employee.organizationId,
        notificationType: "separation.applied",
        title: `Separation applied: ${employee.employeeNo} â†’ ${destination}`,
        message: input.note ?? null,
        entityType: "EMPLOYEE",
        entityId: employee.id,
        createdBy: caller.userId,
      });
    }

    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "employee.separation.apply",
        resourceType: "Employee",
        resourceId: employee.id,
        before: { approvalStatus: approval.status, employmentStatus: employment.status },
        after: {
          status: transition.status,
          clearanceTaskIds,
          effectiveOn: clearanceReference.toISOString(),
        },
      },
      ctx ?? {},
    );

    return {
      employeeId: employee.id,
      employmentId: transition.id,
      status: transition.status as SeparationDestination,
      clearanceTaskIds,
    };
  } catch (err) {
    throw toWorkforceErr(err);
  }
}

/**
 * HR queue view: open separation approvals in the caller's organization.
 * Requires EMPLOYEE_MANAGE (enforced by listPendingApprovals).
 */
export async function listSeparationRequests(
  caller: WorkforceSubject,
  opts: { organizationId?: string | null } = {},
): Promise<ApprovalView[]> {
  try {
    const reach = await accessibleOrganizationIds(caller);
    // ABAC: an explicit target org must be within the caller's reach.
    if (opts.organizationId && reach !== "ALL" && !reach.includes(opts.organizationId)) {
      throw new WorkforceAppError(
        "AUTHORIZATION_DENIED",
        "You do not have access to that organization's queue.",
      );
    }
    let organizationId: string | undefined;
    if (opts.organizationId) {
      organizationId = opts.organizationId;
    } else if (caller.organizationId) {
      organizationId = caller.organizationId;
    } else if (reach === "ALL") {
      organizationId = undefined;
    } else if (reach.length === 1) {
      organizationId = reach[0];
    } else if (reach.length === 0) {
      throw new WorkforceAppError(
        "AUTHORIZATION_DENIED",
        "You do not have any organization scope.",
      );
    }
    // Multi-org calls list everything listPendingApprovals returns (already
    // tenant-scoped) restricted to the reachable set afterward.
    const pending = await listPendingApprovals(caller, { organizationId });
    const separationQueue =
      reach === "ALL" || reach.length <= 1
        ? pending
        : pending.filter((a) => a.organizationId && reach.includes(a.organizationId));
    return separationQueue.filter((a) => isSeparationRequestType(a.requestType));
  } catch (err) {
    throw toWorkforceErr(err);
  }
}

/** Decide a separation approval through the workflow engine (Assigned approver or EMPLOYEE_MANAGE). */
export async function decideSeparation(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { approvalId: string; decision: "APPROVED" | "REJECTED"; note?: string | null; expectedVersion: number },
): Promise<ApprovalView> {
  try {
    const approval = await decideApproval(caller, ctx, {
      approvalId: input.approvalId,
      decision: input.decision,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
    });
    return approval;
  } catch (err) {
    throw toWorkforceErr(err);
  }
}
