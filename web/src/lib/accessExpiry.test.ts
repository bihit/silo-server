import { describe, expect, it } from "vitest";

import { accessExpiryInputValue, accessExpiryInstant, accessExpiryPassed } from "./accessExpiry";

describe("accessExpiry", () => {
  it("stores the end of the picked day and reads the same day back", () => {
    const instant = accessExpiryInstant("2026-12-31");
    expect(instant).not.toBeNull();
    const at = new Date(instant!);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual(
      [2026, 11, 31, 23, 59],
    );
    expect(accessExpiryInputValue(instant)).toBe("2026-12-31");
  });

  it("treats an empty or malformed day as no end date", () => {
    expect(accessExpiryInstant("")).toBeNull();
    expect(accessExpiryInstant("31.12.2026")).toBeNull();
    expect(accessExpiryInputValue(null)).toBe("");
  });

  it("keeps today open until the day ends", () => {
    const now = new Date(2026, 9, 17, 12, 0, 0);
    expect(accessExpiryPassed("2026-10-17", now)).toBe(false);
    expect(accessExpiryPassed("2026-10-16", now)).toBe(true);
  });
});
