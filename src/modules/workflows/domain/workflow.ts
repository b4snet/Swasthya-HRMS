/**
 * Workflow primitives domain (Phase 0 hardening; Slice 1.0; brief §55).
 *
 * Pure state-machine rules for approval requests and workflow tasks, plus
 * separation-of-duties checks. I/O-free and unit-testable; services apply
 * these rules inside their transaction before persisting a transition.
 *
 * Terminal states (APPROVED/REJECTED/CANCELLED, COMPLETED) are never exited —
 * history is preserved, not rewritten.
 */
import { WorkflowDomainError } from "./errors";

export const APPROVAL_STATUSES = [
  "REQUESTED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_DECISIONS = ["APPROVED", "REJECTED"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const WORKFLOW_SOURCE_TYPES = [
  "EMPLOYEE",
  "POSITION",
  "CONTRACT",
  "CREDENTIAL",
  "LEAVE_REQUEST",
  "ONBOARDING",
  "SEPARATION",
  "TRANSFER",
  "PROMOTION",
] as const;
export type WorkflowSourceType = (typeof WORKFLOW_SOURCE_TYPES)[number];

/** entry state → legal successor states */
const APPROVAL_TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  REQUESTED: ["PENDING", "CANCELLED"],
  PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** entry state → legal successor states */
const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  PENDING: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export function assertApprovalTransition(from: ApprovalStatus, to: ApprovalStatus): void {
  if (!canTransitionApproval(from, to)) {
    throw new WorkflowDomainError(
      "TRANSITION_INVALID",
      `Approval cannot move from ${from} to ${to}.`,
    );
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new WorkflowDomainError("TRANSITION_INVALID", `Task cannot move from ${from} to ${to}.`);
  }
}

/** Decisions only ever apply to in-flight approvals (REQUESTED or PENDING). */
export function canDecideApproval(status: ApprovalStatus): boolean {
  return status === "PENDING";
}

export function assertDecidable(status: ApprovalStatus): void {
  if (!canDecideApproval(status)) {
    throw new WorkflowDomainError(
      "APPROVAL_DECISION_INVALID",
      `Approval in ${status} cannot be decided.`,
    );
  }
}

/**
 * Separation of duties: the requester must never approve or reject their own
 * request (escalation always routes through a different owner).
 */
export function assertRequesterIsNotApprover(
  requesterUserId: string | null,
  approverUserId: string | null,
): void {
  if (requesterUserId && approverUserId && requesterUserId === approverUserId) {
    throw new WorkflowDomainError(
      "APPROVER_IS_REQUESTER",
      "A requester cannot approve their own request.",
    );
  }
}

export function requireRequester(
  requesterUserId: string | null,
): asserts requesterUserId is string {
  if (!requesterUserId) {
    throw new WorkflowDomainError("REQUESTER_REQUIRED", "A requester is required.");
  }
}

/** A task assigned to nobody cannot be worked — completion needs an owner. */
export function requireAssignee(assigneeUserId: string | null): asserts assigneeUserId is string {
  if (!assigneeUserId) {
    throw new WorkflowDomainError(
      "TRANSITION_INVALID",
      "Cannot complete a task that has no assignee; assign it first.",
    );
  }
}
