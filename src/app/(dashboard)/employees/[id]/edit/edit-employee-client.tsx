"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { updatePersonAction } from "@/modules/workforce/api/actions";

/** Local shape of the person fields this form edits (server-projected). */
interface PersonForm {
  id: string;
  version: number;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  country: string | null;
  postalCode: string | null;
}

type Person = PersonForm;

/**
 * Identity/contact edit form. Sensitive fields are rendered ONLY when the
 * server already projected them (sensitiveViewed) — values are never
 * fetched-and-hidden client-side. When not viewed, the fields render a
 * Restricted marker and submit as undefined (untouched), so a user without
 * the sensitive grant can still edit names/contacts without touching DOB/
 * address. Update is optimistic (expectedVersion) and audited.
 */
export function EditEmployeeClient({
  employeeId,
  person,
  sensitiveViewed,
}: {
  employeeId: string;
  person: Person;
  sensitiveViewed: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [firstName, setFirstName] = React.useState(person.firstName);
  const [lastName, setLastName] = React.useState(person.lastName);
  const [preferredName, setPreferredName] = React.useState(person.preferredName ?? "");
  const [email, setEmail] = React.useState(person.email ?? "");
  const [phone, setPhone] = React.useState(person.phone ?? "");
  // Sensitive: only initialized when the server actually delivered values.
  const [dateOfBirth, setDateOfBirth] = React.useState(
    person.dateOfBirth ? new Date(person.dateOfBirth).toISOString().slice(0, 10) : "",
  );
  const [addressLine1, setAddressLine1] = React.useState(person.addressLine1 ?? "");
  const [addressLine2, setAddressLine2] = React.useState(person.addressLine2 ?? "");
  const [city, setCity] = React.useState(person.city ?? "");
  const [country, setCountry] = React.useState(person.country ?? "");
  const [postalCode, setPostalCode] = React.useState(person.postalCode ?? "");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    // Presence-preserving payload: sensitive fields are included only when
    // viewed (or explicitly cleared by a viewer); otherwise omitted so the
    // server leaves them untouched.
    const payload: Record<string, unknown> = {
      personId: person.id,
      expectedVersion: person.version,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      preferredName: preferredName.trim() === "" ? null : preferredName.trim(),
      email: email.trim() === "" ? null : email.trim(),
      phone: phone.trim() === "" ? null : phone.trim(),
      city: city.trim() === "" ? null : city.trim(),
      country: country.trim() === "" ? null : country.trim(),
      postalCode: postalCode.trim() === "" ? null : postalCode.trim(),
    };
    if (sensitiveViewed) {
      payload.dateOfBirth = dateOfBirth || null;
      payload.addressLine1 = addressLine1.trim() === "" ? null : addressLine1.trim();
      payload.addressLine2 = addressLine2.trim() === "" ? null : addressLine2.trim();
    }

    const res = await updatePersonAction(payload);
    setPending(false);
    if (res.ok) {
      toast({ title: "Employee updated", variant: "success" });
      router.push(`/employees/${employeeId}`);
      router.refresh();
      return;
    }
    const err = res.error ?? { code: "UNEXPECTED", message: "The request could not be completed." };
    if (err.code === "VALIDATION_FAILED" && "field" in err && err.field) {
      setFieldErrors({ [err.field]: err.message });
    } else {
      setFormError(err.message);
    }
  }

  return (
    <Card className="mx-auto max-w-3xl">
      <CardHeader>
        <CardTitle>Edit identity &amp; contact</CardTitle>
        <CardDescription>
          Updates are audited and protected by optimistic concurrency. Employment history lives on
          the Employment tab — editing here never rewrites it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="firstName"
              label="First name"
              required
              value={firstName}
              onChange={setFirstName}
              error={fieldErrors["firstName"]}
            />
            <Field
              id="lastName"
              label="Last name"
              required
              value={lastName}
              onChange={setLastName}
              error={fieldErrors["lastName"]}
            />
            <Field
              id="preferredName"
              label="Preferred name"
              value={preferredName}
              onChange={setPreferredName}
              error={fieldErrors["preferredName"]}
            />
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              error={fieldErrors["email"]}
            />
            <Field
              id="phone"
              label="Phone"
              value={phone}
              onChange={setPhone}
              error={fieldErrors["phone"]}
            />
          </div>

          <fieldset className="rounded-lg border border-border p-4">
            <legend className="px-1 text-2xs font-semibold text-muted-foreground">
              Sensitive personal data{" "}
              {sensitiveViewed ? (
                <Badge variant="success">viewing granted</Badge>
              ) : (
                <Badge variant="warning">Restricted</Badge>
              )}
            </legend>
            {!sensitiveViewed ? (
              <p className="mb-3 text-2xs text-muted-foreground">
                You do not hold the sensitive-data grant: these fields stay untouched by this form.
                Every granted view is audited.
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="dateOfBirth"
                label="Date of birth"
                type="date"
                value={dateOfBirth}
                onChange={setDateOfBirth}
                disabled={!sensitiveViewed}
                error={fieldErrors["dateOfBirth"]}
              />
              <Field
                id="addressLine1"
                label="Address line 1"
                value={addressLine1}
                onChange={setAddressLine1}
                disabled={!sensitiveViewed}
                error={fieldErrors["addressLine1"]}
              />
              <Field
                id="addressLine2"
                label="Address line 2"
                value={addressLine2}
                onChange={setAddressLine2}
                disabled={!sensitiveViewed}
                error={fieldErrors["addressLine2"]}
              />
              <Field
                id="city"
                label="City"
                value={city}
                onChange={setCity}
                error={fieldErrors["city"]}
              />
              <Field
                id="country"
                label="Country code"
                value={country}
                onChange={setCountry}
                maxLength={2}
                error={fieldErrors["country"]}
              />
              <Field
                id="postalCode"
                label="Postal code"
                value={postalCode}
                onChange={setPostalCode}
                error={fieldErrors["postalCode"]}
              />
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  disabled,
  maxLength,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  maxLength?: number;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        ) : (
          <span className="ml-1 text-2xs font-normal text-muted-foreground">(optional)</span>
        )}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        required={required}
        autoComplete="off"
      />
      {error ? (
        <p id={errorId} className="text-2xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
