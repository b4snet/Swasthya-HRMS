/**
 * Renewal workflow application services (Slice 1.1 continuation; Phase 1
 * roadmap "contract renewal workflow", plus credential renewal on the same
 * readymade primitives).
 *
 * Mirrors the separation binding exactly:
 *  - request* validates against the renewal domain, then raises an
 *    ApprovalRequest (sourceType CONTRACT/CREDENTIAL, sourceId the target
 *    row, namespaced requestType) and notifies the approver;
 *  - apply* executes only on an APPROVED approval, inside ONE transaction
 *    with the audit event: extends the contract term (employment
 *    contractEndDate too) or records the append-only credential renewal;
 *  - the approver can never approve their own request.
 *
 * Authorization (default deny): EMPLOYEE_MANAGE asserted against the
 * organization derived from the authoritative database row, never client
 * input. Tenancy: id resolution is tenant-scoped first (IDOR posture);
 * foreign approvals are NOT_FOUND, never leaks.
 */
import { prisma } from "@/lib/db";
import { writeAuditEvent, type RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "./types";
import { WorkforceAppError, toWorkforceServiceError } from "./app-errors";
import { assertCallerCanManageEmployees } from "./mutations";
import { accessibleOrganizationIds } from "@/lib/auth/scopes";
import {
  createApprovalRequest,
  decideApproval,
  listPendingApprovals,
  type ApprovalView,
} from "@/modules/workflows/service/workflow-service";
import { createNotification } from "@/modules/notifications/service/notifications-service";
import {
  CONTRACT_RENEWAL_REQUEST_TYPE,
  CREDENTIAL_RENEWAL_REQUEST_TYPE,
  assertContractRenewalData,
  assertContractRenewalRequestAllowed,
  assertCredentialRenewalData,
  assertCredentialRenewalRequestAllowed,
  assertRenewalApplicable,
  isRenewalRequestType,
} from "../domain/renewal";
import type { ApprovalStatus } from "@/modules/workflows/domain/workflow";

function assertApproverIsNotRequester(caller: WorkforceSubject, approverUserId: string | null | undefined): void {
  if (approverUserId && approverUserId === caller.userId) {
    throw new WorkforceAppError(
      "AUTHORIZATION_DENIED",
      "An approver cannot be the requester of the same renewal.",
    );
  }
}

// --- contract renewal ------------------------------------------------------

export interface RequestContractRenewalInput {
  employmentId: string;
  newEffectiveFrom: Date;
  newEffectiveTo: Date;
  note?: string | null;
  approverUserId?: string | null;
}

/**
 * Raise a renewal for the employment's current ACTIVE contract. The new term
 * must extend the existing one (domain rule); it becomes effective only once
 * an APPROVED approval is applied.
 */
export async function requestContractRenewal(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: RequestContractRenewalInput,
): Promise<{ approvalId: string; approvalStatus: ApprovalStatus; contractId: string }> {
  try {
    const tenantId = caller.tenantId;
    const employment = await prisma.employment.findFirst({
      where: { id: input.employmentId, tenantId },
      select: { id: true, organizationId: true, employeeId: true },
    });
    if (!employment) throw new WorkforceAppError("NOT_FOUND", "Employment not found.");
    await assertCallerCanManageEmployees(caller, employment.organizationId);

    // The employment's latest contract (any status): a renewable state or a
    // domain error, never a silent "not found" for a plainly non-renewable row.
    const contract = await prisma.contract.findFirst({
      where: { employmentId: employment.id, tenantId },
      orderBy: [{ effectiveTo: "desc" }, { createdAt: "desc" }],
      select: { id: true, contractNo: true, effectiveTo: true, status: true },
    });
    if (!contract) throw new WorkforceAppError("NOT_FOUND", "No contract found.");
    assertContractRenewalRequestAllowed(contract.status);
    assertContractRenewalData(contract.effectiveTo, input);
    assertApproverIsNotRequester(caller, input.approverUserId);

    const approval = await createApprovalRequest(caller, ctx, {
      organizationId: employment.organizationId,
      requestType: CONTRACT_RENEWAL_REQUEST_TYPE,
      subject: `Contract renewal ${contract.contractNo}`,
      rationale: input.note ?? null,
      approverUserId: input.approverUserId ?? null,
      sourceType: "CONTRACT",
      sourceId: contract.id,
    });

    if (input.approverUserId && input.approverUserId !== caller.userId) {
      await createNotification({
        recipientUserId: input.approverUserId,
        tenantId,
        organizationId: employment.organizationId,
        notificationType: "contract.renewal.request",
        title: `Contract renewal approval needed: ${contract.contractNo}`,
        message: input.note ?? null,
        entityType: "CONTRACT",
        entityId: contract.id,
        createdBy: caller.userId,
      });
    }

    return { approvalId: approval.id, approvalStatus: approval.status, contractId: contract.id };
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

export interface ApplyContractRenewalInput {
  approvalId: string;
  expectedVersion: number;
  newEffectiveTo: Date;
  note?: string | null;
}

/**
 * Apply an APPROVED contract renewal: extend the contract term AND the
 * employment contractEndDate in one transaction with the audit event.
 */
export async function applyContractRenewal(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ApplyContractRenewalInput,
): Promise<{ contractId: string; contractNo: string; effectiveTo: Date; contractEndDate: Date }> {
  try {
    const tenantId = caller.tenantId;
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: input.approvalId, tenantId },
    });
    if (
      !approval ||
      approval.sourceType !== "CONTRACT" ||
      approval.requestType !== CONTRACT_RENEWAL_REQUEST_TYPE ||
      !approval.sourceId
    ) {
      throw new WorkforceAppError("NOT_FOUND", "Contract renewal approval not found.");
    }
    assertRenewalApplicable(approval.status);

    const contract = await prisma.contract.findFirst({
      where: { id: approval.sourceId, tenantId },
      select: {
        id: true,
        contractNo: true,
        employmentId: true,
        organizationId: true,
        effectiveFrom: true,
        effectiveTo: true,
        status: true,
      },
    });
    if (!contract) throw new WorkforceAppError("NOT_FOUND", "Contract not found.");
    await assertCallerCanManageEmployees(caller, contract.organizationId);
    assertContractRenewalRequestAllowed(contract.status);
    assertContractRenewalData(contract.effectiveTo, {
      newEffectiveFrom: contract.effectiveFrom,
      newEffectiveTo: input.newEffectiveTo,
    });

    const employment = await prisma.employment.findFirst({
      where: { id: contract.employmentId, tenantId },
      select: { id: true, contractEndDate: true },
    });
    if (!employment) throw new WorkforceAppError("NOT_FOUND", "Employment not found.");

    const effectiveTo = new Date(input.newEffectiveTo);
    await prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: contract.id },
        data: { effectiveTo, updatedBy: caller.userId, version: { increment: 1 } },
      });
      await tx.employment.update({
        where: { id: employment.id },
        data: { contractEndDate: effectiveTo, updatedBy: caller.userId, version: { increment: 1 } },
      });
      await writeAuditEvent(
        {
          tenantId,
          actorUserId: caller.userId,
          action: "contract.renewal.apply",
          resourceType: "Contract",
          resourceId: contract.id,
          before: { effectiveTo: contract.effectiveTo?.toISOString() ?? null },
          after: { effectiveTo: effectiveTo.toISOString(), employmentContractEndDate: effectiveTo.toISOString() },
        },
        ctx ?? {},
        tx,
      );
    });

    if (approval.requesterUserId && approval.requesterUserId !== caller.userId) {
      await createNotification({
        recipientUserId: approval.requesterUserId,
        tenantId,
        organizationId: contract.organizationId,
        notificationType: "contract.renewal.applied",
        title: `Contract renewed: ${contract.contractNo}`,
        message: input.note ?? null,
        entityType: "CONTRACT",
        entityId: contract.id,
        createdBy: caller.userId,
      });
    }

    return { contractId: contract.id, contractNo: contract.contractNo, effectiveTo, contractEndDate: effectiveTo };
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

// --- credential renewal ----------------------------------------------------

export interface RequestCredentialRenewalInput {
  credentialId: string;
  note?: string | null;
  approverUserId?: string | null;
}

/**
 * Raise a renewal for an expiring credential. The approved expiry is fixed
 * at apply time (the executor records the official new expiry), keeping the
 * intent approval separate from the dated effect.
 */
export async function requestCredentialRenewal(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: RequestCredentialRenewalInput,
): Promise<{ approvalId: string; approvalStatus: ApprovalStatus; credentialId: string }> {
  try {
    const tenantId = caller.tenantId;
    const credential = await prisma.employeeCredential.findFirst({
      where: { id: input.credentialId, tenantId },
      select: { id: true, organizationId: true, name: true, expiresOn: true, status: true },
    });
    if (!credential) throw new WorkforceAppError("NOT_FOUND", "Credential not found.");
    await assertCallerCanManageEmployees(caller, credential.organizationId);
    assertCredentialRenewalRequestAllowed(credential.expiresOn, credential.status);
    assertApproverIsNotRequester(caller, input.approverUserId);

    const approval = await createApprovalRequest(caller, ctx, {
      organizationId: credential.organizationId,
      requestType: CREDENTIAL_RENEWAL_REQUEST_TYPE,
      subject: `Credential renewal ${credential.name}`,
      rationale: input.note ?? null,
      approverUserId: input.approverUserId ?? null,
      sourceType: "CREDENTIAL",
      sourceId: credential.id,
    });

    if (input.approverUserId && input.approverUserId !== caller.userId) {
      await createNotification({
        recipientUserId: input.approverUserId,
        tenantId,
        organizationId: credential.organizationId,
        notificationType: "credential.renewal.request",
        title: `Credential renewal approval needed: ${credential.name}`,
        message: input.note ?? null,
        entityType: "CREDENTIAL",
        entityId: credential.id,
        createdBy: caller.userId,
      });
    }

    return { approvalId: approval.id, approvalStatus: approval.status, credentialId: credential.id };
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

export interface ApplyCredentialRenewalInput {
  approvalId: string;
  expectedVersion: number;
  newExpiresOn: Date;
  note?: string | null;
}

/**
 * Apply an APPROVED credential renewal: move the credential expiry forward
 * and record the append-only CredentialRenewal row + audit in ONE
 * transaction (the ledger row is never mutated afterwards).
 */
export async function applyCredentialRenewal(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ApplyCredentialRenewalInput,
): Promise<{ credentialId: string; expiresOn: Date; renewalId: string }> {
  try {
    const tenantId = caller.tenantId;
    const approval = await prisma.approvalRequest.findFirst({
      where: { id: input.approvalId, tenantId },
    });
    if (
      !approval ||
      approval.sourceType !== "CREDENTIAL" ||
      approval.requestType !== CREDENTIAL_RENEWAL_REQUEST_TYPE ||
      !approval.sourceId
    ) {
      throw new WorkforceAppError("NOT_FOUND", "Credential renewal approval not found.");
    }
    assertRenewalApplicable(approval.status);

    const credential = await prisma.employeeCredential.findFirst({
      where: { id: approval.sourceId, tenantId },
      select: { id: true, organizationId: true, name: true, expiresOn: true, status: true },
    });
    if (!credential) throw new WorkforceAppError("NOT_FOUND", "Credential not found.");
    await assertCallerCanManageEmployees(caller, credential.organizationId);
    assertCredentialRenewalRequestAllowed(credential.expiresOn, credential.status);
    assertCredentialRenewalData(input.newExpiresOn, new Date());

    const expiresOn = new Date(input.newExpiresOn);
    const renewal = await prisma.$transaction(async (tx) => {
      await tx.employeeCredential.update({
        where: { id: credential.id },
        data: { expiresOn, updatedBy: caller.userId, version: { increment: 1 } },
      });
      const row = await tx.credentialRenewal.create({
        data: {
          tenantId,
          credentialId: credential.id,
          newExpiresOn: expiresOn,
          notes: input.note ?? approval.rationale ?? null,
          createdBy: caller.userId,
        },
        select: { id: true },
      });
      await writeAuditEvent(
        {
          tenantId,
          actorUserId: caller.userId,
          action: "credential.renewal.apply",
          resourceType: "EmployeeCredential",
          resourceId: credential.id,
          before: { expiresOn: credential.expiresOn?.toISOString() ?? null },
          after: { expiresOn: expiresOn.toISOString(), renewalId: row.id },
        },
        ctx ?? {},
        tx,
      );
      return row;
    });

    if (approval.requesterUserId && approval.requesterUserId !== caller.userId) {
      await createNotification({
        recipientUserId: approval.requesterUserId,
        tenantId,
        organizationId: credential.organizationId,
        notificationType: "credential.renewal.applied",
        title: `Credential renewed: ${credential.name}`,
        message: input.note ?? null,
        entityType: "CREDENTIAL",
        entityId: credential.id,
        createdBy: caller.userId,
      });
    }

    return { credentialId: credential.id, expiresOn, renewalId: renewal.id };
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

// --- shared decide + queue -------------------------------------------------

export interface DecideRenewalInput {
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  note?: string | null;
  expectedVersion: number;
}

/** Decide any renewal approval through the workflow engine (assigned approver or EMPLOYEE_MANAGE). */
export async function decideRenewal(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: DecideRenewalInput,
): Promise<ApprovalView> {
  try {
    const row = await prisma.approvalRequest.findFirst({
      where: { id: input.approvalId, tenantId: caller.tenantId },
    });
    if (!row || !isRenewalRequestType(row.requestType)) {
      throw new WorkforceAppError("NOT_FOUND", "Renewal approval not found.");
    }
    const view = await decideApproval(caller, ctx, {
      approvalId: input.approvalId,
      decision: input.decision,
      note: input.note ?? null,
      expectedVersion: input.expectedVersion,
    });
    return view;
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

/**
 * HR renewal queue: open contract/credential renewal approvals in the
 * caller's reach. Enforces the same ABAC org scope as listSeparationRequests.
 */
export async function listRenewalRequests(
  caller: WorkforceSubject,
  opts: { organizationId?: string | null } = {},
): Promise<ApprovalView[]> {
  try {
    const reach = await accessibleOrganizationIds(caller);
    if (opts.organizationId && reach !== "ALL" && !reach.includes(opts.organizationId)) {
      throw new WorkforceAppError(
        "AUTHORIZATION_DENIED",
        "You do not have access to that organization's queue.",
      );
    }
    let organizationId: string | undefined;
    if (opts.organizationId) {
      organizationId = opts.organizationId;
    } else if (caller.organizationId) {
      organizationId = caller.organizationId;
    } else if (reach === "ALL") {
      organizationId = undefined;
    } else if (reach.length === 1) {
      organizationId = reach[0];
    } else if (reach.length === 0) {
      throw new WorkforceAppError(
        "AUTHORIZATION_DENIED",
        "You do not have any organization scope.",
      );
    }
    const pending = await listPendingApprovals(caller, { organizationId });
    const scoped =
      reach === "ALL" || reach.length <= 1
        ? pending
        : pending.filter((a) => a.organizationId && reach.includes(a.organizationId));
    return scoped.filter((a) => isRenewalRequestType(a.requestType));
  } catch (err) {
    throw toWorkforceServiceError(err);
  }
}

