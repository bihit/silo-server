package handlers

import (
	"testing"
	"time"

	"github.com/Silo-Server/silo-server/internal/models"
)

func TestValidateAccessExpiry(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	past, future := now.Add(-time.Minute), now.Add(time.Hour)
	for _, tc := range []struct {
		name    string
		role    string
		enabled bool
		expires *time.Time
		field   string
	}{
		{name: "no end date", role: models.RoleUser, enabled: true},
		{name: "future end date", role: models.RoleUser, enabled: true, expires: &future},
		{name: "passed end date on a disabled account", role: models.RoleUser, expires: &past},
		{name: "passed end date on an enabled account", role: models.RoleUser, enabled: true, expires: &past, field: "access_expires_at"},
		{name: "end date exactly now", role: models.RoleUser, enabled: true, expires: &now, field: "access_expires_at"},
		{name: "admin with an end date", role: models.RoleAdmin, enabled: true, expires: &future, field: "access_expires_at"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateAccessExpiry(tc.role, tc.enabled, tc.expires, now)
			if tc.field == "" {
				if err != nil {
					t.Fatalf("validateAccessExpiry() = %v, want nil", err)
				}
				return
			}
			apiErr, ok := err.(*APIError)
			if !ok || apiErr.Field != tc.field {
				t.Fatalf("validateAccessExpiry() = %v, want a field error on %s", err, tc.field)
			}
		})
	}
}
