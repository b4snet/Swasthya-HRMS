/**
 * Thin server actions for the Credentials API (Phase 3, prompt 3).
 *
 * Mirrors contracts/api/actions.ts: parse (Zod) → resolve the caller from
 * the SESSION (tenant/org never from input) → call the service → return a
 * typed result. Services own authorization + transactions + audit; actions
 * only translate stable errors into client-safe results (no SQL, no Prisma
 * internals, no stack traces cross this boundary).
 */
"use server";

import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { CredentialsAppError, serializeCredentialsAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "../../workforce/service/types";
import { callerFromUser } from "../../workforce/service/caller";
import {
  attachIssuingAuthoritySchema,
  archiveCredentialSchema,
  archiveIssuingAuthoritySchema,
  createIssuingAuthoritySchema,
  expiryWindowSchema,
  listVerificationRecordsSchema,
  recordVerificationSchema,
  reinstateCredentialSchema,
  renewCredentialSchema,
  submitForVerificationSchema,
  suspendCredentialSchema,
} from "./schemas";
import {
  recordCredentialVerification,
  renewCredential,
  runCredentialExpirySweep,
  createIssuingAuthority,
  archiveIssuingAuthority,
  attachIssuingAuthority,
  listVerificationRecords,
} from "../service/verification-service";
import {
  submitCredentialForVerification,
  suspendCredential,
  reinstateCredential,
  archiveCredential,
  listCredentialsNearingExpiry,
} from "../service/credential-actions";

export interface CredentialActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): CredentialActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): CredentialActionResult<never> {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: first?.message ?? "Invalid input.",
        field: first?.path?.map(String).join("."),
      },
    };
  }
  if (err instanceof CredentialsAppError) {
    const serialized = serializeCredentialsAppError(err);
    return { ok: false, error: serialized.error };
  }
  console.error("[credentials] unexpected failure", err);
  return {
    ok: false,
    error: { code: "UNEXPECTED", message: "The request could not be completed." },
  };
}

async function requestContext(): Promise<RequestAuditContext> {
  const h = await headers();
  return {
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}

async function sessionCaller(): Promise<WorkforceSubject> {
  const user = await getSessionUser();
  if (!user) {
    throw new CredentialsAppError("AUTHORIZATION_DENIED", "You must sign in to perform this action.");
  }
  return callerFromUser(user);
}

async function withCaller<S extends ZodType, T>(
  schema: S,
  input: unknown,
  run: (
    caller: WorkforceSubject,
    parsed: ReturnType<S["parse"]>,
    ctx: RequestAuditContext,
  ) => Promise<T>,
): Promise<CredentialActionResult<T>> {
  try {
    const parsed = schema.parse(input);
    const caller = await sessionCaller();
    const ctx = await requestContext();
    return ok(await run(caller, parsed, ctx));
  } catch (err) {
    return fail(err);
  }
}

export async function submitCredentialForVerificationAction(input: unknown) {
  return withCaller(submitForVerificationSchema, input, (caller, parsed, ctx) =>
    submitCredentialForVerification(caller, ctx, {
      credentialId: parsed.credentialId,
      note: parsed.note ?? null,
    }),
  );
}

export async function recordCredentialVerificationAction(input: unknown) {
  return withCaller(recordVerificationSchema, input, (caller, parsed, ctx) =>
    recordCredentialVerification(caller, ctx, {
      credentialId: parsed.credentialId,
      outcome: parsed.outcome,
      method: parsed.method,
      notes: parsed.notes ?? null,
    }),
  );
}

export async function renewCredentialAction(input: unknown) {
  return withCaller(renewCredentialSchema, input, (caller, parsed, ctx) =>
    renewCredential(caller, ctx, {
      credentialId: parsed.credentialId,
      newExpiresOn: parsed.newExpiresOn,
      notes: parsed.notes ?? null,
    }),
  );
}

export async function suspendCredentialAction(input: unknown) {
  return withCaller(suspendCredentialSchema, input, (caller, parsed, ctx) =>
    suspendCredential(caller, ctx, {
      credentialId: parsed.credentialId,
      expectedVersion: parsed.expectedVersion,
      note: parsed.note ?? null,
    }),
  );
}

export async function reinstateCredentialAction(input: unknown) {
  return withCaller(reinstateCredentialSchema, input, (caller, parsed, ctx) =>
    reinstateCredential(caller, ctx, {
      credentialId: parsed.credentialId,
      expectedVersion: parsed.expectedVersion,
    }),
  );
}

export async function recordCredentialExpirySweepAction(input: unknown) {
  return withCaller(expiryWindowSchema, input, (caller, parsed, ctx) =>
    runCredentialExpirySweep(caller, ctx, parsed?.today),
  );
}

export async function archiveCredentialAction(input: unknown) {
  return withCaller(archiveCredentialSchema, input, (caller, parsed, ctx) =>
    archiveCredential(caller, ctx, {
      credentialId: parsed.credentialId,
      expectedVersion: parsed.expectedVersion,
    }),
  );
}

export async function listExpiringCredentialsAction(input: unknown) {
  return withCaller(expiryWindowSchema, input, (caller, parsed) =>
    listCredentialsNearingExpiry(caller, parsed ? { today: parsed.today } : {}),
  );
}

export async function listVerificationRecordsAction(input: unknown) {
  return withCaller(listVerificationRecordsSchema, input, (caller, parsed) =>
    listVerificationRecords(caller, parsed.credentialId),
  );
}

export async function attachIssuingAuthorityAction(input: unknown) {
  return withCaller(attachIssuingAuthoritySchema, input, (caller, parsed, ctx) =>
    attachIssuingAuthority(caller, ctx, {
      credentialId: parsed.credentialId,
      issuingAuthorityId: parsed.issuingAuthorityId,
      jurisdiction: parsed.jurisdiction ?? null,
      expectedVersion: parsed.expectedVersion,
    }),
  );
}

export async function createIssuingAuthorityAction(input: unknown) {
  return withCaller(createIssuingAuthoritySchema, input, (caller, parsed, ctx) =>
    createIssuingAuthority(caller, ctx, {
      organizationId: parsed.organizationId ?? null,
      code: parsed.code,
      name: parsed.name,
      authorityType: parsed.authorityType,
      jurisdiction: parsed.jurisdiction ?? null,
      website: parsed.website ?? null,
    }),
  );
}

export async function archiveIssuingAuthorityAction(input: unknown) {
  return withCaller(archiveIssuingAuthoritySchema, input, (caller, parsed, ctx) =>
    archiveIssuingAuthority(caller, ctx, {
      authorityId: parsed.authorityId,
      expectedVersion: parsed.expectedVersion,
    }),
  );
}