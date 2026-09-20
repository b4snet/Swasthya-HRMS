/**
 * Thin server actions for the Contracts API (Phase 3, prompt 3).
 *
 * Mirrors workforce/api/actions.ts: parse (Zod) → resolve the caller from
 * the SESSION (tenant/org never from input) → call the service → return a
 * typed result. Services own authorization + transactions + audit; actions
 * only translate stable errors into client-safe results (no SQL, no Prisma
 * internals, no stack traces cross this boundary).
 */
"use server";

import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { ContractsAppError, serializeContractsAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "../../workforce/service/types";
import { callerFromUser } from "../../workforce/service/caller";

export interface ContractActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): ContractActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): ContractActionResult<never> {
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
  if (err instanceof ContractsAppError) {
    const serialized = serializeContractsAppError(err);
    return { ok: false, error: serialized.error };
  }
  console.error("[contracts] unexpected failure", err);
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
    throw new ContractsAppError("AUTHORIZATION_DENIED", "You must sign in to perform this action.");
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
): Promise<ContractActionResult<T>> {
  try {
    const parsed = schema.parse(input);
    const caller = await sessionCaller();
    const ctx = await requestContext();
    return ok(await run(caller, parsed, ctx));
  } catch (err) {
    return fail(err);
  }
}

import {
  createContractSchema,
  amendContractSchema,
  renewContractSchema,
  changeContractStatusSchema,
  updateContractMetadataSchema,
  archiveContractSchema,
  contractIdSchema,
} from "./schemas";
import {
  createContract,
  amendContract,
  changeContractStatus,
  archiveContract,
  getContractDetail,
} from "../service/contract-service";
import {
  renewContract,
  updateContractMetadata,
  listContractsNearingExpiry,
} from "../service/contract-renewals";

export async function createContractAction(input: unknown) {
  return withCaller(createContractSchema, input, (caller, parsed, ctx) =>
    createContract(caller, ctx, {
      ...parsed,
      templateId: parsed.templateId ?? null,
      templateVersionNo: parsed.templateVersionNo ?? null,
      documentId: parsed.documentId ?? null,
      notes: parsed.notes ?? null,
      firstVersion: {
        ...parsed.firstVersion,
        effectiveTo: parsed.firstVersion.effectiveTo ?? null,
        note: parsed.firstVersion.note ?? null,
      },
    }),
  );
}

export async function amendContractAction(input: unknown) {
  return withCaller(amendContractSchema, input, (caller, parsed, ctx) =>
    amendContract(caller, ctx, {
      contractId: parsed.contractId,
      expectedVersion: parsed.expectedVersion,
      nextVersion: {
        ...parsed.nextVersion,
        effectiveTo: parsed.nextVersion.effectiveTo ?? null,
        note: parsed.nextVersion.note ?? null,
      },
    }),
  );
}

export async function renewContractAction(input: unknown) {
  return withCaller(renewContractSchema, input, (caller, parsed, ctx) =>
    renewContract(caller, ctx, { ...parsed, note: parsed.note ?? null }),
  );
}

export async function changeContractStatusAction(input: unknown) {
  return withCaller(changeContractStatusSchema, input, (caller, parsed, ctx) =>
    changeContractStatus(caller, ctx, {
      contractId: parsed.contractId,
      to: parsed.to,
      expectedVersion: parsed.expectedVersion,
      approvedBy: parsed.approvedBy ?? undefined,
      approvedAt: parsed.approvedAt ?? undefined,
      signature: parsed.signature,
    }),
  );
}

export async function updateContractMetadataAction(input: unknown) {
  return withCaller(updateContractMetadataSchema, input, (caller, parsed, ctx) =>
    updateContractMetadata(caller, ctx, {
      contractId: parsed.contractId,
      expectedVersion: parsed.expectedVersion,
      title: parsed.title,
      notes: parsed.notes === undefined ? undefined : parsed.notes,
      documentId: parsed.documentId === undefined ? undefined : (parsed.documentId ?? null),
    }),
  );
}

export async function archiveContractAction(input: unknown) {
  return withCaller(archiveContractSchema, input, (caller, parsed, ctx) =>
    archiveContract(caller, ctx, parsed),
  );
}

export async function getContractDetailAction(input: unknown) {
  return withCaller(contractIdSchema, input, (caller, parsed) =>
    getContractDetail(caller, parsed.contractId),
  );
}

export async function listExpiringContractsAction(input: unknown) {
  return withCaller(expiryWindowInput, input, (caller, parsed) =>
    listContractsNearingExpiry(caller, { windowDays: parsed?.windowDays }),
  );
}

// Local alias so the optional-window schema stays colocated with its use.
import { expiryWindowSchema as expiryWindowInput } from "./schemas";
