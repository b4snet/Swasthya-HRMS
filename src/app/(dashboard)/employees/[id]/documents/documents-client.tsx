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
import {
  listDocumentReferencesAction,
  listCredentialsAction,
  listQualificationsAction,
} from "@/modules/workforce/api/queries";
import { createDocumentReferenceAction } from "@/modules/workforce/api/actions";

interface DocumentRefRow {
  id: string;
  docType: string;
  title: string;
  documentRef: string;
  classification: string;
}
interface CredentialRow {
  id: string;
  type: string;
  name: string;
  issuer: string;
  verificationStatus: string;
  expiresOn: string | null;
  credentialNumberMasked: string | null;
}
interface QualificationRow {
  id: string;
  type: string;
  name: string;
  institution: string | null;
  completedOn: string | null;
}

/**
 * Documents & references. The employee table stores METADATA/references
 * only — file payloads belong to the future secure-storage phase, so this
 * surface links out by reference and marks upload/verification as not yet
 * available rather than pretending capability (plan §13).
 */
export function DocumentsClient({
  organizationId,
  employeeId,
}: {
  organizationId: string;
  employeeId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [docs, setDocs] = React.useState<DocumentRefRow[]>([]);
  const [creds, setCreds] = React.useState<CredentialRow[]>([]);
  const [quals, setQuals] = React.useState<QualificationRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    Promise.all([
      listDocumentReferencesAction(organizationId, employeeId),
      listCredentialsAction(organizationId, employeeId),
      listQualificationsAction(organizationId, employeeId),
    ])
      .then(([d, c, q]) => {
        if (cancelled) return;
        if (d.ok) setDocs((d.data ?? []) as DocumentRefRow[]);
        if (c.ok) setCreds((c.data ?? []) as CredentialRow[]);
        if (q.ok) setQuals((q.data ?? []) as QualificationRow[]);
        setState("ready");
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
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Document references</CardTitle>
            <CardDescription>
              Metadata pointing at stored documents; no file content lives in the HRMS.
            </CardDescription>
          </div>
          <DocRefDialog
            onSubmit={async (payload) => {
              const res = await createDocumentReferenceAction({
                organizationId,
                employeeId,
                ...payload,
              });
              if (res.ok) {
                toast({ title: "Document reference added", variant: "success" });
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
            <LoadingState label="Loading documents…" />
          ) : state === "error" ? (
            <ErrorState onRetry={refresh} />
          ) : docs.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No document references recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{d.title}</p>
                    <p className="text-2xs text-muted-foreground">
                      {d.docType} · ref <code>{d.documentRef}</code>
                    </p>
                  </div>
                  <Badge
                    variant={
                      d.classification === "SENSITIVE_PERSONAL" || d.classification === "PERSONAL"
                        ? "warning"
                        : "neutral"
                    }
                  >
                    {d.classification}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 rounded-lg border border-info-border bg-info-surface p-3 text-2xs text-info">
            File upload and secure storage are not yet available — they arrive with the dedicated
            Documents phase. Only reference metadata can be recorded here today.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>
            License / certification references with masked numbers. Verification workflow is a later
            phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {creds.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No credentials recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {creds.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {c.name} <span className="text-2xs text-muted-foreground">({c.type})</span>
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {c.issuer}
                      {c.credentialNumberMasked ? ` · ${c.credentialNumberMasked}` : ""}
                      {c.expiresOn
                        ? ` · expires ${new Date(c.expiresOn).toLocaleDateString("en-GB")}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    variant={
                      c.verificationStatus === "VERIFIED"
                        ? "success"
                        : c.verificationStatus === "PENDING"
                          ? "warning"
                          : "destructive"
                    }
                  >
                    {c.verificationStatus}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 rounded-lg border border-info-border bg-info-surface p-3 text-2xs text-info">
            Full credential management (verification, renewals, expiry alerts) is not yet available
            — it belongs to the dedicated credential phase.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qualifications</CardTitle>
          <CardDescription>Education and training references.</CardDescription>
        </CardHeader>
        <CardContent>
          {quals.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No qualifications recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {quals.map((q) => (
                <li key={q.id} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-medium">
                    {q.name} <span className="text-2xs text-muted-foreground">({q.type})</span>
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    {q.institution ?? "—"}
                    {q.completedOn
                      ? ` · completed ${new Date(q.completedOn).toLocaleDateString("en-GB")}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocRefDialog({
  onSubmit,
}: {
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
      docType: String(fd.get("docType") ?? "").trim(),
      title: String(fd.get("title") ?? "").trim(),
      documentRef: String(fd.get("documentRef") ?? "").trim(),
      classification: String(fd.get("classification") ?? "EMPLOYMENT"),
    };
    if (!payload.docType || !payload.title || payload.documentRef.length < 4) {
      setError("Type, title and a reference (min 4 chars) are required.");
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
        <Button variant="primary" size="sm">
          New reference
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New document reference"
        description="Record where a document lives — never paste document contents here."
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
            <Label htmlFor={`${uid}-docType`}>
              Document type
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id={`${uid}-docType`}
              name="docType"
              placeholder="CONTRACT"
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>
              Title
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input id={`${uid}-title`} name="title" required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-ref`}>
              Storage reference
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id={`${uid}-ref`}
              name="documentRef"
              placeholder="s3://bucket/…"
              required
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-cls`}>Classification</Label>
            <select
              id={`${uid}-cls`}
              name="classification"
              defaultValue="EMPLOYMENT"
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {["PUBLIC", "INTERNAL", "PERSONAL", "SENSITIVE_PERSONAL", "EMPLOYMENT"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
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
