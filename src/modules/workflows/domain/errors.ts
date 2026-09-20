/**
 * Stable domain errors for the Workflows context (Slice 1.0).
 * Pure rules state their own failures; services translate to app errors.
 */
export type WorkflowDomainErrorCode =
  | "TRANSITION_INVALID"
  | "APPROVER_IS_REQUESTER"
  | "REQUESTER_REQUIRED"
  | "APPROVAL_DECISION_INVALID";

export class WorkflowDomainError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: WorkflowDomainErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "WorkflowDomainError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}
