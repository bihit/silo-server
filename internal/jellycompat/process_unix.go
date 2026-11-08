//go:build unix

package jellycompat

import (
	"errors"
	"syscall"
)

func processIsRunningBySignal(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
