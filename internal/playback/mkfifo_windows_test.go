//go:build windows

package playback

import "errors"

// testMkfifo has no Windows equivalent; the FIFO tests skip on its error.
func testMkfifo(string, uint32) error {
	return errors.New("named pipes via mkfifo are not available on windows")
}
