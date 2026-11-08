package pluginhost

import (
	"runtime"
	"strings"
)

// windowsProcessEnvNames are the variables a Windows process needs beyond
// processEnvNames: the system directory (DLL loading, Winsock, crypto),
// temp and profile directories, and executable lookup. Windows names are
// case-insensitive and commonly spelled "Path" or "SystemRoot", so they are
// matched upper-cased.
var windowsProcessEnvNames = map[string]bool{
	"PATH":         true,
	"PATHEXT":      true,
	"SYSTEMROOT":   true,
	"WINDIR":       true,
	"SYSTEMDRIVE":  true,
	"COMSPEC":      true,
	"TEMP":         true,
	"TMP":          true,
	"USERPROFILE":  true,
	"LOCALAPPDATA": true,
	"APPDATA":      true,
	"PROGRAMDATA":  true,
}

// processEnvAllowed reports whether a server variable named name is passed
// to plugin processes.
func processEnvAllowed(name string) bool {
	if processEnvNames[name] || strings.HasPrefix(name, "LC_") {
		return true
	}
	return runtime.GOOS == "windows" && windowsProcessEnvNames[strings.ToUpper(name)]
}
