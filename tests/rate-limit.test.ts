import { afterEach, describe, expect, it } from "vitest";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

afterEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const results = Array.from({ length: 5 }, () => rateLimit("k1", 5, 60, 1_000));
    expect(results.every((r) => r.allowed)).toBe(true);
    expect(results[4]!.remaining).toBe(0);
  });

  it("blocks requests over the limit with retry-after", () => {
    for (let i = 0; i < 5; i++) rateLimit("k2", 5, 60, 1_000);
    const blocked = rateLimit("k2", 5, 60, 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window passes", () => {
    for (let i = 0; i < 3; i++) rateLimit("k3", 3, 60, 1_000);
    const withinWindow = rateLimit("k3", 3, 60, 30_000);
    expect(withinWindow.allowed).toBe(false);
    const afterWindow = rateLimit("k3", 3, 60, 61_001);
    expect(afterWindow.allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    for (let i = 0; i < 3; i++) rateLimit("kA", 3, 60, 1_000);
    expect(rateLimit("kA", 3, 60, 2_000).allowed).toBe(false);
    expect(rateLimit("kB", 3, 60, 2_000).allowed).toBe(true);
  });
});
