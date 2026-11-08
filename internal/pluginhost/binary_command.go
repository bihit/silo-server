package pluginhost

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// RunnableBinary lets cmd start a plugin binary stored without an extension
// ("plugin") on Windows. exec refuses such a path there, and CreateProcess
// would append ".exe" to it; a trailing dot names the same file while telling
// CreateProcess not to. Elsewhere, or when the file is missing, cmd is
// returned unchanged.
func RunnableBinary(cmd *exec.Cmd, path string) *exec.Cmd {
	if runtime.GOOS != "windows" || filepath.Ext(path) != "" {
		return cmd
	}
	if info, err := os.Stat(path); err != nil || info.IsDir() {
		return cmd
	}
	cmd.Path = path + "."
	cmd.Err = nil
	return cmd
}
