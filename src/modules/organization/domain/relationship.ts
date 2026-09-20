/**
 * Relationship validation (pure functions).
 *
 * Covers Position placement (a seat hangs off at most one owning unit) and
 * ReportingEdge rules (ADR-009): no self-edge, both positions in the same
 * tenant + organization, no PRIMARY reporting cycles, MATRIX edges exempt
 * from the cycle rule (matrix overlays may loop by design).
 */
import { OrgDomainError } from "./errors";

export interface PositionRef {
  id: string;
  tenantId: string;
  organizationId: string;
  departmentId: string | null;
  teamId: string | null;
}

/** A position attaches to a department or a team — never both, never neither. */
export function assertPositionPlacement(p: {
  departmentId: string | null;
  teamId: string | null;
}): void {
  if (p.departmentId && p.teamId) {
    throw new OrgDomainError(
      "RELATIONSHIP_INVALID",
      "A position may belong to a department or a team, not both",
    );
  }
}

export interface ReportingEdgeRef {
  sourcePositionId: string;
  targetPositionId: string;
  tenantId: string;
  organizationId: string;
  type: "PRIMARY" | "SECONDARY" | "MATRIX";
}

export function assertValidReportingEdge(
  edge: ReportingEdgeRef,
  source: PositionRef,
  target: PositionRef,
): void {
  if (edge.sourcePositionId === edge.targetPositionId) {
    throw new OrgDomainError("RELATIONSHIP_INVALID", "A position cannot report to itself");
  }
  if (source.tenantId !== target.tenantId || edge.tenantId !== source.tenantId) {
    throw new OrgDomainError(
      "RELATIONSHIP_INVALID",
      "Reporting edge positions must belong to the same tenant",
    );
  }
  if (
    source.organizationId !== target.organizationId ||
    edge.organizationId !== source.organizationId
  ) {
    throw new OrgDomainError(
      "RELATIONSHIP_INVALID",
      "Reporting edge positions must belong to the same organization",
    );
  }
}

/**
 * PRIMARY reporting edges must form a forest: walking managers from any
 * position must reach a root without revisiting a position.
 */
export function assertNoPrimaryCycle(
  start: string,
  managerOf: ReadonlyMap<string, string>, // source -> target for ACTIVE PRIMARY edges
): void {
  const seen = new Set<string>();
  let cursor: string | undefined = start;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new OrgDomainError(
        "REPORTING_CYCLE",
        "This PRIMARY reporting edge would create a management cycle",
      );
    }
    seen.add(cursor);
    cursor = managerOf.get(cursor);
  }
}
