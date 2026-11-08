//go:build windows

package nfo

import (
	"os"
	"syscall"

	"github.com/Silo-Server/silo-server/internal/fspath"
)

// openNFONoFollow refuses a symlink the way O_NOFOLLOW does elsewhere, by
// answering ELOOP. Windows has no O_NOFOLLOW or FIFOs in ordinary
// directories, so there is nothing to open without blocking; the caller's
// regular-file check on the opened handle still applies.
func openNFONoFollow(path string) (*os.File, error) {
	info, err := fspath.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, &os.PathError{Op: "open", Path: path, Err: syscall.ELOOP}
	}
	return fspath.OpenFile(path, os.O_RDONLY, 0)
}
