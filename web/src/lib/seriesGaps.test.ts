// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatEpisodeRanges, seasonLabel } from "./seriesGaps";

describe("formatEpisodeRanges", () => {
  it("compresses consecutive numbers into ranges", () => {
    expect(formatEpisodeRanges([3, 7, 8, 9, 12])).toBe("E03, E07–E09, E12");
  });

  it("keeps three-digit numbers", () => {
    expect(formatEpisodeRanges([101, 102])).toBe("E101–E102");
  });

  it("returns an empty string for no numbers", () => {
    expect(formatEpisodeRanges([])).toBe("");
  });
});

describe("seasonLabel", () => {
  it("pads the season number", () => {
    expect(seasonLabel(2)).toBe("S02");
  });
});
