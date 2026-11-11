package main

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func toPCM(buf []float32) []int16 {
	out := make([]int16, len(buf))
	for i, v := range buf {
		out[i] = int16(softClip(float64(v)) * 32767)
	}
	return out
}

// Composes every mood for a while and checks the audio is sane. Set
// CDC_MUSIC_OUT=dir to keep WAV files (CDC_MUSIC_SECONDS sets their length).
func TestRenderMusic(t *testing.T) {
	out := os.Getenv("CDC_MUSIC_OUT")
	seconds := 40.0
	if s := os.Getenv("CDC_MUSIC_SECONDS"); s != "" {
		var v float64
		for _, ch := range s {
			v = v*10 + float64(ch-'0')
		}
		seconds = v
	}
	for name, mood := range moods {
		c := newComposer(mood, 42)
		var calm, fight []float32
		for float64(len(calm))/2/sampleRate < seconds {
			base, tens := c.nextBar()
			for i := range base {
				calm = append(calm, base[i]+tens[i]*float32(mood.Tension))
				fight = append(fight, base[i]+tens[i])
			}
		}
		for label, buf := range map[string][]float32{"calm": calm, "fight": fight} {
			var sum, peak, jump float64
			for i, v := range buf {
				f := float64(v)
				if math.IsNaN(f) || math.IsInf(f, 0) {
					t.Fatalf("%s/%s: bad sample at %d", name, label, i)
				}
				sum += f * f
				peak = math.Max(peak, math.Abs(f))
				if i >= 2 {
					jump = math.Max(jump, math.Abs(f-float64(buf[i-2])))
				}
			}
			rms := math.Sqrt(sum / float64(len(buf)))
			t.Logf("%-8s %-5s %4.0fs  rms %.3f  peak %.2f  max step %.2f", name, label, float64(len(buf))/2/sampleRate, rms, peak, jump)
			if rms < 0.03 || rms > 0.3 {
				t.Errorf("%s/%s: loudness looks wrong (rms %.3f)", name, label, rms)
			}
			if peak > 1.2 {
				t.Errorf("%s/%s: clips hard (peak %.2f)", name, label, peak)
			}
			if jump > 0.6 {
				t.Errorf("%s/%s: click in the audio (step %.2f)", name, label, jump)
			}
		}
		if out != "" {
			if err := writeWAV(filepath.Join(out, name+".wav"), toPCM(calm)); err != nil {
				t.Fatal(err)
			}
			_ = writeWAV(filepath.Join(out, name+"-fight.wav"), toPCM(fight))
		}
	}
}

// The music never restarts, so there is no loop point: consecutive bars must join
// without a jump, however long it plays.
func TestMusicIsSeamless(t *testing.T) {
	c := newComposer(moods["crypts"], 7)
	var prev [2]float32
	for bar := 0; bar < 24; bar++ {
		base, _ := c.nextBar()
		if bar > 0 {
			for ch := 0; ch < 2; ch++ {
				// (drums start on the bar line, so only the sustained stem is compared)
				if d := math.Abs(float64(base[ch] - prev[ch])); d > 0.05 {
					t.Fatalf("bar %d does not join the one before (step %.3f)", bar, d)
				}
			}
		}
		n := len(base)
		prev = [2]float32{base[n-2], base[n-1]}
	}
}

func TestSoundEffects(t *testing.T) {
	out := os.Getenv("CDC_MUSIC_OUT")
	for name := range sfxRecipes {
		clip := sfxFor(name)
		if clip == nil || len(clip.pcm) < 100 {
			t.Fatalf("sfx %s is empty", name)
		}
		var peak float64
		for _, v := range clip.pcm {
			if math.IsNaN(float64(v)) {
				t.Fatalf("sfx %s: bad sample", name)
			}
			peak = math.Max(peak, math.Abs(float64(v)))
		}
		if peak < 0.05 || peak > 1 {
			t.Errorf("sfx %s: peak %.2f", name, peak)
		}
		if last := math.Abs(float64(clip.pcm[len(clip.pcm)-1])); last > 0.01 {
			t.Errorf("sfx %s ends with a click (%.3f)", name, last)
		}
		if out != "" {
			st := make([]float32, 0, len(clip.pcm)*2)
			for _, v := range clip.pcm {
				st = append(st, v, v)
			}
			_ = writeWAV(filepath.Join(out, "sfx-"+name+".wav"), toPCM(st))
		}
	}
	if sfxFor("no-such-sound") != nil {
		t.Error("unknown sounds must be ignored")
	}
}

// The mixer is what the sound card hears: music, crossfades and effects together.
func TestMixer(t *testing.T) {
	m := newMixer()
	m.SetVolumes(0.8, 0.8)
	buf := make([]byte, 4096)
	level := func() float64 {
		var sum float64
		for i := 0; i+1 < len(buf); i += 2 {
			v := float64(int16(binary.LittleEndian.Uint16(buf[i:]))) / 32768
			sum += v * v
		}
		return math.Sqrt(sum / float64(len(buf)/2))
	}
	if n, err := m.Read(buf); n != len(buf) || err != nil || level() != 0 {
		t.Fatalf("an idle mixer must write silence: %d %v %.3f", n, err, level())
	}
	m.PlayClip(sfxFor("hit"), 1, -0.5)
	_, _ = m.Read(buf)
	if level() < 0.01 {
		t.Error("the effect is not audible")
	}
	for i := 0; i < 40; i++ {
		_, _ = m.Read(buf)
	}
	if len(m.voices) != 0 {
		t.Error("finished effects must be dropped")
	}
	// Music: wait for the composer, then it must come through and survive a track change.
	s := newMusicStream(moods["boss"], 1)
	m.SetMusic(s, 0.05)
	heard := false
	for i := 0; i < 400 && !heard; i++ {
		s.cur = <-s.blocks
		s.pos = 0
		for j := 0; j < 60; j++ {
			_, _ = m.Read(buf)
			heard = heard || level() > 0.01
		}
	}
	if !heard {
		t.Error("no music came out of the mixer")
	}
	m.SetMusic(nil, 0.05)
	for i := 0; i < 20; i++ {
		_, _ = m.Read(buf)
	}
	if level() != 0 || m.old != nil {
		t.Error("stopping the music must fade to silence")
	}
}
