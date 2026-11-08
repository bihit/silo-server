//go:build windows

package jellycompat

import (
	"errors"

	"golang.org/x/sys/windows"
)

// stillActive is the exit code GetExitCodeProcess reports for a process that
// has not exited (STILL_ACTIVE).
const stillActive = 259

// processIsRunningBySignal mirrors kill(pid, 0) on Windows: the process
// exists when it can be opened and has no exit code yet. A process another
// account owns cannot be queried, which counts as running, like EPERM.
func processIsRunningBySignal(pid int) bool {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer func() { _ = windows.CloseHandle(h) }()
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err != nil {
		return true
	}
	return code == stillActive
}
