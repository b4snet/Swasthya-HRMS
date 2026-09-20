/**
 * Contract renewal + metadata + expiry-read services (Phase 3, prompt 3).
 *
 * Split from contract-service.ts the same way credentials splits
 * verification-service from mutations: keep the creation/lifecycle core
 * focused; renewal and metadata edits live here.
 *
 * Invariants (mirroring the core service):
 * - Renewal is an APPEND-ONLY amendment whose only term change is a
 *   forward-only end date (domain rule assertRenewalChain); the prior
 *   version row is superseded, never edited.
 * - Metadata updates touch display/annotation fields only — status, term
 *   dates and versions are unreachable through this path.
 * - Expiry reads are reach-resolved; EXPIRING is DERIVED, never stored.
 * - Every mutation audits in the same transaction (ADR-005, fail-closed).
 */
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { isContractFrozen } from "../domain/contract-status";
import { assertRenewalChain } from "../domain/contract-renewal";
import { assertClauseNames } from "../domain/contract-number";
import { ContractsAppError, toContractsAppError } from "./app-errors";
import {
  assertCallerCanManageContracts,
  assertCallerCanReadContracts,
  findScopedRow,
  transactWithAudit,
  assertVersionMatches,
  type WorkforceSubject,
} from "./mutations";

// ── Renewal: forward-only extension of the governing term ─────────────────

export interface RenewContractInput {
  contractId: string;
  expectedVersion: number;
  newEffectiveTo: Date;
  note?: string | null;
}

export async function renewContract(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: RenewContractInput,
): Promise<{ versionNo: number; effectiveTo: Date }> {
  try {
    assertClauseNames(["RENEWAL"]);
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
        `A ${current.status} contract cannot be renewed.`,
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
    assertRenewalChain(
      { effectiveFrom: previous.effectiveFrom, effectiveTo: previous.effectiveTo },
      input.newEffectiveTo,
      new Date(),
    );

    return await transactWithAudit(
      caller,
      ctx,
      (result: { versionNo: number; effectiveTo: Date }) => ({
        action: "contract.renewed",
        resourceType: "Contract",
        resourceId: current.id,
        before: { effectiveTo: previous.effectiveTo?.toISOString() ?? null },
        after: { effectiveTo: result.effectiveTo.toISOString(), versionNo: result.versionNo },
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
            effectiveFrom: previous.effectiveFrom,
            effectiveTo: input.newEffectiveTo,
            clauseNames: ["RENEWAL"],
            note: input.note ?? "Renewal: term extended.",
            createdBy: caller.userId,
          },
        });
        const updated = await tx.contract.update({
          where: { id: current.id },
          data: {
            currentVersionNo: current.currentVersionNo + 1,
            effectiveTo: input.newEffectiveTo,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
          select: { currentVersionNo: true },
        });
        return { versionNo: updated.currentVersionNo, effectiveTo: input.newEffectiveTo };
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

// ── Metadata update: non-historical fields only ───────────────────────────

export interface UpdateContractMetadataInput {
  contractId: string;
  expectedVersion: number;
  title?: string;
  notes?: string | null;
  documentId?: string | null;
}

export async function updateContractMetadata(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: UpdateContractMetadataInput,
): Promise<{ ok: true }> {
  try {
    const current = await findScopedRow(
      prisma.contract,
      { id: input.contractId, tenantId: caller.tenantId },
      "Contract",
    );
    await assertCallerCanManageContracts(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Contract");
    if (input.documentId) {
      const doc = await prisma.document.findFirst({
        where: { id: input.documentId, tenantId: caller.tenantId },
        select: { id: true },
      });
      if (!doc) throw new ContractsAppError("NOT_FOUND", "Document not found.");
    }
    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "contract.updated",
        resourceType: "Contract",
        resourceId: current.id,
        after: {
          title: input.title ?? current.title,
          notes: input.notes === undefined ? current.notes : input.notes,
          documentId: input.documentId === undefined ? current.documentId : input.documentId,
        },
      }),
      async (tx) => {
        await tx.contract.update({
          where: { id: current.id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.documentId !== undefined ? { documentId: input.documentId } : {}),
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        return { ok: true as const };
      },
    );
  } catch (err) {
    throw toContractsAppError(err);
  }
}

// ── Expiry queries: data for the future monitoring service (plan §5) ──────

export type ExpiringContractItem = {
  id: string;
  contractNo: string;
  title: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  employmentId: string;
  organizationId: string;
};

/**
 * Expiring/expired contracts the caller may READ: fixed-term contracts at
 * or inside the window (EXPIRING, derived here) or already past effectiveTo
 * (EXPIRED). Rows outside the caller's reach are omitted entirely — never a
 * existence leak (IDOR posture).
 */
export async function listContractsNearingExpiry(
  caller: WorkforceSubject,
  opts: { today?: Date; windowDays?: number } = {},
): Promise<ExpiringContractItem[]> {
  const today = opts.today ?? new Date();
  const windowDays = opts.windowDays ?? 60;
  const horizon = new Date(today.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const rows = await prisma.contract.findMany({
    where: {
      tenantId: caller.tenantId,
      status: { in: ["ACTIVE", "EXPIRED"] },
      effectiveTo: { not: null, lte: horizon },
    },
    orderBy: { effectiveTo: "asc" },
    select: {
      id: true,
      contractNo: true,
      title: true,
      status: true,
      effectiveFrom: true,
      effectiveTo: true,
      employmentId: true,
      organizationId: true,
    },
  });
  const visible: ExpiringContractItem[] = [];
  for (const row of rows) {
    try {
      await assertCallerCanReadContracts(caller, row.organizationId);
      visible.push({
        ...row,
        status:
          row.status === "ACTIVE" && (row.effectiveTo?.getTime() ?? Infinity) <= horizon.getTime()
            ? "EXPIRING"
            : row.status,
      });
    } catch {
      // Denied rows are simply omitted.
    }
  }
  return visible;
}
