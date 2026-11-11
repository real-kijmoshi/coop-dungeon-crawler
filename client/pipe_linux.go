//go:build linux

package main

import (
	"os"
	"syscall"
)

// shrinkPipe makes the pipe to the audio player as small as the kernel allows
// (one page), so audio is not queued up half a second ahead of what is heard.
func shrinkPipe(w *os.File) {
	const fSetPipeSize = 1031 // F_SETPIPE_SZ
	_, _, _ = syscall.Syscall(syscall.SYS_FCNTL, w.Fd(), fSetPipeSize, 4096)
}
