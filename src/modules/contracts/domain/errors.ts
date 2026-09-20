/**
 * Contracts bounded-context domain errors (Phase 3; ADR-011).
 * Stable codes; services map them into the module AppError vocabulary.
 */
export class ContractsDomainError extends Error {
  constructor(
    public readonly code:
      | "CONTRACT_STATE_INVALID"
      | "CONTRACT_NUMBER_INVALID"
      | "CONTRACT_PERIOD_INVALID"
      | "CONTRACT_TEMPLATE_INVALID"
      | "CONTRACT_VERSION_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "ContractsDomainError";
  }
}
