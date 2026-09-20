"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { AuditHistoryButton } from "@/components/org/status-actions";
import { EmptyState } from "@/components/ui/states";
import { changeEmploymentStatusAction } from "@/modules/workforce/api/actions";

/** Local shape of an employment row (server-projected via the profile read). */
interface EmploymentRow {
  id: string;
  employmentNo: string;
  type: string;
  status: string;
  hireDate: Date | string;
  contractEndDate: Date | string | null;
  probationEndDate: Date | string | null;
  workerClassification: string;
  noticePeriodDays: number | null;
  terminationDate: Date | string | null;
  resignationDate: Date | string | null;
  retirementDate: Date | string | null;
  statusHistory: Array<{ status: string; changedAt: string; changedBy?: string; note?: string }>;
}

type Employment = EmploymentRow;

/**
 * Employment history UI. Status changes are lifecycle TRANSITIONS: the
 * state machine lives server-side; the client only offers transitions
 * meaningful from the current state and collects the per-state metadata
 * the domain requires (termination date+reason, resignation date,
 * retirement date). History is displayed as an append-only timeline —
 * never flattened into one mutable row.
 */

const ALLOWED: Record<
  string,
  Array<{ to: string; label: string; requires?: "termination" | "resignation" | "retirement" }>
> = {
  DRAFT: [{ to: "PENDING_ONBOARDING", label: "Approve to hire" }],
  PENDING_ONBOARDING: [{ to: "ACTIVE", label: "Activate" }],
  ACTIVE: [
    { to: "SUSPENDED", label: "Suspend" },
    { to: "INACTIVE", label: "Set inactive" },
    { to: "TERMINATED", label: "Terminate", requires: "termination" },
    { to: "RESIGNED", label: "Record resignation", requires: "resignation" },
    { to: "RETIRED", label: "Record retirement", requires: "retirement" },
  ],
  SUSPENDED: [
    { to: "ACTIVE", label: "Reinstate" },
    { to: "INACTIVE", label: "Set inactive" },
    { to: "TERMINATED", label: "Terminate", requires: "termination" },
    { to: "RESIGNED", label: "Record resignation", requires: "resignation" },
  ],
  INACTIVE: [
    { to: "ACTIVE", label: "Reactivate" },
    { to: "TERMINATED", label: "Terminate", requires: "termination" },
    { to: "RESIGNED", label: "Record resignation", requires: "resignation" },
    { to: "RETIRED", label: "Record retirement", requires: "retirement" },
  ],
};

const TERMINATION_REASONS = [
  "MISCONDUCT",
  "PERFORMANCE",
  "REDUNDANCY",
  "END_OF_CONTRACT",
  "MUTUAL_AGREEMENT",
  "DEATH",
  "OTHER",
];

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function EmploymentClient({
  organizationId,
  employments,
}: {
  organizationId: string;
  employments: Employment[];
}) {
  const router = useRouter();
  const { toast } = useToast();

  if (employments.length === 0) {
    return (
      <EmptyState
        title="No employment records"
        description="This employee has no employment relationship yet."
      />
    );
  }

  return (
    <div className="space-y-6">
      {employments.map((emp) => (
        <Card key={emp.id}>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <code className="text-sm">{emp.employmentNo}</code>
                <Badge variant={emp.status === "ACTIVE" ? "success" : "neutral"}>
                  {emp.status}
                </Badge>
              </CardTitle>
              <CardDescription>
                {emp.type} · {emp.workerClassification} · hired {fmtDate(emp.hireDate)}
                {emp.probationEndDate ? ` · probation ends ${fmtDate(emp.probationEndDate)}` : ""}
                {emp.contractEndDate ? ` · contract ends ${fmtDate(emp.contractEndDate)}` : ""}
                {emp.noticePeriodDays != null ? ` · notice ${emp.noticePeriodDays}d` : ""}
              </CardDescription>
            </div>
            <AuditHistoryButton
              organizationId={organizationId}
              resourceType="Employment"
              resourceId={emp.id}
            />
          </CardHeader>
          <CardContent className="space-y-6">
            <section aria-label={`Status history for ${emp.employmentNo}`}>
              <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Status timeline
              </h4>
              <ol className="space-y-2">
                {emp.statusHistory.map((h, i) => (
                  <li key={`${h.changedAt}-${i}`} className="flex items-start gap-3 text-sm">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                    />
                    <div>
                      <p className="font-medium">
                        {h.status}{" "}
                        <span className="text-2xs font-normal text-muted-foreground">
                          {new Date(h.changedAt).toLocaleString("en-GB")} ·{" "}
                          {h.changedBy ?? "system"}
                        </span>
                      </p>
                      {h.note ? (
                        <p className="text-2xs text-muted-foreground">Note: {h.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {emp.terminationDate || emp.resignationDate || emp.retirementDate ? (
              <p className="text-2xs text-muted-foreground">
                Separation recorded —{" "}
                {emp.terminationDate ? `terminated ${fmtDate(emp.terminationDate)}` : ""}
                {emp.resignationDate ? `resigned ${fmtDate(emp.resignationDate)}` : ""}
                {emp.retirementDate ? `retired ${fmtDate(emp.retirementDate)}` : ""}
              </p>
            ) : null}

            <LifecycleControls
              organizationId={organizationId}
              employmentId={emp.id}
              status={emp.status}
              onChanged={() => router.refresh()}
              toast={toast}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LifecycleControls({
  organizationId,
  employmentId,
  status,
  onChanged,
  toast,
}: {
  organizationId: string;
  employmentId: string;
  status: string;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const options = ALLOWED[status] ?? [];

  async function runTransition(
    to: string,
    requires: string | undefined,
    metadata: Record<string, unknown>,
  ) {
    const payload: Record<string, unknown> = {
      organizationId,
      employmentId,
      to,
      ...metadata,
    };
    const res = await changeEmploymentStatusAction(payload);
    if (res.ok) {
      toast({ title: "Employment status updated", variant: "success" });
      onChanged();
    } else {
      const err = res.error ?? {
        code: "UNEXPECTED",
        message: "The request could not be completed.",
      };
      toast({
        title: err.code === "EMPLOYMENT_STATE_INVALID" ? "Transition not allowed" : "Action failed",
        description: err.message,
        variant: "error",
      });
      onChanged();
    }
  }

  if (options.length === 0) {
    return (
      <p className="text-2xs text-muted-foreground">
        This employment is in a terminal state — rows are immutable history. Archive the employee
        from the profile when ready.
      </p>
    );
  }

  return (
    <section aria-label="Lifecycle actions">
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        Lifecycle actions
      </h4>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) =>
          opt.requires ? (
            <TransitionDialog
              key={opt.to}
              triggerLabel={opt.label}
              title={opt.label}
              requires={opt.requires}
              onSubmit={(metadata) => runTransition(opt.to, opt.requires, metadata)}
            />
          ) : (
            <Button
              key={opt.to}
              variant="outline"
              size="sm"
              onClick={() => void runTransition(opt.to, undefined, {})}
            >
              {opt.label}
            </Button>
          ),
        )}
      </div>
    </section>
  );
}

function TransitionDialog({
  triggerLabel,
  title,
  requires,
  onSubmit,
}: {
  triggerLabel: string;
  title: string;
  requires: "termination" | "resignation" | "retirement";
  onSubmit: (metadata: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [date, setDate] = React.useState("");
  const [reason, setReason] = React.useState("OTHER");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  async function handle() {
    if (!date) {
      setError("A date is required.");
      return;
    }
    setPending(true);
    setError(null);
    const metadata: Record<string, unknown> = { note: note.trim() || null };
    if (requires === "termination") {
      metadata.terminationDate = date;
      metadata.terminationReason = reason;
    } else if (requires === "resignation") {
      metadata.resignationDate = date;
    } else {
      metadata.retirementDate = date;
    }
    await onSubmit(metadata);
    setPending(false);
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setError(null);
          setDate("");
          setNote("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant={requires === "termination" ? "destructive" : "outline"} size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={title}
        description="This transition is recorded in the status timeline."
      >
        <div className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${requires}-date`}>
              {requires === "termination"
                ? "Termination date"
                : requires === "resignation"
                  ? "Resignation date"
                  : "Retirement date"}
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id={`${requires}-date`}
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          {requires === "termination" ? (
            <div className="space-y-1.5">
              <Label htmlFor="termination-reason">
                Reason
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </Label>
              <select
                id="termination-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {TERMINATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${requires}-note`}>Note (optional)</Label>
            <Input
              id={`${requires}-note`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void handle()}>
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
