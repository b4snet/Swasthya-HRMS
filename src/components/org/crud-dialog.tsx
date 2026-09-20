"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { OrgActionResult } from "@/modules/organization/api/actions";

export interface FieldDef {
  name: string;
  label: string;
  description?: string;
  required?: boolean;
  type?: "text" | "date" | "number" | "select";
  /** Options for type=select. */
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
}

/** Fields that never render as inputs; they are supplied via `hidden`. */
const CONTEXT_ONLY_FIELDS = new Set(["organizationId"]);

interface CrudDialogProps {
  /** Server-resolved organization context; sent with every submit. */
  organizationId: string;
  /** Dialog title; create vs edit. */
  title: string;
  description?: string;
  fields: FieldDef[];
  /** Initial values keyed by field name (edit mode). */
  initial?: Record<string, string | number | null | undefined>;
  /**
   * Extra hidden values sent with every submit (e.g. parentId context).
   * Note: `organizationId` always comes from the `organizationId` prop —
   * never from client-editable state — and is NOT overridable here.
   */
  hidden?: Record<string, string>;
  /** Server action taking the assembled payload object. */
  action: (input: Record<string, unknown>) => Promise<OrgActionResult<unknown>>;
  /** Called after a successful save. */
  onSuccess?: () => void;
  /** Submit label; defaults to Save. */
  submitLabel?: string;
  triggerLabel: string;
  triggerVariant?: "primary" | "outline" | "ghost";
  triggerIcon?: "plus" | "pencil" | "none";
  /** Hidden id field marks edit mode (adds expectedVersion handling). */
  editId?: string;
  editVersion?: number;
}

function coerceValue(field: FieldDef, raw: FormDataEntryValue | null): unknown {
  const str = typeof raw === "string" ? raw.trim() : "";
  switch (field.type) {
    case "number":
      // Empty string is "no value" → null (server schema allows nullish
      // optional levels). A non-numeric value is passed through and let the
      // server schema produce a field-scoped validation error.
      return str === "" ? null : Number(str);
    case "date":
      // HTML date inputs submit "YYYY-MM-DD"; the server schemas use
      // z.coerce.date(), which parses that directly.
      return str === "" ? undefined : str;
    case "select":
      // "" is the explicit "none" option → null (clears optional FKs).
      return str === "" ? null : str;
    default:
      return str === "" ? null : str;
  }
}

/**
 * Shared create/edit dialog. Keyboard operable, focus trapped (Radix),
 * focus restored on close, Escape closes. Validation errors map field →
 * aria-describedby error text; server errors render in an error region.
 */
export function CrudDialog({
  organizationId,
  title,
  description,
  fields,
  initial,
  hidden,
  action,
  onSuccess,
  submitLabel,
  triggerLabel,
  triggerVariant = "primary",
  triggerIcon = "plus",
  editId,
  editVersion,
}: CrudDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const uid = React.useId();

  React.useEffect(() => {
    if (!open) {
      setFormError(null);
      setFieldErrors({});
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});
    const form = e.currentTarget;
    const fd = new FormData(form);
    // organizationId is server-context, never user-editable.
    const payload: Record<string, unknown> = { ...hidden, organizationId };
    for (const f of fields) {
      if (CONTEXT_ONLY_FIELDS.has(f.name)) continue; // hidden supplies it
      const coerced = coerceValue(f, fd.get(f.name));
      if (coerced !== undefined) payload[f.name] = coerced;
    }
    if (editId) {
      payload.id = editId;
      payload.expectedVersion = editVersion;
    }

    const result = await action(payload);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      onSuccess?.();
      return;
    }
    const err = result.error ?? {
      code: "UNEXPECTED",
      message: "The request could not be completed.",
    };
    if (err.code === "VALIDATION_FAILED" && err.field) {
      setFieldErrors({ [err.field]: err.message });
    } else {
      setFormError(err.message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          {triggerIcon === "plus" ? <Plus aria-hidden="true" className="h-4 w-4" /> : null}
          {triggerIcon === "pencil" ? <Pencil aria-hidden="true" className="h-3.5 w-3.5" /> : null}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
            >
              {formError}
            </p>
          ) : null}
          {fields.map((f) => {
            const error = fieldErrors[f.name];
            const errorId = `${uid}-${f.name}-error`;
            const descId = f.description ? `${uid}-${f.name}-desc` : undefined;
            const describedBy =
              [descId, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
            const initialValue =
              initial?.[f.name] !== undefined && initial?.[f.name] !== null
                ? String(initial[f.name])
                : (f.defaultValue ?? "");
            return (
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
                {f.type === "select" ? (
                  <select
                    id={`${uid}-${f.name}`}
                    name={f.name}
                    defaultValue={initialValue}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    autoComplete="off"
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive"
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`${uid}-${f.name}`}
                    name={f.name}
                    type={f.type ?? "text"}
                    defaultValue={initialValue}
                    placeholder={f.placeholder}
                    maxLength={f.maxLength}
                    invalid={Boolean(error)}
                    aria-describedby={describedBy}
                    required={f.required}
                    autoComplete="off"
                  />
                )}
                {f.description ? (
                  <p id={descId} className="text-2xs text-muted-foreground">
                    {f.description}
                  </p>
                ) : null}
                {error ? (
                  <p id={errorId} className="text-2xs font-medium text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : (submitLabel ?? "Save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
