//go:build unix

package blobstore

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// lockExclusiveNonBlocking takes an advisory exclusive lock on f, failing
// immediately when another descriptor holds it.
func lockExclusiveNonBlocking(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

// dirSyncUnsupported reports directory-sync errors the platform raises for
// filesystems that cannot flush a directory; EINVAL and ENOTSUP cover Unix.
func dirSyncUnsupported(error) bool { return false }

// hardLinkUnsupported reports link(2) errors from a filesystem that takes no
// hard links (exFAT, some SMB and FUSE mounts answer EPERM).
func hardLinkUnsupported(err error) bool {
	return errors.Is(err, unix.EPERM) || errors.Is(err, unix.ENOTSUP) || errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.EMLINK)
}
