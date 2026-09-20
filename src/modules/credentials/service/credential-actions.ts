/**
 * Credential lifecycle actions (Phase 3; prompt 3 application layer).
 *
 * Submission is SELF-SERVICE (records a PENDING act, never verifies),
 * suspension/reinstatement/archival are explicit acts gated by
 * credential:verify / credential:manage, and expiry reads derive
 * EXPIRING/EXPIRED on the fly (never stored manually). All writes audit
 * in the same transaction (ADR-005) and all lookups are deny-by-default
 * scoped (IDOR posture).
 */
import { prisma } from "@/lib/db";
import type { RequestAuditContext } from "@/lib/audit";
import { accessibleOrganizationIds } from "@/lib/auth/scopes";
import { rolesHavePermission, PERMISSIONS } from "@/lib/auth/rbac";
import { renewalLeadDaysFor } from "../domain/expiry";
import { CredentialsAppError, toCredentialsAppError } from "./app-errors";
import {
  assertCallerCanManageCredentials,
  assertCallerCanReadCredentials,
  assertCallerCanVerifyCredentials,
  findScopedRow,
  transactWithAudit,
  assertVersionMatches,
  type WorkforceSubject,
} from "./mutations";
import { renewalLeadDaysByType } from "./verification-service";

// ── Self-service submission ─────────────────────────────────────────────────

export interface SubmitForVerificationInput {
  credentialId: string;
  note?: string | null;
}

/**
 * Record a self-service submission act. Grants NO verification power: the
 * credential stays PENDING and a second submission by any actor is a
 * CONFLICT_DUPLICATE. A VERIFIED (or otherwise non-PENDING) credential
 * refuses further submissions.
 */
export async function submitCredentialForVerification(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: SubmitForVerificationInput,
): Promise<{ recordId: string }> {
  try {
    if (caller.status !== "ACTIVE") {
      throw new CredentialsAppError("AUTHORIZATION_DENIED", "User account is not active.", undefined, {
        reason: "USER_NOT_ACTIVE",
      });
    }
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    if (current.status === "ARCHIVED") {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        "An archived credential cannot be submitted for verification.",
      );
    }
    if (current.verificationStatus !== "PENDING") {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        `A ${current.verificationStatus} credential cannot be submitted for verification.`,
      );
    }
    const open = await prisma.credentialVerificationRecord.findFirst({
      where: { tenantId: caller.tenantId, credentialId: input.credentialId, outcome: "PENDING" },
      select: { id: true },
    });
    if (open) {
      throw new CredentialsAppError(
        "CONFLICT_DUPLICATE",
        "This credential already has an open verification submission.",
      );
    }

    return await transactWithAudit(
      caller,
      ctx,
      (result) => ({
        action: "credential.submitted",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        after: { recordId: result.recordId, verificationStatus: "PENDING" },
      }),
      async (tx) => {
        const record = await tx.credentialVerificationRecord.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: input.credentialId,
            outcome: "PENDING",
            method: "OTHER",
            performedBy: caller.userId,
            notes: input.note ?? null,
            createdBy: caller.userId,
          },
          select: { id: true },
        });
        // Status intentionally left at PENDING — submission is not verification.
        return { recordId: record.id };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Suspend / reinstate (explicit acts, credential:verify) ──────────────────

export interface SuspendCredentialInput {
  credentialId: string;
  expectedVersion: number;
  note?: string | null;
}

const SUSPENDABLE_STATES = new Set<string>(["PENDING", "IN_PROGRESS", "VERIFIED"]);

/** Suspend a credential in good standing; refuses revocations and expired rows. */
export async function suspendCredential(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: SuspendCredentialInput,
): Promise<{ status: string }> {
  try {
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanVerifyCredentials(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Credential");
    if (current.status === "ARCHIVED" || !SUSPENDABLE_STATES.has(current.verificationStatus)) {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        `A ${current.verificationStatus} credential cannot be suspended.`,
      );
    }

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.suspended",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        before: { verificationStatus: current.verificationStatus },
        after: { verificationStatus: "SUSPENDED", outcome: "SUSPENDED" },
      }),
      async (tx) => {
        await tx.credentialVerificationRecord.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: input.credentialId,
            outcome: "SUSPENDED",
            method: "OTHER",
            performedBy: caller.userId,
            notes: input.note ?? "Credential suspended.",
            createdBy: caller.userId,
          },
        });
        await tx.employeeCredential.update({
          where: { id: input.credentialId },
          data: {
            verificationStatus: "SUSPENDED",
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        return { status: "SUSPENDED" as const };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

export interface ReinstateCredentialInput {
  credentialId: string;
  expectedVersion: number;
}

/** Reinstate a suspended credential to VERIFIED (a fresh verification act). */
export async function reinstateCredential(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ReinstateCredentialInput,
): Promise<{ status: string }> {
  try {
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanVerifyCredentials(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Credential");
    if (current.verificationStatus !== "SUSPENDED") {
      throw new CredentialsAppError(
        "CREDENTIAL_STATE_INVALID",
        "Only a suspended credential can be reinstated.",
      );
    }

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.reinstated",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        before: { verificationStatus: "SUSPENDED" },
        after: { verificationStatus: "VERIFIED", outcome: "VERIFIED" },
      }),
      async (tx) => {
        const record = await tx.credentialVerificationRecord.create({
          data: {
            tenantId: caller.tenantId,
            credentialId: input.credentialId,
            outcome: "VERIFIED",
            method: "OTHER",
            performedBy: caller.userId,
            notes: "Credential reinstated after suspension.",
            createdBy: caller.userId,
          },
          select: { id: true },
        });
        await tx.employeeCredential.update({
          where: { id: input.credentialId },
          data: {
            verificationStatus: "VERIFIED",
            verifiedAt: new Date(),
            verifiedBy: caller.userId,
            verificationRecordId: record.id,
            version: { increment: 1 },
            updatedBy: caller.userId,
          },
        });
        return { status: "VERIFIED" as const };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Archival (visibility-only, never deletion) ─────────────────────────────

export interface ArchiveCredentialInput {
  credentialId: string;
  expectedVersion: number;
}

export async function archiveCredential(
  caller: WorkforceSubject,
  ctx: RequestAuditContext | undefined,
  input: ArchiveCredentialInput,
): Promise<{ status: string }> {
  try {
    const current = await findScopedRow(
      prisma.employeeCredential,
      { id: input.credentialId, tenantId: caller.tenantId },
      "Credential",
    );
    await assertCallerCanManageCredentials(caller, current.organizationId);
    assertVersionMatches(current, input.expectedVersion, "Credential");
    if (current.status === "ARCHIVED") {
      throw new CredentialsAppError("CREDENTIAL_STATE_INVALID", "Credential is already archived.");
    }

    return await transactWithAudit(
      caller,
      ctx,
      () => ({
        action: "credential.archived",
        resourceType: "EmployeeCredential",
        resourceId: input.credentialId,
        after: { lifecycleStatus: "ARCHIVED" },
      }),
      async (tx) => {
        await tx.employeeCredential.update({
          where: { id: input.credentialId },
          data: { status: "ARCHIVED", version: { increment: 1 }, updatedBy: caller.userId },
        });
        return { status: "ARCHIVED" as const };
      },
    );
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}

// ── Expiry read (derived, reach-resolved) ───────────────────────────────────

export interface ExpiringCredentialRow {
  id: string;
  employeeId: string;
  name: string;
  type: string;
  issuer: string;
  expiresOn: Date | null;
  derivedStatus: string;
}

/**
 * Credentials at or inside their type's renewal-lead window, or already
 * expired, that the caller may READ. EXPIRING/EXPIRED are DERIVED here,
 * never stored. The window applies to any recorded credential regardless of
 * verification state (the radar must flag what must be renewed this cycle);
 * the strict domain derivation (deriveCredentialStatus) governs the state
 * machine, not this read. Rows outside reach are omitted — never an
 * existence leak. A caller without credential:read sees an empty list.
 */
export async function listCredentialsNearingExpiry(
  caller: WorkforceSubject,
  opts: { today?: Date } = {},
): Promise<ExpiringCredentialRow[]> {
  try {
    if (caller.status !== "ACTIVE") return [];
    if (!rolesHavePermission(caller.systemRoles, PERMISSIONS.CREDENTIAL_READ)) return [];

    const today = opts.today ?? new Date();
    const todayMs = today.getTime();
    const leads = await renewalLeadDaysByType(caller.tenantId);
    const reach = await accessibleOrganizationIds(caller);

    const rows = await prisma.employeeCredential.findMany({
      where: {
        tenantId: caller.tenantId,
        status: { not: "ARCHIVED" },
        expiresOn: { not: null },
        ...(reach === "ALL" ? {} : { organizationId: { in: reach } }),
      },
      orderBy: { expiresOn: "asc" },
      select: {
        id: true,
        organizationId: true,
        employeeId: true,
        name: true,
        type: true,
        issuer: true,
        expiresOn: true,
        verificationStatus: true,
      },
    });

    const DAY_MS = 24 * 60 * 60 * 1000;
    const out: ExpiringCredentialRow[] = [];
    for (const row of rows) {
      try {
        await assertCallerCanReadCredentials(caller, row.organizationId);
      } catch {
        continue; // out-of-reach rows are omitted
      }
      if (!row.expiresOn) continue;
      const lead = renewalLeadDaysFor(row.type, leads);
      const expiresMs = row.expiresOn.getTime();
      let derivedStatus: string;
      if (expiresMs <= todayMs) {
        derivedStatus = "EXPIRED";
      } else if (expiresMs <= todayMs + lead * DAY_MS) {
        derivedStatus = "EXPIRING";
      } else {
        continue;
      }
      out.push({
        id: row.id,
        employeeId: row.employeeId,
        name: row.name,
        type: row.type,
        issuer: row.issuer,
        expiresOn: row.expiresOn,
        derivedStatus,
      });
    }
    return out;
  } catch (err) {
    throw toCredentialsAppError(err);
  }
}