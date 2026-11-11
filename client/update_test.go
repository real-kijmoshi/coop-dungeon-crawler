package main

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewerRelease(t *testing.T) {
	for _, tc := range []struct {
		current, candidate string
		want               bool
	}{
		{"v0.4.0", "v0.4.1", true},
		{"v0.9.9", "v0.10.0", true},
		{"v1.0.0", "v0.99.99", false},
		{"v0.4.0", "v0.4.0", false},
		{"v0.4.0", "v0.5.0-rc.1", false},
		{"dev", "v0.5.0", false},
	} {
		if got := newerRelease(tc.current, tc.candidate); got != tc.want {
			t.Errorf("newerRelease(%q, %q) = %v, want %v", tc.current, tc.candidate, got, tc.want)
		}
	}
}

func TestInstallUpdate(t *testing.T) {
	const original, update = "original", "verified binary"
	for _, tc := range []struct {
		name, download string
		want           string
	}{
		{"verified", update, update},
		{"corrupt", "corrupt  binary", original},
		{"truncated", update[:5], original},
		{"oversized", update + "x", original},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			exe := filepath.Join(dir, "cdc.exe")
			if err := os.WriteFile(exe, []byte(original), 0755); err != nil {
				t.Fatal(err)
			}
			info, err := os.Stat(exe)
			if err != nil {
				t.Fatal(err)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, tc.download)
			}))
			defer server.Close()

			asset := releaseAsset{Size: int64(len(update)), Digest: fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(update)))}
			err = installUpdate(server.Client(), server.URL, asset, exe, info)
			if (err == nil) != (tc.want == update) {
				t.Fatalf("unexpected install result: %v", err)
			}
			content, err := os.ReadFile(exe)
			if err != nil || string(content) != tc.want {
				t.Fatalf("client contents = %q, err = %v", content, err)
			}
			staged, err := filepath.Glob(filepath.Join(dir, ".cdc-update-*"))
			if err != nil || len(staged) != 0 {
				t.Fatalf("temporary downloads left behind: %v, err = %v", staged, err)
			}
		})
	}
}
