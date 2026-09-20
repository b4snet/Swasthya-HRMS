import type { Metadata } from "next";
import { listExpiringContractsAction } from "@/modules/contracts/api/actions";
import { listExpiringCredentialsAction } from "@/modules/credentials/api/actions";
import { EmptyState, ErrorState, PermissionDeniedState } from "@/components/ui/states";
import { ExpiryClient } from "./expiry-client";

export const metadata: Metadata = { title: "Expiring & expired" };

// Session-dependent (reads cookies via the server actions) — never static.
export const dynamic = "force-dynamic";

/**
 * Workforce expiry view: contracts and credentials inside their renewal
 * windows or already expired, per the caller's reach. Rows outside reach are
 * omitted server-side; counts are computed from what is actually shown.
 */
export default async function ExpiryPage() {
  const [contracts, credentials] = await Promise.all([
    listExpiringContractsAction({}),
    listExpiringCredentialsAction({}),
  ]);

  if (!contracts.ok && contracts.error?.code === "AUTHORIZATION_DENIED") {
    return <PermissionDeniedState />;
  }
  if (!contracts.ok || !credentials.ok) {
    return (
      <ErrorState
        message={
          contracts.error?.message ?? credentials.error?.message ?? "Could not load expiry data."
        }
      />
    );
  }

  const contractRows = (contracts.data ?? []) as Array<{
    id: string;
    contractNo: string;
    title: string;
    status: string;
    effectiveTo: string | null;
    employmentId: string;
  }>;
  const credentialRows = (credentials.data ?? []) as Array<{
    id: string;
    employeeId: string;
    name: string;
    type: string;
    issuer: string;
    expiresOn: string | null;
    derivedStatus: string;
  }>;

  if (contractRows.length === 0 && credentialRows.length === 0) {
    return (
      <EmptyState
        title="Nothing is expiring"
        description="No contracts or credentials in your reach fall inside their renewal windows."
      />
    );
  }

  return <ExpiryClient contractRows={contractRows} credentialRows={credentialRows} />;
}
