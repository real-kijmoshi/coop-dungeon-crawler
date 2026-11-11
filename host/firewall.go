package main

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func firewallRuleName(root, scope string, port int) string {
	// Stable across releases; only replace rules owned by this save folder/mode.
	hash := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(root))))
	return fmt.Sprintf("CoopDungeonHost-%s-%x-%d", scope, hash[:6], port)
}
func firewallProgram(root, scope string) (string, error) {
	if scope == "direct" {
		return os.Executable()
	}
	if scope == "lan" {
		return filepath.Join(root, "runtime-"+version, "node.exe"), nil
	}
	return "", fmt.Errorf("invalid firewall scope %q", scope)
}
