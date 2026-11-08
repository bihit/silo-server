//go:build !windows

package nfo

import (
	"os"
	"syscall"

	"github.com/Silo-Server/silo-server/internal/fspath"
)

func openNFONoFollow(path string) (*os.File, error) {
	return fspath.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK|syscall.O_NOFOLLOW, 0)
}
