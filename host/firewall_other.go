//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func acquireDataLock(root string) (func(), error) {
	f, err := os.OpenFile(filepath.Join(root, "host.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		return nil, fmt.Errorf("save folder is already in use: %w", err)
	}
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
func ensureFirewall(root, program, scope string, port int) error {
	return errors.New("automatic firewall configuration is supported on Windows; configure your firewall manually")
}
func removeFirewall(root, scope string, port int) error {
	return errors.New("automatic firewall configuration is supported on Windows")
}
func configureFirewall(root, scope string, port int, remove bool) error {
	return errors.New("automatic firewall configuration is supported on Windows")
}
