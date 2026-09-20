/**
 * Employee / employment number format validation (pure; ADR-010 §4).
 *
 * Numbering is org-scoped and format-validated, NOT DB-sequenced: a global
 * auto-increment would leak headcount across tenants. Allocation strategy
 * stays configuration, not schema — services validate format + uniqueness;
 * a sequence generator may be added later behind the same interface.
 *
 * Accepted canonical shape (per plan §2): `PREFIX-YY-NNNNN` where
 * - PREFIX: 2–10 uppercase letters/digits (org-defined),
 * - YY: two-digit year context,
 * - NNNNN: 3–8 digit sequence.
 */
import { WorkforceDomainError } from "./errors";

const EMPLOYEE_NO_PATTERN = /^[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/;
const EMPLOYMENT_NO_PATTERN = /^[A-Z0-9]{2,10}-\d{2}-\d{3,8}$/;

export function isValidEmployeeNo(employeeNo: string): boolean {
  return EMPLOYEE_NO_PATTERN.test(employeeNo);
}

export function isValidEmploymentNo(employmentNo: string): boolean {
  return EMPLOYMENT_NO_PATTERN.test(employmentNo);
}

export function assertEmployeeNo(employeeNo: string): void {
  if (!isValidEmployeeNo(employeeNo)) {
    throw new WorkforceDomainError(
      "EMPLOYEE_NUMBER_INVALID",
      "employeeNo must match PREFIX-YY-NNNNN (2–10 uppercase alphanumerics, 2-digit year, 3–8 digit sequence)",
    );
  }
}

export function assertEmploymentNo(employmentNo: string): void {
  if (!isValidEmploymentNo(employmentNo)) {
    throw new WorkforceDomainError(
      "EMPLOYMENT_NUMBER_INVALID",
      "employmentNo must match PREFIX-YY-NNNNN (2–10 uppercase alphanumerics, 2-digit year, 3–8 digit sequence)",
    );
  }
}

/**
 * Masked display form for list views / audit payloads (plan §7): identifiers
 * are INTERNAL classification, but we still avoid echoing full sequences
 * into audit before/after where a masked form suffices.
 */
export function maskNumber(no: string): string {
  const match = /^([A-Z0-9]{2,10}-\d{2}-)(\d{3,8})$/.exec(no);
  if (!match) return "••••";
  const digits = match[2];
  const tail = digits.slice(-2);
  return `${match[1]}•••${tail}`;
}
