"use client";

import {
  getPositionsAction,
  getDepartmentsAction,
  getTeamsAction,
  getDesignationsAction,
  getGradesAction,
  getJobFamiliesAction,
  getCostCentersAction,
} from "@/modules/organization/api/queries";
import {
  createPositionAction,
  updatePositionAction,
  setPositionStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";
import { useQueryData } from "@/components/org/use-query-data";
import { ReportingSection } from "./reporting-section";

type PositionRow =
  Awaited<ReturnType<typeof getPositionsAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

function idField(
  name: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  description?: string,
): FieldDef {
  return {
    name,
    label,
    type: "select",
    options: [{ value: "", label: "— none —" }, ...options],
    description,
  };
}

export function PositionsClient({ organizationId }: { organizationId: string }) {
  const departments = useQueryData(getDepartmentsAction, organizationId, ["ACTIVE", "INACTIVE"]);
  const teams = useQueryData(getTeamsAction, organizationId, ["ACTIVE", "INACTIVE"]);
  const designations = useQueryData(getDesignationsAction, organizationId);
  const grades = useQueryData(getGradesAction, organizationId);
  const jobFamilies = useQueryData(getJobFamiliesAction, organizationId);
  const costCenters = useQueryData(getCostCentersAction, organizationId);

  const depOpts = (departments ?? []).map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const teamOpts = (teams ?? []).map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));
  const desigOpts = (designations ?? []).map((d) => ({
    value: d.id,
    label: `${d.code} — ${d.name}`,
  }));
  const gradeOpts = (grades ?? []).map((g) => ({ value: g.id, label: `${g.code} — ${g.name}` }));
  const jfOpts = (jobFamilies ?? []).map((j) => ({ value: j.id, label: `${j.code} — ${j.name}` }));
  const ccOpts = (costCenters ?? []).map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));

  const createFields: FieldDef[] = [
    {
      name: "code",
      label: "Position code",
      required: true,
      description: "Stable seat identifier, e.g. POS-EMR-001.",
      maxLength: 40,
    },
    {
      name: "title",
      label: "Title",
      maxLength: 120,
      description: "Working title shown in rosters; the classification lives in Designation.",
    },
    idField(
      "departmentId",
      "Department",
      depOpts,
      "A position belongs to exactly one of department or team.",
    ),
    idField("teamId", "Team", teamOpts),
    idField("designationId", "Designation", desigOpts),
    idField("gradeId", "Grade", gradeOpts),
    idField("jobFamilyId", "Job family", jfOpts),
    idField("costCenterId", "Cost center", ccOpts),
  ];

  return (
    <div className="space-y-8">
      <EntityPage<PositionRow>
        organizationId={organizationId}
        load={() => getPositionsAction(organizationId)}
        getRowKey={(r) => r.id}
        getRowStatus={(r) => r.status}
        getRowVersion={(r) => r.version}
        caption="Positions"
        entityLabel="Position"
        resourceType="Position"
        statusOptions={["VACANT", "FILLED", "CLOSED"]}
        searchValues={(r) => [
          r.code,
          r.title ?? "",
          r.department?.name ?? "",
          r.team?.name ?? "",
          r.designation?.name ?? "",
        ]}
        createFields={createFields}
        createAction={createPositionAction}
        editFields={() => createFields.slice(1)} // code is immutable after create
        editAction={updatePositionAction}
        statusActions={{
          onActivate: (i) => setPositionStatusAction({ ...i, status: "VACANT" }),
          onDeactivate: (i) => setPositionStatusAction({ ...i, status: "FILLED" }),
          onArchive: (i) => setPositionStatusAction({ ...i, status: "CLOSED" }),
        }}
        statusLabels={{ activate: "Mark vacant", deactivate: "Mark filled", archive: "Close" }}
        terminalStatuses={["CLOSED"]}
        exportColumns={[
          { key: "code", header: "Code", value: (r) => r.code },
          { key: "title", header: "Title", value: (r) => r.title ?? "" },
          {
            key: "placement",
            header: "Placement",
            value: (r) => r.department?.name ?? r.team?.name ?? "",
          },
          { key: "status", header: "Status", value: (r) => r.status },
        ]}
        columns={[
          {
            key: "code",
            header: "Code",
            sortable: true,
            render: (r) => <code className="text-2xs">{r.code}</code>,
          },
          { key: "title", header: "Title", sortable: true, render: (r) => r.title ?? "—" },
          {
            key: "placement",
            header: "Placement",
            render: (r) => r.department?.name ?? r.team?.name ?? "—",
          },
          { key: "designation", header: "Designation", render: (r) => r.designation?.name ?? "—" },
          { key: "grade", header: "Grade", render: (r) => r.grade?.name ?? "—" },
        ]}
        extraColumns={(h) => [
          { key: "status", header: "Status", sortable: true, render: h.statusCell },
          { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
        ]}
      />

      <ReportingSection organizationId={organizationId} />
    </div>
  );
}
