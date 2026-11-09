//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"os/exec"
	"unsafe"
)

// Closing the launcher window also closes its job handle, stopping the server
// and tunnel children even when Go cannot run deferred cleanup.
func newProcessGroup() (func(*exec.Cmd) error, func(), error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, nil, err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		windows.CloseHandle(job)
		return nil, nil, err
	}
	attach := func(cmd *exec.Cmd) error {
		process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
		if err != nil {
			return err
		}
		defer windows.CloseHandle(process)
		return windows.AssignProcessToJobObject(job, process)
	}
	return attach, func() { windows.CloseHandle(job) }, nil
}
