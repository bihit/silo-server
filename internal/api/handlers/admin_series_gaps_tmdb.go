package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/Silo-Server/silo-server/internal/metadata/tmdb"
)

// SeriesTMDBClient is the TMDB surface the missing-episodes comparison uses.
type SeriesTMDBClient interface {
	GetTVEpisodeCounts(ctx context.Context, id int) (*tmdb.TVEpisodeCounts, error)
	FindByExternalID(ctx context.Context, source, externalID string) ([]tmdb.MediaResult, error)
}

// seriesTMDBRefreshAge is how long one series' TMDB totals stay current.
const seriesTMDBRefreshAge = 7 * 24 * time.Hour

// seriesTMDBRequestGap paces the comparison well below TMDB's rate limit, so
// it never crowds out the requests and collection features sharing the key.
const seriesTMDBRequestGap = 250 * time.Millisecond

const seriesTMDBDueQuery = `
SELECT mi.content_id, COALESCE(mi.tmdb_id, ''), COALESCE(mi.tvdb_id, ''), COALESCE(mi.imdb_id, '')
FROM media_items mi
LEFT JOIN series_tmdb_episode_counts c ON c.series_id = mi.content_id
WHERE mi.type = 'series'
  AND EXISTS (SELECT 1 FROM episodes e JOIN episode_libraries el ON el.episode_id = e.content_id
              WHERE e.series_id = mi.content_id)
  AND (c.series_id IS NULL OR c.fetched_at < now() - $1::interval
       -- A rematch that changed the series' TMDB ID makes its totals stale.
       OR (mi.tmdb_id ~ '^[0-9]{1,9}$' AND c.tmdb_id IS DISTINCT FROM mi.tmdb_id::integer))
ORDER BY c.fetched_at NULLS FIRST, mi.content_id
LIMIT $2`

const seriesTMDBUpsert = `
INSERT INTO series_tmdb_episode_counts
	(series_id, tmdb_id, status, last_aired_season, last_aired_episode, seasons, error, fetched_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (series_id) DO UPDATE SET
	tmdb_id = EXCLUDED.tmdb_id, status = EXCLUDED.status,
	last_aired_season = EXCLUDED.last_aired_season, last_aired_episode = EXCLUDED.last_aired_episode,
	seasons = EXCLUDED.seasons, error = EXCLUDED.error, fetched_at = now()`

// RefreshSeriesTMDBCounts stores TMDB's season totals for up to limit series
// that have none yet or whose totals are older than seriesTMDBRefreshAge. A
// series TMDB does not know is recorded with an error and retried only when
// it is due again; a transient failure is not recorded, so the next sweep
// retries it. It returns how many series it recorded.
func (h *AdminHandler) RefreshSeriesTMDBCounts(ctx context.Context, limit int) (int, error) {
	if h == nil || h.pool == nil || h.SeriesTMDB == nil {
		return 0, nil
	}
	type due struct{ id, tmdbID, tvdbID, imdbID string }
	rows, err := h.pool.Query(ctx, seriesTMDBDueQuery, seriesTMDBRefreshAge.String(), limit)
	if err != nil {
		return 0, err
	}
	var batch []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.tmdbID, &d.tvdbID, &d.imdbID); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	recorded := 0
	for _, d := range batch {
		if err := ctx.Err(); err != nil {
			return recorded, err
		}
		counts, tmdbID, failure, err := h.fetchSeriesTMDBCounts(ctx, d.tmdbID, d.tvdbID, d.imdbID)
		if err != nil {
			// Transient (network, rate limit, TMDB down): stop this batch and
			// let the next sweep retry.
			return recorded, err
		}
		var seasons []byte = []byte("[]")
		status, lastSeason, lastEpisode := "", 0, 0
		if counts != nil {
			if seasons, err = json.Marshal(counts.Seasons); err != nil {
				return recorded, err
			}
			status, lastSeason, lastEpisode = counts.Status, counts.LastAiredSeason, counts.LastAiredEpisode
		}
		var idArg *int
		if tmdbID > 0 {
			idArg = &tmdbID
		}
		if _, err := h.pool.Exec(ctx, seriesTMDBUpsert, d.id, idArg, status, lastSeason, lastEpisode, seasons, failure); err != nil {
			return recorded, err
		}
		recorded++
		select {
		case <-ctx.Done():
			return recorded, ctx.Err()
		case <-time.After(seriesTMDBRequestGap):
		}
	}
	return recorded, nil
}

// fetchSeriesTMDBCounts resolves the series' TMDB ID, through its TVDB or IMDb
// ID when it has none, and reads its season totals. failure names a lasting
// outcome (no ID, not found); err is a transient failure.
func (h *AdminHandler) fetchSeriesTMDBCounts(ctx context.Context, tmdbID, tvdbID, imdbID string) (*tmdb.TVEpisodeCounts, int, string, error) {
	id, _ := strconv.Atoi(strings.TrimSpace(tmdbID))
	if id <= 0 {
		for _, ext := range []struct{ source, value string }{{tmdb.ExternalSourceTVDB, tvdbID}, {tmdb.ExternalSourceIMDb, imdbID}} {
			if strings.TrimSpace(ext.value) == "" {
				continue
			}
			results, err := h.SeriesTMDB.FindByExternalID(ctx, ext.source, ext.value)
			if errors.Is(err, tmdb.ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, 0, "", err
			}
			for _, r := range results {
				if r.MediaType == "series" && r.ID > 0 {
					id = r.ID
					break
				}
			}
			if id > 0 {
				break
			}
		}
	}
	if id <= 0 {
		return nil, 0, "no_tmdb_id", nil
	}
	counts, err := h.SeriesTMDB.GetTVEpisodeCounts(ctx, id)
	if errors.Is(err, tmdb.ErrNotFound) {
		return nil, id, "not_found", nil
	}
	if err != nil {
		return nil, id, "", err
	}
	return counts, id, "", nil
}
