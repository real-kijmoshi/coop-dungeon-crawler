package main

// Audio: one in-process mixer for music and sound effects.
//
// The mixer produces a continuous 44.1 kHz stereo stream (see Read). Where it goes
// depends on the platform:
//   - Windows and macOS: straight to the system through oto (audio_out_oto.go)
//   - Linux and others:  piped into the player the system already has - PulseAudio,
//     PipeWire, ALSA or ffplay (audio_out_pipe.go)
// Either way the client stays a single static binary, the music is gapless because
// it is never restarted, and effects play within a few milliseconds. If there is no
// sound device the game simply runs silent.

import (
	"encoding/binary"
	"io"
	"math"
	"math/rand"
	"os"
	"sync"
	"time"
)

type audioOutput interface {
	Status() string
	Close()
}

type Audio struct {
	mu       sync.Mutex
	mix      *Mixer
	out      audioOutput
	music    bool
	musicVol int // 0..10
	sfx      bool
	sfxVol   int
	track    string // what should be playing
	last     map[string]time.Time
}

func newAudio(s Settings) *Audio {
	a := &Audio{mix: newMixer(), last: map[string]time.Time{}}
	a.apply(s)
	a.out = openAudioOutput(a.mix)
	go warmSFX()
	return a
}

// Status describes the audio backend for the settings screen.
func (a *Audio) Status() string {
	if a == nil || a.out == nil {
		return "off"
	}
	return a.out.Status()
}

func volumeCurve(v int) float64 {
	f := float64(v) / 10
	return f * f
}

func (a *Audio) apply(s Settings) {
	a.music, a.musicVol, a.sfx, a.sfxVol = s.Music, s.MusicVolume, s.Sounds, s.SoundVolume
	mg, sg := 0.0, 0.0
	if a.music {
		mg = volumeCurve(a.musicVol) * 0.85
	}
	if a.sfx {
		sg = volumeCurve(a.sfxVol) * 0.8
	}
	a.mix.SetVolumes(mg, sg)
}

// Apply picks up changed settings; volume changes are heard immediately.
func (a *Audio) Apply(s Settings) {
	if a == nil {
		return
	}
	a.mu.Lock()
	wasOn := a.music && a.musicVol > 0
	a.apply(s)
	isOn := a.music && a.musicVol > 0
	track := a.track
	a.mu.Unlock()
	if wasOn != isOn {
		a.start(track, 1)
	}
}

// Play switches the music to a track ("" stops it). Same track: no-op.
func (a *Audio) Play(track string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	same := a.track == track
	a.track = track
	a.mu.Unlock()
	if !same {
		fade := 2.5
		if track == "boss" {
			fade = 0.7
		}
		a.start(track, fade)
	}
}

func (a *Audio) start(track string, fade float64) {
	a.mu.Lock()
	on := a.music && a.musicVol > 0
	a.mu.Unlock()
	mood, ok := trackFor(track)
	if !ok || !on {
		a.mix.SetMusic(nil, fade)
		return
	}
	a.mix.SetMusic(newMusicStream(mood, time.Now().UnixNano()), fade)
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

// SetTension tells the music how dangerous things are (0 calm .. 1 fighting).
func (a *Audio) SetTension(t float64) {
	if a != nil {
		a.mix.SetTension(t)
	}
}

// SFX plays a sound effect in the middle of the stereo field.
func (a *Audio) SFX(name string) { a.SFXAt(name, 0, 0) }

// SFXAt plays a sound effect that happened dx, dy tiles away from the hero.
func (a *Audio) SFXAt(name string, dx, dy float64) {
	if a == nil {
		return
	}
	now := time.Now()
	a.mu.Lock()
	// The same cue from several sources at once (an area attack) plays once.
	if now.Sub(a.last[name]) < 45*time.Millisecond {
		a.mu.Unlock()
		return
	}
	a.last[name] = now
	on := a.sfx && a.sfxVol > 0
	a.mu.Unlock()
	if !on {
		return
	}
	clip := sfxFor(name)
	if clip == nil {
		return
	}
	d := math.Hypot(dx, dy)
	gain := 1 / (1 + d*d/40)
	pan := clampf(dx/9, -0.8, 0.8)
	a.mix.PlayClip(clip, gain, pan)
}

// Close stops all sound.
func (a *Audio) Close() {
	if a == nil {
		return
	}
	a.mix.SetMusic(nil, 0.1)
	if a.out != nil {
		a.out.Close()
	}
}

// ---------------------------------------------------------------------- mixer

type voice struct {
	pcm    []float32
	pos    float64
	rate   float64
	gl, gr float32
}

const maxVoices = 16

// Mixer is an endless io.Reader of 16-bit little-endian stereo audio.
type Mixer struct {
	mu        sync.Mutex
	cur, old  *MusicStream
	fade      float64 // 0..1, how far the current track has faded in
	oldGain   float64 // level the previous track is fading out from
	fadeStep  float64 // per frame
	musicGain float64
	sfxGain   float64
	tension   float64
	tensionTo float64
	voices    []voice
	buf, tmp  []float32
	rng       *rand.Rand
}

func newMixer() *Mixer {
	return &Mixer{fade: 1, rng: rand.New(rand.NewSource(time.Now().UnixNano()))}
}

func (m *Mixer) SetVolumes(music, sfx float64) {
	m.mu.Lock()
	m.musicGain, m.sfxGain = music, sfx
	m.mu.Unlock()
}

func (m *Mixer) SetTension(t float64) {
	m.mu.Lock()
	m.tensionTo = clampf(t, 0, 1)
	m.mu.Unlock()
}

// SetMusic crossfades to another stream (nil fades to silence).
func (m *Mixer) SetMusic(s *MusicStream, fadeSeconds float64) {
	m.mu.Lock()
	if m.old != nil {
		m.old.Close()
	}
	// If the track we are leaving had not fully faded in, it fades out from there.
	m.old, m.cur, m.oldGain = m.cur, s, m.fade
	m.fade = 0
	m.fadeStep = 1 / (math.Max(0.05, fadeSeconds) * sampleRate)
	m.mu.Unlock()
}

func (m *Mixer) PlayClip(c *sfxClip, gain, pan float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.voices) >= maxVoices {
		m.voices = m.voices[1:]
	}
	p := panOf(pan)
	rate := 1 + (m.rng.Float64()*2-1)*c.vary
	m.voices = append(m.voices, voice{pcm: c.pcm, rate: rate, gl: p.l * float32(gain) * 1.2, gr: p.r * float32(gain) * 1.2})
}

// Read fills p completely; it never returns an error.
func (m *Mixer) Read(p []byte) (int, error) {
	frames := len(p) / 4
	if frames == 0 {
		clear(p)
		return len(p), nil
	}
	m.mu.Lock()
	if cap(m.buf) < frames*2 {
		m.buf = make([]float32, frames*2)
	}
	buf := m.buf[:frames*2]
	clear(buf)

	// Tension rises quickly when a fight starts and lets go slowly afterwards.
	secs := float64(frames) / sampleRate
	if m.tensionTo > m.tension {
		m.tension = math.Min(m.tensionTo, m.tension+secs/0.8)
	} else {
		m.tension = math.Max(m.tensionTo, m.tension-secs/5)
	}
	f0 := m.fade
	f1 := math.Min(1, f0+m.fadeStep*float64(frames))
	m.fade = f1
	g := m.musicGain
	if m.cur != nil {
		m.cur.mix(buf, float32(m.tension), float32(g*f0), float32(g*f1))
	}
	if m.old != nil {
		m.old.mix(buf, float32(m.tension), float32(g*m.oldGain*(1-f0)), float32(g*m.oldGain*(1-f1)))
		if f1 >= 1 {
			m.old.Close()
			m.old = nil
		}
	}

	sg := float32(m.sfxGain)
	kept := m.voices[:0]
	for _, v := range m.voices {
		for i := 0; i < frames; i++ {
			j := int(v.pos)
			if j+1 >= len(v.pcm) {
				break
			}
			fr := float32(v.pos - float64(j))
			s := (v.pcm[j]*(1-fr) + v.pcm[j+1]*fr) * sg
			buf[i*2] += s * v.gl
			buf[i*2+1] += s * v.gr
			v.pos += v.rate
		}
		if int(v.pos)+1 < len(v.pcm) {
			kept = append(kept, v)
		}
	}
	m.voices = kept
	m.mu.Unlock()

	for i, v := range buf {
		binary.LittleEndian.PutUint16(p[i*2:], uint16(int16(softClip(float64(v))*32767)))
	}
	clear(p[frames*4:])
	return len(p), nil
}

// softClip is linear for normal levels and bends smoothly towards +-1 above them.
func softClip(v float64) float64 {
	const knee = 0.7
	a := math.Abs(v)
	if a <= knee {
		return v
	}
	out := knee + (1-knee)*math.Tanh((a-knee)/(1-knee))
	return math.Copysign(out, v)
}

var _ io.Reader = (*Mixer)(nil)

// writeWAV saves interleaved stereo 16-bit audio (used by the render test).
func writeWAV(path string, pcm []int16) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	data := uint32(len(pcm) * 2)
	hdr := []any{
		[4]byte{'R', 'I', 'F', 'F'}, 36 + data, [4]byte{'W', 'A', 'V', 'E'},
		[4]byte{'f', 'm', 't', ' '}, uint32(16), uint16(1), uint16(2),
		uint32(sampleRate), uint32(sampleRate * 4), uint16(4), uint16(16),
		[4]byte{'d', 'a', 't', 'a'}, data,
	}
	for _, v := range hdr {
		if err := binary.Write(f, binary.LittleEndian, v); err != nil {
			return err
		}
	}
	return binary.Write(f, binary.LittleEndian, pcm)
}
