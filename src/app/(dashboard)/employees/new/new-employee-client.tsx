"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import {
  getDepartmentsAction,
  getTeamsAction,
  getDesignationsAction,
  getLocationsAction,
  getFacilitiesAction,
  getPositionsAction,
} from "@/modules/organization/api/queries";
import {
  listManagerCandidatesAction,
  getWorkforceOrganizationsAction,
} from "@/modules/workforce/api/queries";
import { createEmployeeAction, createAssignmentAction } from "@/modules/workforce/api/actions";
import { useQueryData } from "@/components/org/use-query-data";

/**
 * Guided create-employee workflow (plan §9): collect only what Phase 2
 * needs, in three steps — identity, employment, initial assignment (the
 * assignment step is optional; an employee can start without a seat).
 * One server call per step's data; the employee+employment pair is created
 * atomically by createEmployeeAction, then the assignment (if any) via the
 * audited handover-aware createAssignmentAction.
 */

const EMPLOYEE_TYPES = [
  "REGULAR",
  "CONTRACT",
  "PROBATION",
  "LOCUM",
  "INTERN",
  "VOLUNTEER",
  "OTHER",
];
const EMPLOYMENT_TYPES = ["PERMANENT", "PROBATION", "CONTRACT", "LOCUM", "INTERN", "VOLUNTEER"];
const CLASSIFICATIONS = ["EMPLOYEE", "CONTRACTOR", "TRAINEE", "VOLUNTEER"];

interface Option {
  value: string;
  label: string;
}

const NONE: Option = { value: "", label: "— none —" };

function SelectField({
  id,
  label,
  options,
  value,
  onChange,
  required,
  description,
}: {
  id: string;
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  description?: string;
}) {
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
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {[NONE, ...options].map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description ? <p className="text-2xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
}) {
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
        placeholder={placeholder}
        required={required}
        autoComplete="off"
      />
      {description ? <p className="text-2xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function NewEmployeeClient({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [pending, setPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [createdEmployeeId, setCreatedEmployeeId] = React.useState<string | null>(null);
  const [createdEmploymentId, setCreatedEmploymentId] = React.useState<string | null>(null);

  // Step 1 — identity (only what the current phase requires; DOB/address
  // are sensitive and collected but never rendered back unmasked).
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [preferredName, setPreferredName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

  // Step 2 — employment.
  const [employeeNo, setEmployeeNo] = React.useState("");
  const [employmentNo, setEmploymentNo] = React.useState("");
  const [employeeType, setEmployeeType] = React.useState("REGULAR");
  const [employmentType, setEmploymentType] = React.useState("PERMANENT");
  const [classification, setClassification] = React.useState("EMPLOYEE");
  const [hireDate, setHireDate] = React.useState("");
  const [probationEnd, setProbationEnd] = React.useState("");
  const [contractEnd, setContractEnd] = React.useState("");
  const [noticeDays, setNoticeDays] = React.useState("");
  const [workLocationId, setWorkLocationId] = React.useState("");
  const [facilityId, setFacilityId] = React.useState("");

  // Step 3 — initial assignment (optional).
  const [positionId, setPositionId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [teamId, setTeamId] = React.useState("");
  const [designationId, setDesignationId] = React.useState("");
  const [managerEmploymentId, setManagerEmploymentId] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");

  const departments = useQueryData(getDepartmentsAction, organizationId, ["ACTIVE"]);
  const teams = useQueryData(getTeamsAction, organizationId, ["ACTIVE"]);
  const designations = useQueryData(getDesignationsAction, organizationId);
  const locations = useQueryData(getLocationsAction, organizationId);
  const facilities = useQueryData(getFacilitiesAction, organizationId);
  const positions = useQueryData(getPositionsAction, organizationId, ["ACTIVE", "VACANT"]);
  const [managers, setManagers] = React.useState<Option[]>([]);
  const [orgName, setOrgName] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    getWorkforceOrganizationsAction().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        const org = (res.data ?? []).find((o) => o.id === organizationId);
        setOrgName(org ? `${org.name} (${org.code})` : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const loadManagers = React.useCallback(() => {
    listManagerCandidatesAction(organizationId).then((res) => {
      if (res.ok) {
        setManagers((res.data ?? []).map((m) => ({ value: m.employmentId, label: m.label })));
      } else {
        setManagers([]);
      }
    });
  }, [organizationId]);

  const depOpts = (departments ?? []).map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const teamOpts = (teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));
  const desigOpts = (designations ?? []).map((d) => ({
    value: d.id,
    label: `${d.code} — ${d.name}`,
  }));
  const locOpts = (locations ?? []).map((l) => ({ value: l.id, label: `${l.code} — ${l.name}` }));
  const facOpts = (facilities ?? []).map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }));
  const posOpts = (positions ?? []).map((p) => ({
    value: p.id,
    label: `${p.code}${p.title ? ` — ${p.title}` : ""}`,
  }));

  function validateStep1(): string | null {
    if (!firstName.trim()) return "First name is required.";
    if (!lastName.trim()) return "Last name is required.";
    return null;
  }

  function validateStep2(): string | null {
    if (!/^[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/.test(employeeNo.trim()))
      return "Employee No. must use PREFIX-YY-NNNNN (e.g. EMP-26-00001).";
    if (!/^[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/.test(employmentNo.trim()))
      return "Employment No. must use PREFIX-YY-NNNNN (e.g. EMP-26-00001).";
    if (!hireDate) return "Hire date is required.";
    return null;
  }

  async function submitEmployee() {
    setPending(true);
    setFormError(null);
    const res = await createEmployeeAction({
      organizationId,
      person: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        preferredName: preferredName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      },
      employeeNo: employeeNo.trim(),
      employeeType,
      employment: {
        employmentNo: employmentNo.trim(),
        type: employmentType,
        hireDate,
        contractEndDate: contractEnd || null,
        probationEndDate: probationEnd || null,
        workLocationId: workLocationId || null,
        facilityId: facilityId || null,
        workerClassification: classification,
        noticePeriodDays: noticeDays === "" ? null : Number(noticeDays),
      },
    });
    setPending(false);
    if (!res.ok || !res.data) {
      setFormError(res.error?.message ?? "The employee could not be created.");
      return;
    }
    setCreatedEmployeeId(res.data.employeeId);
    setCreatedEmploymentId(res.data.employmentId);
    setStep(3);
    loadManagers();
  }

  async function submitAssignment() {
    if (!createdEmployeeId || !createdEmploymentId) return;
    setPending(true);
    setFormError(null);
    const res = await createAssignmentAction({
      organizationId,
      employmentId: createdEmploymentId,
      positionId: positionId || null,
      departmentId: departmentId || null,
      teamId: teamId || null,
      designationId: designationId || null,
      managerEmploymentId: managerEmploymentId || null,
      workLocationId: workLocationId || null,
      facilityId: facilityId || null,
      effectiveFrom: effectiveFrom || hireDate,
    });
    setPending(false);
    if (!res.ok) {
      setFormError(res.error?.message ?? "The assignment could not be created.");
      return;
    }
    toast({ title: "Employee created", variant: "success" });
    router.push(`/employees/${createdEmployeeId}`);
  }

  if (step === 3 && (!createdEmployeeId || !createdEmploymentId)) {
    return <ErrorState message="Employee was not created yet — go back to step 2." />;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ol className="flex flex-wrap gap-2 text-2xs" aria-label="Progress">
        {[
          [1, "Identity"],
          [2, "Employment"],
          [3, "Initial assignment"],
        ].map(([n, label]) => (
          <li
            key={n}
            aria-current={step === n ? "step" : undefined}
            className={
              step === n
                ? "rounded-full border border-primary bg-primary/10 px-3 py-1 font-semibold text-primary"
                : "rounded-full border border-border bg-muted px-3 py-1 text-muted-foreground"
            }
          >
            {n}. {label}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>
            {step === 1 ? "Identity" : step === 2 ? "Employment" : "Initial assignment"}
          </CardTitle>
          <CardDescription>
            {step === 1
              ? "The person behind the workforce record. Only the current phase's fields are collected."
              : step === 2
                ? `The employment relationship${orgName ? ` at ${orgName}` : ""}. Numbers are organization-scoped (PREFIX-YY-NNNNN).`
                : "Optional: place this employee into the organization structure now, or skip and assign later."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {formError ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-destructive-border bg-destructive-surface p-3 text-2xs text-destructive"
            >
              {formError}
            </p>
          ) : null}

          {step === 1 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="firstName"
                label="First name"
                value={firstName}
                onChange={setFirstName}
                required
              />
              <TextField
                id="lastName"
                label="Last name"
                value={lastName}
                onChange={setLastName}
                required
              />
              <TextField
                id="preferredName"
                label="Preferred name"
                value={preferredName}
                onChange={setPreferredName}
              />
              <TextField id="email" label="Email" type="email" value={email} onChange={setEmail} />
              <TextField id="phone" label="Phone" value={phone} onChange={setPhone} />
            </div>
          ) : null}

          {step === 2 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="employeeNo"
                label="Employee No."
                value={employeeNo}
                onChange={setEmployeeNo}
                required
                placeholder="EMP-26-00001"
                description="Format PREFIX-YY-NNNNN; unique within the organization."
              />
              <TextField
                id="employmentNo"
                label="Employment No."
                value={employmentNo}
                onChange={setEmploymentNo}
                required
                placeholder="EMP-26-00001"
              />
              <SelectField
                id="employeeType"
                label="Employee type"
                options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: t }))}
                value={employeeType}
                onChange={setEmployeeType}
                required
              />
              <SelectField
                id="employmentType"
                label="Employment type"
                options={EMPLOYMENT_TYPES.map((t) => ({ value: t, label: t }))}
                value={employmentType}
                onChange={setEmploymentType}
                required
              />
              <SelectField
                id="classification"
                label="Worker classification"
                options={CLASSIFICATIONS.map((t) => ({ value: t, label: t }))}
                value={classification}
                onChange={setClassification}
              />
              <TextField
                id="hireDate"
                label="Hire date"
                type="date"
                value={hireDate}
                onChange={setHireDate}
                required
              />
              <TextField
                id="probationEnd"
                label="Probation end"
                type="date"
                value={probationEnd}
                onChange={setProbationEnd}
              />
              <TextField
                id="contractEnd"
                label="Contract end"
                type="date"
                value={contractEnd}
                onChange={setContractEnd}
              />
              <TextField
                id="noticeDays"
                label="Notice period (days)"
                type="number"
                value={noticeDays}
                onChange={setNoticeDays}
              />
              <SelectField
                id="workLocation"
                label="Work location"
                options={locOpts}
                value={workLocationId}
                onChange={setWorkLocationId}
              />
              <SelectField
                id="facility"
                label="Facility"
                options={facOpts}
                value={facilityId}
                onChange={setFacilityId}
              />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                id="position"
                label="Position"
                options={posOpts}
                value={positionId}
                onChange={setPositionId}
                description="Occupancy derives from the open assignment; the seat flips to FILLED."
              />
              <SelectField
                id="department"
                label="Department"
                options={depOpts}
                value={departmentId}
                onChange={setDepartmentId}
              />
              <SelectField
                id="team"
                label="Team"
                options={teamOpts}
                value={teamId}
                onChange={setTeamId}
              />
              <SelectField
                id="designation"
                label="Designation"
                options={desigOpts}
                value={designationId}
                onChange={setDesignationId}
              />
              <SelectField
                id="manager"
                label="Manager"
                options={managers}
                value={managerEmploymentId}
                onChange={setManagerEmploymentId}
                description="Effective-dated manager relationship on the assignment — not a mutable employee.managerId."
              />
              <TextField
                id="effectiveFrom"
                label="Effective from"
                type="date"
                value={effectiveFrom}
                onChange={setEffectiveFrom}
                description="Defaults to the hire date when empty."
              />
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between gap-2">
            <div className="flex gap-2">
              {step > 1 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setFormError(null);
                    setStep((s) => (s === 3 ? 2 : 1) as 1 | 2);
                  }}
                >
                  Back
                </Button>
              ) : null}
              {step === 3 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    toast({ title: "Employee created", variant: "success" });
                    router.push(`/employees/${createdEmployeeId}`);
                  }}
                >
                  Skip assignment
                </Button>
              ) : null}
            </div>
            {step === 1 ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const err = validateStep1();
                  if (err) {
                    setFormError(err);
                    return;
                  }
                  setFormError(null);
                  setStep(2);
                }}
              >
                Next: Employment
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  const err = validateStep2();
                  if (err) {
                    setFormError(err);
                    return;
                  }
                  void submitEmployee();
                }}
              >
                {pending ? "Creating…" : "Create employee"}
              </Button>
            ) : null}
            {step === 3 ? (
              <Button size="sm" disabled={pending} onClick={() => void submitAssignment()}>
                {pending ? "Assigning…" : "Create assignment & finish"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
