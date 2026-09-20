import type { Metadata } from "next";
import { WithActiveOrg } from "@/components/org/with-active-org";
import { FacilitiesClient } from "./facilities-client";

export const metadata: Metadata = { title: "Facilities" };

export default function FacilitiesPage() {
  return (
    <WithActiveOrg>
      {(organizationId) => <FacilitiesClient organizationId={organizationId} />}
    </WithActiveOrg>
  );
}
