"use client";

import { getDepartmentsAction } from "@/modules/organization/api/queries";
import {
  createDepartmentAction,
  updateDepartmentAction,
  archiveDepartmentAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";
import { useQueryData } from "@/components/org/use-query-data";

type DepartmentRow =
  Awaited<ReturnType<typeof getDepartmentsAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "Stable uppercase identifier, e.g. NURSING. Used in reports; never reused.",
  maxLength: 40,
};
const nameField: FieldDef = { name: "name", label: "Name", required: true, maxLength: 120 };
const descriptionField: FieldDef = { name: "description", label: "Description", maxLength: 400 };

export function DepartmentsClient({ organizationId }: { organizationId: string }) {
  const departments = useQueryData(getDepartmentsAction, organizationId);
  const parentOptions = (departments ?? [])
    .filter((d) => d.status !== "ARCHIVED")
    .map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));
  const parentField: FieldDef = {
    name: "parentId",
    label: "Parent department",
    type: "select",
    options: [{ value: "", label: "— none (top level) —" }, ...parentOptions],
    description: "Optional higher-level department within the same organization.",
  };

  return (
    <EntityPage<DepartmentRow>
      organizationId={organizationId}
      load={() => getDepartmentsAction(organizationId)}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Departments"
      entityLabel="Department"
      resourceType="Department"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [r.code, r.name, r.description ?? "", r.parent?.name ?? ""]}
      createFields={[codeField, nameField, parentField, descriptionField]}
      createAction={createDepartmentAction}
      editFields={() => [nameField, parentField, descriptionField]}
      editAction={updateDepartmentAction}
      statusActions={{
        onActivate: (i) => setEntityStatusAction({ ...i, table: "department", status: "ACTIVE" }),
        onDeactivate: (i) =>
          setEntityStatusAction({ ...i, table: "department", status: "INACTIVE" }),
        onArchive: archiveDepartmentAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "parent", header: "Parent", value: (r) => r.parent?.name ?? "" },
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
        { key: "parent", header: "Parent", sortable: true, render: (r) => r.parent?.name ?? "—" },
        { key: "description", header: "Description", render: (r) => r.description ?? "—" },
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
