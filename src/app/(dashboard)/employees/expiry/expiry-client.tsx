"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

interface ContractRow {
  id: string;
  contractNo: string;
  title: string;
  status: string;
  effectiveTo: string | null;
  employmentId: string;
}

interface CredentialRow {
  id: string;
  employeeId: string;
  name: string;
  type: string;
  issuer: string;
  expiresOn: string | null;
  derivedStatus: string;
}

/**
 * Expiry dashboard. Status is conveyed by text + badge (never color alone);
 * rows link into the owning employee's profile tabs.
 */
export function ExpiryClient({
  contractRows,
  credentialRows,
}: {
  contractRows: ContractRow[];
  credentialRows: CredentialRow[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Expiring &amp; expired contracts</CardTitle>
          <CardDescription>
            Fixed-term contracts inside the 60-day window or already past their end date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contractRows.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No contracts need attention.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Contracts expiring or expired</caption>
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-4">
                      Contract
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Status
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Ends
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map((c) => (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{c.title}</span>{" "}
                        <code className="text-2xs text-muted-foreground">{c.contractNo}</code>
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={c.status === "EXPIRED" ? "destructive" : "warning"}>
                          {c.status === "EXPIRED" ? "EXPIRED" : "EXPIRING"}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{fmtDate(c.effectiveTo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiring &amp; expired credentials</CardTitle>
          <CardDescription>
            Credentials at or inside their type&apos;s renewal-lead window, or already expired.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {credentialRows.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No credentials need attention.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Credentials expiring or expired</caption>
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-muted-foreground">
                    <th scope="col" className="py-2 pr-4">
                      Credential
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Type
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Derived status
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Expires
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {credentialRows.map((c) => (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="py-2 pr-4">
                        <span className="font-medium">{c.name}</span>{" "}
                        <span className="text-2xs text-muted-foreground">{c.issuer}</span>
                      </td>
                      <td className="py-2 pr-4 text-2xs">{c.type}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={c.derivedStatus === "EXPIRED" ? "destructive" : "warning"}>
                          {c.derivedStatus}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4">{fmtDate(c.expiresOn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
