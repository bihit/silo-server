//go:build unix

package backup

import (
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// openNoFollow refuses to open a path whose last element is a symbolic link.
const openNoFollow = syscall.O_NOFOLLOW

// reopenAppend is the append flag a recovered restore journal is reopened
// with, so every record lands at its end.
const reopenAppend = os.O_APPEND

// pgRestoreReadsStdin reports that pg_restore reads an archive from a pipe.
const pgRestoreReadsStdin = true

// toolExt is the file name extension of the PostgreSQL client programs.
const toolExt = ""

// executableMode reports a file mode with an execute bit set.
func executableMode(mode os.FileMode) bool { return mode&0o111 != 0 }

// dirSyncUnsupported reports a directory sync the platform cannot do; on
// Unix every failure is real.
func dirSyncUnsupported(error) bool { return false }

// renameOpenFiles reports that a file this process holds open, and locked,
// can be renamed.
const renameOpenFiles = true

// diskSpace is what statDisk reads about the file system holding a path.
// Files 0 means the file system reports no inode limit.
type diskSpace struct {
	Free  uint64
	Files uint64
	Ffree uint64
}

// statDisk reads the space and inodes available to this user at dir.
func statDisk(dir string) (diskSpace, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(dir, &st); err != nil {
		return diskSpace{}, err
	}
	return diskSpace{Free: blockBytes(st.Bavail, st.Bsize), Files: uint64(st.Files), Ffree: uint64(st.Ffree)}, nil //nolint:gosec,unconvert // G115: counts the kernel reports are not negative; their types differ by platform
}

// lockExclusiveNonBlocking takes an advisory exclusive lock on f, failing
// immediately when another descriptor holds it.
func lockExclusiveNonBlocking(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}

// ownedByAnotherUser reports a file whose owner is not this process's user.
func ownedByAnotherUser(info os.FileInfo) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	return ok && int(st.Uid) != os.Getuid()
}

// writableByOthers reports a directory other users can write to without the
// sticky bit, where they could replace a file in it.
func writableByOthers(dir os.FileInfo) bool {
	return dir.Mode().Perm()&0o022 != 0 && dir.Mode()&os.ModeSticky == 0
}
