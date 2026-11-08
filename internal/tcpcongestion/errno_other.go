//go:build !unix

package tcpcongestion

import "syscall"

// errnoNames covers the errnos the socket options here can report. Off Unix
// there is no unix.ErrnoName, so the names come from this table.
var errnoNames = map[syscall.Errno]string{
	syscall.EACCES:      "EACCES",
	syscall.EBADF:       "EBADF",
	syscall.EBUSY:       "EBUSY",
	syscall.EINVAL:      "EINVAL",
	syscall.ENOENT:      "ENOENT",
	syscall.ENOMEM:      "ENOMEM",
	syscall.ENOPROTOOPT: "ENOPROTOOPT",
	syscall.EPERM:       "EPERM",
}

// errnoName returns the symbolic name of code, such as "EPERM", or "" when
// the table has none, so errorDetails falls back to the error text.
func errnoName(code syscall.Errno) string {
	return errnoNames[code]
}
