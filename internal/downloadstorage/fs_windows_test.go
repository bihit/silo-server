//go:build windows

package downloadstorage

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStatFSAndDeviceOfOnWindows(t *testing.T) {
	dir := t.TempDir()
	stats, err := statFS(dir)
	if err != nil {
		t.Fatalf("statFS(%q) error = %v", dir, err)
	}
	if stats.total <= 0 || stats.used < 0 || stats.used > stats.total || stats.fsType == "" {
		t.Fatalf("statFS(%q) = %+v, want positive capacity and a filesystem name", dir, stats)
	}
	sub := filepath.Join(dir, "a", "b")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	a, err := deviceOf(dir)
	if err != nil {
		t.Fatalf("deviceOf(%q) error = %v", dir, err)
	}
	b, err := deviceOf(sub)
	if err != nil || a != b {
		t.Fatalf("deviceOf(%q) = %d, %v; want %d, the same volume", sub, b, err, a)
	}
}
