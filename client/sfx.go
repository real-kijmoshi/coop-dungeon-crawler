package main

// Sound effects, synthesized once at startup into short mono clips. The mixer
// plays them with a little random pitch so repeated hits don't sound mechanical.

import (
	"math"
	"math/rand"
	"sync"
)

// sfxBuf builds one clip out of simple layers.
type sfxBuf struct {
	s   []float64
	rng *rand.Rand
}

func newSfxBuf(seconds float64, seed int64) *sfxBuf {
	return &sfxBuf{s: make([]float64, int(seconds*sampleRate)), rng: rand.New(rand.NewSource(seed))}
}

// tone adds a sine gliding from f0 to f1 with an exponential decay. shape adds
// harmonics: 0 pure sine, 1 close to a square.
func (b *sfxBuf) tone(at, dur, f0, f1, vol, decay, shape float64) {
	i0, n := int(at*sampleRate), int(dur*sampleRate)
	ph := 0.0
	for k := 0; k < n && i0+k < len(b.s); k++ {
		t := float64(k) / sampleRate
		x := t / dur
		f := f0 * math.Pow(f1/f0, x)
		ph += f / sampleRate
		v := math.Sin(2 * math.Pi * ph)
		if shape > 0 {
			v = math.Tanh(v*(1+shape*5)) / math.Tanh(1+shape*5)
		}
		env := math.Min(1, t/0.003) * math.Exp(-t*decay) * math.Min(1, (dur-t)/0.01)
		b.s[i0+k] += v * env * vol
	}
}

// noise adds filtered noise: a band around a centre frequency gliding c0 -> c1.
func (b *sfxBuf) noise(at, dur, c0, c1, q, vol, decay float64) {
	i0, n := int(at*sampleRate), int(dur*sampleRate)
	var low, band float64
	for k := 0; k < n && i0+k < len(b.s); k++ {
		t := float64(k) / sampleRate
		x := t / dur
		fc := c0 * math.Pow(c1/c0, x)
		f := 2 * math.Sin(math.Pi*math.Min(fc, 9000)/sampleRate)
		w := b.rng.Float64()*2 - 1
		high := w - low - q*band // state-variable filter
		band += f * high
		low += f * band
		env := math.Min(1, t/0.004) * math.Exp(-t*decay) * math.Min(1, (dur-t)/0.01)
		b.s[i0+k] += band * env * vol
	}
}

// rumble adds low-passed noise.
func (b *sfxBuf) rumble(at, dur, cutoff, vol, decay float64) {
	i0, n := int(at*sampleRate), int(dur*sampleRate)
	a := 1 - math.Exp(-2*math.Pi*cutoff/sampleRate)
	l1, l2 := 0.0, 0.0
	for k := 0; k < n && i0+k < len(b.s); k++ {
		t := float64(k) / sampleRate
		l1 += (b.rng.Float64()*2 - 1 - l1) * a
		l2 += (l1 - l2) * a
		env := math.Min(1, t/0.004) * math.Exp(-t*decay) * math.Min(1, (dur-t)/0.02)
		b.s[i0+k] += l2 * env * vol * 3
	}
}

// bell adds a ringing tone with a few inharmonic partials.
func (b *sfxBuf) bell(at, midi, vol, decay float64) {
	f := midiFreq(midi)
	for j, r := range []float64{1, 2.76, 5.4} {
		if f*r < 10000 {
			b.tone(at, math.Min(4/decay, float64(len(b.s))/sampleRate-at), f*r, f*r, vol/float64(1+j*2), decay*(1+0.6*float64(j)), 0)
		}
	}
}

// notes plays a little melody of soft square-ish notes.
func (b *sfxBuf) notes(at, each, hold, vol float64, midi ...float64) {
	for i, m := range midi {
		f := midiFreq(m)
		b.tone(at+float64(i)*each, hold, f, f, vol, 4/hold, 0.25)
		b.tone(at+float64(i)*each, hold, f*2, f*2, vol*0.25, 6/hold, 0)
	}
}

func (b *sfxBuf) done(gain float64) []float32 {
	out := make([]float32, len(b.s))
	fade := min(len(b.s), 300)
	for i, v := range b.s {
		if rest := len(b.s) - i; rest < fade {
			v *= float64(rest) / float64(fade)
		}
		out[i] = float32(math.Tanh(v * gain))
	}
	return out
}

// Each recipe returns the clip and how much its pitch may vary (0..0.1).
var sfxRecipes = map[string]func() ([]float32, float64){
	// ---- combat
	"hit": func() ([]float32, float64) {
		b := newSfxBuf(0.14, 1)
		b.noise(0, 0.07, 2400, 900, 0.7, 0.55, 45)
		b.tone(0, 0.11, 190, 80, 0.7, 28, 0.2)
		return b.done(1), 0.08
	},
	"crit": func() ([]float32, float64) {
		b := newSfxBuf(0.42, 2)
		b.noise(0, 0.08, 3200, 1200, 0.6, 0.6, 40)
		b.tone(0, 0.14, 230, 70, 0.8, 22, 0.3)
		b.tone(0.005, 0.38, 1480, 1460, 0.22, 9, 0)
		b.tone(0.005, 0.38, 2217, 2200, 0.14, 12, 0)
		return b.done(1.1), 0.05
	},
	"kill": func() ([]float32, float64) {
		b := newSfxBuf(0.36, 3)
		b.tone(0, 0.3, 320, 55, 0.7, 9, 0.35)
		b.noise(0, 0.22, 1500, 300, 0.8, 0.4, 14)
		b.tone(0.03, 0.2, 640, 160, 0.2, 14, 0)
		return b.done(1), 0.08
	},
	"hurt": func() ([]float32, float64) {
		b := newSfxBuf(0.24, 4)
		b.tone(0, 0.2, 130, 50, 0.9, 14, 0.4)
		b.rumble(0, 0.12, 700, 0.5, 26)
		return b.done(1.1), 0.06
	},
	"dodge": func() ([]float32, float64) {
		b := newSfxBuf(0.2, 5)
		b.noise(0, 0.18, 600, 3600, 0.5, 0.35, 9)
		return b.done(1), 0.08
	},
	"shoot": func() ([]float32, float64) {
		b := newSfxBuf(0.16, 6)
		b.noise(0, 0.12, 4200, 1300, 0.4, 0.3, 22)
		b.tone(0, 0.04, 900, 500, 0.2, 60, 0)
		return b.done(1), 0.08
	},
	"slash": func() ([]float32, float64) {
		b := newSfxBuf(0.2, 7)
		b.noise(0, 0.17, 5200, 900, 0.35, 0.5, 16)
		return b.done(1), 0.07
	},
	"stab": func() ([]float32, float64) {
		b := newSfxBuf(0.14, 8)
		b.noise(0, 0.08, 6000, 2500, 0.35, 0.45, 35)
		b.tone(0.02, 0.1, 260, 110, 0.5, 30, 0.2)
		return b.done(1), 0.07
	},
	"warcry": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 9)
		b.tone(0, 0.55, 95, 150, 0.6, 3.5, 0.9)
		b.tone(0, 0.55, 143, 220, 0.3, 4, 0.7)
		b.noise(0, 0.5, 700, 1100, 0.5, 0.3, 4)
		return b.done(1.1), 0.04
	},
	"buff": func() ([]float32, float64) {
		b := newSfxBuf(0.45, 10)
		b.tone(0, 0.4, 330, 880, 0.35, 5, 0.1)
		b.tone(0.05, 0.38, 495, 1320, 0.2, 6, 0)
		return b.done(1), 0.03
	},
	"smoke": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 11)
		b.rumble(0, 0.55, 1300, 0.4, 6)
		b.noise(0, 0.3, 2500, 700, 0.6, 0.15, 10)
		return b.done(1), 0.05
	},
	"teleport": func() ([]float32, float64) {
		b := newSfxBuf(0.4, 12)
		b.tone(0, 0.3, 1500, 180, 0.35, 8, 0.1)
		b.tone(0.02, 0.3, 2250, 270, 0.15, 9, 0)
		b.noise(0, 0.3, 4000, 600, 0.4, 0.2, 9)
		return b.done(1), 0.05
	},
	"fire": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 13)
		b.noise(0, 0.5, 500, 2600, 0.6, 0.45, 5)
		b.rumble(0.05, 0.5, 260, 0.55, 5)
		for i := 0; i < 8; i++ { // crackle
			b.noise(0.1+b.rng.Float64()*0.4, 0.012, 5000, 3000, 0.5, 0.3, 200)
		}
		return b.done(1.1), 0.06
	},
	"frost": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 14)
		b.noise(0, 0.3, 7000, 4000, 0.3, 0.3, 10)
		for i := 0; i < 9; i++ {
			f := 2600 + b.rng.Float64()*4200
			b.tone(b.rng.Float64()*0.25, 0.3, f, f*0.98, 0.1, 14, 0)
		}
		return b.done(1.1), 0.05
	},
	"shock": func() ([]float32, float64) {
		b := newSfxBuf(0.36, 15)
		for i := 0; i < 14; i++ {
			f := 300 + b.rng.Float64()*1800
			b.tone(float64(i)*0.022, 0.03, f, f*0.7, 0.3, 30, 1)
		}
		b.noise(0, 0.3, 5000, 2500, 0.3, 0.25, 9)
		return b.done(1), 0.06
	},
	"holy": func() ([]float32, float64) {
		b := newSfxBuf(1.1, 16)
		for _, m := range []float64{69, 73, 76, 81} {
			b.bell(0, m, 0.2, 4.5)
		}
		b.noise(0, 0.5, 6000, 8000, 0.2, 0.06, 6)
		return b.done(1.1), 0.02
	},
	"heal": func() ([]float32, float64) {
		b := newSfxBuf(0.8, 17)
		for i, m := range []float64{72, 76, 79, 84} {
			f := midiFreq(m)
			b.tone(float64(i)*0.07, 0.5, f, f, 0.2, 6, 0)
			b.tone(float64(i)*0.07, 0.5, f*2, f*2, 0.05, 8, 0)
		}
		return b.done(1), 0.02
	},
	"revive": func() ([]float32, float64) {
		b := newSfxBuf(1.3, 18)
		for i, m := range []float64{60, 64, 67, 72, 76, 79, 84} {
			b.bell(float64(i)*0.07, m, 0.17, 4)
		}
		return b.done(1.1), 0
	},
	"down": func() ([]float32, float64) {
		b := newSfxBuf(1.0, 19)
		b.notes(0, 0.22, 0.3, 0.35, 64, 60, 57)
		b.tone(0.6, 0.38, 104, 60, 0.5, 6, 0.5)
		return b.done(1), 0
	},
	"explode": func() ([]float32, float64) {
		b := newSfxBuf(0.9, 20)
		b.tone(0, 0.7, 140, 32, 1.0, 5, 0.5)
		b.rumble(0, 0.8, 900, 0.8, 5.5)
		b.noise(0, 0.1, 3000, 800, 0.6, 0.5, 30)
		return b.done(1.3), 0.06
	},
	"slam": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 21)
		b.tone(0, 0.45, 110, 36, 1.0, 8, 0.5)
		b.rumble(0, 0.5, 600, 0.8, 9)
		b.noise(0, 0.05, 2500, 1000, 0.6, 0.5, 50)
		return b.done(1.3), 0.06
	},
	"windup": func() ([]float32, float64) {
		b := newSfxBuf(0.4, 22)
		b.tone(0, 0.36, 220, 520, 0.22, 1.5, 0.5)
		b.tone(0, 0.36, 233, 551, 0.16, 1.5, 0.5)
		return b.done(1), 0.05
	},
	"combo": func() ([]float32, float64) {
		b := newSfxBuf(0.7, 23)
		b.tone(0, 0.3, 196, 196, 0.35, 8, 0.8)
		b.tone(0, 0.3, 294, 294, 0.3, 8, 0.8)
		b.notes(0.04, 0.05, 0.3, 0.2, 79, 86, 91)
		b.noise(0, 0.1, 5000, 2000, 0.4, 0.3, 25)
		return b.done(1.1), 0.03
	},
	"bosskill": func() ([]float32, float64) {
		b := newSfxBuf(2.2, 24)
		b.tone(0, 0.9, 120, 30, 0.9, 4, 0.5)
		b.rumble(0, 1.0, 800, 0.7, 4)
		for i, m := range []float64{50, 57, 62, 66, 69, 74} {
			b.bell(0.25+float64(i)*0.1, m, 0.2, 2.2)
		}
		return b.done(1.2), 0
	},
	"boss": func() ([]float32, float64) {
		b := newSfxBuf(1.4, 25)
		b.tone(0, 1.2, 73, 69, 0.6, 2, 0.9)
		b.tone(0, 1.2, 103, 98, 0.45, 2, 0.9) // a tritone above: trouble
		b.rumble(0, 0.6, 500, 0.6, 5)
		return b.done(1.2), 0
	},
	"ambush": func() ([]float32, float64) {
		b := newSfxBuf(0.8, 26)
		b.tone(0, 0.3, 147, 147, 0.4, 5, 0.9)
		b.tone(0.2, 0.5, 208, 208, 0.4, 4, 0.9)
		b.tone(0, 0.3, 90, 45, 0.7, 10, 0.3)
		return b.done(1.1), 0.02
	},
	"curse": func() ([]float32, float64) {
		b := newSfxBuf(1.1, 27)
		b.tone(0, 1.0, 440, 330, 0.25, 2.5, 0.2)
		b.tone(0, 1.0, 466, 349, 0.22, 2.5, 0.2)
		b.noise(0, 0.9, 1200, 400, 0.3, 0.12, 3)
		return b.done(1), 0.02
	},
	"victory": func() ([]float32, float64) {
		b := newSfxBuf(1.5, 28)
		b.notes(0, 0.11, 0.3, 0.26, 67, 72, 76, 79)
		for _, m := range []float64{72, 76, 79, 84} {
			b.bell(0.44, m, 0.16, 3)
		}
		return b.done(1), 0
	},
	// ---- finding things
	"gold": func() ([]float32, float64) {
		b := newSfxBuf(0.3, 30)
		b.tone(0, 0.12, 1760, 1760, 0.22, 22, 0)
		b.tone(0.05, 0.22, 2637, 2637, 0.22, 14, 0)
		b.tone(0.05, 0.2, 4310, 4310, 0.06, 20, 0)
		return b.done(1), 0.05
	},
	"item": func() ([]float32, float64) {
		b := newSfxBuf(0.32, 31)
		b.notes(0, 0.07, 0.2, 0.22, 76, 81)
		return b.done(1), 0.03
	},
	"drink": func() ([]float32, float64) {
		b := newSfxBuf(0.42, 32)
		for i := 0; i < 4; i++ {
			f := 380 + float64(i)*110
			b.tone(float64(i)*0.085, 0.07, f, f*1.5, 0.3, 18, 0)
		}
		return b.done(1), 0.05
	},
	"chest": func() ([]float32, float64) {
		b := newSfxBuf(1.0, 33)
		b.tone(0, 0.18, 150, 240, 0.25, 6, 0.9) // creak
		b.noise(0, 0.05, 1200, 600, 0.6, 0.4, 40)
		for i, m := range []float64{84, 88, 91, 96} {
			b.bell(0.16+float64(i)*0.06, m, 0.14, 5)
		}
		return b.done(1), 0.02
	},
	"shrine": func() ([]float32, float64) {
		b := newSfxBuf(1.5, 34)
		for _, m := range []float64{57, 64, 69, 73} {
			b.bell(0, m, 0.2, 2.8)
		}
		return b.done(1.1), 0
	},
	"urn": func() ([]float32, float64) {
		b := newSfxBuf(0.36, 35)
		b.noise(0, 0.1, 5000, 2500, 0.4, 0.5, 25)
		for i := 0; i < 7; i++ {
			f := 1800 + b.rng.Float64()*3800
			b.tone(b.rng.Float64()*0.14, 0.12, f, f, 0.12, 30, 0)
		}
		b.tone(0, 0.08, 300, 150, 0.4, 35, 0.2)
		return b.done(1), 0.08
	},
	"fountain": func() ([]float32, float64) {
		b := newSfxBuf(1.1, 36)
		for i := 0; i < 14; i++ {
			f := 500 + b.rng.Float64()*1400
			b.tone(b.rng.Float64()*0.7, 0.06, f, f*1.6, 0.12, 25, 0)
		}
		b.noise(0, 1.0, 3000, 3500, 0.5, 0.05, 2)
		for i, m := range []float64{72, 79, 84} {
			b.bell(0.3+float64(i)*0.12, m, 0.1, 4)
		}
		return b.done(1), 0.03
	},
	"discover": func() ([]float32, float64) {
		b := newSfxBuf(0.7, 37)
		b.bell(0, 76, 0.09, 6)
		b.bell(0.12, 83, 0.09, 5)
		return b.done(1), 0.02
	},
	"step": func() ([]float32, float64) {
		b := newSfxBuf(0.07, 38)
		b.rumble(0, 0.05, 500, 0.3, 60)
		b.noise(0, 0.02, 1800, 900, 0.7, 0.1, 120)
		return b.done(1), 0.1
	},
	// ---- milestones and menus
	"levelup": func() ([]float32, float64) {
		b := newSfxBuf(1.2, 40)
		b.notes(0, 0.085, 0.22, 0.26, 72, 76, 79)
		b.bell(0.26, 84, 0.22, 3)
		b.bell(0.26, 88, 0.14, 3.5)
		return b.done(1), 0
	},
	"death": func() ([]float32, float64) {
		b := newSfxBuf(1.6, 41)
		b.notes(0, 0.24, 0.4, 0.3, 64, 60, 57, 52)
		b.tone(0.72, 0.8, 82, 55, 0.5, 3.5, 0.5)
		return b.done(1), 0
	},
	"legendary": func() ([]float32, float64) {
		b := newSfxBuf(1.5, 42)
		for i, m := range []float64{84, 88, 91, 96, 100} {
			b.bell(float64(i)*0.065, m, 0.16, 3.5)
		}
		b.bell(0.33, 72, 0.2, 2.5)
		return b.done(1), 0
	},
	"achievement": func() ([]float32, float64) {
		b := newSfxBuf(1.0, 43)
		b.notes(0, 0.12, 0.3, 0.25, 79, 86)
		b.bell(0.12, 91, 0.12, 4)
		return b.done(1), 0
	},
	"quest": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 44)
		b.notes(0, 0.08, 0.25, 0.22, 81, 88, 93)
		return b.done(1), 0
	},
	"select": func() ([]float32, float64) {
		b := newSfxBuf(0.09, 45)
		b.tone(0, 0.07, 880, 990, 0.2, 30, 0.1)
		return b.done(1), 0
	},
	"back": func() ([]float32, float64) {
		b := newSfxBuf(0.09, 46)
		b.tone(0, 0.07, 660, 520, 0.2, 30, 0.1)
		return b.done(1), 0
	},
	"start": func() ([]float32, float64) {
		b := newSfxBuf(0.6, 47)
		b.notes(0, 0.08, 0.25, 0.24, 69, 76, 81)
		return b.done(1), 0
	},
}

type sfxClip struct {
	pcm  []float32
	vary float64
}

var (
	sfxMu    sync.Mutex
	sfxCache = map[string]*sfxClip{}
)

// sfxFor returns a clip, rendering it the first time (nil if unknown).
func sfxFor(name string) *sfxClip {
	sfxMu.Lock()
	defer sfxMu.Unlock()
	if c, ok := sfxCache[name]; ok {
		return c
	}
	recipe, ok := sfxRecipes[name]
	if !ok {
		sfxCache[name] = nil
		return nil
	}
	pcm, vary := recipe()
	c := &sfxClip{pcm, vary}
	sfxCache[name] = c
	return c
}

// warmSFX renders every effect in the background so the first hit isn't late.
func warmSFX() {
	for name := range sfxRecipes {
		sfxFor(name)
	}
}
