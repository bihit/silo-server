-- +goose Up
-- TMDB's per-season episode totals for each series, refreshed in the
-- background, so the admin missing-episodes report can name episodes missing
-- after the last present one and seasons missing entirely without calling
-- TMDB on every page load. seasons holds [{season_number, episode_count}].
-- last_aired_* bound what has aired; both are 0 when nothing has. error keeps
-- the last failure so a series TMDB does not know is not retried every sweep.
CREATE TABLE IF NOT EXISTS series_tmdb_episode_counts (
    series_id text PRIMARY KEY REFERENCES media_items (content_id) ON DELETE CASCADE,
    tmdb_id integer,
    status text NOT NULL DEFAULT '',
    last_aired_season integer NOT NULL DEFAULT 0,
    last_aired_episode integer NOT NULL DEFAULT 0,
    seasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    error text NOT NULL DEFAULT '',
    fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS series_tmdb_episode_counts_fetched_at_idx
    ON series_tmdb_episode_counts (fetched_at);

-- +goose Down
DROP TABLE IF EXISTS series_tmdb_episode_counts;
