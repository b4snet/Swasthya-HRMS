import type { Metadata } from "next";
import { WithActiveOrg } from "@/components/org/with-active-org";
import { DesignationsClient } from "./designations-client";

export const metadata: Metadata = { title: "Designations" };

export default function DesignationsPage() {
  return (
    <WithActiveOrg>
      {(organizationId) => <DesignationsClient organizationId={organizationId} />}
    </WithActiveOrg>
  );
}
