//go:build unix

package tcpcongestion

import (
	"syscall"

	"golang.org/x/sys/unix"
)

// errnoName returns the symbolic name of code, such as "EPERM", or "" when
// the platform has none.
func errnoName(code syscall.Errno) string {
	return unix.ErrnoName(code)
}
