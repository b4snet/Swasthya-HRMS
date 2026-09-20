/**
 * Read-side server actions for the Contracts UI (Phase 3, prompt 4).
 *
 * Mirrors contracts/api/actions.ts: session-resolved caller, stable
 * client-safe results (dates serialized to ISO strings), no DB internals
 * across the boundary.
 */
"use server";

import { headers } from "next/headers";
import { ZodError } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { ContractsAppError, serializeContractsAppError } from "../service/app-errors";
import type { RequestAuditContext } from "@/lib/audit";
import { callerFromUser } from "../../workforce/service/caller";
import { contractIdSchema } from "./schemas";
import { getContractDetail } from "../service/contract-service";
import { listContractsForEmployment } from "../service/contract-queries";

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
    return { ok: false, error: serializeContractsAppError(err).error };
  }
  console.error("[contracts-queries] unexpected failure", err);
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

/** Serialized contract row (dates → ISO) safe to cross the RSC boundary. */
export interface ContractListItemView {
  id: string;
  contractNo: string;
  title: string;
  type: string;
  status: string;
  currentVersionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export async function listContractsForEmploymentAction(employmentId: string) {
  try {
    const user = await getSessionUser();
    if (!user) {
      throw new ContractsAppError("AUTHORIZATION_DENIED", "Sign in to view contracts.");
    }
    const caller = callerFromUser(user);
    await requestContext();
    const rows = await listContractsForEmployment(caller, employmentId);
    return ok(
      rows.map((r) => ({
        ...r,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })) satisfies ContractListItemView[],
    );
  } catch (err) {
    return fail(err);
  }
}

export interface ContractVersionView {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  clauseNames: string[];
  note: string | null;
  isCurrent: boolean;
  supersededAt: string | null;
  createdAt: string;
}

export interface ContractPartyView {
  id: string;
  role: string;
  displayName: string;
}

export interface ContractDetailView {
  contract: {
    id: string;
    contractNo: string;
    title: string;
    type: string;
    status: string;
    jurisdiction: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    currentVersionNo: number;
    approvedBy: string | null;
    approvedAt: string | null;
    signedOn: string | null;
    notes: string | null;
    version: number;
    employmentId: string;
    organizationId: string;
  };
  versions: ContractVersionView[];
  parties: ContractPartyView[];
}

export async function getContractDetailViewAction(contractId: string) {
  try {
    const user = await getSessionUser();
    if (!user) {
      throw new ContractsAppError("AUTHORIZATION_DENIED", "Sign in to view contracts.");
    }
    const caller = callerFromUser(user);
    const parsed = contractIdSchema.parse({ contractId });
    const raw = (await getContractDetail(caller, parsed.contractId)) as {
      contract: Record<string, unknown>;
      versions: Array<Record<string, unknown>>;
      parties: Array<Record<string, unknown>>;
    };
    const c = raw.contract as {
      id: string;
      contractNo: string;
      title: string;
      type: string;
      status: string;
      jurisdiction: string | null;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      currentVersionNo: number;
      approvedBy: string | null;
      approvedAt: Date | null;
      signedOn: Date | null;
      notes: string | null;
      version: number;
      employmentId: string;
      organizationId: string;
    };
    const iso = (d: unknown) =>
      d instanceof Date ? d.toISOString() : ((d as string | null) ?? null);
    return ok({
      contract: {
        id: c.id,
        contractNo: c.contractNo,
        title: c.title,
        type: c.type,
        status: c.status,
        jurisdiction: c.jurisdiction,
        effectiveFrom: iso(c.effectiveFrom)!,
        effectiveTo: iso(c.effectiveTo),
        currentVersionNo: c.currentVersionNo,
        approvedBy: c.approvedBy,
        approvedAt: iso(c.approvedAt),
        signedOn: iso(c.signedOn),
        notes: c.notes,
        version: c.version,
        employmentId: c.employmentId,
        organizationId: c.organizationId,
      },
      versions: raw.versions.map((v) => {
        const ver = v as {
          id: string;
          versionNo: number;
          effectiveFrom: Date;
          effectiveTo: Date | null;
          clauseNames: string[];
          note: string | null;
          supersededAt: Date | null;
          createdAt: Date;
        };
        return {
          id: ver.id,
          versionNo: ver.versionNo,
          effectiveFrom: ver.effectiveFrom.toISOString(),
          effectiveTo: ver.effectiveTo ? ver.effectiveTo.toISOString() : null,
          clauseNames: ver.clauseNames,
          note: ver.note,
          isCurrent: ver.versionNo === c.currentVersionNo,
          supersededAt: ver.supersededAt ? ver.supersededAt.toISOString() : null,
          createdAt: ver.createdAt.toISOString(),
        } satisfies ContractVersionView;
      }),
      parties: raw.parties.map((p) => {
        const party = p as { id: string; role: string; displayName: string };
        return { id: party.id, role: party.role, displayName: party.displayName };
      }),
    } satisfies ContractDetailView);
  } catch (err) {
    return fail(err);
  }
}
