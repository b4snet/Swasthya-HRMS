"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { uploadDocumentAction, archiveDocumentAction } from "@/modules/documents/api/actions";
import {
  listDocumentsForSubjectViewAction,
  getDocumentDetailViewAction,
  type DocumentDetailView,
} from "@/modules/documents/api/queries";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // mirror of MAX_DOCUMENT_BYTES
const ACCEPTED_TYPES = ".pdf,.png,.jpg,.jpeg";

interface DocumentRow {
  id: string;
  title: string;
  classification: string;
  status: string;
  currentVersionNo: number;
  subjectType: string;
  subjectId: string;
  effectiveTo: string | null;
  createdAt: string;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Phase 3 documents tab: real metadata + controlled upload + authorized
 * download via the session-gated route handler. Classification-gated rows are
 * omitted server-side — the browser never receives hidden documents to
 * "hide with CSS" (ADR-011 §2). Upload success ≠ verification: the banner
 * states this explicitly.
 */
export function Phase3DocumentsClient({
  organizationId,
  employeeId,
}: {
  organizationId: string;
  employeeId: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = React.useState<DocumentRow[]>([]);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    setState("loading");
    listDocumentsForSubjectViewAction("EMPLOYEE", employeeId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setRows((res.data ?? []) as DocumentRow[]);
        else
          toast({
            title: "Could not load documents",
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
  }, [employeeId, reloadKey, toast]);

  function refresh() {
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Documents</CardTitle>
            <CardDescription>
              Secure document metadata with versioned storage. Only rows your scope allows appear
              here; sensitive classifications need their own grant.
            </CardDescription>
          </div>
          <UploadDialog
            organizationId={organizationId}
            employeeId={employeeId}
            onDone={(ok, message) => {
              if (ok) {
                toast({
                  title: "Document uploaded",
                  description: "Upload stored the file — it is not verified content.",
                  variant: "success",
                });
                refresh();
              } else {
                toast({ title: "Upload failed", description: message, variant: "error" });
              }
              return ok;
            }}
          />
        </CardHeader>
        <CardContent>
          {state === "loading" ? (
            <LoadingState label="Loading documents…" />
          ) : state === "error" ? (
            <ErrorState onRetry={refresh} />
          ) : rows.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No documents recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {d.title}{" "}
                      <span className="text-2xs font-normal text-muted-foreground">
                        v{d.currentVersionNo}
                      </span>
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      Uploaded {fmtDate(d.createdAt)}
                      {d.effectiveTo ? ` · expires ${fmtDate(d.effectiveTo)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        d.classification === "SENSITIVE_PERSONAL"
                          ? "destructive"
                          : d.classification === "PERSONAL"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {d.classification}
                    </Badge>
                    <Badge variant={statusVariant(d.status)}>{d.status}</Badge>
                    <DocumentDetailDialog
                      documentId={d.id}
                      onChanged={(m, v) => {
                        toast({ title: m, variant: v });
                        refresh();
                      }}
                    />
                    {d.status !== "ARCHIVED" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          // Browser-native download through the authorized route
                          // handler; a denied session gets a JSON error instead
                          // of bytes.
                          window.location.href = `/api/documents/${d.id}/download`;
                        }}
                      >
                        <Download aria-hidden="true" className="h-3.5 w-3.5" />
                        Download
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="rounded-lg border border-info-border bg-info-surface p-3 text-2xs text-info">
        Upload only stores a document. Verification of what a document attests (credentials,
        qualifications) is a separate, authorized act — an uploaded certificate is never treated as
        verified.
      </p>
    </div>
  );
}

// ── Upload dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  organizationId,
  employeeId,
  onDone,
}: {
  organizationId: string;
  employeeId: string;
  onDone: (ok: boolean, message?: string) => Promise<boolean> | boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string>("");
  const [fileSize, setFileSize] = React.useState<number | null>(null);
  const uid = React.useId();

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    const title = String(fd.get("title") ?? "").trim();
    const typeCode = String(fd.get("typeCode") ?? "")
      .trim()
      .toUpperCase();
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (!title) {
      setError("A display title is required.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File exceeds the 25 MB limit.");
      return;
    }
    setPending(true);
    setError(null);
    const content = new Uint8Array(await file.arrayBuffer());
    const res = await uploadDocumentAction(
      {
        organizationId,
        subjectType: "EMPLOYEE",
        subjectId: employeeId,
        typeCode,
        title,
        description: String(fd.get("description") ?? "").trim() || null,
        fileName: file.name,
        effectiveTo: String(fd.get("effectiveTo") ?? "").trim() || null,
      },
      content,
    );
    setPending(false);
    const done = res.ok ? await onDone(true) : await onDone(false, res.error?.message);
    if (done) {
      setOpen(false);
      setFileName("");
      setFileSize(null);
      form.reset();
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setError(null);
          setFileName("");
          setFileSize(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          Upload document
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Upload document"
        description="Stored privately on the server; downloads are authorized per user. PDF, PNG or JPEG up to 25 MB."
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
            <Label htmlFor={`${uid}-file`}>File (PDF, PNG or JPEG · max 25 MB)</Label>
            <input
              id={`${uid}-file`}
              name="file"
              type="file"
              accept={ACCEPTED_TYPES}
              required
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFileName(f?.name ?? "");
                setFileSize(f ? f.size : null);
              }}
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-2xs"
            />
            {fileName ? (
              <p className="text-2xs text-muted-foreground">
                {fileName}
                {fileSize !== null ? ` · ${(fileSize / 1024).toFixed(1)} KB` : ""}
              </p>
            ) : null}
            <p className="text-2xs text-muted-foreground">
              The real content type is detected from the file itself — a renamed file is rejected.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-type`}>Document type code</Label>
            <Input
              id={`${uid}-type`}
              name="typeCode"
              required
              maxLength={60}
              placeholder="CONTRACT_SIGNED"
            />
            <p className="text-2xs text-muted-foreground">
              Tenant-configured code (e.g. CONTRACT_SIGNED, ID_PROOF). Ask HR if unsure.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-title`}>Title</Label>
            <Input id={`${uid}-title`} name="title" required maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-desc`}>Description (optional)</Label>
            <Input id={`${uid}-desc`} name="description" maxLength={2000} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-exp`}>Expires on (optional)</Label>
            <Input id={`${uid}-exp`} name="effectiveTo" type="date" />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={pending}>
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail dialog: version history + archive ─────────────────────────────────

function DocumentDetailDialog({
  documentId,
  onChanged,
}: {
  documentId: string;
  onChanged: (message: string, variant: "success" | "error") => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<DocumentDetailView | null>(null);
  const [pending, setPending] = React.useState(false);

  async function load() {
    setState("loading");
    const res = await getDocumentDetailViewAction(documentId);
    if (res.ok && res.data) {
      setDetail(res.data);
      setState("ready");
    } else {
      setError(res.error?.message ?? "Could not load document.");
      setState("error");
    }
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
          Details
        </Button>
      </DialogTrigger>
      <DialogContent
        title={detail?.title ?? "Document"}
        description="Version history with checksums. Historical versions are read-only."
      >
        {state === "loading" ? <LoadingState label="Loading…" /> : null}
        {state === "error" ? <ErrorState message={error ?? undefined} onRetry={load} /> : null}
        {state === "ready" && detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge
                variant={
                  detail.classification === "SENSITIVE_PERSONAL"
                    ? "destructive"
                    : detail.classification === "PERSONAL"
                      ? "warning"
                      : "neutral"
                }
              >
                {detail.classification}
              </Badge>
              <Badge variant={statusVariant(detail.status)}>{detail.status}</Badge>
            </div>

            {detail.status !== "ARCHIVED" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  const res = await archiveDocumentAction({
                    documentId: detail.id,
                    expectedVersion: detail.currentVersionNo,
                  });
                  setPending(false);
                  if (res.ok) {
                    onChanged("Document archived", "success");
                    await load();
                  } else {
                    onChanged(res.error?.message ?? "Archive failed.", "error");
                  }
                }}
              >
                {pending ? "Archiving…" : "Archive document"}
              </Button>
            ) : (
              <p className="text-2xs text-muted-foreground">
                Archived — hidden from lists, bytes retained for retention policy.
              </p>
            )}

            <section aria-label="Version history">
              <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Version history
              </h4>
              <ol className="mt-2 space-y-2">
                {detail.versions.map((v) => (
                  <li
                    key={v.versionNo}
                    className={
                      v.versionNo === detail.currentVersionNo
                        ? "rounded-lg border border-info-border bg-info-surface p-3"
                        : "rounded-lg border border-border p-3 opacity-80"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-2xs font-semibold">
                        Version {v.versionNo}
                        {v.versionNo === detail.currentVersionNo ? " · current" : " · superseded"}
                      </p>
                      <span className="text-2xs text-muted-foreground">
                        {v.contentType} · {(v.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      Uploaded {new Date(v.uploadedAt).toLocaleString("en-GB")}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      checksum <code className="break-all">{v.checksumSha256.slice(0, 16)}…</code>
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
