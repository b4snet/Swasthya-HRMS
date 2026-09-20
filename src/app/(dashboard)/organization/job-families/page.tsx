import type { Metadata } from "next";
import { WithActiveOrg } from "@/components/org/with-active-org";
import { JobFamiliesClient } from "./job-families-client";

export const metadata: Metadata = { title: "Job families" };

export default function JobFamiliesPage() {
  return (
    <WithActiveOrg>
      {(organizationId) => <JobFamiliesClient organizationId={organizationId} />}
    </WithActiveOrg>
  );
}
