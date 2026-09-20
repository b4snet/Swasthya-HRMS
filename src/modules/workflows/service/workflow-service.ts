/**
 * Workflow primitives application service (Phase 0 hardening; Slice 1.0;
 * brief §55).
 *
 * Reusable approval + task engine for future domains (leave, transfer,
 * separation, onboarding…). Every write commits with its AuditEvent in ONE
 * transaction (ADR-005) and bumps `version` (optimistic concurrency, same as
 * credentials). All tenant scoping uses the session caller; resource ids are
 * resolved tenant-scoped before any authorization decision (IDOR posture).
 *
 * Authorization (default deny):
 *  - State transitions always require the state to be assignable per the
 *    pure domain rules (workflow.ts).
 *  - `decide` requires the assigned approver OR the EMPLOYEE_MANAGE
 *    permission (escalation); an approver can never decide their own request
 *    (separation of duties, enforced in domain).
 *  - Task work requires the assignee OR EMPLOYEE_MANAGE; assigning work to
 *    someone else (or leaving it unassigned) requires EMPLOYEE_MANAGE.
 *  - Org-wide queues (listPendingApprovals) require EMPLOYEE_MANAGE.
 */
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import { PERMISSIONS, rolesHavePermission } from "@/lib/auth/rbac";
import type { WorkforceSubject } from "@/modules/workforce/service/types";
import { createNotification, toIso } from "@/modules/notifications/service/notifications-service";
import { WorkflowsAppError, toWorkflowsAppError } from "./app-errors";
import {
  assertApprovalTransition,
  assertDecidable,
  assertRequesterIsNotApprover,
  assertTaskTransition,
  requireAssignee,
  requireRequester,
  canTransitionTask,
  type ApprovalDecision,
  type ApprovalStatus,
  type TaskPriority,
  type TaskStatus,
  type WorkflowSourceType,
} from "../domain/workflow";

export type WorkflowCaller = WorkforceSubject;

export interface ApprovalView {
  id: string;
  organizationId: string | null;
  requestType: string;
  subject: string;
  rationale: string | null;
  status: ApprovalStatus;
  requesterUserId: string | null;
  approverUserId: string | null;
  approverName: string | null;
  sourceType: WorkflowSourceType | null;
  sourceId: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  version: number;
}

export interface TaskView {
  id: string;
  organizationId: string | null;
  taskType: string;
  subject: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeUserId: string | null;
  sourceType: WorkflowSourceType | null;
  sourceId: string | null;
  dueDate: string | null;
  completedAt: string | null;
  completedBy: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  version: number;
}

const APPROVAL_VIEW_SELECT = {
  id: true,
  organizationId: true,
  requestType: true,
  subject: true,
  rationale: true,
  status: true,
  requesterUserId: true,
  approverUserId: true,
  approverName: true,
  sourceType: true,
  sourceId: true,
  requestedAt: true,
  decidedAt: true,
  decidedBy: true,
  decisionNote: true,
  version: true,
} as const;

const TASK_VIEW_SELECT = {
  id: true,
  organizationId: true,
  taskType: true,
  subject: true,
  description: true,
  priority: true,
  status: true,
  assigneeUserId: true,
  sourceType: true,
  sourceId: true,
  dueDate: true,
  completedAt: true,
  completedBy: true,
  cancelledAt: true,
  cancelledBy: true,
  version: true,
} as const;

function ensureActive(caller: WorkflowCaller): void {
  if (caller.status !== "ACTIVE") {
    throw new WorkflowsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
      reason: "USER_NOT_ACTIVE",
    });
  }
}

function canManageWorkflows(caller: WorkflowCaller): boolean {
  return rolesHavePermission(caller.systemRoles, PERMISSIONS.EMPLOYEE_MANAGE);
}

function notFound(what: string): never {
  throw new WorkflowsAppError("NOT_FOUND", `${what} not found.`);
}

function unauthorized(reason: string): never {
  throw new WorkflowsAppError(
    "AUTHORIZATION_DENIED",
    "You do not have permission to perform this action.",
    undefined,
    {
      reason,
    },
  );
}

function assertVersionMatches(
  current: { id: string; version: number },
  expectedVersion: number,
  what: string,
): void {
  if (current.version !== expectedVersion) {
    throw new WorkflowsAppError(
      "RESOURCE_CONFLICT",
      `${what} changed since it was read (expected v${expectedVersion}, at v${current.version}); reload and retry.`,
    );
  }
}

function toApprovalView(row: {
  id: string;
  organizationId: string | null;
  requestType: string;
  subject: string;
  rationale: string | null;
  status: ApprovalStatus;
  requesterUserId: string | null;
  approverUserId: string | null;
  approverName: string | null;
  sourceType: WorkflowSourceType | null;
  sourceId: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
  version: number;
}): ApprovalView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    requestType: row.requestType,
    subject: row.subject,
    rationale: row.rationale,
    status: row.status,
    requesterUserId: row.requesterUserId,
    approverUserId: row.approverUserId,
    approverName: row.approverName,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: toIso(row.decidedAt),
    decidedBy: row.decidedBy,
    decisionNote: row.decisionNote,
    version: row.version,
  };
}

function toTaskView(row: {
  id: string;
  organizationId: string | null;
  taskType: string;
  subject: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeUserId: string | null;
  sourceType: WorkflowSourceType | null;
  sourceId: string | null;
  dueDate: Date | null;
  completedAt: Date | null;
  completedBy: string | null;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  version: number;
}): TaskView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    taskType: row.taskType,
    subject: row.subject,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    dueDate: toIso(row.dueDate),
    completedAt: toIso(row.completedAt),
    completedBy: row.completedBy,
    cancelledAt: toIso(row.cancelledAt),
    cancelledBy: row.cancelledBy,
    version: row.version,
  };
}

/* ── Approvals ───────────────────────────────────────────────────────────── */

export interface CreateApprovalInput {
  organizationId?: string | null;
  requestType: string;
  subject: string;
  rationale?: string | null;
  approverUserId?: string | null;
  sourceType?: WorkflowSourceType | null;
  sourceId?: string | null;
}

/**
 * Create an approval request for the caller (self-service) or on behalf of a
 * requester when the caller holds EMPLOYEE_MANAGE. Assigned approvals start
 * PENDING (actionable); unassigned start REQUESTED (queued for HR).
 */
async function createApprovalRequestInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: CreateApprovalInput,
): Promise<ApprovalView> {
  ensureActive(caller);
  const requesterUserId = caller.userId;
  requireRequester(requesterUserId);
  assertRequesterIsNotApprover(requesterUserId, input.approverUserId ?? null);

  const status: ApprovalStatus = input.approverUserId ? "PENDING" : "REQUESTED";

  return prisma.$transaction(async (tx) => {
    const row = await tx.approvalRequest.create({
      data: {
        tenantId: caller.tenantId,
        organizationId: input.organizationId ?? null,
        requestType: input.requestType,
        subject: input.subject,
        rationale: input.rationale ?? null,
        status,
        requesterUserId,
        approverUserId: input.approverUserId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        createdBy: caller.userId,
      },
      select: APPROVAL_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.approval.create",
        resourceType: "ApprovalRequest",
        resourceId: row.id,
        after: { status, requestType: input.requestType, subject: input.subject },
      },
      ctx ?? {},
      tx,
    );
    return toApprovalView(row);
  });
}

export interface AssignApproverInput {
  approvalId: string;
  approverUserId: string;
  expectedVersion: number;
}

/** Move a queued request (REQUESTED) to an actionable PENDING with an approver. */
async function assignApprovalApproverInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: AssignApproverInput,
): Promise<ApprovalView> {
  ensureActive(caller);
  if (!canManageWorkflows(caller)) unauthorized("MANAGE_REQUIRED");
  const row = await prisma.approvalRequest.findFirst({
    where: { id: input.approvalId, tenantId: caller.tenantId },
    include: { requester: { select: { id: true } } },
  });
  if (!row) notFound("Approval request");
  assertVersionMatches(row, input.expectedVersion, "Approval request");
  assertApprovalTransition(row.status, "PENDING");
  assertRequesterIsNotApprover(row.requesterUserId, input.approverUserId);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalRequest.update({
      where: { id: row.id },
      data: {
        status: "PENDING",
        approverUserId: input.approverUserId,
        version: { increment: 1 },
        updatedAt: new Date(),
        updatedBy: caller.userId,
      },
      select: APPROVAL_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.approval.assign",
        resourceType: "ApprovalRequest",
        resourceId: row.id,
        before: { status: row.status, version: row.version },
        after: {
          status: updated.status,
          version: updated.version,
          approverUserId: input.approverUserId,
        },
      },
      ctx ?? {},
      tx,
    );
    return toApprovalView(updated);
  });
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: ApprovalDecision;
  note?: string | null;
  expectedVersion: number;
}

/**
 * Decide an approval. The assigned approver decides their own queue; anyone
 * with EMPLOYEE_MANAGE may decide (escalation). An approver can never decide
 * their own request (domain separation of duties). The requester is
 * notified in the same transaction.
 */
async function decideApprovalInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: DecideApprovalInput,
): Promise<ApprovalView> {
  ensureActive(caller);
  const row = await prisma.approvalRequest.findFirst({
    where: { id: input.approvalId, tenantId: caller.tenantId },
  });
  if (!row) notFound("Approval request");
  assertVersionMatches(row, input.expectedVersion, "Approval request");

  // Authorization gate first: non-approvers (unless EMPLOYEE_MANAGE) are
  // refused BEFORE separation-of-duties / state rules, so identity failures
  // surface as AUTHORIZATION_DENIED and never leak state details.
  if (row.approverUserId) {
    if (row.approverUserId !== caller.userId && !canManageWorkflows(caller)) {
      unauthorized("NOT_ASSIGNED_APPROVER");
    }
  } else if (!canManageWorkflows(caller)) {
    unauthorized("MANAGE_REQUIRED");
  }
  assertRequesterIsNotApprover(row.requesterUserId, caller.userId);
  assertDecidable(row.status);
  assertApprovalTransition(row.status, input.decision);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.approvalRequest.update({
      where: { id: row.id },
      data: {
        status: input.decision,
        decidedAt: new Date(),
        decidedBy: caller.userId,
        decisionNote: input.note ?? null,
        version: { increment: 1 },
        updatedAt: new Date(),
        updatedBy: caller.userId,
      },
      select: APPROVAL_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.approval.decide",
        resourceType: "ApprovalRequest",
        resourceId: row.id,
        before: { status: row.status, version: row.version },
        after: {
          status: updated.status,
          version: updated.version,
          decisionNote: input.note ?? null,
        },
      },
      ctx ?? {},
      tx,
    );
    if (row.requesterUserId) {
      await createNotification(
        {
          recipientUserId: row.requesterUserId,
          tenantId: caller.tenantId,
          organizationId: row.organizationId,
          notificationType: "approval.decision",
          title: `${row.subject} — ${input.decision}`,
          message: input.note ?? null,
          entityType: row.sourceType ?? null,
          entityId: row.sourceId ?? null,
          createdBy: caller.userId,
        },
        tx,
      );
    }
    return toApprovalView(updated);
  });
}

/** Requests I raised (requester) or I must decide (approver). */
async function listMyApprovalsInternal(caller: WorkflowCaller): Promise<ApprovalView[]> {
  ensureActive(caller);
  const rows = await prisma.approvalRequest.findMany({
    where: {
      tenantId: caller.tenantId,
      OR: [{ requesterUserId: caller.userId }, { approverUserId: caller.userId }],
    },
    orderBy: { createdAt: "asc" },
    select: APPROVAL_VIEW_SELECT,
  });
  return rows.map(toApprovalView);
}

export interface ListPendingApprovalsInput {
  organizationId?: string | null;
}

/** HR queue: open approvals in the caller's organization (available scope). */
async function listPendingApprovalsInternal(
  caller: WorkflowCaller,
  input: ListPendingApprovalsInput = {},
): Promise<ApprovalView[]> {
  ensureActive(caller);
  if (!canManageWorkflows(caller)) unauthorized("MANAGE_REQUIRED");
  const organizationId = input.organizationId ?? caller.organizationId ?? undefined;
  const rows = await prisma.approvalRequest.findMany({
    where: {
      tenantId: caller.tenantId,
      organizationId: organizationId ?? undefined,
      status: { in: ["REQUESTED", "PENDING"] },
    },
    orderBy: { createdAt: "asc" },
    select: APPROVAL_VIEW_SELECT,
  });
  return rows.map(toApprovalView);
}

/* ── Tasks ───────────────────────────────────────────────────────────────── */

export interface CreateTaskInput {
  organizationId?: string | null;
  taskType: string;
  subject: string;
  description?: string | null;
  priority?: TaskPriority | null;
  assigneeUserId?: string | null;
  sourceType?: WorkflowSourceType | null;
  sourceId?: string | null;
  dueDate?: Date | null;
}

/**
 * Create a task. Assigning work to someone else (or leaving it unassigned)
 * requires EMPLOYEE_MANAGE; an active user may always create a task for
 * themselves. The assignee is notified in the same transaction.
 */
async function createTaskInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: CreateTaskInput,
): Promise<TaskView> {
  ensureActive(caller);
  const assigneeUserId = input.assigneeUserId ?? null;
  if (assigneeUserId && assigneeUserId !== caller.userId && !canManageWorkflows(caller)) {
    unauthorized("ASSIGN_TO_OTHER_REQUIRES_MANAGE");
  }
  if (!assigneeUserId && !canManageWorkflows(caller)) unauthorized("MANAGE_REQUIRED");

  return prisma.$transaction(async (tx) => {
    const row = await tx.workflowTask.create({
      data: {
        tenantId: caller.tenantId,
        organizationId: input.organizationId ?? null,
        taskType: input.taskType,
        subject: input.subject,
        description: input.description ?? null,
        priority: input.priority ?? "MEDIUM",
        status: "PENDING",
        assigneeUserId,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        dueDate: input.dueDate ?? null,
        createdBy: caller.userId,
      },
      select: TASK_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.task.create",
        resourceType: "WorkflowTask",
        resourceId: row.id,
        after: {
          taskType: input.taskType,
          subject: input.subject,
          assigneeUserId,
          status: "PENDING",
        },
      },
      ctx ?? {},
      tx,
    );
    if (assigneeUserId && assigneeUserId !== caller.userId) {
      await createNotification(
        {
          recipientUserId: assigneeUserId,
          tenantId: caller.tenantId,
          organizationId: row.organizationId,
          notificationType: "task.assignment",
          title: `Task assigned: ${row.subject}`,
          message: input.description ?? null,
          entityType: input.sourceType ?? null,
          entityId: input.sourceId ?? null,
          createdBy: caller.userId,
        },
        tx,
      );
    }
    return toTaskView(row);
  });
}

export interface UpdateTaskInput {
  taskId: string;
  expectedVersion: number;
}

/** Assignee (or EMPLOYEE_MANAGE) starts work: PENDING → IN_PROGRESS. */
async function startTaskInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: UpdateTaskInput,
): Promise<TaskView> {
  ensureActive(caller);
  const row = await prisma.workflowTask.findFirst({
    where: { id: input.taskId, tenantId: caller.tenantId },
  });
  if (!row) notFound("Task");
  assertVersionMatches(row, input.expectedVersion, "Task");
  if (row.assigneeUserId !== caller.userId && !canManageWorkflows(caller)) {
    unauthorized("NOT_ASSIGNEE");
  }
  assertTaskTransition(row.status, "IN_PROGRESS");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowTask.update({
      where: { id: row.id },
      data: {
        status: "IN_PROGRESS",
        version: { increment: 1 },
        updatedAt: new Date(),
        updatedBy: caller.userId,
      },
      select: TASK_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.task.start",
        resourceType: "WorkflowTask",
        resourceId: row.id,
        before: { status: row.status, version: row.version },
        after: { status: updated.status, version: updated.version },
      },
      ctx ?? {},
      tx,
    );
    return toTaskView(updated);
  });
}

/** Assignee (or EMPLOYEE_MANAGE) completes the work; requires an assignee. */
async function completeTaskInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: UpdateTaskInput,
): Promise<TaskView> {
  ensureActive(caller);
  const row = await prisma.workflowTask.findFirst({
    where: { id: input.taskId, tenantId: caller.tenantId },
  });
  if (!row) notFound("Task");
  assertVersionMatches(row, input.expectedVersion, "Task");
  requireAssignee(row.assigneeUserId);
  if (row.assigneeUserId !== caller.userId && !canManageWorkflows(caller)) {
    unauthorized("NOT_ASSIGNEE");
  }
  if (!canTransitionTask(row.status, "COMPLETED")) {
    assertTaskTransition(row.status, "COMPLETED");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowTask.update({
      where: { id: row.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        completedBy: caller.userId,
        version: { increment: 1 },
        updatedAt: new Date(),
        updatedBy: caller.userId,
      },
      select: TASK_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.task.complete",
        resourceType: "WorkflowTask",
        resourceId: row.id,
        before: { status: row.status, version: row.version },
        after: { status: updated.status, version: updated.version, completedBy: caller.userId },
      },
      ctx ?? {},
      tx,
    );
    return toTaskView(updated);
  });
}

/** Assignee (or creator or EMPLOYEE_MANAGE) cancels; requires assignee. */
async function cancelTaskInternal(
  caller: WorkflowCaller,
  ctx: RequestAuditContext | undefined,
  input: UpdateTaskInput,
): Promise<TaskView> {
  ensureActive(caller);
  const row = await prisma.workflowTask.findFirst({
    where: { id: input.taskId, tenantId: caller.tenantId },
  });
  if (!row) notFound("Task");
  assertVersionMatches(row, input.expectedVersion, "Task");
  const isOwner = row.assigneeUserId === caller.userId || row.createdBy === caller.userId;
  if (!isOwner && !canManageWorkflows(caller)) unauthorized("NOT_ASSIGNEE");
  assertTaskTransition(row.status, "CANCELLED");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.workflowTask.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: caller.userId,
        version: { increment: 1 },
        updatedAt: new Date(),
        updatedBy: caller.userId,
      },
      select: TASK_VIEW_SELECT,
    });
    await writeAuditEvent(
      {
        tenantId: caller.tenantId,
        actorUserId: caller.userId,
        action: "workflows.task.cancel",
        resourceType: "WorkflowTask",
        resourceId: row.id,
        before: { status: row.status, version: row.version },
        after: { status: updated.status, version: updated.version, cancelledBy: caller.userId },
      },
      ctx ?? {},
      tx,
    );
    return toTaskView(updated);
  });
}

/** Tasks assigned to the caller (open first, then recent). */
async function listMyTasksInternal(caller: WorkflowCaller): Promise<TaskView[]> {
  ensureActive(caller);
  const rows = await prisma.workflowTask.findMany({
    where: { tenantId: caller.tenantId, assigneeUserId: caller.userId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: TASK_VIEW_SELECT,
  });
  return rows.map(toTaskView);
}

/* ── Exported face (error mapping) ───────────────────────────────────────── */

type Fn<Args extends unknown[], T> = (...args: Args) => Promise<T>;

/** Translate domain errors (pure state-machine rules) into stable app errors. */
function wrap<Args extends unknown[], T>(fn: Fn<Args, T>): Fn<Args, T> {
  return async (...args: Args): Promise<T> => {
    try {
      return await fn(...args);
    } catch (err) {
      throw toWorkflowsAppError(err);
    }
  };
}

export const createApprovalRequest = wrap(createApprovalRequestInternal);
export const assignApprovalApprover = wrap(assignApprovalApproverInternal);
export const decideApproval = wrap(decideApprovalInternal);
export const listMyApprovals = wrap(listMyApprovalsInternal);
export const listPendingApprovals = wrap(listPendingApprovalsInternal);
export const createTask = wrap(createTaskInternal);
export const startTask = wrap(startTaskInternal);
export const completeTask = wrap(completeTaskInternal);
export const cancelTask = wrap(cancelTaskInternal);
export const listMyTasks = wrap(listMyTasksInternal);
