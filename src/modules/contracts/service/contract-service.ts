/**
 * Contract application services (Phase 3; ADR-011 §1).
 *
 * Invariants enforced here (all unit/integration-tested):
 * - Contract binds an employment in the caller's tenant+org; employment
 *   must not be DRAFT (a draft hire has nothing to contract yet).
 * - Exactly ONE ACTIVE contract per (employment, type) — DB partial unique
 *   index `contracts_active_per_employment_type_key` + friendly service
 *   pre-check (CONFLICT_DUPLICATE instead of a raw P2002 leak).
 * - Versions are append-only: amendment closes the current version
 *   (supersededAt) and inserts the next in the SAME transaction; no update
 *   path for term rows exists in this module.
 * - Lifecycle transitions validated by the pure state machine + approval
 *   metadata requirement on activation; EXPIRED is set only by the sweep.
 * - Every mutation writes an audit event in the same transaction
 *   (fail-closed; ADR-005).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import {
  assertContractTransition,
  assertApprovalRequirements,
  isContractFrozen,
  type ContractStatusValue,
} from "../domain/contract-status";
import { assertContractNo, assertClauseNames, assertVersionChain } from "../domain/contract-number";
import { ContractsAppError, toContractsAppError } from "./app-errors";
import {
  assertCallerCanManageContracts,
  assertCallerCanReadContracts,
  findScopedRow,
  transactWithAudit,
  assertVersionMatches,
  type WorkforceSubject,
} from "./mutations";

export interface ContractVersionFacts {
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  clauseNames?: string[];
  note?: string | null;
}

export interface CreateContractInput {
  organizationId: string;
  employmentId: string;
  contractNo: string;
  title: string;
  type:
    | "EMPLOYMENT"
    | "SECONDMENT"
    | "NDA"
    | "CONFIDENTIALITY"
    | "LOCUM"
    | "CONSULTANCY"
    | "INTERNSHIP"
    | "OTHER";
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  templateId?: string | null;
  templateVersionNo?: number | null;
  jurisdiction?: string | null;
  documentId?: string | null;
  notes?: string | null;
  firstVersion: ContractVersionFacts;
}

export async function createContract(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: CreateContractInput,
): Promise<{ id: string }> {
  try {
    assertContractNo(input.contractNo);
    assertClauseNames(input.firstVersion.clauseNames ?? []);
    await assertCallerCanManageContracts(caller, input.organizationId);

    const employment = await findScopedRow(
      prisma.employment,
      { id: input.employmentId, tenantId: caller.tenantId, organizationId: input.organizationId },
      "Employment",
    );
    if (employment.status === "DRAFT") {
      throw new ContractsAppError(
        "EMPLOYMENT_STATE_INVALID",
        "Contracts cannot be created for a DRAFT employment.",
      );
    }
    if (input.templateId) {
      const template = await prisma.contractTemplate.findFirst({
        where: { id: input.templateId, tenantId: caller.tenantId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!template) {
        throw new ContractsAppError(
          "CONTRACT_TEMPLATE_INVALID",
          "Template not found or not active in this tenant.",
        );
      }
    }
    if (input.documentId) {
      // The referenced artifact must live in the caller's tenant (IDOR-safe
      // existence check before the FK does it for us).
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!doc) {
        throw new ContractsAppError("NOT_FOUND", "Document not found.");
      }
    }

    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "contract.created",
        resourceType: "Contract",
        resourceId: created.id,
        after: {
          contractNo: input.contractNo,
          type: input.type,
          status: "DRAFT",
          employmentId: input.employmentId,
        },
      }),
      async (tx) => {
        const duplicate = await tx.contract.findFirst({
          where: { tenantId: caller.tenantId, contractNo: input.contractNo },
          select: { id: true },
        });
        if (duplicate) {
          throw new ContractsAppError(
            "CONFLICT_DUPLICATE",
            "A contract with this number already exists.",
            "contractNo",
          );
        }
        const created = await tx.contract.create({
          data: {
            tenantId: caller.tenantId,
            organizationId: input.organizationId,
            employmentId: input.employmentId,
            contractNo: input.contractNo,
            title: input.title,
            type: input.type,
            status: "DRAFT",
            jurisdiction: input.jurisdiction ?? null,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo ?? null,
            templateId: input.templateId ?? null,
            templateVersionNo: input.templateVersionNo ?? null,
            documentId: input.documentId ?? null,
            notes: input.notes ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
            versions: {
              create: {
                tenantId: caller.tenantId,
                versionNo: 1,
                effectiveFrom: input.firstVersion.effectiveFrom,
                effectiveTo: input.firstVersion.effectiveTo ?? null,
                clauseNames: input.firstVersion.clauseNames ?? [],
                note: input.firstVersion.note ?? null,
                createdBy: caller.userId,
              },
            },
          },
          select: { id: true },
        });
        return created;
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

export interface AmendContractInput {
  contractId: string;
  expectedVersion: number;
  nextVersion: ContractVersionFacts;
}

/**
 * Amendment = new append-only version row + supersede the current one + the
 * contract stays ACTIVE with currentVersionNo bumped. History is never
 * overwritten: the superseded row keeps its clause set forever.
 */
export async function amendContract(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: AmendContractInput,
): Promise<{ versionNo: number }> {
  try {
    assertClauseNames(input.nextVersion.clauseNames ?? []);
    const current = await findScopedRow(
      prisma.contract,
      { id: input.contractId, tenantId: caller.tenantId },
      "Contract",
    );
    await assertCallerCanManageContracts(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Contract");
    if (isContractFrozen(current.status)) {
      throw new ContractsAppError(
        "CONTRACT_STATE_INVALID",
        `A ${current.status} contract cannot be amended.`,
      );
    }
    const previous = await prisma.contractVersion.findFirstOrThrow({
      where: {
        tenantId: caller.tenantId,
        contractId: current.id,
        versionNo: current.currentVersionNo,
      },
      select: { effectiveFrom: true, effectiveTo: true },
    });
    assertVersionChain(
      { effectiveFrom: previous.effectiveFrom, effectiveTo: previous.effectiveTo },
      {
        effectiveFrom: input.nextVersion.effectiveFrom,
        effectiveTo: input.nextVersion.effectiveTo ?? null,
      },
    );
    if (current.status !== "ACTIVE") {
      assertContractTransition(current.status, "ACTIVE");
    }

    return await transactWithAudit(
      caller,
      ctx,
      (result) => ({
        action: "contract.amended",
        resourceType: "Contract",
        resourceId: current.id,
        before: { currentVersionNo: current.currentVersionNo },
        after: { currentVersionNo: result.versionNo },
      }),
      async (tx) => {
        const now = new Date();
        await tx.contractVersion.updateMany({
          where: {
            tenantId: caller.tenantId,
            contractId: current.id,
            versionNo: current.currentVersionNo,
          },
          data: { supersededAt: now, supersededBy: caller.userId },
        });
        await tx.contractVersion.create({
          data: {
            tenantId: caller.tenantId,
            contractId: current.id,
            versionNo: current.currentVersionNo + 1,
            effectiveFrom: input.nextVersion.effectiveFrom,
            effectiveTo: input.nextVersion.effectiveTo ?? null,
            clauseNames: input.nextVersion.clauseNames ?? [],
            note: input.nextVersion.note ?? null,
            createdBy: caller.userId,
          },
        });
        const updated = await tx.contract.update({
          where: { id: current.id },
          data: {
            currentVersionNo: current.currentVersionNo + 1,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
          select: { currentVersionNo: true },
        });
        return { versionNo: updated.currentVersionNo };
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

export interface ChangeContractStatusInput {
  contractId: string;
  to: Exclude<ContractStatusValue, "EXPIRED">; // EXPIRED is sweep-derived only
  expectedVersion: number;
  approvedBy?: string;
  approvedAt?: Date;
  signature?: { signedOn: Date; signedByEmployee?: string; signedByEmployer?: string };
}

export async function changeContractStatus(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ChangeContractStatusInput,
): Promise<{ status: string }> {
  try {
    const current = await findScopedRow(
      prisma.contract,
      { id: input.contractId, tenantId: caller.tenantId },
      "Contract",
    );
    await assertCallerCanManageContracts(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Contract");
    assertContractTransition(current.status, input.to);
    assertApprovalRequirements(input.to, {
      approvedBy: input.approvedBy ?? null,
      approvedAt: input.approvedAt ?? null,
    });

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: input.to === "ACTIVE" ? "contract.activated" : `contract.${input.to.toLowerCase()}`,
        resourceType: "Contract",
        resourceId: current.id,
        before: { status: current.status },
        after: { status: input.to },
      }),
      async (tx) => {
        const updated = await tx.contract.update({
          where: { id: current.id },
          data: {
            status: input.to,
            approvedBy: input.approvedBy ?? current.approvedBy,
            approvedAt: input.approvedAt ?? current.approvedAt,
            signedOn: input.signature?.signedOn ?? current.signedOn,
            signedByEmployee: input.signature?.signedByEmployee ?? current.signedByEmployee,
            signedByEmployer: input.signature?.signedByEmployer ?? current.signedByEmployer,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
          select: { status: true },
        });
        return { status: updated.status };
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

export async function archiveContract(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { contractId: string; expectedVersion: number },
): Promise<{ status: string }> {
  try {
    const current = await findScopedRow(
      prisma.contract,
      { id: input.contractId, tenantId: caller.tenantId },
      "Contract",
    );
    await assertCallerCanManageContracts(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Contract");
    if (current.status === "DRAFT") {
      throw new ContractsAppError(
        "CONTRACT_STATE_INVALID",
        "Draft contracts are deleted by discarding the draft flow, not archived.",
      );
    }
    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "contract.archived",
        resourceType: "Contract",
        resourceId: current.id,
        before: { status: current.status },
        after: { status: "ARCHIVED" },
      }),
      async (tx) => {
        const updated = await tx.contract.update({
          where: { id: current.id },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
          select: { status: true },
        });
        return { status: updated.status };
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

/**
 * Expiry sweep (pure input, injectable clock): flips ACTIVE contracts past
 * effectiveTo to EXPIRED. The future monitoring service calls this; no
 * scheduler is wired in Phase 3 (plan §5).
 */
export async function runContractExpirySweep(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  today: Date,
): Promise<{ expired: number }> {
  const contracts = await prisma.contract.findMany({
    where: { tenantId: caller.tenantId, status: "ACTIVE", effectiveTo: { lte: today } },
    select: { id: true, organizationId: true },
  });
  let expired = 0;
  for (const contract of contracts) {
    // Sweep runs with manage capability per contract's org.
    await assertCallerCanManageContracts(caller, contract.organizationId);
    await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "contract.expired",
        resourceType: "Contract",
        resourceId: contract.id,
        after: { status: "EXPIRED" },
      }),
      async (tx: Prisma.TransactionClient) => {
        await tx.contract.update({
          where: { id: contract.id },
          data: { status: "EXPIRED", version: { increment: 1 }, updatedBy: caller.userId },
        });
        return { expired: 1 };
      },
    );
    expired += 1;
  }
  return { expired };
}

export async function getContractDetail(
  caller: WorkforceSubject,
  contractId: string,
): Promise<unknown> {
  const contract = await findScopedRow(
    prisma.contract,
    { id: contractId, tenantId: caller.tenantId },
    "Contract",
  );
  await assertCallerCanReadContracts(caller, contract.organizationId);
  const versions = await prisma.contractVersion.findMany({
    where: { tenantId: caller.tenantId, contractId: contract.id },
    orderBy: { versionNo: "asc" },
  });
  const parties = await prisma.contractParty.findMany({
    where: { tenantId: caller.tenantId, contractId: contract.id },
    orderBy: { createdAt: "asc" },
  });
  return { contract, versions, parties };
}
