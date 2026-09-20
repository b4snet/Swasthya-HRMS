"use client";

import { getFacilitiesAction, getLocationsAction } from "@/modules/organization/api/queries";
import {
  createFacilityAction,
  updateFacilityAction,
  archiveFacilityAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";
import { useQueryData } from "@/components/org/use-query-data";

type Row =
  Awaited<ReturnType<typeof getFacilitiesAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "e.g. FAC-HOSP-01. Uppercase letters, digits, - or _.",
  maxLength: 40,
};
const nameField: FieldDef = { name: "name", label: "Name", required: true, maxLength: 120 };

const typeOptions = [
  { value: "HOSPITAL", label: "Hospital" },
  { value: "CLINIC", label: "Clinic" },
  { value: "OFFICE", label: "Office" },
  { value: "OTHER", label: "Other" },
];

export function FacilitiesClient({ organizationId }: { organizationId: string }) {
  const locations = useQueryData(getLocationsAction);
  // Archived locations cannot host a new facility; keep them visible in edit
  // lists only when already selected (server validates the reference).
  const activeLocations = (locations ?? []).filter((l) => l.status !== "ARCHIVED");
  const locationOptions = activeLocations.map((l) => ({
    value: l.id,
    label: `${l.code} — ${l.name}${l.city ? `, ${l.city}` : ""}`,
  }));

  const createFields: FieldDef[] = [
    codeField,
    nameField,
    {
      name: "type",
      label: "Facility type",
      type: "select",
      required: true,
      options: typeOptions,
    },
    {
      name: "locationId",
      label: "Location",
      type: "select",
      required: true,
      options: [{ value: "", label: "— select location —" }, ...locationOptions],
      description: "Facilities reference a geographic location. Create one under Locations first.",
    },
    { name: "effectiveFrom", label: "Effective from", type: "date" },
  ];

  return (
    <EntityPage<Row>
      organizationId={organizationId}
      load={() => getFacilitiesAction(organizationId)}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Facilities"
      entityLabel="Facility"
      resourceType="Facility"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [r.code, r.name, r.type, r.location?.name ?? "", r.location?.city ?? ""]}
      createFields={createFields}
      createAction={createFacilityAction}
      editFields={() => [
        nameField,
        { name: "type", label: "Facility type", type: "select", options: typeOptions },
      ]}
      editAction={updateFacilityAction}
      statusActions={{
        onActivate: (i) =>
          setEntityStatusAction({ ...i, organizationId, table: "facility", status: "ACTIVE" }),
        onDeactivate: (i) =>
          setEntityStatusAction({ ...i, organizationId, table: "facility", status: "INACTIVE" }),
        onArchive: archiveFacilityAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "type", header: "Type", value: (r) => r.type },
        { key: "location", header: "Location", value: (r) => r.location?.name ?? "" },
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
        { key: "type", header: "Type", sortable: true },
        {
          key: "location",
          header: "Location",
          render: (r) =>
            r.location ? `${r.location.name}${r.location.city ? `, ${r.location.city}` : ""}` : "—",
        },
        {
          key: "effectiveFrom",
          header: "Effective from",
          sortable: true,
          render: (r) => new Date(r.effectiveFrom).toLocaleDateString(),
        },
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
