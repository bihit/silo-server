package tmdb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestReadAccessTokenTravelsAsBearer(t *testing.T) {
	const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("api_key"); got != "" {
			t.Errorf("api_key query = %q, want none for a read access token", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+token {
			t.Errorf("Authorization = %q, want the bearer token", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":7,"status":"Returning Series","seasons":[{"season_number":0,"episode_count":2},{"season_number":1,"episode_count":10},{"season_number":2,"episode_count":8}],"last_episode_to_air":{"season_number":2,"episode_number":5}}`))
	}))
	defer srv.Close()

	c := NewClient(token, 10)
	defer c.Close()
	c.SetBaseURL(srv.URL)
	got, err := c.GetTVEpisodeCounts(context.Background(), 7)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastAiredSeason != 2 || got.LastAiredEpisode != 5 || len(got.Seasons) != 3 || got.Seasons[1].EpisodeCount != 10 {
		t.Fatalf("counts = %+v", got)
	}
}

func TestIsReadAccessToken(t *testing.T) {
	if isReadAccessToken("4ef0d7355d9ffb5151e987764708ce96") {
		t.Fatal("v3 key taken for a read access token")
	}
	if !isReadAccessToken("eyJa.eyJb.c") {
		t.Fatal("JWT not recognized")
	}
}
