/**
 * Relationship validation rules (pure functions; ADR-010 §3).
 *
 * Manager relationships live ON the assignment (managerEmploymentId = the
 * manager's Employment in effect for that period) — never a mutable
 * employee.managerId column. A manager change without a transfer is a new
 * assignment version. These helpers encode the invariants the service
 * layer must uphold before persisting an assignment:
 *  - an employment cannot manage itself,
 *  - the manager employment must belong to the same organization,
 *  - manager cycles are rejected over the ACTIVE assignment graph.
 */
import { WorkforceDomainError } from "./errors";

/** Minimal projection the service layer feeds in (no Prisma types here). */
export interface ManagerAssignmentEdge {
  managerEmploymentId: string | null;
  employmentId: string;
}

export function assertNotSelfManager(
  employmentId: string,
  managerEmploymentId: string | null,
): void {
  if (managerEmploymentId !== null && managerEmploymentId === employmentId) {
    throw new WorkforceDomainError(
      "ASSIGNMENT_MANAGER_INVALID",
      "An employment cannot be its own manager",
    );
  }
}

export function assertSameOrganization(
  employmentOrganizationId: string,
  managerOrganizationId: string,
): void {
  if (employmentOrganizationId !== managerOrganizationId) {
    throw new WorkforceDomainError(
      "ASSIGNMENT_MANAGER_INVALID",
      "Manager employment must belong to the same organization",
    );
  }
}

/**
 * Cycle detection over the ACTIVE assignment graph (plan §13 risk):
 * walk managerEmploymentId edges from the candidate assignment; if we get
 * back to the managed employment, the chain is circular and rejected.
 * `edges` maps employmentId → managerEmploymentId (null = top of chain).
 */
export function assertNoManagerCycle(
  employmentId: string,
  managerEmploymentId: string | null,
  edges: readonly ManagerAssignmentEdge[],
): void {
  if (managerEmploymentId === null) return;
  assertNotSelfManager(employmentId, managerEmploymentId);

  // Last edge wins: callers pass edges ordered oldest→newest, so the most
  // recent assignment version for an employment is authoritative.
  const byEmployment = new Map<string, string | null>();
  for (const edge of edges) {
    byEmployment.set(edge.employmentId, edge.managerEmploymentId);
  }

  const seen = new Set<string>([employmentId]);
  let current: string | null = managerEmploymentId;
  while (current !== null) {
    if (seen.has(current)) {
      throw new WorkforceDomainError(
        "ASSIGNMENT_MANAGER_INVALID",
        "Manager chain would create a cycle; reporting relationships must form a DAG",
      );
    }
    seen.add(current);
    current = byEmployment.get(current) ?? null;
  }
}

/**
 * Employment/employee type coherence (plan §2): certain employment types
 * only pair with certain worker classifications. Kept deliberately small —
 * only pairings with a genuine domain reason are restricted:
 *  - VOLUNTEER employment ⇒ VOLUNTEER classification,
 *  - INTERN employment ⇒ TRAINEE classification,
 *  - LOCUM employment ⇒ CONTRACTOR classification (locums engage as
 *    independent practitioners, not employees).
 */
const TYPE_CLASSIFICATION: Record<string, readonly string[]> = {
  VOLUNTEER: ["VOLUNTEER"],
  INTERN: ["TRAINEE"],
  LOCUM: ["CONTRACTOR"],
};

export function assertTypeClassificationCoherent(
  employmentType: string,
  workerClassification: string,
): void {
  const allowed = TYPE_CLASSIFICATION[employmentType];
  if (allowed && !allowed.includes(workerClassification)) {
    throw new WorkforceDomainError(
      "RELATIONSHIP_INVALID",
      `Employment type ${employmentType} requires worker classification ${allowed.join(" or ")}`,
    );
  }
}

/**
 * Identity-document reference sanity (plan §2): masked number keeps at
 * most the last 4 characters; document images/full numbers never enter
 * this table (they belong to the future Documents phase).
 */
export function assertMaskedDocumentNumber(numberMasked: string): void {
  const digits = numberMasked.replace(/\D/g, "");
  if (numberMasked.length < 4 || digits.length < 4 || numberMasked.length > 12) {
    throw new WorkforceDomainError(
      "IDENTITY_DOCUMENT_INVALID",
      "numberMasked must retain at least the last 4 characters and nothing longer than 12",
    );
  }
  // Reject values that look like an unmasked full number (8+ consecutive digits).
  if (/\d{8,}/.test(numberMasked)) {
    throw new WorkforceDomainError(
      "IDENTITY_DOCUMENT_INVALID",
      "numberMasked appears to contain an unmasked document number",
    );
  }
}
