import type { Metadata } from "next";
import { WithActiveOrg } from "@/components/org/with-active-org";
import { LocationsClient } from "./locations-client";

export const metadata: Metadata = { title: "Locations" };

export default function LocationsPage() {
  return (
    <WithActiveOrg>
      {(organizationId) => <LocationsClient organizationId={organizationId} />}
    </WithActiveOrg>
  );
}
