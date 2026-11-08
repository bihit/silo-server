//go:build windows

package jellycompat

import (
	"strconv"

	"golang.org/x/sys/windows"
)

// processToken identifies a process instance by its creation time, so a
// reused PID does not match a recorded operation.
func processToken(pid int) string {
	if pid <= 0 {
		return ""
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer func() { _ = windows.CloseHandle(h) }()
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(h, &created, &exited, &kernel, &user); err != nil {
		return ""
	}
	return strconv.FormatInt(created.Nanoseconds(), 10)
}
