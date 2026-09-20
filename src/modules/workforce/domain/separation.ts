/**
 * Separation workflow domain (Slice 1.1; brief §44–46).
 *
 * Pure rules binding the employment lifecycle (employment-status.ts) to the
 * workflow primitives (approval → decision → exit clearance tasks):
 *
 *  - A separation exists only for a TERMINAL destination
 *    (TERMINATED / RESIGNED / RETIRED); non-terminal requests are invalid.
 *  - The destination is carried on the approval's namespaced requestType
 *    (`separation.<DESTINATION>`) so the final apply step never relies on
 *    free-text subjects.
 *  - Applying an approval requires an APPROVED decision (PENDING cannot
 *    mutate employment); applying twice is refused — terminal rows are
 *    immutable history.
 *  - On apply, the exit-clearance catalog (§46) is derived into concrete
 *    workflow tasks relative to the separation date.
 *
 * No I/O here; services enforce tenant scoping, authorization, audits.
 */
import { WorkforceDomainError } from "./errors";
import {
  assertEmploymentTransition,
  assertSeparationRequirements,
  isTerminalEmploymentStatus,
  type EmploymentStatusValue,
} from "./employment-status";
import type { ApprovalStatus } from "@/modules/workflows/domain/workflow";

export type SeparationDestination = "TERMINATED" | "RESIGNED" | "RETIRED";

export const SEPARATION_DESTINATIONS: readonly SeparationDestination[] = [
  "TERMINATED",
  "RESIGNED",
  "RETIRED",
];

const SEPARATION_PREFIX = "separation.";

export function separationRequestType(destination: SeparationDestination): string {
  return `${SEPARATION_PREFIX}${destination}`;
}

export function isSeparationRequestType(requestType: string): boolean {
  return requestType.startsWith(SEPARATION_PREFIX);
}

/** Parse the destination carried on the approval request type; null if foreign. */
export function separationDestinationFromRequestType(
  requestType: string,
): SeparationDestination | null {
  const candidate = requestType.slice(SEPARATION_PREFIX.length) as SeparationDestination;
  return SEPARATION_DESTINATIONS.includes(candidate) ? candidate : null;
}

/**
 * A separation request is only valid toward a terminal destination from a
 * non-terminal employment state the lifecycle machine permits.
 */
export function assertSeparationRequestAllowed(
  from: EmploymentStatusValue,
  to: EmploymentStatusValue,
): void {
  if (!isTerminalEmploymentStatus(to)) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      `Separation is only valid for terminal destinations (got ${to}).`,
    );
  }
  assertEmploymentTransition(from, to);
}

/** The apply step may only act on an APPROVED decision. */
export function assertSeparationApplicable(status: ApprovalStatus): void {
  if (status !== "APPROVED") {
    throw new WorkforceDomainError(
      "EMPLOYMENT_STATE_INVALID",
      `Separation can only be applied from an APPROVED decision (got ${status}).`,
    );
  }
}

/**
 * Re-export of the termination/resignation/retirement data requirements.
 * The service enforces these at request time (fail fast) and again at apply
 * time (official record carries the authoritative dates).
 */
export { assertSeparationRequirements };

export interface SeparationClearanceItem {
  key: string;
  taskType: string;
  subject: string;
  description: string;
  /** Days AFTER the separation date the task is due; null = open-ended. */
  dueAfterDays: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
}

/**
 * Exit-clearance catalog (brief §46). Deterministic and seeded from data,
 * not fabricated per employee — the same items apply to every separation.
 */
export const SEPARATION_CLEARANCE_CATALOG: readonly SeparationClearanceItem[] = [
  {
    key: "access",
    taskType: "separation.clearance",
    subject: "Revoke system & application access",
    description: "Disable logins, email, badge, and building access for the separating employee.",
    dueAfterDays: 0,
    priority: "HIGH",
  },
  {
    key: "badge",
    taskType: "separation.clearance",
    subject: "Return ID badge & building keys",
    description: "Collect the employee's physical badge and any issued keys.",
    dueAfterDays: 0,
    priority: "HIGH",
  },
  {
    key: "devices",
    taskType: "separation.clearance",
    subject: "Return assigned devices & equipment",
    description: "Collect laptop, phone, and any other assigned equipment; record condition.",
    dueAfterDays: 0,
    priority: "MEDIUM",
  },
  {
    key: "handover",
    taskType: "separation.clearance",
    subject: "Collect deliverables & handover notes",
    description: "Gather pending deliverables, documentation, and the role handover pack.",
    dueAfterDays: 7,
    priority: "MEDIUM",
  },
  {
    key: "advances",
    taskType: "separation.clearance",
    subject: "Settle cash advances & expense card",
    description: "Reconcile and settle any cash advances and corporate expense card usage.",
    dueAfterDays: 14,
    priority: "MEDIUM",
  },
  {
    key: "exit-interview",
    taskType: "separation.clearance",
    subject: "Schedule exit interview",
    description: "Book and complete the standard exit interview.",
    dueAfterDays: 1,
    priority: "LOW",
  },
  {
    key: "compliance",
    taskType: "separation.clearance",
    subject: "Verify credential & access settlements",
    description: "Confirm licence/credential handback and third-party access revocation.",
    dueAfterDays: 7,
    priority: "HIGH",
  },
  {
    key: "salary",
    taskType: "separation.clearance",
    subject: "Final salary & dues handoff",
    description: "Prepare final pay, accrued leave payout, and any remaining dues for the employee.",
    dueAfterDays: 45,
    priority: "MEDIUM",
  },
];

export interface SeparationTaskDraft {
  taskType: string;
  subject: string;
  description: string | null;
  priority: SeparationClearanceItem["priority"];
  dueDate: Date | null;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Derive exit-clearance task drafts relative to the separation date. */
export function deriveSeparationClearance(referenceDate: Date): SeparationTaskDraft[] {
  return SEPARATION_CLEARANCE_CATALOG.map((item) => ({
    taskType: item.taskType,
    subject: item.subject,
    description: item.description ?? null,
    priority: item.priority,
    dueDate: item.dueAfterDays === null ? null : addDays(referenceDate, item.dueAfterDays),
  }));
}