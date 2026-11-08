//go:build windows

package nfo

import (
	"context"
	"path/filepath"
	"testing"
)

// Kodi on Windows writes artwork references with backslashes and drive
// letters; they resolve while they stay inside the item's folders.
func TestArtResolverSourceWindowsPaths(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	movieDir := filepath.Join(root, "Movies", "Film (2001)")
	writeFile(t, filepath.Join(movieDir, ".actors", "Lead.png"), "img")
	writeFile(t, filepath.Join(movieDir, "extrafanart", "fanart1.jpg"), "img")
	writeFile(t, filepath.Join(root, "Movies", "outside.jpg"), "img")
	resolver := newArtResolver(newSidecarFinder(context.Background()), filepath.Join(movieDir, "movie.nfo"), []string{movieDir})

	for ref, want := range map[string]string{
		`.actors\Lead.png`:                             filepath.Join(movieDir, ".actors", "Lead.png"),
		`.\extrafanart\fanart1.jpg`:                    filepath.Join(movieDir, "extrafanart", "fanart1.jpg"),
		filepath.Join(movieDir, ".actors", "Lead.png"): filepath.Join(movieDir, ".actors", "Lead.png"),
		`..\outside.jpg`:                               "",
		filepath.Join(root, "Movies", "outside.jpg"):   "",
		`\\nas\share\poster.jpg`:                       "",
	} {
		if got := resolver.source(ref); artSourcePath(t, got) != want {
			t.Errorf("source(%q) = %q, want %q", ref, got, want)
		}
	}
}
