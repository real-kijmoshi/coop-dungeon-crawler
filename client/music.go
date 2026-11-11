package main

// A tiny procedural chiptune composer and synthesizer.
//
// Every track is described by a Song (tempo, key, scale, chord progression,
// instruments and sections). compose() turns it into notes with a seeded RNG,
// so the same song always sounds the same, and render() mixes the notes into
// 16-bit PCM using band-limited square/saw waves, triangles, noise drums, a
// soft pad, an echo on the lead and a gentle low-pass.

import (
	"math"
	"math/rand"
)

const sampleRate = 22050

var (
	scaleMinor     = []int{0, 2, 3, 5, 7, 8, 10}
	scaleHarmonic  = []int{0, 2, 3, 5, 7, 8, 11}
	scaleDorian    = []int{0, 2, 3, 5, 7, 9, 10}
	scalePhrygian  = []int{0, 1, 3, 5, 7, 8, 10}
	scaleMajor     = []int{0, 2, 4, 5, 7, 9, 11}
	scaleMixolydia = []int{0, 2, 4, 5, 7, 9, 10}
)

// Section kinds: which parts play.
const (
	secIntro = iota // pad + bass (+ arp)
	secA            // everything, main theme
	secB            // everything, second theme, higher
	secBreak        // no drums, sparse
)

type Song struct {
	Name     string
	BPM      float64
	Root     int   // MIDI note of the tonic (bass octave)
	Scale    []int // intervals
	Prog     []int // chord degree per bar, repeated
	Sections []int // one per 4 bars
	Seed     int64

	LeadDuty   float64 // 0 = triangle lead
	LeadGain   float64
	LeadOctave int     // octaves above Root
	Echo       float64 // lead echo mix
	ArpGain    float64
	ArpRate    int // steps per arp note (1 = 16ths, 2 = 8ths)
	BassGain   float64
	BassStyle  int // 0 sustained, 1 quarters, 2 eighth octave bounce, 3 driving eighths
	PadGain    float64
	DrumStyle  int // 0 none, 1 soft hats, 2 heartbeat, 3 rock, 4 driving
	DrumGain   float64
	Brightness float64 // master low-pass cutoff in Hz
	Swing      float64 // 0..0.3 delay on odd 8th notes
}

// The game's soundtrack.
var songs = map[string]Song{
	// Main menu: heroic and a little sad.
	"title": {Name: "title", BPM: 92, Root: 45, Scale: scaleMinor, Prog: []int{0, 5, 2, 6, 0, 5, 3, 4},
		Sections: []int{secIntro, secA, secA, secB, secB, secA}, Seed: 11,
		LeadDuty: 0.25, LeadGain: 0.30, LeadOctave: 2, Echo: 0.32, ArpGain: 0.07, ArpRate: 1,
		BassGain: 0.34, BassStyle: 2, PadGain: 0.10, DrumStyle: 1, DrumGain: 0.22, Brightness: 7000},
	// Safe room: warm and calm.
	"town": {Name: "town", BPM: 76, Root: 41, Scale: scaleMajor, Prog: []int{0, 4, 5, 3, 0, 4, 3, 4},
		Sections: []int{secIntro, secA, secA, secB, secA, secBreak}, Seed: 23,
		LeadDuty: 0, LeadGain: 0.36, LeadOctave: 2, Echo: 0.28, ArpGain: 0.07, ArpRate: 2,
		BassGain: 0.30, BassStyle: 1, PadGain: 0.12, DrumStyle: 1, DrumGain: 0.12, Brightness: 5200, Swing: 0.12},
	// The upper dungeon: curious, adventurous.
	"explore": {Name: "explore", BPM: 86, Root: 40, Scale: scaleDorian, Prog: []int{0, 0, 6, 3, 0, 5, 6, 4},
		Sections: []int{secIntro, secBreak, secA, secA, secB, secBreak, secA, secB}, Seed: 37,
		LeadDuty: 0.125, LeadGain: 0.24, LeadOctave: 2, Echo: 0.38, ArpGain: 0.06, ArpRate: 1,
		BassGain: 0.32, BassStyle: 1, PadGain: 0.09, DrumStyle: 1, DrumGain: 0.16, Brightness: 6000},
	// The deep: crypts, fire and the abyss.
	"deep": {Name: "deep", BPM: 70, Root: 38, Scale: scalePhrygian, Prog: []int{0, 1, 0, 6, 0, 1, 5, 4},
		Sections: []int{secIntro, secBreak, secA, secA, secB, secBreak}, Seed: 53,
		LeadDuty: 0.5, LeadGain: 0.20, LeadOctave: 1, Echo: 0.45, ArpGain: 0.05, ArpRate: 2,
		BassGain: 0.36, BassStyle: 0, PadGain: 0.15, DrumStyle: 2, DrumGain: 0.30, Brightness: 3600},
	// Boss fights: fast and loud.
	"boss": {Name: "boss", BPM: 148, Root: 40, Scale: scaleHarmonic, Prog: []int{0, 0, 5, 4, 0, 0, 6, 4},
		Sections: []int{secA, secA, secB, secB, secA, secB}, Seed: 71,
		LeadDuty: 0.5, LeadGain: 0.26, LeadOctave: 2, Echo: 0.18, ArpGain: 0.06, ArpRate: 1,
		BassGain: 0.36, BassStyle: 3, PadGain: 0.06, DrumStyle: 4, DrumGain: 0.34, Brightness: 7500},
}

type note struct {
	start, dur float64 // seconds
	midi       float64
	vel        float64
	inst       int
}

const (
	instLead = iota
	instBass
	instArp
	instPad
	instKick
	instSnare
	instHat
)

func midiFreq(m float64) float64 { return 440 * math.Pow(2, (m-69)/12) }

// degree -> MIDI note in the song's scale (degree 7 is one octave up).
func (s Song) pitch(deg int) float64 {
	oct := int(math.Floor(float64(deg) / 7))
	i := deg - oct*7
	return float64(s.Root + 12*oct + s.Scale[i])
}

type motifNote struct {
	step, len int // in 16th steps within a 2-bar phrase (32 steps)
	off       int // scale degrees relative to the chord root
}

var rhythms = [][][2]int{
	{{0, 4}, {4, 2}, {6, 2}, {8, 4}, {12, 4}, {16, 6}, {22, 2}, {24, 8}},
	{{0, 2}, {2, 2}, {4, 4}, {8, 2}, {10, 2}, {12, 4}, {16, 4}, {20, 4}, {24, 8}},
	{{0, 6}, {6, 2}, {8, 8}, {16, 2}, {18, 2}, {20, 2}, {22, 2}, {24, 8}},
	{{0, 3}, {3, 3}, {6, 2}, {8, 8}, {16, 3}, {19, 3}, {22, 2}, {24, 4}, {28, 4}},
	{{0, 8}, {8, 4}, {12, 4}, {16, 8}, {24, 8}},
	{{2, 2}, {4, 2}, {6, 2}, {8, 6}, {14, 2}, {16, 4}, {20, 2}, {22, 2}, {24, 8}},
}

// makeMotif writes a 2-bar melodic idea as offsets from the chord root, so it can be
// repeated over other chords (a "sequence") and still fit the harmony.
func makeMotif(rng *rand.Rand, center int) []motifNote {
	rh := rhythms[rng.Intn(len(rhythms))]
	chordTones := []int{0, 2, 4, 7}
	cur := center
	out := make([]motifNote, 0, len(rh))
	for i, r := range rh {
		strong := r[0]%8 == 0 || i == len(rh)-1
		if strong {
			// nearest chord tone (in any octave) to where the melody is, with a nudge
			best, bestD := cur, 99
			for oct := -7; oct <= 14; oct += 7 {
				for _, t := range chordTones {
					c := t + oct
					d := absi(c - (cur + rng.Intn(3) - 1))
					if d < bestD {
						best, bestD = c, d
					}
				}
			}
			cur = best
		} else {
			step := []int{-2, -1, -1, 1, 1, 2, 0}[rng.Intn(7)]
			// pull back toward the center
			if cur > center+4 {
				step = -absi(step)
			} else if cur < center-3 {
				step = absi(step)
			}
			cur += step
		}
		out = append(out, motifNote{r[0], r[1], cur})
	}
	// end the phrase on the root or the fifth
	last := &out[len(out)-1]
	if rng.Intn(2) == 0 {
		last.off = roundTo(last.off, 7)
	} else {
		last.off = roundTo(last.off-4, 7) + 4
	}
	return out
}

func roundTo(v, m int) int { return int(math.Round(float64(v)/float64(m))) * m }

func absi(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// compose turns a song into notes.
func compose(s Song) ([]note, float64) {
	rng := rand.New(rand.NewSource(s.Seed))
	step := 60 / s.BPM / 4 // one 16th note
	bar := step * 16
	var notes []note
	add := func(t, d, m, v float64, inst int) {
		notes = append(notes, note{t, d, m, v, inst})
	}

	motifA := []([]motifNote){makeMotif(rng, 7), makeMotif(rng, 7)}
	motifB := []([]motifNote){makeMotif(rng, 9), makeMotif(rng, 8)}
	nBars := len(s.Sections) * 4
	swing := func(st int) float64 {
		if st%4 == 2 {
			return s.Swing * step * 2
		}
		return 0
	}

	for b := 0; b < nBars; b++ {
		sec := s.Sections[b/4]
		t0 := float64(b) * bar
		deg := s.Prog[b%len(s.Prog)]
		chord := []int{deg, deg + 2, deg + 4}
		// Harmonic minor: make the V chord major (raised 7th already in the scale).

		// Pad: the chord, held for the bar.
		if s.PadGain > 0 {
			for _, c := range chord {
				add(t0, bar*1.02, s.pitch(c)+12, s.PadGain, instPad)
			}
		}

		// Bass
		root := s.pitch(deg)
		switch s.BassStyle {
		case 0:
			add(t0, bar*0.98, root, s.BassGain, instBass)
		case 1:
			for q := 0; q < 4; q++ {
				m := root
				if q == 2 && rng.Intn(3) == 0 {
					m = s.pitch(deg + 4)
				}
				add(t0+float64(q*4)*step, step*3.2, m, s.BassGain, instBass)
			}
		case 2:
			for e := 0; e < 8; e++ {
				m := root
				if e%2 == 1 {
					m += 12
				}
				add(t0+float64(e*2)*step+swing(e*2), step*1.7, m, s.BassGain*(1-0.15*float64(e%2)), instBass)
			}
		case 3:
			for e := 0; e < 8; e++ {
				m := root
				if e == 6 {
					m = s.pitch(deg + 4)
				}
				add(t0+float64(e*2)*step, step*1.5, m, s.BassGain, instBass)
			}
		}

		// Arpeggio over the chord, up and down
		if s.ArpGain > 0 && sec != secBreak {
			seq := []int{chord[0], chord[1], chord[2], chord[0] + 7, chord[2], chord[1]}
			n := 16 / s.ArpRate
			for i := 0; i < n; i++ {
				st := i * s.ArpRate
				add(t0+float64(st)*step+swing(st), step*float64(s.ArpRate)*0.8, s.pitch(seq[i%len(seq)])+24, s.ArpGain, instArp)
			}
		}

		// Lead: motifs in 2-bar phrases; in each 8 bars: X X' Y X''
		if s.LeadGain > 0 && (sec == secA || sec == secB || (sec == secBreak && b%8 >= 4)) {
			if b%2 == 0 {
				phrase := (b / 2) % 4
				set := motifA
				if sec == secB {
					set = motifB
				}
				m := set[0]
				if phrase == 2 {
					m = set[1]
				}
				for i, mn := range m {
					if sec == secBreak && i%2 == 1 {
						continue // sparse
					}
					barOff := mn.step / 16
					chordRoot := s.Prog[(b+barOff)%len(s.Prog)]
					off := mn.off
					if phrase == 1 && i == len(m)-1 {
						off += 2 // variation: end on the third instead
					}
					d := s.pitch(chordRoot+off) + float64(12*(s.LeadOctave-1))
					st := mn.step
					add(t0+float64(st)*step+swing(st), float64(mn.len)*step*0.92, d, s.LeadGain, instLead)
				}
			}
		}

		// Drums
		if sec == secIntro && s.DrumStyle != 2 || sec == secBreak && s.DrumStyle != 2 {
			continue
		}
		g := s.DrumGain
		for st := 0; st < 16; st++ {
			t := t0 + float64(st)*step + swing(st)
			switch s.DrumStyle {
			case 1: // soft hats + kick on 1
				if st%4 == 2 {
					add(t, 0.05, 0, g*0.5, instHat)
				}
				if st == 0 {
					add(t, 0.2, 0, g*0.8, instKick)
				}
			case 2: // heartbeat
				if st == 0 || st == 3 {
					add(t, 0.25, 0, g*map[bool]float64{true: 1, false: 0.7}[st == 0], instKick)
				}
				if sec != secIntro && st%8 == 6 {
					add(t, 0.04, 0, g*0.25, instHat)
				}
			case 3: // rock
				if st == 0 || st == 8 || st == 10 {
					add(t, 0.2, 0, g, instKick)
				}
				if st == 4 || st == 12 {
					add(t, 0.15, 0, g*0.8, instSnare)
				}
				if st%2 == 0 {
					add(t, 0.04, 0, g*0.4, instHat)
				}
			case 4: // driving
				if st%4 == 0 {
					add(t, 0.18, 0, g, instKick)
				}
				if st == 4 || st == 12 || (st == 14 && b%4 == 3) {
					add(t, 0.15, 0, g*0.85, instSnare)
				}
				add(t, 0.03, 0, g*0.3*float64(1+st%2), instHat)
			}
		}
	}
	return notes, float64(nBars) * bar
}

// ------------------------------------------------------------------ synthesis

// polyBLEP smooths the jumps of naive square/saw waves (less harsh aliasing).
func polyBLEP(t, dt float64) float64 {
	if t < dt {
		t /= dt
		return t + t - t*t - 1
	}
	if t > 1-dt {
		t = (t - 1) / dt
		return t*t + t + t + 1
	}
	return 0
}

func env(t, dur, a, d, s, r float64) float64 {
	var v float64
	switch {
	case t < a:
		v = t / a
	case t < a+d:
		v = 1 - (1-s)*(t-a)/d
	default:
		v = s
	}
	if t > dur {
		v *= math.Max(0, 1-(t-dur)/r)
	}
	return v
}

// render mixes a song to mono 16-bit PCM at the given volume (0..1).
func render(s Song, volume float64) []int16 {
	notes, length := compose(s)
	n := int(length*sampleRate) + 1
	lead := make([]float64, n)
	mix := make([]float64, n)
	noise := rand.New(rand.NewSource(s.Seed * 7))

	for _, nt := range notes {
		i0 := int(nt.start * sampleRate)
		freq := midiFreq(nt.midi)
		dt := freq / sampleRate
		var a, d, su, rel float64
		var buf = mix
		switch nt.inst {
		case instLead:
			a, d, su, rel, buf = 0.008, 0.12, 0.65, 0.09, lead
		case instBass:
			a, d, su, rel = 0.004, 0.2, 0.8, 0.05
		case instArp:
			a, d, su, rel = 0.002, 0.07, 0.15, 0.03
		case instPad:
			a, d, su, rel = 0.45, 0.4, 0.8, 0.5
		case instKick:
			a, d, su, rel = 0.001, 0.16, 0, 0.01
		case instSnare:
			a, d, su, rel = 0.001, 0.13, 0, 0.01
		case instHat:
			a, d, su, rel = 0.001, 0.035, 0, 0.005
		}
		total := nt.dur + rel
		if nt.inst >= instKick {
			total = a + d + rel
		}
		cnt := int(total * sampleRate)
		phase, phase2 := 0.0, 0.25
		lp := 0.0
		hold := 0.0
		for k := 0; k < cnt && i0+k < n; k++ {
			t := float64(k) / sampleRate
			e := env(t, nt.dur, a, d, su, rel)
			if e <= 0 && t > a {
				if nt.inst >= instKick || t > nt.dur {
					break
				}
			}
			var v float64
			switch nt.inst {
			case instLead:
				vib := 1.0
				if t > 0.18 {
					vib = math.Pow(2, 0.18/12*math.Sin(2*math.Pi*5.5*t)*math.Min(1, (t-0.18)*3))
				}
				ddt := dt * vib
				if s.LeadDuty == 0 {
					v = 2*math.Abs(2*phase-1) - 1 // triangle
				} else {
					v = sqrBLEP(phase, ddt, s.LeadDuty)
				}
				phase += ddt
			case instBass:
				tri := 2*math.Abs(2*phase-1) - 1
				v = tri*0.85 + sqrBLEP(phase, dt, 0.5)*0.15
				phase += dt
			case instArp:
				v = sqrBLEP(phase, dt, 0.125)
				phase += dt
			case instPad:
				// two detuned saws through a low-pass
				s1 := 2*phase - 1 - polyBLEP(phase, dt)
				dt2 := dt * 1.006
				s2 := 2*phase2 - 1 - polyBLEP(phase2, dt2)
				phase += dt
				phase2 += dt2
				if phase2 >= 1 {
					phase2--
				}
				lp += (0.5*(s1+s2) - lp) * 0.08
				v = lp
			case instKick:
				f := 45 + 110*math.Exp(-t*35)
				phase += f / sampleRate
				v = math.Sin(2*math.Pi*phase) * 1.2
			case instSnare:
				w := noise.Float64()*2 - 1
				lp += (w - lp) * 0.5
				phase += 185.0 / sampleRate
				v = lp*0.8 + math.Sin(2*math.Pi*phase)*0.4*math.Exp(-t*40)
			case instHat:
				w := noise.Float64()*2 - 1
				v = w - hold // crude high-pass
				hold = w
				v *= 0.5
			}
			if phase >= 1 {
				phase -= math.Floor(phase)
			}
			buf[i0+k] += v * e * nt.vel
		}
	}

	// echo on the lead (dotted eighth), then mix
	if s.Echo > 0 {
		delay := int(60 / s.BPM * 0.75 * sampleRate)
		for i := delay; i < n; i++ {
			lead[i] += lead[i-delay] * s.Echo
		}
	}
	for i := range mix {
		mix[i] += lead[i]
	}

	// master low-pass, fades, normalise, soft clip
	alpha := 1 - math.Exp(-2*math.Pi*s.Brightness/sampleRate)
	y := 0.0
	peak := 0.0
	for i := range mix {
		y += (mix[i] - y) * alpha
		mix[i] = y
		if math.Abs(y) > peak {
			peak = math.Abs(y)
		}
	}
	fadeIn, fadeOut := int(0.04*sampleRate), int(0.6*sampleRate)
	gain := 0.9 / math.Max(peak, 0.01) * volume
	out := make([]int16, n)
	for i, v := range mix {
		f := 1.0
		if i < fadeIn {
			f = float64(i) / float64(fadeIn)
		}
		if i > n-fadeOut {
			f = float64(n-i) / float64(fadeOut)
		}
		v = math.Tanh(v*gain*1.2) / 1.2 * f
		out[i] = int16(v * 32767)
	}
	return out
}

func sqrBLEP(phase, dt, duty float64) float64 {
	v := -1.0
	if phase < duty {
		v = 1
	}
	v += polyBLEP(phase, dt)
	p2 := phase - duty
	if p2 < 0 {
		p2++
	}
	v -= polyBLEP(p2, dt)
	return v
}

// ------------------------------------------------------------------ sound effects

type sfxNote struct {
	at, dur, midi float64
	duty          float64 // 0 = triangle, -1 = noise
}

var sfxDefs = map[string][]sfxNote{
	"levelup":     {{0, 0.09, 72, 0.25}, {0.08, 0.09, 76, 0.25}, {0.16, 0.09, 79, 0.25}, {0.24, 0.35, 84, 0.25}, {0.24, 0.35, 88, 0}},
	"death":       {{0, 0.25, 64, 0.5}, {0.22, 0.25, 60, 0.5}, {0.44, 0.25, 57, 0.5}, {0.66, 0.7, 52, 0.5}},
	"legendary":   {{0, 0.08, 84, 0.125}, {0.06, 0.08, 88, 0.125}, {0.12, 0.08, 91, 0.125}, {0.18, 0.08, 96, 0.125}, {0.24, 0.5, 100, 0}, {0.24, 0.5, 91, 0.25}},
	"achievement": {{0, 0.12, 79, 0.25}, {0.12, 0.4, 86, 0.25}, {0.12, 0.4, 79, 0}},
	"quest":       {{0, 0.07, 88, 0.125}, {0.07, 0.25, 93, 0.125}},
	"boss":        {{0, 0.5, 40, 0.5}, {0, 0.5, 46, 0.5}, {0, 0.4, 0, -1}},
	"select":      {{0, 0.05, 81, 0.25}},
	"back":        {{0, 0.05, 74, 0.25}},
	"start":       {{0, 0.07, 69, 0.25}, {0.07, 0.07, 76, 0.25}, {0.14, 0.2, 81, 0.25}},
}

func renderSFX(name string, volume float64) []int16 {
	def := sfxDefs[name]
	end := 0.0
	for _, n := range def {
		end = math.Max(end, n.at+n.dur+0.08)
	}
	n := int(end * sampleRate)
	buf := make([]float64, n)
	rng := rand.New(rand.NewSource(3))
	for _, nt := range def {
		i0 := int(nt.at * sampleRate)
		dt := midiFreq(nt.midi) / sampleRate
		phase := 0.0
		cnt := int((nt.dur + 0.06) * sampleRate)
		for k := 0; k < cnt && i0+k < n; k++ {
			t := float64(k) / sampleRate
			e := env(t, nt.dur, 0.003, nt.dur*0.6, 0.4, 0.06)
			var v float64
			switch {
			case nt.duty < 0:
				v = (rng.Float64()*2 - 1) * math.Exp(-t*8)
			case nt.duty == 0:
				v = 2*math.Abs(2*phase-1) - 1
			default:
				v = sqrBLEP(phase, dt, nt.duty)
			}
			phase += dt
			if phase >= 1 {
				phase--
			}
			buf[i0+k] += v * e * 0.35
		}
	}
	out := make([]int16, n)
	for i, v := range buf {
		out[i] = int16(math.Tanh(v*volume*1.4) * 30000)
	}
	return out
}
