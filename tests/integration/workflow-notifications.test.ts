/**
 * Integration tests for the workflow primitives + notifications services
 * (Slice 1.0). Covers tenant isolation, authorization/IDOR, separation of
 * duties, optimistic concurrency, audit generation, and notification fan-out.
 *
 * Pattern mirrors workforce-scope.test.ts: real Postgres, isolated
 * tenants/users via helpers, direct service calls (no HTTP/login flow).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  auditCount,
  auditLast,
  makeTenantContext,
  makeUser,
  resetDatabase,
  SYSTEM_ROLES,
} from "./helpers";
import { WorkflowsAppError } from "@/modules/workflows/service/app-errors";
import {
  assignApprovalApprover,
  cancelTask,
  completeTask,
  createApprovalRequest,
  createTask,
  decideApproval,
  listMyApprovals,
  listMyTasks,
  listPendingApprovals,
  startTask,
} from "@/modules/workflows/service/workflow-service";
import {
  listUserNotifications,
  markNotificationRead,
} from "@/modules/notifications/service/notifications-service";
import { NotificationsAppError } from "@/modules/notifications/service/app-errors";

describe("workflow primitives + notifications", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("decides a request end-to-end with audit + notification fan-out", async () => {
    const ctx = await makeTenantContext("wf-decision");
    const requester = await makeUser(ctx, "requester", [SYSTEM_ROLES.EMPLOYEE]);
    const approver = await makeUser(ctx, "approver", [SYSTEM_ROLES.EMPLOYEE]);

    const created = await createApprovalRequest(
      requester.subject,
      {},
      {
        requestType: "leave.request",
        subject: "PTO 20-26 Sep",
        rationale: "Family travel",
        approverUserId: approver.userId,
        sourceType: "LEAVE_REQUEST",
      },
    );
    expect(created.status).toBe("PENDING");

    // Assigned approver (not the requester) decides.
    const decided = await decideApproval(
      approver.subject,
      {},
      {
        approvalId: created.id,
        decision: "APPROVED",
        note: "Go ahead",
        expectedVersion: 1,
      },
    );
    expect(decided.status).toBe("APPROVED");
    expect(decided.decidedBy).toBe(approver.userId);
    expect(decided.version).toBe(2);

    // Audit written for the same mutations.
    expect(await auditCount(ctx.tenantId, "workflows.approval.create")).toBe(1);
    expect(await auditCount(ctx.tenantId, "workflows.approval.decide")).toBe(1);

    // Approver cannot decide after a terminal state.
    await expect(
      decideApproval(
        approver.subject,
        {},
        { approvalId: created.id, decision: "REJECTED", expectedVersion: 2 },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "STATE_INVALID",
    );

    // Requester was notified in the same transaction.
    const list = await listUserNotifications(requester.subject, { limit: 10 });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]!.notificationType).toBe("approval.decision");
    expect(list.rows[0]!.entityType).toBe("LEAVE_REQUEST");
    expect(list.unread).toBe(1);
  });

  it("enforces separation of duties and assigned-approver authority", async () => {
    const ctx = await makeTenantContext("wf-sod");
    const requester = await makeUser(ctx, "requester", [SYSTEM_ROLES.EMPLOYEE]);
    const other = await makeUser(ctx, "other", [SYSTEM_ROLES.EMPLOYEE]);

    // Requester cannot approve their own request.
    await expect(
      createApprovalRequest(
        requester.subject,
        {},
        { requestType: "leave.request", subject: "Self", approverUserId: requester.userId },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "STATE_INVALID",
    );

    // A stranger cannot decide someone else's assigned request.
    const created = await createApprovalRequest(
      requester.subject,
      {},
      {
        requestType: "leave.request",
        subject: "PTO",
        approverUserId: requester.userId === other.userId ? null : other.userId,
      },
    );
    await expect(
      decideApproval(
        requester.subject,
        {},
        { approvalId: created.id, decision: "APPROVED", expectedVersion: 1 },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "AUTHORIZATION_DENIED",
    );
  });

  it("HR assigns queue work and escalates decisions with EMPLOYEE_MANAGE", async () => {
    const ctx = await makeTenantContext("wf-hr");
    const requester = await makeUser(ctx, "requester", [SYSTEM_ROLES.EMPLOYEE]);
    const target = await makeUser(ctx, "target", [SYSTEM_ROLES.EMPLOYEE]);
    const hr = await makeUser(ctx, "hr", [SYSTEM_ROLES.HR_ADMIN]);

    const queued = await createApprovalRequest(
      requester.subject,
      {},
      { requestType: "transfer.request", subject: "Transfer to Cardio", approverUserId: null },
    );
    expect(queued.status).toBe("REQUESTED");

    // A non-manager sees the queue he raised, not the org pool.
    expect((await listMyApprovals(requester.subject)).map((a) => a.id)).toEqual([queued.id]);
    await expect(listPendingApprovals(requester.subject)).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "AUTHORIZATION_DENIED",
    );

    const pool = await listPendingApprovals(hr.subject);
    expect(pool.map((a) => a.id)).toEqual([queued.id]);

    const assigned = await assignApprovalApprover(
      hr.subject,
      {},
      {
        approvalId: queued.id,
        approverUserId: target.userId,
        expectedVersion: 1,
      },
    );
    expect(assigned.status).toBe("PENDING");
    expect(assigned.approverUserId).toBe(target.userId);

    // HR escalation can decide even when not the assigned approver.
    const decided = await decideApproval(
      hr.subject,
      {},
      {
        approvalId: queued.id,
        decision: "APPROVED",
        expectedVersion: 2,
      },
    );
    expect(decided.status).toBe("APPROVED");
    expect(await auditCount(ctx.tenantId, "workflows.approval.assign")).toBe(1);

    // The requester sees the notification of the final decision.
    const notices = await listUserNotifications(requester.subject);
    expect(notices.unread).toBe(1);
    expect(notices.rows[0]!.title).toContain("APPROVED");
  });

  it("rejects cross-tenant and cross-user access to notifications (IDOR)", async () => {
    const tenantA = await makeTenantContext("notif-a");
    const tenantB = await makeTenantContext("notif-b");
    const owner = await makeUser(tenantA, "owner", [SYSTEM_ROLES.EMPLOYEE]);
    const approverA = await makeUser(tenantA, "approver", [SYSTEM_ROLES.EMPLOYEE]);
    const intruderB = await makeUser(tenantB, "intruder", [SYSTEM_ROLES.EMPLOYEE]);

    const approval = await createApprovalRequest(
      owner.subject,
      {},
      { requestType: "leave.request", subject: "PTO", approverUserId: approverA.userId },
    );
    await decideApproval(
      approverA.subject,
      {},
      {
        approvalId: approval.id,
        decision: "APPROVED",
        expectedVersion: 1,
      },
    );

    // The requester owns the notification; others can't open it.
    const notices = await listUserNotifications(owner.subject);
    const [notification] = notices.rows;
    expect(notification).toBeDefined();

    await expect(
      markNotificationRead(intruderB.subject, {}, { notificationId: notification!.id }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof NotificationsAppError && e.code === "NOT_FOUND",
    );

    await expect(
      markNotificationRead(approverA.subject, {}, { notificationId: notification!.id }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof NotificationsAppError && e.code === "AUTHORIZATION_DENIED",
    );

    const marked = await markNotificationRead(
      owner.subject,
      {},
      { notificationId: notification!.id },
    );
    expect(marked.id).toBe(notification!.id);
    expect(await auditCount(tenantA.tenantId, "notifications.markRead")).toBe(1);

    // Idempotent re-read does not duplicate events.
    await markNotificationRead(owner.subject, {}, { notificationId: notification!.id });
    expect(await auditCount(tenantA.tenantId, "notifications.markRead")).toBe(2);

    const after = await listUserNotifications(owner.subject);
    expect(after.unread).toBe(0);
  });

  it("guards task creation, ownership and concurrency", async () => {
    const ctx = await makeTenantContext("wf-task");
    const worker = await makeUser(ctx, "worker", [SYSTEM_ROLES.EMPLOYEE]);
    const stranger = await makeUser(ctx, "stranger", [SYSTEM_ROLES.EMPLOYEE]);
    const hr = await makeUser(ctx, "hr", [SYSTEM_ROLES.HR_ADMIN]);

    // Only managers may assign work to others.
    await expect(
      createTask(
        worker.subject,
        {},
        { taskType: "onboarding.document", subject: "Upload ID", assigneeUserId: stranger.userId },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "AUTHORIZATION_DENIED",
    );

    const task = await createTask(
      hr.subject,
      {},
      {
        taskType: "onboarding.document",
        subject: "Upload photo ID",
        assigneeUserId: worker.userId,
        dueDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    );
    expect(task.status).toBe("PENDING");
    expect(await auditCount(ctx.tenantId, "workflows.task.create")).toBe(1);

    // The assignee was notified.
    const notices = await listUserNotifications(worker.subject);
    expect(notices.rows[0]!.notificationType).toBe("task.assignment");
    expect(notices.unread).toBe(1);

    // A stranger cannot start or complete someone else's task.
    await expect(
      startTask(stranger.subject, {}, { taskId: task.id, expectedVersion: 1 }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "AUTHORIZATION_DENIED",
    );

    const started = await startTask(worker.subject, {}, { taskId: task.id, expectedVersion: 1 });
    expect(started.status).toBe("IN_PROGRESS");
    expect(await auditCount(ctx.tenantId, "workflows.task.start")).toBe(1);

    // Stale version is rejected.
    await expect(
      completeTask(worker.subject, {}, { taskId: task.id, expectedVersion: 1 }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "RESOURCE_CONFLICT",
    );

    const done = await completeTask(worker.subject, {}, { taskId: task.id, expectedVersion: 2 });
    expect(done.status).toBe("COMPLETED");
    expect(done.completedBy).toBe(worker.userId);
    expect(done.version).toBe(3);
    expect(await auditCount(ctx.tenantId, "workflows.task.complete")).toBe(1);

    // Completed tasks cannot be cancelled.
    await expect(
      cancelTask(worker.subject, {}, { taskId: task.id, expectedVersion: 3 }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "STATE_INVALID",
    );

    expect((await listMyTasks(worker.subject)).map((t) => t.id)).toEqual([task.id]);
  });

  it("isolates workflows across tenants (IDOR on ids)", async () => {
    const tenantA = await makeTenantContext("wf-iso-a");
    const tenantB = await makeTenantContext("wf-iso-b");

    const aWorker = await makeUser(tenantA, "a-worker", [SYSTEM_ROLES.EMPLOYEE]);
    const aApprover = await makeUser(tenantA, "a-approver", [SYSTEM_ROLES.EMPLOYEE]);
    const aHr = await makeUser(tenantA, "a-hr", [SYSTEM_ROLES.HR_ADMIN]);
    const bStranger = await makeUser(tenantB, "b-stranger", [SYSTEM_ROLES.HR_ADMIN]);

    const approval = await createApprovalRequest(
      aWorker.subject,
      {},
      { requestType: "leave.request", subject: "PTO", approverUserId: aApprover.userId },
    );
    const task = await createTask(
      aHr.subject,
      {},
      {
        taskType: "onboarding.badge",
        subject: "Issue badge",
        assigneeUserId: aWorker.userId,
      },
    );

    // Same ids, different tenant → invisible (NOT_FOUND), never a leak.
    await expect(
      decideApproval(
        bStranger.subject,
        {},
        { approvalId: approval.id, decision: "APPROVED", expectedVersion: 1 },
      ),
    ).rejects.toSatisfy((e: unknown) => e instanceof WorkflowsAppError && e.code === "NOT_FOUND");
    await expect(
      completeTask(bStranger.subject, {}, { taskId: task.id, expectedVersion: 1 }),
    ).rejects.toSatisfy((e: unknown) => e instanceof WorkflowsAppError && e.code === "NOT_FOUND");

    expect((await listMyApprovals(bStranger.subject)).length).toBe(0);
    expect((await listMyTasks(bStranger.subject)).length).toBe(0);
    expect(await prisma.workflowTask.count({ where: { tenantId: tenantA.tenantId } })).toBe(1);
  });

  it("asserts optimistic concurrency on approvals", async () => {
    const ctx = await makeTenantContext("wf-version");
    const requester = await makeUser(ctx, "requester", [SYSTEM_ROLES.EMPLOYEE]);
    const approver = await makeUser(ctx, "approver", [SYSTEM_ROLES.EMPLOYEE]);

    const approval = await createApprovalRequest(
      requester.subject,
      {},
      { requestType: "leave.request", subject: "PTO", approverUserId: approver.userId },
    );
    // Two concurrent decisions against v1: exactly one wins.
    await decideApproval(
      approver.subject,
      {},
      { approvalId: approval.id, decision: "APPROVED", expectedVersion: 1 },
    );
    await expect(
      decideApproval(
        approver.subject,
        {},
        { approvalId: approval.id, decision: "REJECTED", expectedVersion: 1 },
      ),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof WorkflowsAppError && e.code === "RESOURCE_CONFLICT",
    );

    const row = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(row?.status).toBe("APPROVED");
    expect(row?.version).toBe(2);
  });

  it("reports Open Approvals queue only to managers, scoped to org", async () => {
    const { tenantId } = await makeTenantContext("wf-orgqueue");
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { organizations: true },
    });
    const orgA = tenant!.organizations[0]!;
    const orgB = tenant!.organizations[1]!;

    const requester = await makeUser(
      { tenantId, organizationId: orgA.id, secondOrganizationId: orgB.id },
      "requester",
      [SYSTEM_ROLES.EMPLOYEE],
    );
    const hrInA = await makeUser(
      { tenantId, organizationId: orgA.id, secondOrganizationId: orgB.id },
      "hr-a",
      [SYSTEM_ROLES.HR_ADMIN],
    );

    await createApprovalRequest(
      requester.subject,
      {},
      { requestType: "leave.request", subject: "Org A request", organizationId: orgA.id },
    );
    await createApprovalRequest(
      requester.subject,
      {},
      { requestType: "leave.request", subject: "Org B request", organizationId: orgB.id },
    );

    const inA = await listPendingApprovals(hrInA.subject, { organizationId: orgA.id });
    expect(inA.map((a) => a.subject)).toEqual(["Org A request"]);
    expect(inA[0]!.organizationId).toBe(orgA.id);
  });
});
