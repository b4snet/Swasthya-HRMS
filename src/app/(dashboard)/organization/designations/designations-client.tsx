"use client";

import { getDesignationsAction } from "@/modules/organization/api/queries";
import {
  createDesignationAction,
  updateDesignationAction,
  archiveDesignationAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";

type Row =
  Awaited<ReturnType<typeof getDesignationsAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "e.g. DESG-MO. Uppercase letters, digits, - or _.",
  maxLength: 40,
};
const nameField: FieldDef = {
  name: "name",
  label: "Title / classification name",
  required: true,
  maxLength: 120,
};
const levelField: FieldDef = {
  name: "level",
  label: "Level",
  type: "number",
  description: "Optional ordinal level (1–99) for sorting career ladders.",
};

export function DesignationsClient({ organizationId }: { organizationId: string }) {
  return (
    <EntityPage<Row>
      organizationId={organizationId}
      load={() => getDesignationsAction(organizationId)}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Designations"
      entityLabel="Designation"
      resourceType="Designation"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [r.code, r.name]}
      createFields={[codeField, nameField, levelField]}
      createAction={createDesignationAction}
      editFields={() => [nameField, levelField]}
      editAction={updateDesignationAction}
      statusActions={{
        onActivate: (i) => setEntityStatusAction({ ...i, table: "designation", status: "ACTIVE" }),
        onDeactivate: (i) =>
          setEntityStatusAction({ ...i, table: "designation", status: "INACTIVE" }),
        onArchive: archiveDesignationAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "level", header: "Level", value: (r) => r.level ?? "" },
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
        { key: "level", header: "Level", sortable: true, render: (r) => r.level ?? "—" },
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
