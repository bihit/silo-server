//go:build windows

package backup

import (
	"errors"
	"math"
	"os"

	"golang.org/x/sys/windows"
)

// openNoFollow is zero on Windows, which has no O_NOFOLLOW; the restore
// journal lives in the operator's own working directory there.
const openNoFollow = 0

// reopenAppend is 0 on Windows: Go opens an O_APPEND file without
// FILE_WRITE_DATA, so cutting a torn record with Truncate would be refused.
// The reopened journal seeks to its end instead.
const reopenAppend = 0

// pgRestoreReadsStdin is false on Windows: pg_restore opens stdin in text
// mode there and rejects a custom-format archive's header ("unsupported
// version in file header"), so the table of contents is read from a file.
const pgRestoreReadsStdin = false

// toolExt is the file name extension of the PostgreSQL client programs.
const toolExt = ".exe"

// executableMode is true on Windows, which has no execute bits: the .exe
// name is what makes a program runnable there.
func executableMode(os.FileMode) bool { return true }

// dirSyncUnsupported reports the error FlushFileBuffers returns for a
// directory handle. NTFS journals directory entries itself, and Windows has
// no call that flushes a directory opened for reading.
func dirSyncUnsupported(err error) bool {
	return errors.Is(err, windows.ERROR_ACCESS_DENIED) || errors.Is(err, windows.ERROR_INVALID_HANDLE)
}

// renameOpenFiles is false on Windows: Go opens files without
// FILE_SHARE_DELETE, so a file this process holds open cannot be renamed.
const renameOpenFiles = false

// diskSpace is what statDisk reads about the file system holding a path.
// Files 0 means the file system reports no inode limit, as NTFS does.
type diskSpace struct {
	Free  uint64
	Files uint64
	Ffree uint64
}

// statDisk reads the space available to this user at dir.
func statDisk(dir string) (diskSpace, error) {
	p, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return diskSpace{}, err
	}
	var free, total, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &free, &total, &totalFree); err != nil {
		return diskSpace{}, err
	}
	return diskSpace{Free: free}, nil
}

// lockExclusiveNonBlocking takes an exclusive lock over the whole of f,
// failing immediately when another handle holds it.
func lockExclusiveNonBlocking(f *os.File) error {
	var overlapped windows.Overlapped
	return windows.LockFileEx(windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, math.MaxUint32, math.MaxUint32, &overlapped)
}

// ownedByAnotherUser is false on Windows: ownership lives in the file's ACL,
// which os.FileInfo does not carry.
func ownedByAnotherUser(os.FileInfo) bool { return false }

// writableByOthers is false on Windows, where directory permission bits are
// synthesized and the ACL decides who may write.
func writableByOthers(os.FileInfo) bool { return false }
