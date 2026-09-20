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
import { listEmergencyContactsAction } from "@/modules/workforce/api/queries";
import {
  createEmergencyContactAction,
  updateEmergencyContactAction,
} from "@/modules/workforce/api/actions";

interface ContactRow {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email: string | null;
  isPrimary: boolean;
  version: number;
}

/**
 * Emergency contacts. Minimal PII per plan §7: name / relationship / phone
 * / optional email — no addresses, no ID numbers. Primary management is
 * server-side (setting one clears the others in the same transaction).
 */
export function ContactsClient({
  organizationId,
  employeeId,
}: {
  organizationId: string;
  employeeId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<ContactRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    listEmergencyContactsAction(organizationId, employeeId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setRows((res.data ?? []) as ContactRow[]);
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
          <CardTitle>Emergency contacts</CardTitle>
          <CardDescription>
            Minimal contact data only — purpose-limited (privacy plan §7).
          </CardDescription>
        </div>
        <ContactDialog
          title="New emergency contact"
          triggerLabel="New contact"
          onSubmit={async (payload) => {
            const res = await createEmergencyContactAction({
              organizationId,
              employeeId,
              ...payload,
            });
            if (res.ok) {
              toast({ title: "Contact added", variant: "success" });
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
          <LoadingState label="Loading contacts…" />
        ) : state === "error" ? (
          <ErrorState onRetry={refresh} />
        ) : rows.length === 0 ? (
          <p className="text-2xs text-muted-foreground">No emergency contacts recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="text-sm">
                  <p className="font-medium">
                    {c.name} {c.isPrimary ? <Badge variant="success">Primary</Badge> : null}
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {c.relationship} · {c.phone}
                    {c.email ? ` · ${c.email}` : ""}
                  </p>
                </div>
                <ContactDialog
                  title="Edit emergency contact"
                  triggerLabel="Edit"
                  triggerVariant="outline"
                  initial={{
                    name: c.name,
                    relationship: c.relationship,
                    phone: c.phone,
                    email: c.email ?? "",
                    isPrimary: c.isPrimary ? "true" : "false",
                  }}
                  onSubmit={async (payload) => {
                    const res = await updateEmergencyContactAction({
                      organizationId,
                      contactId: c.id,
                      expectedVersion: c.version,
                      ...payload,
                    });
                    if (res.ok) {
                      toast({ title: "Contact updated", variant: "success" });
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
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ContactDialog({
  title,
  triggerLabel,
  triggerVariant = "primary",
  initial,
  onSubmit,
}: {
  title: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "outline";
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
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      relationship: String(fd.get("relationship") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim() || null,
      isPrimary: fd.get("isPrimary") === "true",
    };
    if (!payload.name || !payload.relationship || !payload.phone) {
      setError("Name, relationship and phone are required.");
      return;
    }
    setPending(true);
    setError(null);
    const ok = await onSubmit(payload);
    setPending(false);
    if (ok) setOpen(false);
  }

  const fields: Array<{ name: string; label: string; type?: string; required?: boolean }> = [
    { name: "name", label: "Name", required: true },
    { name: "relationship", label: "Relationship", required: true },
    { name: "phone", label: "Phone", required: true },
    { name: "email", label: "Email", type: "email" },
  ];

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
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <Label htmlFor={`${uid}-${f.name}`}>
                {f.label}
                {f.required ? (
                  <span aria-hidden="true" className="ml-0.5 text-destructive">
                    *
                  </span>
                ) : (
                  <span className="ml-1 text-2xs font-normal text-muted-foreground">
                    (optional)
                  </span>
                )}
              </Label>
              <Input
                id={`${uid}-${f.name}`}
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={initial?.[f.name] ?? ""}
                required={f.required}
                autoComplete="off"
              />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-isPrimary`}>Primary contact</Label>
            <select
              id={`${uid}-isPrimary`}
              name="isPrimary"
              defaultValue={initial?.["isPrimary"] ?? "false"}
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <option value="false">No</option>
              <option value="true">Yes (clears the previous primary)</option>
            </select>
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
