package api

import (
	"context"
	"log/slog"
	"time"
)

const (
	// seriesTMDBBatch is how many series one sweep pass compares with TMDB.
	seriesTMDBBatch = 200
	// seriesTMDBBusyInterval follows a pass that found work; the idle
	// interval follows one that found every series current.
	seriesTMDBBusyInterval = time.Minute
	seriesTMDBIdleInterval = 6 * time.Hour
)

type seriesTMDBRefresher interface {
	RefreshSeriesTMDBCounts(context.Context, int) (int, error)
}

// startSeriesTMDBSweep keeps the missing-episodes report's TMDB season totals
// current: shortly after startup, then in paced batches until every series
// is current, then every few hours, until appCtx ends.
func startSeriesTMDBSweep(appCtx context.Context, refresher seriesTMDBRefresher) {
	if appCtx == nil {
		appCtx = context.Background()
	}
	go func() {
		timer := time.NewTimer(2 * time.Minute)
		defer timer.Stop()
		for {
			select {
			case <-appCtx.Done():
				return
			case <-timer.C:
			}
			n, err := refresher.RefreshSeriesTMDBCounts(appCtx, seriesTMDBBatch)
			if err != nil && appCtx.Err() == nil {
				slog.WarnContext(appCtx, "series tmdb sweep failed", "component", "api", "recorded", n, "error", err)
			}
			next := seriesTMDBIdleInterval
			if n > 0 || err != nil {
				next = seriesTMDBBusyInterval
			}
			timer.Reset(next)
		}
	}()
}
