package api

import (
	"context"
	"log/slog"
	"time"
)

// accountExpiryInterval is how often expired accounts are disabled. An
// account whose end date passes keeps working for at most this long.
const accountExpiryInterval = time.Minute

type accountExpirer interface {
	ExpireAccounts(context.Context) (int, error)
}

// startAccountExpirySweep disables ordinary accounts whose end date has
// passed, once shortly after startup and then every accountExpiryInterval,
// until appCtx ends. Each replica may run it: the disable re-checks the
// account under its row lock, so a second replica finds nothing left to do.
func startAccountExpirySweep(appCtx context.Context, expirer accountExpirer) {
	if appCtx == nil {
		appCtx = context.Background()
	}
	go func() {
		timer := time.NewTimer(15 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-appCtx.Done():
				return
			case <-timer.C:
			}
			if _, err := expirer.ExpireAccounts(appCtx); err != nil && appCtx.Err() == nil {
				slog.WarnContext(appCtx, "account expiry sweep failed", "component", "api", "error", err)
			}
			timer.Reset(accountExpiryInterval)
		}
	}()
}
