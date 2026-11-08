//go:build !windows

package xattr

import (
	"errors"

	"golang.org/x/sys/unix"
)

func getxattr(path, attr string) (string, error) {
	sz, err := unix.Getxattr(path, attr, nil)
	if err != nil {
		return "", err
	}
	if sz == 0 {
		return "", nil
	}
	buf := make([]byte, sz)
	n, err := unix.Getxattr(path, attr, buf)
	if err != nil {
		return "", err
	}
	return string(buf[:n]), nil
}

func isNoData(err error) bool {
	return errors.Is(err, unix.ENODATA) || errors.Is(err, unix.ENOTSUP)
}
