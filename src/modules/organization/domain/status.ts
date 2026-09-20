/**
 * Lifecycle/status rules (pure functions).
 *
 * LifecycleStatus: ACTIVE ⇄ INACTIVE, → ARCHIVED (terminal).
 * PositionStatus: VACANT → FILLED ⇄ VACANT, → CLOSED (terminal).
 *
 * Archival (status ARCHIVED + effectiveTo) replaces deletion for every
 * historically meaningful record (AGENTS.md).
 */
import { OrgDomainError } from "./errors";

export type Lifecycle = "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type PositionLifecycle = "VACANT" | "FILLED" | "CLOSED";

const LIFECYCLE_TRANSITIONS: Record<Lifecycle, readonly Lifecycle[]> = {
  ACTIVE: ["ACTIVE", "INACTIVE", "ARCHIVED"],
  INACTIVE: ["INACTIVE", "ACTIVE", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED"], // terminal: identity preserved, no reactivation
};

const POSITION_TRANSITIONS: Record<PositionLifecycle, readonly PositionLifecycle[]> = {
  VACANT: ["VACANT", "FILLED", "CLOSED"],
  FILLED: ["FILLED", "VACANT", "CLOSED"],
  CLOSED: ["CLOSED"], // terminal
};

export function assertLifecycleTransition(from: Lifecycle, to: Lifecycle): void {
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
    throw new OrgDomainError(
      "LIFECYCLE_TRANSITION_INVALID",
      `Cannot transition ${from} → ${to}; archived records are immutable history`,
    );
  }
}

export function assertPositionTransition(from: PositionLifecycle, to: PositionLifecycle): void {
  if (!POSITION_TRANSITIONS[from].includes(to)) {
    throw new OrgDomainError(
      "LIFECYCLE_TRANSITION_INVALID",
      `Cannot transition position ${from} → ${to}; closed positions are terminal`,
    );
  }
}

/** Archival closes the effective period; caller persists both atomically. */
export function archivalPatch(effectiveTo: Date | null): {
  status: Lifecycle;
  effectiveTo: Date;
} {
  return {
    status: "ARCHIVED",
    effectiveTo: effectiveTo ?? new Date(),
  };
}
