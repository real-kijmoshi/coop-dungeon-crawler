//go:build !windows

package main

import "os/exec"

func newProcessGroup() (func(*exec.Cmd) error, func(), error) {
	return func(*exec.Cmd) error { return nil }, func() {}, nil
}
