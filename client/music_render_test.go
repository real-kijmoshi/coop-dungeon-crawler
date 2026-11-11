package main

import (
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Renders every song and effect; set CDC_MUSIC_OUT=dir to keep the WAV files.
func TestRenderMusic(t *testing.T) {
	out := os.Getenv("CDC_MUSIC_OUT")
	for name, s := range songs {
		start := time.Now()
		pcm := render(s, 0.8)
		secs := float64(len(pcm)) / sampleRate
		var sum float64
		peak := 0
		for _, v := range pcm {
			sum += float64(v) * float64(v)
			if a := int(math.Abs(float64(v))); a > peak {
				peak = a
			}
		}
		rms := math.Sqrt(sum/float64(len(pcm))) / 32768
		t.Logf("%-8s %5.1fs  rendered in %v  peak %d  rms %.3f", name, secs, time.Since(start).Round(time.Millisecond), peak, rms)
		if secs < 20 || rms < 0.03 || peak == 0 {
			t.Errorf("%s looks broken: %.1fs rms %.3f", name, secs, rms)
		}
		if out != "" {
			if err := writeWAV(filepath.Join(out, name+".wav"), pcm); err != nil {
				t.Fatal(err)
			}
		}
	}
	for name := range sfxDefs {
		pcm := renderSFX(name, 0.8)
		if len(pcm) == 0 {
			t.Errorf("sfx %s is empty", name)
		}
		if out != "" {
			_ = writeWAV(filepath.Join(out, "sfx-"+name+".wav"), pcm)
		}
	}
}
