"use client";

import { getJobFamiliesAction } from "@/modules/organization/api/queries";
import {
  createJobFamilyAction,
  updateJobFamilyAction,
  archiveJobFamilyAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";

type Row =
  Awaited<ReturnType<typeof getJobFamiliesAction>> extends { data?: infer D }
    ? D extends (infer R)[] | undefined
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "e.g. CLINICAL. Uppercase letters, digits, - or _.",
  maxLength: 40,
};
const nameField: FieldDef = { name: "name", label: "Name", required: true, maxLength: 120 };

export function JobFamiliesClient({ organizationId }: { organizationId: string }) {
  return (
    <EntityPage<Row>
      organizationId={organizationId}
      load={() => getJobFamiliesAction(organizationId)}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Job families"
      entityLabel="Job family"
      resourceType="JobFamily"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [r.code, r.name]}
      createFields={[codeField, nameField]}
      createAction={createJobFamilyAction}
      editFields={() => [nameField]}
      editAction={updateJobFamilyAction}
      statusActions={{
        onActivate: (i) => setEntityStatusAction({ ...i, table: "jobFamily", status: "ACTIVE" }),
        onDeactivate: (i) =>
          setEntityStatusAction({ ...i, table: "jobFamily", status: "INACTIVE" }),
        onArchive: archiveJobFamilyAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
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
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
