/**
 * Unit tests — employee/employment number validation (ADR-010 §4).
 * Pure domain: org-scoped, format-validated identifiers.
 */
import { describe, expect, it } from "vitest";
import {
  assertEmployeeNo,
  assertEmploymentNo,
  isValidEmployeeNo,
  isValidEmploymentNo,
  maskNumber,
} from "@/modules/workforce/domain/employee-number";
import { WorkforceDomainError } from "@/modules/workforce/domain/errors";

describe("employee number format", () => {
  it("accepts the canonical PREFIX-YY-NNNNN shape", () => {
    expect(isValidEmployeeNo("EMP-26-00001")).toBe(true);
    expect(isValidEmployeeNo("HQ12-25-123")).toBe(true);
    expect(isValidEmployeeNo("AB-99-12345678")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidEmployeeNo("emp-26-00001")).toBe(false); // lowercase
    expect(isValidEmployeeNo("EMP-26-1")).toBe(false); // sequence too short
    expect(isValidEmployeeNo("EMP-26-")).toBe(false); // no sequence
    expect(isValidEmployeeNo("EMP-2026-00001")).toBe(false); // year must be 2 digits
    expect(isValidEmployeeNo("EMP2600001")).toBe(false); // missing separators
    expect(isValidEmployeeNo("-26-00001")).toBe(false); // empty prefix
    expect(isValidEmployeeNo("")).toBe(false);
    expect(isValidEmployeeNo("EMP-26-00001EXTRA")).toBe(false);
  });

  it("throws EMPLOYEE_NUMBER_INVALID with a helpful message", () => {
    expect(() => assertEmployeeNo("bad")).toThrow(WorkforceDomainError);
    try {
      assertEmployeeNo("bad");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WorkforceDomainError).code).toBe("EMPLOYEE_NUMBER_INVALID");
    }
  });
});

describe("employment number format", () => {
  it("accepts the canonical shape", () => {
    expect(isValidEmploymentNo("EMP-26-00001")).toBe(true);
    expect(isValidEmploymentNo("CON-25-00042")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidEmploymentNo("EMP-26-00001")).toBe(true); // sanity
    expect(isValidEmploymentNo("EMP_26_00001")).toBe(false);
    expect(isValidEmploymentNo("EMP-26-00001-9")).toBe(false);
  });

  it("throws EMPLOYMENT_NUMBER_INVALID", () => {
    expect(() => assertEmploymentNo("nope")).toThrow(WorkforceDomainError);
    try {
      assertEmploymentNo("nope");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WorkforceDomainError).code).toBe("EMPLOYMENT_NUMBER_INVALID");
    }
  });
});

describe("maskNumber", () => {
  it("keeps the prefix and year, masks the sequence tail", () => {
    expect(maskNumber("EMP-26-00001")).toBe("EMP-26-•••01");
  });

  it("falls back to a generic mask for unparseable input", () => {
    expect(maskNumber("garbage")).toBe("••••");
  });
});
