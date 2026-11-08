package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
)

// maxSeriesGapNumbers bounds the missing numbers listed for one season, so a
// single misnumbered file (S06E265) cannot balloon the response.
const maxSeriesGapNumbers = 500

// AdminSeriesGapSeason is one season with missing episode numbers.
type AdminSeriesGapSeason struct {
	SeasonNumber int
	Present      int
	FirstEpisode int
	// LastEpisode is the last number the season is checked up to: the
	// highest present episode, or TMDB's last aired one when that is higher.
	LastEpisode int
	// ExpectedEpisodes is how many episodes of the season TMDB says have
	// aired, nil when TMDB has not been consulted for the series.
	ExpectedEpisodes *int
	MissingCount     int
	Missing          []int
	// Suspect marks a season with more numbers missing between its present
	// episodes than present, which usually means a misnumbered file.
	Suspect bool
	// TMDBMismatch marks a season whose present numbers run past TMDB's
	// aired total, so local and TMDB numbering differ.
	TMDBMismatch bool
}

// AdminSeriesMissingSeason is a regular season without any present episode.
type AdminSeriesMissingSeason struct {
	SeasonNumber     int
	ExpectedEpisodes *int
}

// AdminSeriesGapView is one series with missing episodes or seasons.
type AdminSeriesGapView struct {
	SeriesID       string
	Title          string
	Year           *int
	Libraries      []string
	PresentSeasons int
	MissingSeasons []AdminSeriesMissingSeason
	Seasons        []AdminSeriesGapSeason
	// TMDBChecked reports whether TMDB's season totals were applied.
	TMDBChecked  bool
	TMDBMismatch bool
}

// AdminSeriesGapsTMDB summarizes the background TMDB comparison.
type AdminSeriesGapsTMDB struct {
	Enabled bool
	Checked int
	Failed  int
	Total   int
}

// AdminSeriesGapsReport is the whole missing-episodes report.
type AdminSeriesGapsReport struct {
	Items []AdminSeriesGapView
	TMDB  AdminSeriesGapsTMDB
}

// seriesPresentEpisodesQuery lists, per series and regular season, the
// distinct episode numbers present on disk. Multi-episode files cover their
// whole range. Specials (season 0) are skipped.
const seriesPresentEpisodesQuery = `
WITH present AS (
	SELECT e.series_id, e.season_number, e.episode_number AS ep
	FROM episodes e
	JOIN episode_libraries el ON el.episode_id = e.content_id
	WHERE e.season_number > 0 AND e.episode_number > 0
	UNION
	SELECT e.series_id, e.season_number, gs
	FROM media_files mf
	JOIN episodes e ON e.content_id = mf.episode_id
	JOIN episode_libraries el ON el.episode_id = e.content_id
	CROSS JOIN LATERAL generate_series(mf.multi_episode_start, mf.multi_episode_end) gs
	WHERE mf.missing_since IS NULL AND e.season_number > 0
	  AND mf.multi_episode_start > 0 AND mf.multi_episode_end > mf.multi_episode_start
	  AND mf.multi_episode_end - mf.multi_episode_start < 100
)
SELECT series_id, season_number, array_agg(ep ORDER BY ep)
FROM present
GROUP BY series_id, season_number
ORDER BY series_id, season_number`

const seriesGapDetailsQuery = `
SELECT mi.content_id, mi.title, mi.year,
       COALESCE((SELECT array_agg(DISTINCT mfo.name ORDER BY mfo.name)
                 FROM episodes e
                 JOIN episode_libraries el ON el.episode_id = e.content_id
                 JOIN media_folders mfo ON mfo.id = el.media_folder_id
                 WHERE e.series_id = mi.content_id), '{}')
FROM media_items mi
WHERE mi.content_id = ANY($1)`

const seriesTMDBCountsQuery = `
SELECT series_id, last_aired_season, last_aired_episode, seasons
FROM series_tmdb_episode_counts
WHERE error = '' AND tmdb_id IS NOT NULL`

// seriesTMDBExpectation is TMDB's aired episode total per regular season.
type seriesTMDBExpectation map[int]int

// ListAdminSeriesGaps reports every series with missing episodes: numbers
// missing between present episodes, and, where the background TMDB
// comparison has run, episodes after the last present one and whole seasons
// that have aired on TMDB but are absent.
func (h *AdminHandler) ListAdminSeriesGaps(ctx context.Context) (*AdminSeriesGapsReport, error) {
	if h == nil || h.pool == nil {
		return nil, apiError(http.StatusServiceUnavailable, "unavailable", "Database not configured")
	}
	failed := func() error {
		return apiError(http.StatusInternalServerError, "internal_error", "Failed to list series gaps")
	}

	present := map[string]map[int][]int32{}
	order := []string{}
	rows, err := h.pool.Query(ctx, seriesPresentEpisodesQuery)
	if err != nil {
		return nil, failed()
	}
	for rows.Next() {
		var seriesID string
		var season int
		var eps []int32
		if err := rows.Scan(&seriesID, &season, &eps); err != nil {
			rows.Close()
			return nil, failed()
		}
		if present[seriesID] == nil {
			present[seriesID] = map[int][]int32{}
			order = append(order, seriesID)
		}
		present[seriesID][season] = eps
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, failed()
	}

	expectations := map[string]seriesTMDBExpectation{}
	if rows, err = h.pool.Query(ctx, seriesTMDBCountsQuery); err != nil {
		return nil, failed()
	}
	for rows.Next() {
		var seriesID string
		var lastSeason, lastEpisode int
		var raw []byte
		if err := rows.Scan(&seriesID, &lastSeason, &lastEpisode, &raw); err != nil {
			rows.Close()
			return nil, failed()
		}
		var seasons []struct {
			Number       int `json:"season_number"`
			EpisodeCount int `json:"episode_count"`
		}
		if json.Unmarshal(raw, &seasons) != nil || lastSeason <= 0 {
			continue
		}
		exp := seriesTMDBExpectation{}
		for _, s := range seasons {
			switch {
			case s.Number <= 0 || s.Number > lastSeason:
			case s.Number < lastSeason:
				exp[s.Number] = s.EpisodeCount
			default:
				exp[s.Number] = min(s.EpisodeCount, lastEpisode)
			}
		}
		expectations[seriesID] = exp
	}
	rows.Close()
	if rows.Err() != nil {
		return nil, failed()
	}

	report := &AdminSeriesGapsReport{Items: []AdminSeriesGapView{}}
	for _, seriesID := range order {
		exp, checked := expectations[seriesID]
		view, ok := seriesGapView(present[seriesID], exp, checked)
		if !ok {
			continue
		}
		view.SeriesID = seriesID
		report.Items = append(report.Items, view)
	}
	if err := h.fillSeriesGapDetails(ctx, report.Items); err != nil {
		return nil, failed()
	}
	sort.SliceStable(report.Items, func(i, j int) bool { return report.Items[i].Title < report.Items[j].Title })

	if err := h.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE error = ''), count(*) FILTER (WHERE error <> '')
		FROM series_tmdb_episode_counts`).Scan(&report.TMDB.Checked, &report.TMDB.Failed); err != nil {
		return nil, failed()
	}
	report.TMDB.Total = len(order)
	report.TMDB.Enabled = h.SeriesTMDB != nil
	return report, nil
}

func (h *AdminHandler) fillSeriesGapDetails(ctx context.Context, items []AdminSeriesGapView) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	index := make(map[string]int, len(items))
	for i, item := range items {
		ids[i] = item.SeriesID
		index[item.SeriesID] = i
	}
	rows, err := h.pool.Query(ctx, seriesGapDetailsQuery, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, title string
		var year *int
		var libraries []string
		if err := rows.Scan(&id, &title, &year, &libraries); err != nil {
			return err
		}
		if i, ok := index[id]; ok {
			items[i].Title, items[i].Year, items[i].Libraries = title, year, libraries
		}
	}
	return rows.Err()
}

// seriesGapView compares one series' present episodes with its own numbering
// and, when checked, with TMDB's aired totals. A season whose first present
// number exceeds its present count uses absolute numbering (301-393) and is
// counted from its first present episode; TMDB totals do not apply to it.
func seriesGapView(seasons map[int][]int32, exp seriesTMDBExpectation, checked bool) (AdminSeriesGapView, bool) {
	view := AdminSeriesGapView{
		PresentSeasons: len(seasons),
		MissingSeasons: []AdminSeriesMissingSeason{},
		Seasons:        []AdminSeriesGapSeason{},
		TMDBChecked:    checked,
	}
	numbers := make([]int, 0, len(seasons))
	maxSeason := 0
	for n := range seasons {
		numbers = append(numbers, n)
		maxSeason = max(maxSeason, n)
	}
	sort.Ints(numbers)

	for _, n := range numbers {
		eps := seasons[n]
		first, last := int(eps[0]), int(eps[len(eps)-1])
		count := len(eps)
		start := 1
		if first-1 >= count {
			start = first
		}
		localMissing := last - start + 1 - count
		season := AdminSeriesGapSeason{
			SeasonNumber: n,
			Present:      count,
			FirstEpisode: start,
			LastEpisode:  last,
			Suspect:      localMissing > count,
		}
		if expected, ok := exp[n]; checked && ok && start == 1 {
			season.ExpectedEpisodes = new(expected)
			if last > expected {
				season.TMDBMismatch = true
				view.TMDBMismatch = true
			} else {
				season.LastEpisode = expected
			}
		}
		season.Missing = missingNumbers(start, season.LastEpisode, eps, maxSeriesGapNumbers)
		season.MissingCount = season.LastEpisode - start + 1 - count
		if season.MissingCount > 0 {
			view.Seasons = append(view.Seasons, season)
		}
	}

	missing := map[int]*int{}
	for n := 1; n < maxSeason; n++ {
		if _, ok := seasons[n]; !ok {
			missing[n] = nil
		}
	}
	// A mismatch means local numbering does not follow TMDB's seasons, so
	// TMDB's later seasons are not evidence of anything missing.
	if checked && !view.TMDBMismatch {
		for n, expected := range exp {
			if _, ok := seasons[n]; !ok && expected > 0 {
				missing[n] = new(expected)
			}
		}
	}
	for n, expected := range missing {
		if expected == nil {
			if e, ok := exp[n]; checked && ok {
				expected = new(e)
			}
		}
		view.MissingSeasons = append(view.MissingSeasons, AdminSeriesMissingSeason{SeasonNumber: n, ExpectedEpisodes: expected})
	}
	sort.Slice(view.MissingSeasons, func(i, j int) bool {
		return view.MissingSeasons[i].SeasonNumber < view.MissingSeasons[j].SeasonNumber
	})
	return view, len(view.Seasons) > 0 || len(view.MissingSeasons) > 0
}

// missingNumbers lists the numbers in [from, to] absent from have, at most
// limit of them.
func missingNumbers(from, to int, have []int32, limit int) []int {
	sorted := append([]int32(nil), have...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	out := make([]int, 0)
	i := 0
	for n := from; n <= to && len(out) < limit; n++ {
		for i < len(sorted) && int(sorted[i]) < n {
			i++
		}
		if i < len(sorted) && int(sorted[i]) == n {
			continue
		}
		out = append(out, n)
	}
	return out
}
