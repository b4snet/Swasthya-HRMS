"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { AuditHistoryButton } from "@/components/org/status-actions";
import { ErrorState, LoadingState } from "@/components/ui/states";
import {
  createContractAction,
  renewContractAction,
  changeContractStatusAction,
  archiveContractAction,
} from "@/modules/contracts/api/actions";
import {
  listContractsForEmploymentAction,
  getContractDetailViewAction,
  type ContractListItemView,
  type ContractDetailView,
} from "@/modules/contracts/api/queries";

const CONTRACT_NO_HELP =
  "Format CONTRACT-<ORG CODE>-YY-NNNNN, e.g. CONTRACT-HQ-26-00001. Number is org-scoped and format-checked.";

const COMMON_CLAUSES = [
  "PROBATION_90_DAYS",
  "NOTICE_30",
  "NOTICE_60",
  "CONFIDENTIALITY",
  "NON_SOLICITATION",
  "RENEWAL",
] as const;

function fmtDate(d: string | null): string {
  if (!d) return "open-ended";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Contracts tab. List + create + detail (version history) + lifecycle
 * (activate/terminate/archive) + renewal. The server owns every decision:
 * this UI only surfaces stable error results. Historical versions render
 * read-only — editing history is impossible by design (append-only chain).
 */
export function ContractsClient({
  organizationId,
  employmentId,
}: {
  organizationId: string;
  employeeId: string;
  employmentId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<ContractListItemView[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    listContractsForEmploymentAction(employmentId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setRows(res.data ?? []);
        else
          toast({
            title: "Could not load contracts",
            description: res.error?.message,
            variant: "error",
          });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [employmentId, reloadKey, toast]);

  function refresh() {
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Contracts</CardTitle>
            <CardDescription>
              Versioned agreements tied to this employment. Amendments and renewals append new
              versions; prior versions are preserved read-only.
            </CardDescription>
          </div>
          <NewContractDialog
            organizationId={organizationId}
            employmentId={employmentId}
            onDone={(ok, message) => {
              if (ok) {
                toast({ title: "Contract created as DRAFT", variant: "success" });
                refresh();
              } else {
                toast({ title: "Create failed", description: message, variant: "error" });
              }
              return ok;
            }}
          />
        </CardHeader>
        <CardContent>
          {state === "loading" ? (
            <LoadingState label="Loading contracts…" />
          ) : state === "error" ? (
            <ErrorState onRetry={refresh} />
          ) : rows.length === 0 ? (
            <p className="text-2xs text-muted-foreground">
              No contracts recorded for this employment yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.title}{" "}
                      <span className="text-2xs font-normal text-muted-foreground">
                        <code>{c.contractNo}</code> · v{c.currentVersionNo}
                      </span>
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {c.type} · {fmtDate(c.effectiveFrom)} → {fmtDate(c.effectiveTo)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    <ContractDetailDialog
                      contractId={c.id}
                      onChanged={(message, variant) => {
                        toast({ title: message, variant });
                        refresh();
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Create dialog ────────────────────────────────────────────────────────────

function NewContractDialog({
  organizationId,
  employmentId,
  onDone,
}: {
  organizationId: string;
  employmentId: string;
  onDone: (ok: boolean, message?: string) => Promise<boolean> | boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const uid = React.useId();

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const contractNo = String(fd.get("contractNo") ?? "")
      .trim()
      .toUpperCase();
    const title = String(fd.get("title") ?? "").trim();
    const effectiveFrom = String(fd.get("effectiveFrom") ?? "");
    const effectiveToRaw = String(fd.get("effectiveTo") ?? "").trim();
    const clauses = fd.getAll("clauses").map(String);
    if (!title || title.length < 3) {
      setError("A title of at least 3 characters is required.");
      return;
    }
    if (!effectiveFrom) {
      setError("Effective from date is required.");
      return;
    }
    if (effectiveToRaw && effectiveToRaw <= effectiveFrom) {
      setError("End date must be after the start date.");
      return;
    }
    if (clauses.length === 0) {
      setError("Select at least one clause for the first version.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await createContractAction({
      organizationId,
      employmentId,
      contractNo,
      title,
      type: String(fd.get("type") ?? "EMPLOYMENT"),
      effectiveFrom,
      effectiveTo: effectiveToRaw || null,
      jurisdiction: String(fd.get("jurisdiction") ?? "").trim() || null,
      firstVersion: {
        effectiveFrom,
        effectiveTo: effectiveToRaw || null,
        clauseNames: clauses,
        note: String(fd.get("note") ?? "").trim() || null,
      },
    });
    setPending(false);
    const okDone = res.ok ? await onDone(true) : await onDone(false, res.error?.message);
    if (okDone) setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          New contract
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New contract"
        description="Creates a DRAFT contract with its first version. Activate it after approval."
      >
        <form onSubmit={handle} noValidate className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-no`}>Contract number</Label>
            <Input id={`${uid}-no`} name="contractNo" placeholder="CONTRACT-HQ-26-00001" required />
            <p className="text-2xs text-muted-foreground">{CONTRACT_NO_HELP}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            <Input id={`${uid}-title`} name="title" required minLength={3} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-type`}>Type</Label>
              <select
                id={`${uid}-type`}
                name="type"
                className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {[
                  "EMPLOYMENT",
                  "SECONDMENT",
                  "NDA",
                  "CONFIDENTIALITY",
                  "LOCUM",
                  "CONSULTANCY",
                  "INTERNSHIP",
                  "OTHER",
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-jur`}>Jurisdiction (optional)</Label>
              <Input id={`${uid}-jur`} name="jurisdiction" maxLength={80} placeholder="NP" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-from`}>Effective from</Label>
              <Input id={`${uid}-from`} name="effectiveFrom" type="date" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-to`}>Effective to (optional)</Label>
              <Input id={`${uid}-to`} name="effectiveTo" type="date" />
            </div>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-2xs font-medium">First-version clauses</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {COMMON_CLAUSES.map((c) => (
                <label key={c} className="flex items-center gap-1.5 text-2xs">
                  <input type="checkbox" name="clauses" value={c} className="accent-current" />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-note`}>Version note (optional)</Label>
            <Input id={`${uid}-note`} name="note" maxLength={2000} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail dialog: version history + lifecycle + renewal ─────────────────────

function ContractDetailDialog({
  contractId,
  onChanged,
}: {
  contractId: string;
  onChanged: (message: string, variant: "success" | "error") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = React.useState<ContractDetailView | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  async function load() {
    setState("loading");
    const res = await getContractDetailViewAction(contractId);
    if (res.ok && res.data) {
      setDetail(res.data);
      setState("ready");
    } else {
      setActionError(res.error?.message ?? "Could not load contract.");
      setState("error");
    }
  }

  async function run(
    kind: string,
    fn: () => Promise<{ ok: boolean; error?: { message: string } }>,
    successMsg: string,
  ) {
    setPending(kind);
    setActionError(null);
    const res = await fn();
    setPending(null);
    if (res.ok) {
      onChanged(successMsg, "success");
      await load();
    } else {
      setActionError(res.error?.message ?? "Action failed.");
      onChanged(res.error?.message ?? "Action failed.", "error");
    }
  }

  const c = detail?.contract;
  const frozen = c ? ["EXPIRED", "TERMINATED", "ARCHIVED"].includes(c.status) : false;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) void load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Details
        </Button>
      </DialogTrigger>
      <DialogContent
        title={c ? `Contract ${c.contractNo}` : "Contract"}
        description="Version history is append-only. Historical versions are read-only."
      >
        {state === "loading" ? <LoadingState label="Loading contract…" /> : null}
        {state === "error" ? (
          <ErrorState message={actionError ?? undefined} onRetry={load} />
        ) : null}
        {state === "ready" && c && detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <p className="font-semibold">{c.title}</p>
                <p className="text-2xs text-muted-foreground">
                  {c.type} · {fmtDate(c.effectiveFrom)} → {fmtDate(c.effectiveTo)}
                  {c.jurisdiction ? ` · ${c.jurisdiction}` : ""}
                </p>
                {c.approvedAt ? (
                  <p className="text-2xs text-muted-foreground">
                    Approved {new Date(c.approvedAt).toLocaleDateString("en-GB")}
                    {c.signedOn
                      ? ` · signed ${new Date(c.signedOn).toLocaleDateString("en-GB")}`
                      : ""}
                  </p>
                ) : null}
              </div>
              <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
            </div>

            {actionError ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
              >
                {actionError}
              </p>
            ) : null}

            {/* Lifecycle actions — server re-validates every transition. */}
            <div className="flex flex-wrap items-center gap-2">
              {c.status === "DRAFT" || c.status === "PENDING_APPROVAL" ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() =>
                    run(
                      "activate",
                      () =>
                        changeContractStatusAction({
                          contractId: c.id,
                          to: "ACTIVE",
                          expectedVersion: c.version,
                          approvedBy: "ui:activator",
                          approvedAt: new Date().toISOString(),
                        }),
                      "Contract activated",
                    )
                  }
                >
                  {pending === "activate" ? "Activating…" : "Activate"}
                </Button>
              ) : null}
              {c.status === "ACTIVE" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() =>
                    run(
                      "terminate",
                      () =>
                        changeContractStatusAction({
                          contractId: c.id,
                          to: "TERMINATED",
                          expectedVersion: c.version,
                        }),
                      "Contract terminated",
                    )
                  }
                >
                  {pending === "terminate" ? "Terminating…" : "Terminate"}
                </Button>
              ) : null}
              {c.status !== "ARCHIVED" && c.status !== "DRAFT" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending !== null}
                  onClick={() =>
                    run(
                      "archive",
                      () => archiveContractAction({ contractId: c.id, expectedVersion: c.version }),
                      "Contract archived",
                    )
                  }
                >
                  {pending === "archive" ? "Archiving…" : "Archive"}
                </Button>
              ) : null}
              {frozen ? (
                <span className="text-2xs text-muted-foreground">
                  This contract is {c.status.toLowerCase()} — term changes are locked.
                </span>
              ) : (
                <RenewInline
                  disabled={pending !== null}
                  currentEffectiveTo={c.effectiveTo}
                  onRenew={(newEffectiveTo) =>
                    run(
                      "renew",
                      () =>
                        renewContractAction({
                          contractId: c.id,
                          expectedVersion: c.version,
                          newEffectiveTo,
                        }),
                      "Contract renewed (new version appended)",
                    )
                  }
                />
              )}
            </div>

            {/* Version history — append-only, superseded rows render read-only. */}
            <section aria-label="Version history">
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Version history
              </h4>
              <ol className="mt-2 space-y-2">
                {detail.versions.map((v) => (
                  <li
                    key={v.id}
                    className={
                      v.isCurrent
                        ? "rounded-lg border border-info-border bg-info-surface p-3"
                        : "rounded-lg border border-border p-3 opacity-80"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-2xs font-semibold">
                        Version {v.versionNo}
                        {v.isCurrent ? " · current" : " · superseded"}
                      </p>
                      <span className="text-2xs text-muted-foreground">
                        {fmtDate(v.effectiveFrom)} → {fmtDate(v.effectiveTo)}
                      </span>
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      {v.clauseNames.length > 0 ? v.clauseNames.join(", ") : "no clauses"}
                    </p>
                    {v.note ? <p className="text-2xs text-muted-foreground">{v.note}</p> : null}
                    {v.supersededAt ? (
                      <p className="text-2xs text-muted-foreground">
                        Superseded {new Date(v.supersededAt).toLocaleString("en-GB")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>

            <AuditHistoryButton
              organizationId={c.organizationId}
              resourceType="Contract"
              resourceId={c.id}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RenewInline({
  disabled,
  currentEffectiveTo,
  onRenew,
}: {
  disabled: boolean;
  currentEffectiveTo: string | null;
  onRenew: (newEffectiveTo: string) => Promise<void>;
}) {
  const [value, setValue] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const uid = React.useId();

  if (!currentEffectiveTo) {
    return (
      <span className="text-2xs text-muted-foreground">
        Open-ended contracts are not renewable; amend instead.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label htmlFor={`${uid}-renew`}>Renew until</Label>
        <Input
          id={`${uid}-renew`}
          type="date"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setLocalError(null);
          }}
          className="text-2xs"
        />
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled || !value}
        onClick={async () => {
          if (new Date(value).getTime() <= new Date(currentEffectiveTo).getTime()) {
            setLocalError("Renewal must extend beyond the current end date.");
            return;
          }
          setLocalError(null);
          await onRenew(value);
        }}
      >
        Renew
      </Button>
      {localError ? (
        <p role="alert" className="text-2xs text-destructive">
          {localError}
        </p>
      ) : null}
    </div>
  );
}
