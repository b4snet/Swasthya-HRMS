/**
 * Workforce domain errors. Services map these to action results; UI maps
 * results to the canonical states. No HTTP/React types here. Stable codes
 * extend the Phase 1 vocabulary with the two new Phase 2 codes (plan §8):
 * ASSIGNMENT_OVERLAP and EMPLOYMENT_STATE_INVALID.
 */
export class WorkforceDomainError extends Error {
  constructor(
    public readonly code:
      | "EMPLOYMENT_STATE_INVALID"
      | "ASSIGNMENT_OVERLAP"
      | "ASSIGNMENT_PERIOD_INVALID"
      | "ASSIGNMENT_MANAGER_INVALID"
      | "EMPLOYEE_NUMBER_INVALID"
      | "EMPLOYMENT_NUMBER_INVALID"
      | "IDENTITY_DOCUMENT_INVALID"
      | "RELATIONSHIP_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "WorkforceDomainError";
  }
}
