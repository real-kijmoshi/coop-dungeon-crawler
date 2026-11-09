//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func acquireDataLock(root string) (func(), error) {
	name, err := syscall.UTF16PtrFromString(filepath.Join(root, "host.lock"))
	if err != nil {
		return nil, err
	}
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil, syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, fmt.Errorf("this save folder is already in use or inaccessible: %w", err)
	}
	return func() { syscall.CloseHandle(handle) }, nil
}

func runPowerShell(script string, vars map[string]string) error {
	cmd := exec.Command(filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = os.Environ()
	for k, v := range vars {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
func firewallVars(root, program, scope string, port int) map[string]string {
	remote := "LocalSubnet"
	profileMask := "2"
	if scope == "direct" {
		remote = "Any"
		profileMask = "6"
	}
	return map[string]string{"CDC_RULE": firewallRuleName(root, scope, port), "CDC_PROGRAM": program, "CDC_PORT": strconv.Itoa(port), "CDC_REMOTE": remote, "CDC_PROFILE_MASK": profileMask}
}

const matchingRuleScript = `$ErrorActionPreference='Stop';
$r=Get-NetFirewallRule -PolicyStore PersistentStore -Name $env:CDC_RULE -ErrorAction SilentlyContinue;
if (!$r -or $r.Enabled -ne 'True' -or $r.Direction -ne 'Inbound' -or $r.Action -ne 'Allow' -or [int]$r.Profile -ne [int]$env:CDC_PROFILE_MASK) {exit 1};
$p=$r|Get-NetFirewallPortFilter; $a=$r|Get-NetFirewallApplicationFilter; $s=$r|Get-NetFirewallAddressFilter;
if ($p.Protocol -ne 'TCP' -or $p.LocalPort -ne $env:CDC_PORT -or $a.Program -ine $env:CDC_PROGRAM -or $s.RemoteAddress -ne $env:CDC_REMOTE) {exit 1}; exit 0`

func ensureFirewall(root, program, scope string, port int) error {
	if err := runPowerShell(matchingRuleScript, firewallVars(root, program, scope, port)); err == nil {
		return nil
	}
	return elevateFirewall(root, scope, port, false)
}
func removeFirewall(root, scope string, port int) error {
	return elevateFirewall(root, scope, port, true)
}
func elevateFirewall(root, scope string, port int, remove bool) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{"--firewall-helper", scope, "--port", strconv.Itoa(port), "--data-dir", root}
	if remove {
		args = append(args, "--remove-firewall")
	}
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = syscall.EscapeArg(arg)
	}
	script := `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath $env:CDC_EXE -ArgumentList $env:CDC_ARGS -Verb RunAs -Wait -PassThru; exit $p.ExitCode } catch { Write-Error $_; exit 1 }`
	return runPowerShell(script, map[string]string{"CDC_EXE": exe, "CDC_ARGS": strings.Join(quoted, " ")})
}
func configureFirewall(root, scope string, port int, remove bool) error {
	program, err := firewallProgram(root, scope)
	if err != nil {
		return err
	}
	vars := firewallVars(root, program, scope, port)
	script := `$ErrorActionPreference='Stop'; Get-NetFirewallRule -PolicyStore PersistentStore -Name $env:CDC_RULE -ErrorAction SilentlyContinue | Remove-NetFirewallRule;`
	if !remove {
		script += `$profiles=if ($env:CDC_REMOTE -eq 'Any') {@('Private','Public')} else {@('Private')}; New-NetFirewallRule -PolicyStore PersistentStore -Name $env:CDC_RULE -DisplayName $env:CDC_RULE -Direction Inbound -Action Allow -Protocol TCP -LocalPort $env:CDC_PORT -Program $env:CDC_PROGRAM -Profile $profiles -RemoteAddress $env:CDC_REMOTE -Enabled True | Out-Null;`
	}
	return runPowerShell(script, vars)
}
