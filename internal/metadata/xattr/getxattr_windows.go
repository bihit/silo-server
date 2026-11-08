//go:build windows

package xattr

import "errors"

// errNoXattr stands in for ENOTSUP: NTFS has no user.* extended attributes,
// so this provider finds no IDs on Windows.
var errNoXattr = errors.New("extended attributes are not supported on windows")

func getxattr(string, string) (string, error) { return "", errNoXattr }

func isNoData(err error) bool { return errors.Is(err, errNoXattr) }
