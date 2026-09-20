/**
 * Unit tests for the workflow primitives domain (Slice 1.0).
 * Pure transition legality + separation-of-duties rules — no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  APPROVAL_STATUSES,
  TASK_STATUSES,
  assertApprovalTransition,
  assertDecidable,
  assertRequesterIsNotApprover,
  assertTaskTransition,
  canDecideApproval,
  canTransitionApproval,
  canTransitionTask,
  requireAssignee,
} from "@/modules/workflows/domain/workflow";
import { WorkflowDomainError } from "@/modules/workflows/domain/errors";

describe("approval state machine", () => {
  it("permits REQUESTED → PENDING / CANCELLED and PENDING → decided states", () => {
    expect(canTransitionApproval("REQUESTED", "PENDING")).toBe(true);
    expect(canTransitionApproval("REQUESTED", "CANCELLED")).toBe(true);
    expect(canTransitionApproval("PENDING", "APPROVED")).toBe(true);
    expect(canTransitionApproval("PENDING", "REJECTED")).toBe(true);
    expect(canTransitionApproval("PENDING", "CANCELLED")).toBe(true);
  });

  it("forbids skipping PENDING or restarting a terminal state", () => {
    expect(canTransitionApproval("REQUESTED", "APPROVED")).toBe(false);
    expect(canTransitionApproval("APPROVED", "PENDING")).toBe(false);
    expect(canTransitionApproval("REJECTED", "REJECTED")).toBe(false);
    expect(canTransitionApproval("CANCELLED", "PENDING")).toBe(false);
  });

  it("asserts only actionable approvals can be decided", () => {
    expect(canDecideApproval("PENDING")).toBe(true);
    for (const status of ["REQUESTED", "APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(canDecideApproval(status)).toBe(false);
      expect(() => assertDecidable(status)).toThrow(WorkflowDomainError);
      expect(() => assertDecidable(status)).toThrow(/cannot be decided/);
    }
    expect(() => assertDecidable("PENDING")).not.toThrow();
  });

  it("assertApprovalTransition throws a stable code for illegal moves", () => {
    expect(() => assertApprovalTransition("REQUESTED", "APPROVED")).toThrowError(
      expect.objectContaining({ code: "TRANSITION_INVALID" }),
    );
    expect(() => assertApprovalTransition("REQUESTED", "PENDING")).not.toThrow();
  });
});

describe("task state machine", () => {
  it("permits PENDING → IN_PROGRESS/COMPLETED/CANCELLED and IN_PROGRESS → COMPLETED/CANCELLED", () => {
    expect(canTransitionTask("PENDING", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTask("PENDING", "COMPLETED")).toBe(true);
    expect(canTransitionTask("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionTask("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionTask("IN_PROGRESS", "CANCELLED")).toBe(true);
  });

  it("locks terminal task states", () => {
    expect(canTransitionTask("COMPLETED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionTask("CANCELLED", "PENDING")).toBe(false);
    expect(() => assertTaskTransition("COMPLETED", "PENDING")).toThrow(WorkflowDomainError);
  });

  it("rejects every impossible pair across the full status set", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const expectedLegal = ((from, to) => {
          if (from === "PENDING")
            return to === "IN_PROGRESS" || to === "COMPLETED" || to === "CANCELLED";
          if (from === "IN_PROGRESS") return to === "COMPLETED" || to === "CANCELLED";
          return false;
        })(from, to);
        expect(canTransitionTask(from, to), `${from}→${to}`).toBe(expectedLegal);
      }
    }
  });

  it("completion requires an assignee", () => {
    expect(requireAssignee).toBeTypeOf("function");
    expect(() => requireAssignee(null)).toThrow(WorkflowDomainError);
    expect(() => requireAssignee("user-1")).not.toThrow();
  });
});

describe("separation of duties", () => {
  it("a requester can never approve their own request", () => {
    expect(() => assertRequesterIsNotApprover("u1", "u1")).toThrowError(
      expect.objectContaining({ code: "APPROVER_IS_REQUESTER" }),
    );
  });

  it("different people pass; missing approver passes", () => {
    expect(() => assertRequesterIsNotApprover("u1", "u2")).not.toThrow();
    expect(() => assertRequesterIsNotApprover("u1", null)).not.toThrow();
    expect(() => assertRequesterIsNotApprover(null, null)).not.toThrow();
  });
});

describe("status sets are closed", () => {
  it("approval decisions map onto legal approval states", () => {
    for (const decision of ["APPROVED", "REJECTED"] as const) {
      expect(APPROVAL_STATUSES).toContain(decision);
    }
  });
});
