package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const releaseRepo = "real-kijmoshi/coop-dungeon-crawler"
const maxUpdateSize = 64 << 20

var stableTag = regexp.MustCompile(`^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`)

func releaseVersion(tag string) (result [3]uint64, valid bool) {
	match := stableTag.FindStringSubmatch(tag)
	if match == nil {
		return result, false
	}
	for i, part := range match[1:] {
		number, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return result, false
		}
		result[i] = number
	}
	return result, true
}

func newerRelease(current, candidate string) bool {
	old, oldOK := releaseVersion(current)
	next, nextOK := releaseVersion(candidate)
	if !oldOK || !nextOK {
		return false
	}
	for i := range old {
		if next[i] != old[i] {
			return next[i] > old[i]
		}
	}
	return false
}

type releaseAsset struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	Digest string `json:"digest"`
}

func updateClient() {
	if _, valid := releaseVersion(version); !valid {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return
	}
	original, err := os.Stat(exe)
	if err != nil || !original.Mode().IsRegular() || original.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 {
		return
	}
	if runtime.GOOS == "windows" {
		_ = os.Remove(exe + ".previous")
	}

	client := &http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			switch req.URL.Host {
			case "api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com":
				if req.URL.Scheme == "https" && len(via) < 5 {
					return nil
				}
			}
			return errors.New("unexpected update redirect")
		},
	}
	res, err := client.Get("https://api.github.com/repos/" + releaseRepo + "/releases/latest")
	if err != nil {
		return
	}
	defer res.Body.Close()
	var release struct {
		Tag        string         `json:"tag_name"`
		Draft      bool           `json:"draft"`
		Prerelease bool           `json:"prerelease"`
		Assets     []releaseAsset `json:"assets"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&release) != nil ||
		release.Draft || release.Prerelease || !newerRelease(version, release.Tag) {
		return
	}

	name := "cdc-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	for _, asset := range release.Assets {
		if asset.Name != name {
			continue
		}
		url := "https://github.com/" + releaseRepo + "/releases/download/" + release.Tag + "/" + name
		client.Timeout = 30 * time.Second
		fmt.Fprintf(os.Stderr, "Downloading Coop Dungeon Crawler %s…\n", release.Tag)
		if err := installUpdate(client, url, asset, exe, original); err != nil {
			fmt.Fprintln(os.Stderr, "Update deferred:", err)
		} else {
			fmt.Fprintf(os.Stderr, "Updated to %s for your next launch.\n", release.Tag)
		}
		return
	}
}

func installUpdate(client *http.Client, url string, asset releaseAsset, exe string, original os.FileInfo) error {
	digest, ok := strings.CutPrefix(asset.Digest, "sha256:")
	expected, err := hex.DecodeString(digest)
	if !ok || err != nil || len(expected) != sha256.Size || asset.Size <= 0 || asset.Size > maxUpdateSize {
		return errors.New("invalid release asset metadata")
	}

	file, err := os.CreateTemp(filepath.Dir(exe), ".cdc-update-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()

	res, err := client.Get(url)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned HTTP %d", res.StatusCode)
	}
	hash := sha256.New()
	n, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(res.Body, asset.Size+1))
	if err != nil {
		return err
	}
	if n != asset.Size || !bytes.Equal(hash.Sum(nil), expected) {
		return errors.New("release binary failed checksum verification")
	}
	if err := file.Chmod(original.Mode().Perm()); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	current, err := os.Stat(exe)
	if err != nil || !os.SameFile(current, original) {
		return errors.New("client was replaced during download")
	}

	if runtime.GOOS != "windows" {
		return os.Rename(file.Name(), exe)
	}
	// Windows permits moving a running executable aside. Keep it available
	// for rollback until the new file has moved into place.
	backup := exe + ".previous"
	if _, err := os.Lstat(backup); !os.IsNotExist(err) {
		return errors.New("previous client is still in use")
	}
	if err := os.Rename(exe, backup); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), exe); err != nil {
		if restoreErr := os.Rename(backup, exe); restoreErr != nil {
			return fmt.Errorf("install failed: %w; restore %s: %v", err, backup, restoreErr)
		}
		return err
	}
	return nil
}
