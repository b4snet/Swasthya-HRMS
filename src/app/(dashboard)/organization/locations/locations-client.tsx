"use client";

import { getLocationsAction } from "@/modules/organization/api/queries";
import {
  createLocationAction,
  updateLocationAction,
  archiveLocationAction,
  setEntityStatusAction,
} from "@/modules/organization/api/actions";
import { EntityPage } from "@/components/org/entity-page";
import type { FieldDef } from "@/components/org/crud-dialog";

type Row =
  Awaited<ReturnType<typeof getLocationsAction>> extends { data?: infer D }
    ? D extends (infer R)[]
      ? R
      : never
    : never;

const codeField: FieldDef = {
  name: "code",
  label: "Code",
  required: true,
  description: "e.g. LOC-KTM. Uppercase letters, digits, - or _.",
  maxLength: 40,
};
const nameField: FieldDef = { name: "name", label: "Name", required: true, maxLength: 120 };
const countryField: FieldDef = {
  name: "country",
  label: "Country",
  required: true,
  description: "Two-letter ISO 3166-1 code, e.g. NP.",
  maxLength: 2,
};

export function LocationsClient({ organizationId }: { organizationId: string }) {
  return (
    <EntityPage<Row>
      organizationId={organizationId}
      load={() => getLocationsAction()}
      getRowKey={(r) => r.id}
      getRowStatus={(r) => r.status}
      getRowVersion={(r) => r.version}
      caption="Locations"
      entityLabel="Location"
      resourceType="Location"
      statusOptions={["ACTIVE", "INACTIVE", "ARCHIVED"]}
      searchValues={(r) => [r.code, r.name, r.city ?? "", r.district ?? "", r.country]}
      createFields={[
        codeField,
        nameField,
        { name: "addressLine", label: "Address", maxLength: 200 },
        { name: "city", label: "City", maxLength: 80 },
        { name: "district", label: "District", maxLength: 80 },
        { name: "province", label: "Province", maxLength: 80 },
        countryField,
        { name: "postalCode", label: "Postal code", maxLength: 20 },
      ]}
      createAction={createLocationAction}
      editFields={() => [
        nameField,
        { name: "addressLine", label: "Address", maxLength: 200 },
        { name: "city", label: "City", maxLength: 80 },
        { name: "district", label: "District", maxLength: 80 },
        { name: "province", label: "Province", maxLength: 80 },
        { name: "postalCode", label: "Postal code", maxLength: 20 },
      ]}
      editAction={updateLocationAction}
      statusActions={{
        onActivate: (i) =>
          setEntityStatusAction({ ...i, organizationId, table: "location", status: "ACTIVE" }),
        onDeactivate: (i) =>
          setEntityStatusAction({ ...i, organizationId, table: "location", status: "INACTIVE" }),
        onArchive: archiveLocationAction,
      }}
      exportColumns={[
        { key: "code", header: "Code", value: (r) => r.code },
        { key: "name", header: "Name", value: (r) => r.name },
        { key: "city", header: "City", value: (r) => r.city ?? "" },
        { key: "country", header: "Country", value: (r) => r.country },
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
        { key: "city", header: "City", sortable: true, render: (r) => r.city ?? "—" },
        { key: "district", header: "District", render: (r) => r.district ?? "—" },
        {
          key: "country",
          header: "Country",
          sortable: true,
          render: (r) => <code className="text-2xs">{r.country}</code>,
        },
      ]}
      extraColumns={(h) => [
        { key: "status", header: "Status", sortable: true, render: h.statusCell },
        { key: "actions", header: "Actions", className: "text-right", render: h.actionsCell },
      ]}
    />
  );
}
