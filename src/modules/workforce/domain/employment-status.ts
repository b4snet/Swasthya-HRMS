/**
 * Employment lifecycle state machine (pure functions; ADR-010 §2).
 *
 * DRAFT → PENDING_ONBOARDING → ACTIVE ⇄ SUSPENDED → INACTIVE;
 * ACTIVE → TERMINATED | RESIGNED | RETIRED (terminal).
 *
 * Every state has a distinct domain consequence (plan §4):
 * - DRAFT: record being assembled (pre-employment); not visible on rosters.
 * - PENDING_ONBOARDING: approved to hire; not yet started.
 * - ACTIVE: on staff — the only state counted in headcount/FTE.
 * - SUSPENDED: administrative hold; excluded from rosters, retains rights.
 * - INACTIVE: long unpaid leave / sabbatical; not a separation.
 * - TERMINATED / RESIGNED / RETIRED: terminal separations with distinct
 *   reason semantics; rows become immutable history.
 *
 * Transitions are validated here (pure) and re-checked in the service;
 * every transition is audited by the caller.
 */
import { WorkforceDomainError } from "./errors";

export type EmploymentStatusValue =
  | "DRAFT"
  | "PENDING_ONBOARDING"
  | "ACTIVE"
  | "SUSPENDED"
  | "INACTIVE"
  | "TERMINATED"
  | "RESIGNED"
  | "RETIRED";

const TRANSITIONS: Record<EmploymentStatusValue, readonly EmploymentStatusValue[]> = {
  DRAFT: ["DRAFT", "PENDING_ONBOARDING"],
  PENDING_ONBOARDING: ["PENDING_ONBOARDING", "ACTIVE"],
  ACTIVE: ["ACTIVE", "SUSPENDED", "INACTIVE", "TERMINATED", "RESIGNED", "RETIRED"],
  SUSPENDED: ["SUSPENDED", "ACTIVE", "INACTIVE", "TERMINATED", "RESIGNED"],
  INACTIVE: ["INACTIVE", "ACTIVE", "TERMINATED", "RESIGNED", "RETIRED"],
  // Terminal: rows become immutable history; archival is the only follow-up.
  TERMINATED: ["TERMINATED"],
  RESIGNED: ["RESIGNED"],
  RETIRED: ["RETIRED"],
};

export const TERMINAL_EMPLOYMENT_STATUSES: readonly EmploymentStatusValue[] = [
  "TERMINATED",
  "RESIGNED",
  "RETIRED",
];

export function isTerminalEmploymentStatus(status: EmploymentStatusValue): boolean {
  return TERMINAL_EMPLOYMENT_STATUSES.includes(status);
}

export function isEmploymentTransitionAllowed(
  from: EmploymentStatusValue,
  to: EmploymentStatusValue,
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertEmploymentTransition(
  from: EmploymentStatusValue,
  to: EmploymentStatusValue,
): void {
  if (!isEmploymentTransitionAllowed(from, to)) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      `Cannot transition employment ${from} → ${to}; terminal states are immutable history`,
    );
  }
}

/**
 * Separation requirements: a terminal transition must carry the matching
 * date, and TERMINATED additionally requires a reason code (plan §4).
 * RESIGNED carries resignationDate; RETIRED carries retirementDate.
 */
export function assertSeparationRequirements(
  to: EmploymentStatusValue,
  data: {
    terminationDate?: Date | null;
    terminationReason?: string | null;
    resignationDate?: Date | null;
    retirementDate?: Date | null;
  },
): void {
  if (!isTerminalEmploymentStatus(to)) return;
  if (to === "TERMINATED") {
    if (!data.terminationDate || !data.terminationReason) {
      throw new WorkforceDomainError(
        "EMPLOYMENT_STATE_INVALID",
        "Termination requires terminationDate and terminationReason",
      );
    }
  }
  if (to === "RESIGNED" && !data.resignationDate) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "Resignation requires resignationDate",
    );
  }
  if (to === "RETIRED" && !data.retirementDate) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      "Retirement requires retirementDate",
    );
  }
}

/**
 * Status-history entry appended on every transition (plan §4): one row is
 * the answerable record of "why was this employee suspended in March".
 */
export interface StatusHistoryEntry {
  status: EmploymentStatusValue;
  changedAt: string;
  changedBy?: string;
  note?: string;
}

export function appendStatusHistory(
  history: readonly StatusHistoryEntry[],
  entry: StatusHistoryEntry,
): StatusHistoryEntry[] {
  const last = history[history.length - 1];
  if (last && last.status === entry.status) {
    // No-op transition (same state): do not append duplicate rows.
    return [...history];
  }
  return [...history, entry];
}
