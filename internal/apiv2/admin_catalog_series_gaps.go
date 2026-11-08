package apiv2

import (
	"context"

	"github.com/Silo-Server/silo-server/internal/api/handlers"
)

type AdminSeriesGapsService interface {
	ListAdminSeriesGaps(context.Context) (*handlers.AdminSeriesGapsReport, error)
}

type AdminSeriesGapsInput struct{}

type AdminSeriesGapSeason struct {
	SeasonNumber     int   `json:"season_number" doc:"Season number"`
	Present          int   `json:"present" doc:"Distinct episode numbers present on disk"`
	FirstEpisode     int   `json:"first_episode" doc:"Number the season is counted from: 1, or the first present number under absolute numbering"`
	LastEpisode      int   `json:"last_episode" doc:"Number the season is checked up to: the highest present episode, or TMDB's last aired one when higher"`
	ExpectedEpisodes *int  `json:"expected_episodes,omitempty" doc:"Episodes of the season aired on TMDB; absent when TMDB was not consulted"`
	MissingCount     int   `json:"missing_count" doc:"Numbers missing between first_episode and last_episode"`
	Missing          []int `json:"missing" doc:"Missing episode numbers, at most 500"`
	Suspect          bool  `json:"suspect" doc:"More numbers missing between present episodes than present; usually a misnumbered file"`
	TMDBMismatch     bool  `json:"tmdb_mismatch" doc:"Present numbers run past TMDB's aired total"`
}

type AdminSeriesMissingSeason struct {
	SeasonNumber     int  `json:"season_number" doc:"Season number"`
	ExpectedEpisodes *int `json:"expected_episodes,omitempty" doc:"Episodes of the season aired on TMDB"`
}

type AdminSeriesGap struct {
	SeriesID       string                     `json:"series_id" doc:"Series content ID"`
	Title          string                     `json:"title"`
	Year           *int                       `json:"year,omitempty"`
	Libraries      []string                   `json:"libraries" doc:"Names of the libraries holding the series"`
	PresentSeasons int                        `json:"present_seasons" doc:"Regular seasons with at least one present episode"`
	MissingSeasons []AdminSeriesMissingSeason `json:"missing_seasons" doc:"Regular seasons without any present episode"`
	Seasons        []AdminSeriesGapSeason     `json:"seasons" doc:"Seasons with missing episodes"`
	TMDBChecked    bool                       `json:"tmdb_checked" doc:"TMDB's season totals were applied"`
	TMDBMismatch   bool                       `json:"tmdb_mismatch" doc:"Local numbering does not follow TMDB's seasons"`
}

type AdminSeriesGapsTMDB struct {
	Enabled bool `json:"enabled" doc:"An administrator's TMDB key drives the comparison"`
	Checked int  `json:"checked" doc:"Series with current TMDB season totals"`
	Failed  int  `json:"failed" doc:"Series TMDB could not match"`
	Total   int  `json:"total" doc:"Series with present episodes"`
}

type AdminSeriesGapsReport struct {
	Items []AdminSeriesGap    `json:"items" doc:"Series with missing episodes; empty, never null"`
	TMDB  AdminSeriesGapsTMDB `json:"tmdb" doc:"Progress of the background TMDB comparison"`
}

type AdminSeriesGapsOutput struct {
	Body AdminSeriesGapsReport
}

func registerAdminCatalogSeriesGaps(reg *Registry) {
	op := Operation{Operation: humaOp("GET", Prefix+"/admin/series-gaps", "listAdminSeriesGaps", "admin-catalog", "List series with missing episodes, from local numbering gaps and, where compared, TMDB's aired season totals."), Class: ClassActingAdmin, ServiceBacked: true}
	Register(reg, op, func(ctx context.Context, _ *AdminSeriesGapsInput) (*AdminSeriesGapsOutput, error) {
		if reg.deps.AdminSeriesGaps == nil {
			return nil, unavailable("series gaps")
		}
		report, err := reg.deps.AdminSeriesGaps.ListAdminSeriesGaps(ctx)
		if err != nil {
			return nil, serviceProblem(err)
		}
		items := make([]AdminSeriesGap, 0, len(report.Items))
		for _, r := range report.Items {
			seasons := make([]AdminSeriesGapSeason, 0, len(r.Seasons))
			for _, s := range r.Seasons {
				seasons = append(seasons, AdminSeriesGapSeason{
					SeasonNumber:     s.SeasonNumber,
					Present:          s.Present,
					FirstEpisode:     s.FirstEpisode,
					LastEpisode:      s.LastEpisode,
					ExpectedEpisodes: s.ExpectedEpisodes,
					MissingCount:     s.MissingCount,
					Missing:          NonNil(s.Missing),
					Suspect:          s.Suspect,
					TMDBMismatch:     s.TMDBMismatch,
				})
			}
			missingSeasons := make([]AdminSeriesMissingSeason, 0, len(r.MissingSeasons))
			for _, m := range r.MissingSeasons {
				missingSeasons = append(missingSeasons, AdminSeriesMissingSeason{SeasonNumber: m.SeasonNumber, ExpectedEpisodes: m.ExpectedEpisodes})
			}
			items = append(items, AdminSeriesGap{
				SeriesID:       r.SeriesID,
				Title:          r.Title,
				Year:           r.Year,
				Libraries:      NonNil(r.Libraries),
				PresentSeasons: r.PresentSeasons,
				MissingSeasons: missingSeasons,
				Seasons:        seasons,
				TMDBChecked:    r.TMDBChecked,
				TMDBMismatch:   r.TMDBMismatch,
			})
		}
		return &AdminSeriesGapsOutput{Body: AdminSeriesGapsReport{
			Items: items,
			TMDB: AdminSeriesGapsTMDB{
				Enabled: report.TMDB.Enabled,
				Checked: report.TMDB.Checked,
				Failed:  report.TMDB.Failed,
				Total:   report.TMDB.Total,
			},
		}}, nil
	})
}
