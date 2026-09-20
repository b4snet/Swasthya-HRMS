import type { Metadata } from "next";
import { WithActiveOrg } from "@/components/org/with-active-org";
import { GradesClient } from "./grades-client";

export const metadata: Metadata = { title: "Grades" };

export default function GradesPage() {
  return (
    <WithActiveOrg>
      {(organizationId) => <GradesClient organizationId={organizationId} />}
    </WithActiveOrg>
  );
}
