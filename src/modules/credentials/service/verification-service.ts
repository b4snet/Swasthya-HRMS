/**
 * Credential verification, renewal, expiry and registry services
 * (Phase 3; prompt 3 API/application layer).
 *
 * Authorization = RBAC capability + ABAC reach resolved server-side
 * (ADR-003), pure helpers from domain/expiry, single-transaction audit
 * (ADR-005, fail-closed) and deny-by-default scoped lookups (IDOR-safe).
 *
 * Invariants (ADR-011 §3):
 * - Verification is an explicit act recorded in an append-only record;
 *   the EmployeeCredential status is the derived CURRENT pointer.
 * - EXPIRED is DERIVED — manual writes are rejected; the sweep appends an
 *   EXPIRED record when the recorded expiry passes.
 * - Renewals move expiry forward only; a REVOKED credential stays REVOKED.
 * - The issuing-authority registry is tenant-scoped and manage-gated.
 */
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { accessibleOrganizationIds } from "@/lib/auth/scopes";
import {
  assertRecordableOutcome,
  assertOutcomeProgression,
  assertRenewalExpiry,
  type VerificationOutcome,
} from "../domain/expiry";
import {
  CredentialsAppError,
  toCredentialsAppError,
} from "./app-errors";
import {
  assertCallerCanManageCredentialConfig,
  assertCallerCanManageCredentials,
  assertCallerCanReadCredentials,
  assertCallerCanVerifyCredentials,
  findScopedRow,
  transactWithAudit,
  assertVersionMatches,
  asConflict,
  type WorkforceSubject,
} from "./mutations";

type ManualOutcome = Exclude<VerificationOutcome, "EXPIRED">;

function verifyAction(outcome: ManualOutcome): string {
  switch (outcome) {
    case "VERIFIED":
      return "credential.verified";
    case "REVOKED":
      return "credential.revoked";
    case "SUSPENDED":
      return "credential.suspended";
    case "REJECTED":
      return "credential.rejected";
    case "IN_PROGRESS":
      return "credential.verification_in_progress";
    case "PENDING":
      return "credential.submitted";
  }
}

interface VerificationInput {
  credentialId: string;
  outcome: ManualOutcome;
  method: "ISSUER_DIRECT" | "PORTAL" | "DOCUMENT_INSPECTION" | "PHONE" | "OTHER";
  notes?: string | null;
}

/**
 * Record a verification act. `credential:verify` (plus org reach) required;
 * the caller can never verify in their own name in a way that upgrades the
 * credential (denied by capability map, not by identity heuristics).
 */
export async function recordCredentialVerification(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: VerificationInput,
): Promise<{ status: ManualOutcome; recordId: string }> {
  try {
    assertRecordableOutcome(input.outcome); // runtime guard for untyped callers
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanVerifyCredentials(caller, current.organizationId);
    if (current.status === "ARCHIVED") {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        "An archived credential cannot receive verification acts.",
      );
    }
    assertOutcomeProgression(
      current.verificationStatus as VerificationOutcome,
      input.outcome,
    );

    return await transactWithAudit(
      caller,
      ctx,
      (result) => ({
        action: verifyAction(input.outcome),
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        before: { verificationStatus: current.verificationStatus },
        after: { verificationStatus: result.status, outcome: input.outcome },
      }),
      async (tx) => {
        const record = await tx.credentialVerificationRecord.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: input.credentialId,
            outcome: input.outcome,
            method: input.method,
            performedBy: caller.userId,
            notes: input.notes ?? null,
            createdBy: caller.userId,
          },
          select: { id: true },
        });
        const data: {
          verificationStatus: ManualOutcome;
          verifiedAt?: Date;
          verifiedBy?: string;
          verificationRecordId?: string;
          version: { increment: number };
          updatedBy: string;
        } = {
          verificationStatus: input.outcome,
          version: { increment: 1 },
          updatedBy: caller.userId,
        };
        if (input.outcome === "VERIFIED") {
          data.verifiedAt = new Date();
          data.verifiedBy = caller.userId;
          data.verificationRecordId = record.id;
        }
        await tx.employeeCredential.update({ where: { id: input.credentialId }, data });
        return { status: input.outcome, recordId: record.id };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Renewal ────────────────────────────────────────────────────────────────

interface RenewCredentialInput {
  credentialId: string;
  newExpiresOn: Date;
  notes?: string | null;
}

/**
 * Extend the expiry window FORWARD ONLY. The verification status is never
 * altered by a renewal — a REVOKED credential stays REVOKED.
 */
export async function renewCredential(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: RenewCredentialInput,
): Promise<{ newExpiresOn: Date }> {
  try {
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanManageCredentials(caller, current.organizationId);
    if (current.status === "ARCHIVED") {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        "An archived credential cannot be renewed.",
      );
    }
    assertRenewalExpiry({ expiresOn: current.expiresOn }, input.newExpiresOn, new Date());

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.renewed",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        before: { expiresOn: current.expiresOn?.toISOString() ?? null },
        after: { newExpiresOn: input.newExpiresOn.toISOString() },
      }),
      async (tx) => {
        await tx.credentialRenewal.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: input.credentialId,
            newExpiresOn: input.newExpiresOn,
            notes: input.notes ?? null,
            createdBy: caller.userId,
          },
        });
        await tx.employeeCredential.update({
          where: { id: input.credentialId },
          data: {
            expiresOn: input.newExpiresOn,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        return { newExpiresOn: input.newExpiresOn };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Expiry sweep ───────────────────────────────────────────────────────────

/**
 * Derive EXPIRED for credentials whose recorded expiry has passed. Appends
 * an EXPIRED record with method OTHER (derived, never an asserted act) and
 * syncs the denormalized status. One audit event summarises the sweep.
 */
export async function runCredentialExpirySweep(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  today: Date = new Date(),
): Promise<{ expired: number }> {
  try {
    if (caller.status !== "ACTIVE") {
      throw new CredentialsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
        reason: "USER_NOT_ACTIVE",
      });
    }
    const reach = await accessibleOrganizationIds(caller);
    const expired = await prisma.employeeCredential.findMany({
      where: {
        tenantId: caller.tenantId,
        status: { not: "ARCHIVED" },
        verificationStatus: { notIn: ["EXPIRED", "REVOKED"] },
        expiresOn: { lte: today },
        ...(reach === "ALL" ? {} : { organizationId: { in: reach } }),
      },
      select: { id: true, organizationId: true },
    });

    let count = 0;
    for (const credential of expired) {
      try {
        await assertCallerCanVerifyCredentials(caller, credential.organizationId);
      } catch {
        continue; // out-of-reach rows are simply not expired by this caller
      }
      await prisma.$transaction(async (tx) => {
        await tx.credentialVerificationRecord.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: credential.id,
            outcome: "EXPIRED",
            method: "OTHER",
            performedBy: caller.userId,
            notes: "Derived: recorded expiry date passed (sweep).",
            createdBy: caller.userId,
          },
        });
        await tx.employeeCredential.update({
          where: { id: credential.id },
          data: {
            verificationStatus: "EXPIRED",
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
      });
      count += 1;
    }

    if (count > 0) {
      await transactWithAudit(
        caller,
        ctx,
        () => ({
          action: "credential.expired",
          resourceType: "EmployeeCredential",
          after: { expired: count },
        }),
        async () => ({ ok: true as const }),
      );
    }
    return { expired: count };
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Verification record history ────────────────────────────────────────────

export interface VerificationRecordRow {
  id: string;
  outcome: string;
  method: string;
  performedBy: string;
  performedAt: Date;
  notes: string | null;
}

/** Append-only verification history for one credential (read-gated). */
export async function listVerificationRecords(
  caller: WorkforceSubject,
  credentialId: string,
): Promise<VerificationRecordRow[]> {
  try {
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanReadCredentials(caller, current.organizationId);
    const rows = await prisma.credentialVerificationRecord.findMany({
      where: { tenantId: caller.tenantId, credentialId },
      orderBy: { performedAt: "asc" },
      select: {
        id: true,
        outcome: true,
        method: true,
        performedBy: true,
        performedAt: true,
        notes: true,
      },
    });
    return rows.map((r) => ({ ...r, outcome: r.outcome as string, method: r.method as string }));
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Issuing authority registry ─────────────────────────────────────────────

export interface IssuingAuthorityInput {
  organizationId: string | null; // registry is tenant-scoped; null = global-capable row
  code: string;
  name: string;
  authorityType: "MEDICAL_COUNCIL" | "NURSING_COUNCIL" | "GOVERNMENT" | "UNIVERSITY" | "BOARD" | "OTHER";
  jurisdiction?: string | null;
  website?: string | null;
}

export async function createIssuingAuthority(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: IssuingAuthorityInput,
): Promise<{ id: string; status: string }> {
  try {
    await assertCallerCanManageCredentialConfig(caller);
    return await transactWithAudit(
      caller,
      ctx,
      (created) => ({
        action: "credential.authority.created",
        resourceType: "IssuingAuthority",
        resourceId: created.id,
        after: { code: input.code, name: input.name, authorityType: input.authorityType },
      }),
      async (tx) => {
        const authority = await tx.issuingAuthority.create({
          data: {
            tenantId: caller.tenantId,
            code: input.code,
            name: input.name,
            authorityType: input.authorityType,
            jurisdiction: input.jurisdiction ?? null,
            website: input.website ?? null,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          },
          select: { id: true, status: true },
        });
        return { id: authority.id, status: authority.status as string };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(asConflict(err));
  }
}

export async function archiveIssuingAuthority(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: { authorityId: string; expectedVersion: number },
): Promise<{ status: string }> {
  try {
    const authority = await findScopedRow(
      prisma.issuingAuthority,
      { id: input.authorityId, tenantId: caller.tenantId },
      "Issuing authority",
    );
    await assertCallerCanManageCredentialConfig(caller);
    assertVersionMatches(authority, input.expectedVersion, "Issuing authority");

    const inUse =
      (await prisma.employeeCredential.count({ where: { issuingAuthorityId: input.authorityId } })) >
        0 ||
      (await prisma.employeeQualification.count({
        where: { issuingAuthorityId: input.authorityId },
      })) > 0;
    if (inUse) {
      throw new CredentialsAppError(
        "AUTHORITY_IN_USE",
        "This issuing authority is referenced by credentials or qualifications and cannot be archived.",
      );
    }

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.authority.archived",
        resourceType: "IssuingAuthority",
        resourceId: input.authorityId,
        after: { status: "ARCHIVED" },
      }),
      async (tx) => {
        await tx.issuingAuthority.update({
          where: { id: input.authorityId },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
        });
        return { status: "ARCHIVED" as const };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

export async function attachIssuingAuthority(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: {
    credentialId: string;
    issuingAuthorityId: string;
    jurisdiction?: string | null;
    expectedVersion: number;
  },
): Promise<{ status: string }> {
  try {
    const credential = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanManageCredentials(caller, credential.organizationId);
    assertVersionMatches(credential, input.expectedVersion, "Credential");
    await findScopedRow(
      prisma.issuingAuthority,
      { id: input.issuingAuthorityId, tenantId: caller.tenantId },
      "Issuing authority",
    );

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.authority.attached",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        after: {
          issuingAuthorityId: input.issuingAuthorityId,
          jurisdiction: input.jurisdiction ?? null,
        },
      }),
      async (tx) => {
        await tx.employeeCredential.update({
          where: { id: input.credentialId },
          data: {
            issuingAuthorityId: input.issuingAuthorityId,
            jurisdiction: input.jurisdiction ?? null,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        // Attachment is NOT a verification act: status unchanged by design.
        return { status: credential.verificationStatus as string };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

/**
 * Lead-window map used by the expiry reads. Falls back to the domain's
 * per-type defaults when the tenant has no CredentialTypeConfig rows.
 */
export async function renewalLeadDaysByType(
  tenantId: string,
): Promise<Record<string, number>> {
  const configs = await prisma.credentialTypeConfig.findMany({
    where: { tenantId, status: { not: "ARCHIVED" } },
    select: { code: true, renewalLeadDays: true },
  });
  const byType: Record<string, number> = {};
  for (const c of configs) byType[c.code] = c.renewalLeadDays;
  return byType;
}