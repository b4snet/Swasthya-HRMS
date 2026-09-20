"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { listDependentsAction } from "@/modules/workforce/api/queries";
import {
  createDependentAction,
  updateDependentAction,
  archiveDependentAction,
} from "@/modules/workforce/api/actions";

interface DependentRow {
  id: string;
  name: string;
  relationship: string;
  /** null unless the server's sensitive projection allowed it. */
  dateOfBirth: string | null;
}

const RELATIONSHIPS = ["SPOUSE", "CHILD", "PARENT", "OTHER"];

/**
 * Dependents. DOB is SENSITIVE_PERSONAL: the server strips it without the
 * sensitive grant, so the UI receives null and renders a Restricted badge —
 * masking is server-enforced, never CSS-hidden. DOB *writes* also require
 * the sensitive grant server-side; the form omits the field for callers
 * without it.
 */
export function DependentsClient({
  organizationId,
  employeeId,
  sensitiveViewed,
}: {
  organizationId: string;
  employeeId: string;
  sensitiveViewed: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<DependentRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    listDependentsAction(organizationId, employeeId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows((res.data ?? []) as DependentRow[]);
          setState("ready");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, employeeId, reloadKey]);

  function refresh() {
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Dependents</CardTitle>
          <CardDescription>
            Benefits eligibility arrives with the Payroll phase; records are maintained now.
          </CardDescription>
        </div>
        <DependentDialog
          title="New dependent"
          triggerLabel="New dependent"
          sensitiveViewed={sensitiveViewed}
          onSubmit={async (payload) => {
            const res = await createDependentAction({ organizationId, employeeId, ...payload });
            if (res.ok) {
              toast({ title: "Dependent added", variant: "success" });
              refresh();
              return true;
            }
            toast({ title: "Action failed", description: res.error?.message, variant: "error" });
            return false;
          }}
        />
      </CardHeader>
      <CardContent>
        {state === "loading" ? (
          <LoadingState label="Loading dependents…" />
        ) : state === "error" ? (
          <ErrorState onRetry={refresh} />
        ) : rows.length === 0 ? (
          <p className="text-2xs text-muted-foreground">No dependents recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="text-sm">
                  <p className="font-medium">{d.name}</p>
                  <p className="text-2xs text-muted-foreground">
                    {d.relationship} ·{" "}
                    {d.dateOfBirth ? (
                      new Date(d.dateOfBirth).toLocaleDateString("en-GB")
                    ) : (
                      <Badge variant="warning">Restricted DOB</Badge>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <DependentDialog
                    title="Edit dependent"
                    triggerLabel="Edit"
                    triggerVariant="outline"
                    sensitiveViewed={sensitiveViewed}
                    initial={{
                      name: d.name,
                      relationship: d.relationship,
                      dateOfBirth: d.dateOfBirth
                        ? new Date(d.dateOfBirth).toISOString().slice(0, 10)
                        : "",
                    }}
                    onSubmit={async (payload) => {
                      const res = await updateDependentAction({
                        organizationId,
                        dependentId: d.id,
                        expectedVersion: 1,
                        ...payload,
                      });
                      if (res.ok) {
                        toast({ title: "Dependent updated", variant: "success" });
                        refresh();
                        return true;
                      }
                      toast({
                        title: "Action failed",
                        description: res.error?.message,
                        variant: "error",
                      });
                      return false;
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const res = await archiveDependentAction({
                        organizationId,
                        dependentId: d.id,
                        expectedVersion: 1,
                      });
                      if (res.ok) {
                        toast({ title: "Dependent archived", variant: "success" });
                        refresh();
                      } else {
                        toast({
                          title: "Action failed",
                          description: res.error?.message,
                          variant: "error",
                        });
                      }
                    }}
                  >
                    Archive
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DependentDialog({
  title,
  triggerLabel,
  triggerVariant = "primary",
  sensitiveViewed,
  initial,
  onSubmit,
}: {
  title: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "outline";
  sensitiveViewed: boolean;
  initial?: Record<string, string>;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const uid = React.useId();

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      name: String(fd.get("name") ?? "").trim(),
      relationship: String(fd.get("relationship") ?? "OTHER"),
    };
    const dob = String(fd.get("dateOfBirth") ?? "");
    if (sensitiveViewed) {
      payload.dateOfBirth = dob || null;
    }
    if (!payload.name) {
      setError("Name is required.");
      return;
    }
    setPending(true);
    setError(null);
    const ok = await onSubmit(payload);
    setPending(false);
    if (ok) setOpen(false);
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
        <Button variant={triggerVariant} size="sm">
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent title={title}>
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
            <Label htmlFor={`${uid}-name`}>
              Name
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id={`${uid}-name`}
              name="name"
              defaultValue={initial?.["name"] ?? ""}
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-rel`}>Relationship</Label>
            <select
              id={`${uid}-rel`}
              name="relationship"
              defaultValue={initial?.["relationship"] ?? "OTHER"}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-dob`}>
              Date of birth {sensitiveViewed ? null : <Badge variant="warning">Restricted</Badge>}
            </Label>
            <Input
              id={`${uid}-dob`}
              name="dateOfBirth"
              type="date"
              defaultValue={initial?.["dateOfBirth"] ?? ""}
              disabled={!sensitiveViewed}
            />
            {!sensitiveViewed ? (
              <p className="text-2xs text-muted-foreground">
                DOB reads and writes require the sensitive-data grant (server-enforced).
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
