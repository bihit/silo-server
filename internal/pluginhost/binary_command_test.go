package pluginhost

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestRunnableBinaryStartsExtensionlessFile(t *testing.T) {
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "plugin")
	if err := os.WriteFile(path, data, 0o755); err != nil {
		t.Fatal(err)
	}
	// The copied test binary runs no tests for a pattern that matches none.
	cmd := RunnableBinary(exec.Command(path, "-test.run=^$"), path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("start %s: %v\n%s", path, err, out)
	}
	if runtime.GOOS != "windows" && cmd.Path != path {
		t.Fatalf("path changed off Windows: %q", cmd.Path)
	}
}
