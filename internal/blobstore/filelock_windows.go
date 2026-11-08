//go:build windows

package blobstore

import (
	"errors"
	"math"
	"os"

	"golang.org/x/sys/windows"
)

// lockExclusiveNonBlocking takes an exclusive lock over the whole of f,
// failing immediately when another handle holds it. Windows locks are
// mandatory, but they bind other handles only: the writer keeps writing
// through the handle that holds the lock.
func lockExclusiveNonBlocking(f *os.File) error {
	var overlapped windows.Overlapped
	return windows.LockFileEx(windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, math.MaxUint32, math.MaxUint32, &overlapped)
}

// dirSyncUnsupported reports the error FlushFileBuffers returns for a
// directory handle. NTFS journals directory entries itself, and Windows has
// no call that flushes a directory opened for reading.
func dirSyncUnsupported(err error) bool {
	return errors.Is(err, windows.ERROR_ACCESS_DENIED) || errors.Is(err, windows.ERROR_INVALID_HANDLE)
}

// hardLinkUnsupported reports CreateHardLink errors from a volume that takes
// no hard links (FAT and exFAT, some SMB shares) or a file at its link limit.
func hardLinkUnsupported(err error) bool {
	return errors.Is(err, windows.ERROR_NOT_SUPPORTED) || errors.Is(err, windows.ERROR_INVALID_FUNCTION) || errors.Is(err, windows.ERROR_TOO_MANY_LINKS)
}
