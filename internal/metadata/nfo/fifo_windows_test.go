//go:build windows

package nfo

import "errors"

func makeFIFO(string) error { return errors.New("windows has no FIFOs in ordinary directories") }
