/**
 * Thin server actions for the Documents API (Phase 3, prompt 3).
 *
 * Mirrors the contracts/workforce action pattern: parse (Zod) → caller from
 * the SESSION → service → typed result with stable error codes.
 *
 * Bytes are NOT part of the JSON schemas: `uploadDocumentAction` and
 * `replaceDocumentAction` take the validated metadata plus a Uint8Array in
 * a dedicated signature (route handlers/multipart forms pass the file
 * through). Every content decision is still made server-side from magic
 * bytes — the client's claimed type is never accepted, never logged.
 */
"use server";

import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { DocumentsAppError, serializeDocumentsAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";
import type { WorkforceSubject } from "../../workforce/service/types";
import { callerFromUser } from "../../workforce/service/caller";
import {
  uploadDocumentSchema,
  replaceDocumentSchema,
  archiveDocumentSchema,
  grantDocumentAccessSchema,
  documentIdSchema,
  listForSubjectSchema,
} from "./schemas";
import {
  uploadDocument,
  replaceDocument,
  archiveDocument,
  grantDocumentAccess,
  listDocumentsForSubject,
} from "../service/document-service";
import { getDocumentDetail } from "../service/document-queries";

export interface DocumentActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; field?: string };
}

function ok<T>(data: T): DocumentActionResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): DocumentActionResult<never> {
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
  if (err instanceof DocumentsAppError) {
    const serialized = serializeDocumentsAppError(err);
    return { ok: false, error: serialized.error };
  }
  console.error("[documents] unexpected failure", err);
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
    throw new DocumentsAppError("AUTHORIZATION_DENIED", "You must sign in to perform this action.");
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
): Promise<DocumentActionResult<T>> {
  try {
    const parsed = schema.parse(input);
    const caller = await sessionCaller();
    const ctx = await requestContext();
    return ok(await run(caller, parsed, ctx));
  } catch (err) {
    return fail(err);
  }
}

export async function uploadDocumentAction(input: unknown, content: Uint8Array) {
  return withCaller(uploadDocumentSchema, input, (caller, parsed, ctx) =>
    uploadDocument(caller, ctx, {
      organizationId: parsed.organizationId ?? null,
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      typeCode: parsed.typeCode,
      title: parsed.title,
      description: parsed.description ?? null,
      fileName: parsed.fileName,
      content,
      // No client content type is accepted — sniffed server-side.
      effectiveTo: parsed.effectiveTo ?? null,
    }),
  );
}

export async function replaceDocumentAction(input: unknown, content: Uint8Array) {
  return withCaller(replaceDocumentSchema, input, (caller, parsed, ctx) =>
    replaceDocument(caller, ctx, {
      documentId: parsed.documentId,
      expectedVersion: parsed.expectedVersion,
      fileName: parsed.fileName,
      content,
      note: parsed.note ?? null,
    }),
  );
}

export async function archiveDocumentAction(input: unknown) {
  return withCaller(archiveDocumentSchema, input, (caller, parsed, ctx) =>
    archiveDocument(caller, ctx, parsed),
  );
}

export async function grantDocumentAccessAction(input: unknown) {
  return withCaller(grantDocumentAccessSchema, input, (caller, parsed, ctx) =>
    grantDocumentAccess(caller, ctx, parsed),
  );
}

export async function getDocumentDetailAction(input: unknown) {
  return withCaller(documentIdSchema, input, (caller, parsed) =>
    getDocumentDetail(caller, parsed.documentId),
  );
}

export async function listDocumentsForSubjectAction(input: unknown) {
  return withCaller(listForSubjectSchema, input, (caller, parsed) =>
    listDocumentsForSubject(caller, parsed.subjectType, parsed.subjectId),
  );
}
