/**
 * Stable application errors for the Contracts context (Phase 3, plan §13).
 * Same contract as Workforce/Organization/Documents: clients receive ONLY
 * { code, message, field? }; database internals never cross the boundary.
 */
import { ContractsDomainError } from "../domain/errors";

export type ContractsAppErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHORIZATION_DENIED"
  | "NOT_FOUND"
  | "CONFLICT_DUPLICATE"
  | "RESOURCE_CONFLICT"
  | "CONTRACT_STATE_INVALID"
  | "CONTRACT_NUMBER_INVALID"
  | "CONTRACT_PERIOD_INVALID"
  | "CONTRACT_TEMPLATE_INVALID"
  | "CONTRACT_VERSION_INVALID"
  | "EMPLOYMENT_STATE_INVALID"
  | "UNEXPECTED";

export const CONTRACTS_ERROR_STATUS: Record<ContractsAppErrorCode, number> = {
  VALIDATION_FAILED: 400,
  AUTHORIZATION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT_DUPLICATE: 409,
  RESOURCE_CONFLICT: 409,
  CONTRACT_STATE_INVALID: 422,
  CONTRACT_NUMBER_INVALID: 400,
  CONTRACT_PERIOD_INVALID: 400,
  CONTRACT_TEMPLATE_INVALID: 400,
  CONTRACT_VERSION_INVALID: 422,
  EMPLOYMENT_STATE_INVALID: 422,
  UNEXPECTED: 500,
};

export class ContractsAppError extends Error {
  declare readonly cause?: unknown;

  constructor(
    public readonly code: ContractsAppErrorCode,
    message: string,
    public readonly field?: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ContractsAppError";
    if (cause !== undefined) {
      Object.defineProperty(this, "cause", { value: cause, enumerable: false });
    }
  }
}

const DOMAIN_CODE_MAP: Record<ContractsDomainError["code"], ContractsAppErrorCode> = {
  CONTRACT_STATE_INVALID: "CONTRACT_STATE_INVALID",
  CONTRACT_NUMBER_INVALID: "CONTRACT_NUMBER_INVALID",
  CONTRACT_PERIOD_INVALID: "CONTRACT_PERIOD_INVALID",
  CONTRACT_TEMPLATE_INVALID: "CONTRACT_TEMPLATE_INVALID",
  CONTRACT_VERSION_INVALID: "CONTRACT_VERSION_INVALID",
};

export function toContractsAppError(err: unknown): ContractsAppError {
  if (err instanceof ContractsAppError) return err;
  if (err instanceof ContractsDomainError) {
    return new ContractsAppError(DOMAIN_CODE_MAP[err.code], err.message, undefined, err);
  }
  return new ContractsAppError("UNEXPECTED", "An unexpected error occurred.", undefined, err);
}

export function serializeContractsAppError(err: ContractsAppError): {
  ok: false;
  error: { code: ContractsAppErrorCode; message: string; field?: string };
} {
  return {
    ok: false,
    error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
  };
}
