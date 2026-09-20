/**
 * Unit tests for the notifications domain (Slice 1.0).
 * Pure helpers: read state, unread counts, recency ordering/capping.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_NOTIFICATION_LIMIT,
  isRead,
  readState,
  recentOf,
  unreadCountOf,
  type NotificationRow,
} from "@/modules/notifications/domain/notifications";

function row(id: string, readAt: string | null, createdAt: string): NotificationRow {
  return {
    id,
    notificationType: "test.type",
    title: `t-${id}`,
    message: null,
    href: null,
    entityType: null,
    entityId: null,
    readAt,
    createdAt,
  };
}

describe("notification read state", () => {
  it("readAt drives read/unread classification", () => {
    const unread = row("a", null, "2026-01-01T00:00:00.000Z");
    const read = row("b", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    expect(isRead(unread)).toBe(false);
    expect(isRead(read)).toBe(true);
    expect(readState(unread)).toBe("unread");
    expect(readState(read)).toBe("read");
  });

  it("counts only unread items", () => {
    expect(
      unreadCountOf([
        row("a", null, "2026-01-01T00:00:00.000Z"),
        row("b", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
        row("c", null, "2026-01-03T00:00:00.000Z"),
      ]),
    ).toBe(2);
    expect(unreadCountOf([])).toBe(0);
  });
});

describe("recentOf", () => {
  it("caps to the configured limit and never exceeds MAX_NOTIFICATION_LIMIT", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      row(String(i), null, `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`),
    );
    const tail = recentOf(many, 12);
    expect(tail).toHaveLength(12);
    // Global cap: even a huge limit never exceeds MAX_NOTIFICATION_LIMIT (50).
    expect(recentOf(many, 999)).toHaveLength(50);
    expect(recentOf(many, 999)[0]!.id).toBe("59");
  });

  it("sorts most-recent-first and keeps unread ahead of read", () => {
    const olderUnread = row("a", null, "2026-01-01T00:00:00.000Z");
    const theNews = row("b", "2026-01-05T00:00:00.000Z", "2026-01-05T00:00:00.000Z");
    const sorted = recentOf([theNews, olderUnread], 10);
    expect(sorted[0]!.id).toBe("a"); // unread surfaces first despite being older
    expect(sorted.length).toBe(2);
  });

  it("treats limit 0/negative as a sane floor", () => {
    const items = [row("a", null, "2026-01-01T00:00:00.000Z")];
    expect(recentOf(items, 0).length).toBeGreaterThan(0);
    expect(recentOf(items, -5).length).toBeGreaterThan(0);
    expect(MAX_NOTIFICATION_LIMIT).toBe(50);
  });
});
