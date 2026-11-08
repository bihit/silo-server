package tmdb

import (
	"context"
	"fmt"
)

// TVEpisodeCounts is how many episodes TMDB lists per season of a series, and
// the last episode that has aired.
type TVEpisodeCounts struct {
	ID     int
	Status string
	// LastAiredSeason and LastAiredEpisode are zero when nothing has aired.
	LastAiredSeason  int
	LastAiredEpisode int
	Seasons          []SeasonEpisodeCount
}

// SeasonEpisodeCount is one season's episode total on TMDB.
type SeasonEpisodeCount struct {
	Number       int    `json:"season_number"`
	EpisodeCount int    `json:"episode_count"`
	AirDate      string `json:"air_date"`
}

type tvEpisodeCountsResponse struct {
	ID               int                  `json:"id"`
	Status           string               `json:"status"`
	Seasons          []SeasonEpisodeCount `json:"seasons"`
	LastEpisodeToAir *struct {
		SeasonNumber  int `json:"season_number"`
		EpisodeNumber int `json:"episode_number"`
	} `json:"last_episode_to_air"`
}

// GetTVEpisodeCounts reads a series' season episode totals without the
// credits, ratings and recommendations GetMediaDetail appends.
func (c *Client) GetTVEpisodeCounts(ctx context.Context, id int) (*TVEpisodeCounts, error) {
	if id <= 0 {
		return nil, fmt.Errorf("tmdb: series id must be > 0 (got %d)", id)
	}
	var resp tvEpisodeCountsResponse
	if err := c.doGet(ctx, fmt.Sprintf("/tv/%d", id), &resp); err != nil {
		return nil, err
	}
	out := &TVEpisodeCounts{ID: resp.ID, Status: resp.Status, Seasons: resp.Seasons}
	if resp.LastEpisodeToAir != nil {
		out.LastAiredSeason = resp.LastEpisodeToAir.SeasonNumber
		out.LastAiredEpisode = resp.LastEpisodeToAir.EpisodeNumber
	}
	return out, nil
}
