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
import { useQueryData } from "@/components/org/use-query-data";
import {
  getDepartmentsAction,
  getTeamsAction,
  getDesignationsAction,
  getLocationsAction,
  getFacilitiesAction,
  getPositionsAction,
} from "@/modules/organization/api/queries";
import { listManagerCandidatesAction } from "@/modules/workforce/api/queries";
import {
  createAssignmentAction,
  closeAssignmentAction,
  archiveEmployeeAction,
} from "@/modules/workforce/api/actions";

interface AssignmentRow {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  open: boolean;
  positionId: string | null;
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const NONE = { value: "", label: "— none —" };

/**
 * Assignment timeline. Rows are effective-dated facts: OPEN (current),
 * future-dated, and historical (closed) are shown separately and never
 * merged — history is never flattened into a mutable profile. Changing the
 * assignment uses the handover contract: an open assignment is closed at
 * closeCurrentAt and the replacement opens at effectiveFrom, atomically,
 * server-side.
 */
export function AssignmentsClient({
  organizationId,
  employeeId,
  employmentId,
  assignments,
}: {
  organizationId: string;
  employeeId: string;
  employmentId: string | null;
  assignments: AssignmentRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const current = assignments.find((a) => a.open);
  const historical = assignments
    .filter((a) => a.effectiveTo !== null && a.effectiveTo.slice(0, 10) <= today)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const future = assignments.filter((a) => !a.open && a.effectiveFrom.slice(0, 10) > today);

  const departments = useQueryData(getDepartmentsAction, organizationId, ["ACTIVE"]);
  const teams = useQueryData(getTeamsAction, organizationId, ["ACTIVE"]);
  const designations = useQueryData(getDesignationsAction, organizationId);
  const locations = useQueryData(getLocationsAction, organizationId);
  const facilities = useQueryData(getFacilitiesAction, organizationId);
  const positions = useQueryData(getPositionsAction, organizationId, ["ACTIVE", "VACANT"]);
  const [managers, setManagers] = React.useState<Array<{ value: string; label: string }>>([]);

  React.useEffect(() => {
    if (!employmentId) return;
    listManagerCandidatesAction(organizationId, employmentId).then((res) => {
      if (res.ok) {
        setManagers((res.data ?? []).map((m) => ({ value: m.employmentId, label: m.label })));
      }
    });
  }, [organizationId, employmentId]);

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

  async function handleCreateAssignment(payload: Record<string, unknown>) {
    setPending(true);
    const res = await createAssignmentAction({
      organizationId,
      employmentId,
      ...payload,
    });
    setPending(false);
    if (res.ok) {
      toast({ title: "Assignment created", variant: "success" });
      router.refresh();
    } else {
      const err = res.error ?? {
        code: "UNEXPECTED",
        message: "The request could not be completed.",
      };
      toast({
        title:
          err.code === "CONFLICT_ASSIGNMENT_OVERLAP"
            ? "Assignment conflict"
            : err.code === "AUTHORIZATION_DENIED"
              ? "Permission denied"
              : "Action failed",
        description: err.message,
        variant: "error",
      });
      router.refresh();
    }
  }

  async function handleCloseOpen(effectiveTo: string) {
    if (!employmentId || !current) return;
    setPending(true);
    const res = await closeAssignmentAction({
      organizationId,
      employmentId,
      effectiveTo,
    });
    setPending(false);
    if (res.ok) {
      toast({ title: "Assignment closed", variant: "success" });
      router.refresh();
    } else {
      const err = res.error ?? {
        code: "UNEXPECTED",
        message: "The request could not be completed.",
      };
      toast({ title: "Action failed", description: err.message, variant: "error" });
      router.refresh();
    }
  }

  async function handleArchive() {
    setPending(true);
    const res = await archiveEmployeeAction({
      organizationId,
      employeeId,
      expectedVersion: 1, // re-read server-side; the UI cannot guess versions
    });
    setPending(false);
    if (res.ok) {
      toast({ title: "Employee archived", variant: "success" });
      router.push("/employees");
    } else {
      const err = res.error ?? {
        code: "UNEXPECTED",
        message: "The request could not be completed.",
      };
      toast({
        title:
          err.code === "RELATIONSHIP_INVALID" ? "Close the open assignment first" : "Action failed",
        description: err.message,
        variant: "error",
      });
    }
  }

  if (!employmentId) {
    return (
      <EmptyState
        title="No employment record"
        description="Assignments attach to an employment relationship; this employee has none yet."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle>Current assignment</CardTitle>
            <CardDescription>The open effective-dated placement.</CardDescription>
          </div>
          <div className="flex gap-2">
            <AuditHistoryButton
              organizationId={organizationId}
              resourceType="EmploymentAssignment"
              resourceId={current?.id ?? employmentId}
            />
            <ChangeAssignmentDialog
              hasOpenAssignment={Boolean(current)}
              posOpts={posOpts}
              depOpts={depOpts}
              teamOpts={teamOpts}
              desigOpts={desigOpts}
              locOpts={locOpts}
              facOpts={facOpts}
              managerOpts={managers}
              pending={pending}
              onSubmit={handleCreateAssignment}
            />
          </div>
        </CardHeader>
        <CardContent>
          {current ? (
            <>
              <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Effective from</dt>
                <dd>{fmtDate(current.effectiveFrom)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant="success">OPEN</Badge>
                </dd>
                <dt className="text-muted-foreground">Position</dt>
                <dd>{current.positionId ? "Assigned" : "—"}</dd>
              </dl>
              <div className="mt-4">
                <CloseAssignmentDialog
                  disabled={pending}
                  onClose={(date) => void handleCloseOpen(date)}
                />
              </div>
            </>
          ) : (
            <EmptyState
              title="No open assignment"
              description="Use “New assignment” to place this employee into the organization structure."
            />
          )}
        </CardContent>
      </Card>

      {future.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Future assignments</CardTitle>
            <CardDescription>Scheduled placements that have not started yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {future.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <Badge variant="info">FUTURE</Badge>
                  <span>
                    {fmtDate(a.effectiveFrom)} → {fmtDate(a.effectiveTo)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Historical assignments</CardTitle>
          <CardDescription>Closed placements — immutable history.</CardDescription>
        </CardHeader>
        <CardContent>
          {historical.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No closed assignments yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {historical.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <Badge variant="neutral">CLOSED</Badge>
                  <span>
                    {fmtDate(a.effectiveFrom)} → {fmtDate(a.effectiveTo)}
                  </span>
                  <AuditHistoryButton
                    organizationId={organizationId}
                    resourceType="EmploymentAssignment"
                    resourceId={a.id}
                    label="History"
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 border-t border-border pt-4">
            <h4 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Danger zone
            </h4>
            <p className="mb-2 text-2xs text-muted-foreground">
              Archival requires a terminal/inactive employment and no open assignment. History is
              retained, never deleted.
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => void handleArchive()}
            >
              Archive employee
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CloseAssignmentDialog({
  disabled,
  onClose,
}: {
  disabled: boolean;
  onClose: (effectiveTo: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Close current assignment
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Close current assignment"
        description="Closes the open placement without a replacement (e.g. on separation)."
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
            <Label htmlFor="close-date">
              Effective to
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
            </Label>
            <Input
              id="close-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (!date) {
                  setError("Effective to is required.");
                  return;
                }
                setOpen(false);
                onClose(date);
              }}
            >
              Close assignment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeAssignmentDialog({
  hasOpenAssignment,
  posOpts,
  depOpts,
  teamOpts,
  desigOpts,
  locOpts,
  facOpts,
  managerOpts,
  pending,
  onSubmit,
}: {
  hasOpenAssignment: boolean;
  posOpts: Array<{ value: string; label: string }>;
  depOpts: Array<{ value: string; label: string }>;
  teamOpts: Array<{ value: string; label: string }>;
  desigOpts: Array<{ value: string; label: string }>;
  locOpts: Array<{ value: string; label: string }>;
  facOpts: Array<{ value: string; label: string }>;
  managerOpts: Array<{ value: string; label: string }>;
  pending: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [positionId, setPositionId] = React.useState("");
  const [departmentId, setDepartmentId] = React.useState("");
  const [teamId, setTeamId] = React.useState("");
  const [designationId, setDesignationId] = React.useState("");
  const [workLocationId, setWorkLocationId] = React.useState("");
  const [facilityId, setFacilityId] = React.useState("");
  const [managerEmploymentId, setManagerEmploymentId] = React.useState("");
  const [effectiveFrom, setEffectiveFrom] = React.useState("");
  const [closeCurrentAt, setCloseCurrentAt] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const selectCls =
    "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

  function Select({
    id,
    label,
    options,
    value,
    onChange,
    description,
  }: {
    id: string;
    label: string;
    options: Array<{ value: string; label: string }>;
    value: string;
    onChange: (v: string) => void;
    description?: string;
  }) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={selectCls}
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

  async function handle() {
    if (!effectiveFrom) {
      setError("Effective from is required.");
      return;
    }
    if (hasOpenAssignment && !closeCurrentAt) {
      setError("An open assignment exists — provide the handover date (Close current at).");
      return;
    }
    if (closeCurrentAt && effectiveFrom < closeCurrentAt) {
      setError("The new assignment cannot start before the handover date.");
      return;
    }
    setError(null);
    await onSubmit({
      positionId: positionId || null,
      departmentId: departmentId || null,
      teamId: teamId || null,
      designationId: designationId || null,
      workLocationId: workLocationId || null,
      facilityId: facilityId || null,
      managerEmploymentId: managerEmploymentId || null,
      effectiveFrom,
      closeCurrentAt: closeCurrentAt || null,
    });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setError(null);
          setCloseCurrentAt("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          {hasOpenAssignment ? "Change assignment" : "New assignment"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={hasOpenAssignment ? "Change assignment" : "New assignment"}
        description={
          hasOpenAssignment
            ? "The current assignment closes at the handover date and the replacement opens atomically."
            : "Place this employment into the organization structure."
        }
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
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              id="asg-position"
              label="Position"
              options={posOpts}
              value={positionId}
              onChange={setPositionId}
              description="Occupancy derives from the open assignment."
            />
            <Select
              id="asg-department"
              label="Department"
              options={depOpts}
              value={departmentId}
              onChange={setDepartmentId}
            />
            <Select
              id="asg-team"
              label="Team"
              options={teamOpts}
              value={teamId}
              onChange={setTeamId}
            />
            <Select
              id="asg-designation"
              label="Designation"
              options={desigOpts}
              value={designationId}
              onChange={setDesignationId}
            />
            <Select
              id="asg-location"
              label="Work location"
              options={locOpts}
              value={workLocationId}
              onChange={setWorkLocationId}
            />
            <Select
              id="asg-facility"
              label="Facility"
              options={facOpts}
              value={facilityId}
              onChange={setFacilityId}
            />
            <Select
              id="asg-manager"
              label="Manager"
              options={managerOpts}
              value={managerEmploymentId}
              onChange={setManagerEmploymentId}
              description="Effective-dated manager on the assignment."
            />
            <div className="space-y-1.5">
              <Label htmlFor="asg-from">
                Effective from
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
              </Label>
              <Input
                id="asg-from"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            {hasOpenAssignment ? (
              <div className="space-y-1.5">
                <Label htmlFor="asg-close">
                  Close current at
                  <span aria-hidden="true" className="ml-0.5 text-destructive">
                    *
                  </span>
                </Label>
                <Input
                  id="asg-close"
                  type="date"
                  value={closeCurrentAt}
                  onChange={(e) => setCloseCurrentAt(e.target.value)}
                />
                <p className="text-2xs text-muted-foreground">
                  The open assignment ends on this date; the new one starts at “Effective from”.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void handle()}>
              {pending ? "Saving…" : "Save assignment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
