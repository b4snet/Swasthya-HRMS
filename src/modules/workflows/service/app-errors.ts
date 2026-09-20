/**
 * Stable application errors for the Workflows context (Slice 1.0; ADR-011).
 * Same contract as other modules: clients receive ONLY { code, message,
 * field? }; DB internals never cross the boundary.
 */
import { WorkflowDomainError } from "../domain/errors";

export type WorkflowsAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "RESOURCE_CONFLICT"
  | "STATE_INVALID"
  | "UNEXPECTED";

export const WORKFLOWS_ERROR_STATUS: Record<WorkflowsAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  RESOURCE_CONFLICT: 409,
  STATE_INVALID: 422,
  UNEXPECTED: 500,
};

export class WorkflowsAppError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: WorkflowsAppErrorCode,
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "WorkflowsAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

const DOMAIN_CODE_MAP: Record<WorkflowDomainError["code"], WorkflowsAppErrorCode> = {
  TRANSITION_INVALID: "STATE_INVALID",
  APPROVER_IS_REQUESTER: "STATE_INVALID",
  REQUESTER_REQUIRED: "VALIDATION_FAILED",
  APPROVAL_DECISION_INVALID: "STATE_INVALID",
};

export function toWorkflowsAppError(err: unknown): WorkflowsAppError {
  if (err instanceof WorkflowsAppError) return err;
  if (err instanceof WorkflowDomainError) {
    return new WorkflowsAppError(DOMAIN_CODE_MAP[err.code], err.message, undefined, err);
  }
  return new WorkflowsAppError("UNEXPECTED", "An unexpected error occurred.", undefined, err);
}

export function serializeWorkflowsAppError(err: WorkflowsAppError): {
  ok: false;
  error: { code: WorkflowsAppErrorCode; message: string; field?: string };
} {
  return {
    ok: false,
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  };
}
