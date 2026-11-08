//go:build !windows

package playback

import "syscall"

func testMkfifo(path string, mode uint32) error { return syscall.Mkfifo(path, mode) }
