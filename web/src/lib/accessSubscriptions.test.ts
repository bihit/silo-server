import { describe, expect, it } from "vitest";

import type { AdminUser } from "@/api/types";
import {
  accessSubscriptionOf,
  accessSubscriptionRemainingLabel,
  classifyAccessSubscriptions,
  countAccessSubscriptions,
} from "./accessSubscriptions";

function user(id: number, username: string, accessExpiresAt: string | null): AdminUser {
  return { id, username, access_expires_at: accessExpiresAt } as AdminUser;
}

describe("classifyAccessSubscriptions", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  it("sorts ended, soon, active and unlimited accounts", () => {
    const rows = classifyAccessSubscriptions(
      [
        user(1, "zoe", null),
        user(2, "anna", null),
        user(3, "later", "2027-03-01T22:59:59.999Z"),
        user(4, "soon", "2026-11-05T22:59:59.999Z"),
        user(5, "ended", "2026-10-30T22:59:59.999Z"),
        user(6, "sooner", "2026-11-02T22:59:59.999Z"),
      ],
      now,
    );

    expect(rows.map((r) => [r.user.username, r.state, r.daysLeft])).toEqual([
      ["ended", "expired", 0],
      ["sooner", "soon", 2],
      ["soon", "soon", 5],
      ["later", "active", 121],
      ["anna", "none", null],
      ["zoe", "none", null],
    ]);
  });

  it("counts the 14th day as soon and the 15th as active", () => {
    const rows = classifyAccessSubscriptions(
      [
        user(1, "day14", new Date(now.getTime() + 14 * 86_400_000).toISOString()),
        user(2, "day15", new Date(now.getTime() + 15 * 86_400_000).toISOString()),
      ],
      now,
    );
    expect(rows.map((r) => [r.user.username, r.state])).toEqual([
      ["day14", "soon"],
      ["day15", "active"],
    ]);
  });

  it("treats an unreadable end date as no end date", () => {
    const rows = classifyAccessSubscriptions([user(1, "x", "not-a-date")], now);
    expect(rows[0]?.state).toBe("none");
  });
});

describe("accessSubscriptionOf", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  it("labels the remaining time", () => {
    expect(accessSubscriptionRemainingLabel(accessSubscriptionOf(null, now))).toBe("unbefristet");
    expect(
      accessSubscriptionRemainingLabel(accessSubscriptionOf("2026-10-31T22:59:59.999Z", now)),
    ).toBe("beendet");
    expect(
      accessSubscriptionRemainingLabel(accessSubscriptionOf("2026-11-02T10:00:00.000Z", now)),
    ).toBe("noch 1 Tag");
  });

  it("counts accounts per state", () => {
    const users = [
      { access_expires_at: null },
      { access_expires_at: "2026-11-03T00:00:00Z" },
      { access_expires_at: "2027-01-01T00:00:00Z" },
      { access_expires_at: "2026-10-01T00:00:00Z" },
      { access_expires_at: null },
    ] as AdminUser[];
    expect(countAccessSubscriptions(users, now)).toEqual({
      expired: 1,
      soon: 1,
      active: 1,
      none: 2,
    });
  });
});
