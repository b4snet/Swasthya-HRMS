/**
 * Organization domain errors. Services map these to action results; UI maps
 * results to the five canonical states. No HTTP/React types here.
 */
export class OrgDomainError extends Error {
  constructor(
    public readonly code:
      | "EFFECTIVE_PERIOD_INVALID"
      | "EFFECTIVE_PERIOD_OVERLAP"
      | "HIERARCHY_CYCLE"
      | "HIERARCHY_PARENT_MISMATCH"
      | "HIERARCHY_DEPTH_EXCEEDED"
      | "LIFECYCLE_TRANSITION_INVALID"
      | "RELATIONSHIP_INVALID"
      | "REPORTING_CYCLE",
    message: string,
  ) {
    super(message);
    this.name = "OrgDomainError";
  }
}
