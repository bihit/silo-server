import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSeriesGap } from "@/api/v2/adminSeriesGaps";
import AdminSeriesGaps from "./AdminSeriesGaps";

const items: AdminSeriesGap[] = [
  {
    series_id: "series-1",
    title: "Lückenserie",
    year: 2001,
    libraries: ["Serien"],
    present_seasons: 2,
    missing_seasons: [{ season_number: 2, expected_episodes: 8 }],
    tmdb_checked: true,
    tmdb_mismatch: false,
    seasons: [
      {
        season_number: 1,
        present: 6,
        first_episode: 1,
        last_episode: 10,
        expected_episodes: 10,
        missing_count: 4,
        missing: [3, 7, 8, 9],
        suspect: false,
        tmdb_mismatch: false,
      },
    ],
  },
  {
    series_id: "series-2",
    title: "Falsch nummeriert",
    libraries: ["Anime"],
    present_seasons: 1,
    missing_seasons: [],
    tmdb_checked: false,
    tmdb_mismatch: false,
    seasons: [
      {
        season_number: 6,
        present: 2,
        first_episode: 1,
        last_episode: 265,
        missing_count: 263,
        missing: [2, 3],
        suspect: true,
        tmdb_mismatch: false,
      },
    ],
  },
];

vi.mock("@/hooks/queries/admin/seriesGaps", () => ({
  useAdminSeriesGaps: () => ({
    data: { items, tmdb: { enabled: true, checked: 10, failed: 1, total: 20 } },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

describe("AdminSeriesGaps", () => {
  beforeEach(() => {
    render(
      <MemoryRouter>
        <AdminSeriesGaps />
      </MemoryRouter>,
    );
  });

  it("lists missing episodes, missing seasons and the TMDB progress", () => {
    expect(screen.getByRole("link", { name: "Lückenserie (2001)" })).toHaveAttribute(
      "href",
      "/item/series-1",
    );
    expect(screen.getByText("E03, E07–E09")).toBeInTheDocument();
    expect(screen.getByText("S02 (8 Folgen)")).toBeInTheDocument();
    expect(screen.getByText(/6 vorhanden von 10 laut TMDB/)).toBeInTheDocument();
    expect(screen.getByText(/11 von 20 Serien geprüft/)).toBeInTheDocument();
    expect(screen.getByText("Nummerierung prüfen")).toBeInTheDocument();
    expect(screen.getByText(/und 261 weitere/)).toBeInTheDocument();
  });

  it("hides seasons with suspect numbering on request", () => {
    fireEvent.click(screen.getByRole("switch", { name: "Auffällige Nummerierung anzeigen" }));
    expect(screen.queryByText("Falsch nummeriert")).not.toBeInTheDocument();
    expect(screen.getByText("Lückenserie (2001)")).toBeInTheDocument();
  });

  it("filters by title", () => {
    fireEvent.change(screen.getByLabelText("Serie suchen"), { target: { value: "falsch" } });
    expect(screen.queryByText("Lückenserie (2001)")).not.toBeInTheDocument();
    expect(screen.getByText("Falsch nummeriert")).toBeInTheDocument();
  });
});
