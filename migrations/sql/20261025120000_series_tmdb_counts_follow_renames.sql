-- +goose Up
-- Matching a local item renames its content_id (local-… → series-tvdb-…).
-- The foreign key must follow that rename like the other media_items
-- references do, or the rename and with it the match fails.
ALTER TABLE series_tmdb_episode_counts
    DROP CONSTRAINT IF EXISTS series_tmdb_episode_counts_series_id_fkey;
ALTER TABLE series_tmdb_episode_counts
    ADD CONSTRAINT series_tmdb_episode_counts_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES media_items (content_id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- +goose Down
ALTER TABLE series_tmdb_episode_counts
    DROP CONSTRAINT IF EXISTS series_tmdb_episode_counts_series_id_fkey;
ALTER TABLE series_tmdb_episode_counts
    ADD CONSTRAINT series_tmdb_episode_counts_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES media_items (content_id)
    ON DELETE CASCADE;
