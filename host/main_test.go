package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func archive(name string) []byte {
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	f, _ := w.Create(name)
	f.Write([]byte("test"))
	w.Close()
	return b.Bytes()
}
func TestArchiveContainment(t *testing.T) {
	for _, name := range []string{"../escape", "dir/../../escape", "C:/escape", "dir\\..\\..\\escape"} {
		if unpack(archive(name), t.TempDir()) == nil {
			t.Fatal("accepted unsafe name", name)
		}
	}
}
func TestBundleExtraction(t *testing.T) {
	d := t.TempDir()
	if err := unpack(archive("server/file.txt"), d); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(d, "server", "file.txt"))
	if err != nil || string(b) != "test" {
		t.Fatal("bad extraction", err)
	}
}
func TestTunnelURL(t *testing.T) {
	if urlPattern.FindString("INF Visit https://example-name.trycloudflare.com |") != "https://example-name.trycloudflare.com" {
		t.Fatal("URL detection failed")
	}
}
