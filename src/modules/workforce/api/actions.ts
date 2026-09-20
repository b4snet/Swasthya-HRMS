/**
 * Thin server actions for the Workforce API (Phase 2, prompt 3).
 *
 * Every action: parse (Zod) → resolve caller from the SESSION (tenant/org
 * scope never from input) → call the service → return a typed result.
 * Services own authorization + transactions + audit; actions only translate
 * stable errors into client-safe results (no DB internals, no stack traces).
 */
"use server";

import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { WorkforceAppError, serializeWorkforceAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "../service/types";
import { callerFromUser } from "../service/caller";

// ── Result types (stable client surface) ─────────────────────────────────────

export interface WorkforceActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): WorkforceActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): WorkforceActionResult<never> {
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
  if (err instanceof WorkforceAppError) {
    return { ok: false, error: serializeWorkforceAppError(err) };
  }
  // Unexpected: log server-side, return a fixed message (no internals).
  console.error("[workforce] unexpected failure", err);
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
    throw new WorkforceAppError("AUTHORIZATION_DENIED", "You must sign in to perform this action.");
  }
  return callerFromUser(user);
}

/**
 * Run a mutation with a session-resolved caller. AUTHORIZATION_DENIED and
 * NOT_FOUND are returned as results (UI shows the permission-denied state);
 * everything else flows through fail().
 */
async function withCaller<S extends ZodType, T>(
  schema: S,
  input: unknown,
  run: (
    caller: WorkforceSubject,
    parsed: ReturnType<S["parse"]>,
    ctx: RequestAuditContext,
  ) => Promise<T>,
): Promise<WorkforceActionResult<T>> {
  try {
    const parsed = schema.parse(input);
    const caller = await sessionCaller();
    const ctx = await requestContext();
    return ok(await run(caller, parsed, ctx));
  } catch (err) {
    return fail(err);
  }
}

// ── Imports (after helper declarations to keep the pattern visible) ─────────

import {
  createPersonSchema,
  updatePersonSchema,
  personIdSchema,
  createEmployeeSchema,
  changeEmploymentStatusSchema,
  createAssignmentSchema,
  closeAssignmentSchema,
  archiveEmployeeSchema,
  createEmergencyContactSchema,
  updateEmergencyContactSchema,
  createDependentSchema,
  updateDependentSchema,
  archiveDependentSchema,
  createCredentialSchema,
  updateCredentialSchema,
  createQualificationSchema,
  createDocumentReferenceSchema,
} from "./schemas";

import {
  createPerson,
  updatePerson,
  archivePerson,
  createEmployee,
  changeEmploymentStatus,
  createAssignment,
  closeOpenAssignment,
  archiveEmployee,
} from "../service/employee-service";

import {
  createEmergencyContact,
  updateEmergencyContact,
  createDependent,
  updateDependent,
  archiveDependent,
  createCredential,
  updateCredential,
  createQualification,
  createDocumentReference,
} from "../service/child-entity-service";

// ── Person actions ───────────────────────────────────────────────────────────

export async function createPersonAction(input: unknown) {
  return withCaller(createPersonSchema, input, (caller, parsed, ctx) =>
    createPerson(caller, parsed, ctx),
  );
}

export async function updatePersonAction(input: unknown) {
  return withCaller(updatePersonSchema, input, (caller, parsed, ctx) =>
    updatePerson(caller, parsed.personId, parsed, ctx),
  );
}

export async function archivePersonAction(input: unknown) {
  return withCaller(personIdSchema, input, (caller, parsed, ctx) =>
    archivePerson(caller, parsed.personId, parsed.expectedVersion, ctx),
  );
}

// ── Employee + Employment actions ────────────────────────────────────────────

export async function createEmployeeAction(input: unknown) {
  return withCaller(createEmployeeSchema, input, (caller, parsed, ctx) =>
    createEmployee(caller, parsed, ctx),
  );
}

export async function changeEmploymentStatusAction(input: unknown) {
  return withCaller(changeEmploymentStatusSchema, input, (caller, parsed, ctx) =>
    changeEmploymentStatus(caller, parsed.organizationId, parsed.employmentId, parsed, ctx),
  );
}

export async function createAssignmentAction(input: unknown) {
  return withCaller(createAssignmentSchema, input, (caller, parsed, ctx) =>
    createAssignment(caller, { ...parsed, closeCurrentAt: parsed.closeCurrentAt ?? null }, ctx),
  );
}

export async function closeAssignmentAction(input: unknown) {
  return withCaller(closeAssignmentSchema, input, (caller, parsed, ctx) =>
    closeOpenAssignment(
      caller,
      parsed.organizationId,
      parsed.employmentId,
      parsed.effectiveTo,
      ctx,
    ),
  );
}

export async function archiveEmployeeAction(input: unknown) {
  return withCaller(archiveEmployeeSchema, input, (caller, parsed, ctx) =>
    archiveEmployee(caller, parsed.organizationId, parsed.employeeId, parsed.expectedVersion, ctx),
  );
}

// ── Child-entity actions ─────────────────────────────────────────────────────

export async function createEmergencyContactAction(input: unknown) {
  return withCaller(createEmergencyContactSchema, input, (caller, parsed, ctx) =>
    createEmergencyContact(caller, { ...parsed, email: parsed.email ?? null }, ctx),
  );
}

export async function updateEmergencyContactAction(input: unknown) {
  return withCaller(updateEmergencyContactSchema, input, (caller, parsed, ctx) =>
    updateEmergencyContact(caller, parsed.organizationId, parsed.contactId, parsed, ctx),
  );
}

export async function createDependentAction(input: unknown) {
  return withCaller(createDependentSchema, input, (caller, parsed, ctx) =>
    createDependent(caller, { ...parsed, dateOfBirth: parsed.dateOfBirth ?? null }, ctx),
  );
}

export async function updateDependentAction(input: unknown) {
  return withCaller(updateDependentSchema, input, (caller, parsed, ctx) =>
    updateDependent(caller, parsed.organizationId, parsed.dependentId, parsed, ctx),
  );
}

export async function archiveDependentAction(input: unknown) {
  return withCaller(archiveDependentSchema, input, (caller, parsed, ctx) =>
    archiveDependent(
      caller,
      parsed.organizationId,
      parsed.dependentId,
      parsed.expectedVersion,
      ctx,
    ),
  );
}

// ── Credential / qualification / document-ref actions ───────────────────────

export async function createCredentialAction(input: unknown) {
  return withCaller(createCredentialSchema, input, (caller, parsed, ctx) =>
    createCredential(caller, { ...parsed, credentialNumber: parsed.credentialNumber ?? null }, ctx),
  );
}

export async function updateCredentialAction(input: unknown) {
  return withCaller(updateCredentialSchema, input, (caller, parsed, ctx) =>
    updateCredential(caller, parsed.organizationId, parsed.credentialId, parsed, ctx),
  );
}

export async function createQualificationAction(input: unknown) {
  return withCaller(createQualificationSchema, input, (caller, parsed, ctx) =>
    createQualification(caller, parsed, ctx),
  );
}

export async function createDocumentReferenceAction(input: unknown) {
  return withCaller(createDocumentReferenceSchema, input, (caller, parsed, ctx) =>
    createDocumentReference(caller, parsed, ctx),
  );
}
