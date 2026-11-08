//go:build windows

package downloadstorage

import (
	"strings"

	"golang.org/x/sys/windows"
)

// statFS reports a volume's capacity the way statFS does on Unix: used is
// every taken byte, and total is used plus what this process may still write,
// so quota-held space counts as neither.
func statFS(path string) (fsStats, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return fsStats{}, err
	}
	var available, total, free uint64
	if err := windows.GetDiskFreeSpaceEx(p, &available, &total, &free); err != nil {
		return fsStats{}, err
	}
	if free > total {
		free = total
	}
	used := total - free
	stats := fsStats{used: int64(used), total: int64(used + available)}
	if root, err := volumeRoot(path); err == nil {
		var fsName [windows.MAX_PATH + 1]uint16
		if windows.GetVolumeInformation(root, nil, 0, nil, nil, nil, &fsName[0], uint32(len(fsName))) == nil {
			stats.fsType = strings.ToLower(windows.UTF16ToString(fsName[:]))
		}
	}
	return stats, nil
}

// deviceOf returns the serial number of the volume a path lives on, so two
// paths on one volume compare equal.
func deviceOf(path string) (uint64, error) {
	root, err := volumeRoot(path)
	if err != nil {
		return 0, err
	}
	var serial uint32
	if err := windows.GetVolumeInformation(root, nil, 0, &serial, nil, nil, nil, 0); err != nil {
		return 0, err
	}
	return uint64(serial), nil
}

// volumeRoot returns the mount point of the volume holding path, such as
// `D:\` or a mounted folder.
func volumeRoot(path string) (*uint16, error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	buf := make([]uint16, windows.MAX_PATH+1)
	if err := windows.GetVolumePathName(p, &buf[0], uint32(len(buf))); err != nil {
		return nil, err
	}
	return &buf[0], nil
}
