package main

// Music and sound effects without any audio library: tracks are synthesized
// (music.go) into WAV files in the user's cache folder and played with the
// player the system already has (afplay on macOS, PowerShell on Windows,
// PipeWire / PulseAudio / ALSA / ffplay on Linux). The client stays a single
// static binary, and if no player is found the game simply runs silent.

import (
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const audioVersion = 1 // bump when the music changes so caches refresh

type Audio struct {
	mu       sync.Mutex
	player   []string // command, with "{}" for the file
	looping  bool     // the player loops by itself (Windows)
	dir      string
	music    bool
	musicVol int // 0..10
	sfx      bool
	sfxVol   int

	track    string // what should be playing
	gen      int    // bumps on every change; old loops exit
	cmd      *exec.Cmd
	failures int
	disabled string // why audio is off, if it broke
}

func newAudio(s Settings) *Audio {
	a := &Audio{}
	cache, err := os.UserCacheDir()
	if err != nil {
		cache = os.TempDir()
	}
	a.dir = filepath.Join(cache, "coop-dungeon-crawler", "audio")
	a.player, a.looping = detectPlayer()
	a.apply(s)
	return a
}

// detectPlayer finds a command-line audio player.
func detectPlayer() ([]string, bool) {
	if p := os.Getenv("CDC_AUDIO_PLAYER"); p != "" {
		return strings.Fields(p), false
	}
	switch runtime.GOOS {
	case "darwin":
		if _, err := exec.LookPath("afplay"); err == nil {
			return []string{"afplay", "{}"}, false
		}
	case "windows":
		if _, err := exec.LookPath("powershell"); err == nil {
			return []string{"powershell", "-NoProfile", "-NonInteractive", "-Command"}, true
		}
	default:
		for _, c := range [][]string{
			{"pw-play", "{}"},
			{"paplay", "{}"},
			{"aplay", "-q", "{}"},
			{"ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "{}"},
		} {
			if _, err := exec.LookPath(c[0]); err == nil {
				return c, false
			}
		}
	}
	return nil, false
}

// Status describes the audio backend for the settings screen.
func (a *Audio) Status() string {
	if a == nil {
		return "off"
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.disabled != "" {
		return a.disabled
	}
	if a.player == nil {
		return "off (no audio player found: install pipewire, pulseaudio-utils, alsa-utils or ffmpeg)"
	}
	return "playing through " + a.player[0]
}

func (a *Audio) apply(s Settings) {
	a.music, a.musicVol, a.sfx, a.sfxVol = s.Music, s.MusicVolume, s.Sounds, s.SoundVolume
}

// Apply picks up changed settings (restarts the music if needed).
func (a *Audio) Apply(s Settings) {
	if a == nil {
		return
	}
	a.mu.Lock()
	changed := a.music != s.Music || a.musicVol != s.MusicVolume
	a.apply(s)
	track := a.track
	a.mu.Unlock()
	if changed {
		a.restart(track)
	}
}

// Play switches the music to a track ("" stops it). Same track: no-op.
func (a *Audio) Play(track string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	same := a.track == track
	a.mu.Unlock()
	if !same {
		a.restart(track)
	}
}

func (a *Audio) restart(track string) {
	a.mu.Lock()
	a.track = track
	a.gen++
	gen := a.gen
	if a.cmd != nil && a.cmd.Process != nil {
		_ = a.cmd.Process.Kill()
	}
	a.cmd = nil
	ok := track != "" && a.music && a.musicVol > 0 && a.player != nil && a.disabled == ""
	vol := a.musicVol
	a.mu.Unlock()
	if ok {
		go a.loop(gen, track, vol)
	}
}

func (a *Audio) loop(gen int, track string, vol int) {
	file, err := a.musicFile(track, vol)
	if err != nil {
		a.mu.Lock()
		a.disabled = "off (" + err.Error() + ")"
		a.mu.Unlock()
		return
	}
	for {
		a.mu.Lock()
		if a.gen != gen {
			a.mu.Unlock()
			return
		}
		cmd := a.command(file, a.looping)
		if err := cmd.Start(); err != nil {
			a.disabled = "off (could not start " + a.player[0] + ")"
			a.mu.Unlock()
			return
		}
		a.cmd = cmd
		a.mu.Unlock()

		started := time.Now()
		_ = cmd.Wait()

		a.mu.Lock()
		if a.gen != gen {
			a.mu.Unlock()
			return
		}
		// A player that quits right away has no sound device: stop trying.
		if time.Since(started) < 2*time.Second {
			a.failures++
			if a.failures >= 3 {
				a.disabled = "off (" + a.player[0] + " found no sound device)"
				a.mu.Unlock()
				return
			}
		} else {
			a.failures = 0
		}
		a.mu.Unlock()
	}
}

// Current is the track that should be playing.
func (a *Audio) Current() string {
	if a == nil {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.track
}

// SFX plays a short sound effect.
func (a *Audio) SFX(name string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	ok := a.sfx && a.sfxVol > 0 && a.player != nil && a.disabled == ""
	vol := a.sfxVol
	a.mu.Unlock()
	if !ok {
		return
	}
	go func() {
		file, err := a.cached(fmt.Sprintf("sfx-%s-%d", name, vol), func() []int16 {
			return renderSFX(name, float64(vol)/10)
		})
		if err != nil {
			return
		}
		a.mu.Lock()
		cmd := a.command(file, false)
		a.mu.Unlock()
		if cmd.Start() == nil {
			_ = cmd.Wait()
		}
	}()
}

// Close stops all sound.
func (a *Audio) Close() {
	if a == nil {
		return
	}
	a.restart("")
}

func (a *Audio) command(file string, loop bool) *exec.Cmd {
	if runtime.GOOS == "windows" && a.player[0] == "powershell" {
		method := "PlaySync()"
		if loop {
			method = "PlayLooping(); Start-Sleep -Seconds 86400"
		}
		script := fmt.Sprintf("$p = New-Object Media.SoundPlayer '%s'; $p.%s", strings.ReplaceAll(file, "'", "''"), method)
		return hidden(exec.Command(a.player[0], append(a.player[1:], script)...))
	}
	args := make([]string, 0, len(a.player))
	hasFile := false
	for _, p := range a.player[1:] {
		if p == "{}" {
			p, hasFile = file, true
		}
		args = append(args, p)
	}
	if !hasFile {
		args = append(args, file)
	}
	return hidden(exec.Command(a.player[0], args...))
}

func hidden(c *exec.Cmd) *exec.Cmd {
	c.Stdin, c.Stdout, c.Stderr = nil, nil, nil
	return c
}

func (a *Audio) musicFile(track string, vol int) (string, error) {
	song, ok := songs[track]
	if !ok {
		return "", fmt.Errorf("unknown track %q", track)
	}
	// Each volume step is a separate file, so every player gets the same loudness.
	return a.cached(fmt.Sprintf("music-%s-%d", track, vol), func() []int16 {
		return render(song, volumeCurve(vol))
	})
}

func volumeCurve(v int) float64 {
	f := float64(v) / 10
	return f * f * 0.9
}

var renderMu sync.Mutex

// cached renders a sound once and keeps the WAV on disk.
func (a *Audio) cached(name string, gen func() []int16) (string, error) {
	path := filepath.Join(a.dir, fmt.Sprintf("v%d-%s.wav", audioVersion, name))
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	renderMu.Lock()
	defer renderMu.Unlock()
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if err := os.MkdirAll(a.dir, 0o755); err != nil {
		return "", fmt.Errorf("can't write to %s", a.dir)
	}
	tmp := path + ".tmp"
	if err := writeWAV(tmp, gen()); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

func writeWAV(path string, pcm []int16) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	data := uint32(len(pcm) * 2)
	hdr := []any{
		[4]byte{'R', 'I', 'F', 'F'}, 36 + data, [4]byte{'W', 'A', 'V', 'E'},
		[4]byte{'f', 'm', 't', ' '}, uint32(16), uint16(1), uint16(1),
		uint32(sampleRate), uint32(sampleRate * 2), uint16(2), uint16(16),
		[4]byte{'d', 'a', 't', 'a'}, data,
	}
	for _, v := range hdr {
		if err := binary.Write(f, binary.LittleEndian, v); err != nil {
			return err
		}
	}
	return binary.Write(f, binary.LittleEndian, pcm)
}
