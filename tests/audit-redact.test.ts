import { describe, expect, it } from "vitest";
import { redactForAudit } from "@/lib/audit";

describe("redactForAudit", () => {
  it("redacts password fields at any depth", () => {
    const result = redactForAudit({
      name: "Login attempt",
      credentials: { password: "hunter2", username: "dr.x" },
    });
    expect(result).toEqual({
      name: "Login attempt",
      credentials: { password: "[redacted]", username: "dr.x" },
    });
  });

  it("redacts tokens, secrets, and national IDs", () => {
    const result = redactForAudit({
      token: "abc",
      mfa_secret: "def",
      citizenshipNo: "12-34-56-78901",
      passport_no: "PA123",
      otp: "123456",
    });
    expect(result).toEqual({
      token: "[redacted]",
      mfa_secret: "[redacted]",
      citizenshipNo: "[redacted]",
      passport_no: "[redacted]",
      otp: "[redacted]",
    });
  });

  it("keeps non-sensitive values intact", () => {
    const result = redactForAudit({ salary: 75000, status: "ACTIVE" });
    expect(result).toEqual({ salary: 75000, status: "ACTIVE" });
  });

  it("handles nested arrays and objects without throwing", () => {
    const result = redactForAudit({
      items: [{ password: "x", keep: 1 }, "scalar", [{ token: "y" }]],
    });
    expect(result).toBeDefined();
    const items = (result as { items: { items: unknown[] } }).items.items;
    expect(items[0]).toEqual({ password: "[redacted]", keep: 1 });
  });

  it("returns undefined for null/undefined input", () => {
    expect(redactForAudit(null)).toBeUndefined();
    expect(redactForAudit(undefined)).toBeUndefined();
  });

  it("bounds depth to prevent runaway payloads", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 50; i++) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const result = redactForAudit(deep) as { next?: unknown };
    expect(JSON.stringify(result)).toContain("[truncated]");
  });
});
