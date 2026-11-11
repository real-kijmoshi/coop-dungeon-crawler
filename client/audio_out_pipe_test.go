//go:build !windows && !darwin

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The whole chain: mixer -> pipe -> player process, with dd standing in for the player.
func TestPipeOutputStreamsToThePlayer(t *testing.T) {
	file := filepath.Join(t.TempDir(), "out.raw")
	t.Setenv("CDC_AUDIO_PLAYER", "dd status=none of="+file)
	m := newMixer()
	m.SetVolumes(1, 1)
	out := openAudioOutput(m)
	m.PlayClip(sfxFor("levelup"), 1, 0)
	time.Sleep(400 * time.Millisecond)
	if s := out.Status(); !strings.Contains(s, "dd") {
		t.Errorf("status = %q", s)
	}
	out.Close()
	time.Sleep(100 * time.Millisecond)
	data, err := os.ReadFile(file)
	if err != nil || len(data) < 4096 {
		t.Fatalf("the player received %d bytes (%v)", len(data), err)
	}
	loud := false
	for _, b := range data {
		loud = loud || b != 0
	}
	if !loud {
		t.Error("the player only received silence")
	}
}

// A player that exits at once (no sound device) must not hang or spin.
func TestPipeOutputGivesUpQuietly(t *testing.T) {
	t.Setenv("CDC_AUDIO_PLAYER", "false")
	out := openAudioOutput(newMixer())
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !strings.HasPrefix(out.Status(), "off") {
		time.Sleep(20 * time.Millisecond)
	}
	if s := out.Status(); !strings.HasPrefix(s, "off") {
		t.Errorf("status = %q", s)
	}
	out.Close()
}
