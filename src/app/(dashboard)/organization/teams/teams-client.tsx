"use client";

import { getTeamsAction, getDepartmentsAction } from "@/modules/organization/api/queries";
import {
  createTeamAction,
  updateTeamAction,
  archiveTeamAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";
import { useQueryData } from "@/components/org/use-query-data";

type TeamRow =
  Awaited<ReturnType<typeof getTeamsAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "Stable uppercase identifier, e.g. ICU-NIGHT.",
  maxLength: 40,
};
const nameField: FieldDef = { name: "name", label: "Name", required: true, maxLength: 120 };
const descriptionField: FieldDef = { name: "description", label: "Description", maxLength: 400 };

export function TeamsClient({ organizationId }: { organizationId: string }) {
  const departments = useQueryData(getDepartmentsAction, organizationId, ["ACTIVE", "INACTIVE"]);

  const departmentOptions = (departments ?? []).map((d) => ({
    value: d.id,
    label: `${d.code} — ${d.name}`,
  }));

  return (
    <EntityPage<TeamRow>
      organizationId={organizationId}
      load={() => getTeamsAction(organizationId)}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Teams"
      entityLabel="Team"
      resourceType="Team"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [
        r.code,
        r.name,
        r.description ?? "",
        r.department?.name ?? "",
        r.parent?.name ?? "",
      ]}
      createFields={[
        codeField,
        nameField,
        {
          name: "departmentId",
          label: "Owning department",
          type: "select",
          options: [{ value: "", label: "— none —" }, ...departmentOptions],
          description: "Optional department this team belongs to.",
        },
        descriptionField,
      ]}
      createAction={createTeamAction}
      editFields={() => [nameField, { ...descriptionField }]}
      editAction={updateTeamAction}
      statusActions={{
        onActivate: (i) => setEntityStatusAction({ ...i, table: "team", status: "ACTIVE" }),
        onDeactivate: (i) => setEntityStatusAction({ ...i, table: "team", status: "INACTIVE" }),
        onArchive: archiveTeamAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "department", header: "Department", value: (r) => r.department?.name ?? "" },
        { key: "status", header: "Status", value: (r) => r.status },
      ]}
      columns={[
        {
          key: "code",
          header: "Code",
          sortable: true,
          render: (r) => <code className="text-2xs">{r.code}</code>,
        },
        { key: "name", header: "Name", sortable: true },
        {
          key: "department",
          header: "Department",
          sortable: true,
          render: (r) => r.department?.name ?? "—",
        },
        { key: "parent", header: "Parent team", render: (r) => r.parent?.name ?? "—" },
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
