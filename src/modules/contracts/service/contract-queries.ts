/**
 * Contract read services (Phase 3, prompt 4).
 *
 * listContractsForEmployment: the employee-profile "Contracts" tab source.
 * Reach is enforced per row via assertCallerCanReadContracts; the employment
 * itself is probed through the tenant scope first so a guessed id yields
 * NOT_FOUND without org-reach leakage.
 */
import { prisma } from "@/lib/db";
import { ContractsAppError, toContractsAppError } from "./app-errors";
import { assertCallerCanReadContracts, findScopedRow } from "./mutations";
import type { WorkforceSubject } from "../../workforce/service/types";

export type ContractListItem = {
  id: string;
  contractNo: string;
  title: string;
  type: string;
  status: string;
  currentVersionNo: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
};

export async function listContractsForEmployment(
  caller: WorkforceSubject,
  employmentId: string,
): Promise<ContractListItem[]> {
  try {
    const employment = await findScopedRow(
      prisma.employment,
      { id: employmentId, tenantId: caller.tenantId },
      "Employment",
    );
    const rows = await prisma.contract.findMany({
      where: {
        tenantId: caller.tenantId,
        employmentId: employment.id,
        status: { not: "ARCHIVED" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        contractNo: true,
        title: true,
        type: true,
        status: true,
        currentVersionNo: true,
        effectiveFrom: true,
        effectiveTo: true,
        createdAt: true,
        organizationId: true,
      },
    });
    const visible: ContractListItem[] = [];
    for (const row of rows) {
      try {
        await assertCallerCanReadContracts(caller, row.organizationId);
        visible.push(row);
      } catch {
        // Denied rows are omitted — never an existence leak (IDOR posture).
      }
    }
    return visible;
  } catch (err) {
    throw toContractsAppError(err);
  }
}

export { ContractsAppError };
