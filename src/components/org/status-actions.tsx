"use client";

import * as React from "react";
import { Archive, History, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Badge, statusVariant } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { OrgActionResult } from "@/modules/organization/api/actions";
import type { OrgAuditEntry } from "@/modules/organization/api/queries";
import { getOrgAuditHistoryAction } from "@/modules/organization/api/queries";

interface StatusActionsProps {
  organizationId: string;
  id: string;
  status: string;
  /** Optimistic-concurrency hint for update-shaped actions. */
  version?: number;
  /** Terminal status (ARCHIVED/CLOSED) hides all actions. */
  terminal?: boolean;
  onActivate: (input: { organizationId: string; id: string }) => Promise<OrgActionResult<unknown>>;
  onDeactivate: (input: {
    organizationId: string;
    id: string;
  }) => Promise<OrgActionResult<unknown>>;
  onArchive: (input: { organizationId: string; id: string }) => Promise<OrgActionResult<unknown>>;
  resourceType: string;
  onChanged: () => void;
  /** Optional domain-appropriate labels (e.g. positions: Mark filled). */
  activateLabel?: string;
  deactivateLabel?: string;
  archiveLabel?: string;
}

/**
 * Lifecycle controls: activate / deactivate / archive. The server is the
 * authority — these buttons merely surface stable error results; a denied
 * user sees the same buttons but receives AUTHORIZATION_DENIED (rendered as
 * a toast), matching the permission-denied state contract.
 */
export function StatusActions({
  organizationId,
  id,
  status,
  terminal,
  onActivate,
  onDeactivate,
  onArchive,
  onChanged,
  activateLabel = "Activate",
  deactivateLabel = "Deactivate",
  archiveLabel = "Archive",
}: StatusActionsProps) {
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);

  if (terminal || status === "ARCHIVED" || status === "CLOSED") return null;

  async function run(kind: "activate" | "deactivate" | "archive") {
    setPending(kind);
    const fn = kind === "activate" ? onActivate : kind === "deactivate" ? onDeactivate : onArchive;
    const result = await fn({ organizationId, id });
    setPending(null);
    if (result.ok) {
      toast({
        title:
          kind === "archive"
            ? `${archiveLabel} — done`
            : kind === "activate"
              ? `${activateLabel} — done`
              : `${deactivateLabel} — done`,
        variant: "success",
      });
      onChanged();
    } else {
      const err = result.error ?? {
        code: "UNEXPECTED",
        message: "The request could not be completed.",
      };
      toast({
        title: err.code === "AUTHORIZATION_DENIED" ? "Permission denied" : "Action failed",
        description: err.message,
        variant: "error",
      });
      onChanged();
    }
  }

  const s = status.toUpperCase();
  return (
    <div className="flex items-center gap-1">
      {s === "ACTIVE" ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={() => run("deactivate")}
        >
          <Power aria-hidden="true" className="h-3.5 w-3.5" />
          {deactivateLabel}
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending !== null}
          onClick={() => run("activate")}
        >
          <Power aria-hidden="true" className="h-3.5 w-3.5" />
          {activateLabel}
        </Button>
      )}
      <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => run("archive")}>
        <Archive aria-hidden="true" className="h-3.5 w-3.5" />
        {archiveLabel}
      </Button>
    </div>
  );
}

/** Audit history side dialog for one resource (uses the read actions). */
export function AuditHistoryButton({
  organizationId,
  resourceType,
  resourceId,
  label = "History",
}: {
  organizationId: string;
  resourceType: string;
  resourceId: string;
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<OrgAuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function load() {
    setEntries(null);
    setError(null);
    const res = await getOrgAuditHistoryAction(organizationId, resourceType, resourceId);
    if (res.ok) setEntries(res.data ?? []);
    else setError(res.error?.message ?? "Could not load history.");
  }

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
          <History aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title="Audit history" description="Append-only record of material changes.">
        {error ? <ErrorState message={error} /> : null}
        {!error && entries === null ? (
          <p role="status" className="p-4 text-2xs text-muted-foreground">
            Loading…
          </p>
        ) : null}
        {!error && entries !== null && entries.length === 0 ? (
          <EmptyState
            title="No audit events yet"
            description="Changes to this record will appear here."
          />
        ) : null}
        {entries !== null && entries.length > 0 ? (
          <ol className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-2xs font-semibold">{e.action}</code>
                  <span className="text-2xs text-muted-foreground">
                    <time dateTime={e.occurredAt}>{new Date(e.occurredAt).toLocaleString()}</time>
                  </span>
                </div>
                <p className="mt-1 text-2xs text-muted-foreground">by {e.actorEmail ?? "system"}</p>
                {e.after ? (
                  <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted p-2 text-2xs leading-relaxed">
                    {JSON.stringify(e.after, null, 2)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Status cell: color-independent (badge text carries the meaning). */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={statusVariant(status)}>{status}</Badge>;
}
