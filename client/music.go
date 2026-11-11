package main

// The soundtrack: an endless, generative dark-fantasy score.
//
// Nothing is looped. Each track is a Mood (key, scale, tempo, instruments), and a
// composer writes it bar after bar for as long as it plays: it picks chord
// progressions, brings instruments in and out, and develops a couple of melodic
// motifs so the music has a theme without ever repeating exactly.
//
// Every bar is rendered into two stereo stems that share tempo and harmony:
//   - base:    drone, choir pad, harp, flute or horn, bells
//   - tension: war drums and a low string ostinato
// The mixer fades the tension stem in while monsters are hunting you, so the same
// piece of music tightens when a fight starts and relaxes when it ends.

import (
	"math"
	"math/rand"
)

const sampleRate = 44100

var (
	scaleMinor    = []int{0, 2, 3, 5, 7, 8, 10}
	scaleHarmonic = []int{0, 2, 3, 5, 7, 8, 11}
	scaleDorian   = []int{0, 2, 3, 5, 7, 9, 10}
	scalePhrygian = []int{0, 1, 3, 5, 7, 8, 10}
	scaleMajor    = []int{0, 2, 4, 5, 7, 9, 11}
	scaleLydian   = []int{0, 2, 4, 6, 7, 9, 11}
	scaleHijaz    = []int{0, 1, 4, 5, 7, 8, 10} // phrygian dominant
)

const (
	leadFlute = iota
	leadHorn
)

const (
	drumsRitual    = iota + 1 // slow taiko and toms
	drumsHeartbeat            // lub-dub
	drumsWar                  // driving 3-3-2
)

// Mood describes one track.
type Mood struct {
	BPM   float64
	Beats int // beats per bar
	Root  int // MIDI note of the tonic, bass octave
	Scale []int
	Progs [][]int // chord progressions (scale degrees, one per bar)

	Pedal  bool    // bass stays on the tonic instead of following the chords
	Drone  float64 // gains, 0 = instrument unused
	Pad    float64
	Pluck  float64
	Lead   float64
	Bell   float64
	Kind   int     // lead instrument
	Octave int     // lead octave above Root
	Busy   float64 // 0..1: how often harp and melody play
	Active bool    // quick melodic rhythms (boss) instead of long notes

	Drums    int
	DrumGain float64
	Ostinato float64
	Tension  float64 // how much of the tension stem always plays (1 = boss)

	Bright float64 // low-pass cutoff in Hz
	Reverb float64 // wet amount
	Gain   float64 // overall level
}

var moods = map[string]Mood{
	// Main menu: a sad, proud theme. Harp, choir and a flute.
	"title": {BPM: 63, Beats: 4, Root: 38, Scale: scaleMinor,
		Progs: [][]int{{0, 5, 2, 6}, {0, 3, 5, 4}, {0, 6, 5, 6}, {0, 5, 3, 4}},
		Drone: 0.5, Pad: 0.8, Pluck: 0.9, Lead: 0.9, Bell: 0.25, Kind: leadFlute, Octave: 2, Busy: 0.75,
		Drums: drumsRitual, DrumGain: 0.8, Ostinato: 0.6, Bright: 7500, Reverb: 0.34, Gain: 1.3},
	// Emberfall, the safe room: a slow lute waltz by the fire.
	"town": {BPM: 84, Beats: 3, Root: 41, Scale: scaleMajor,
		Progs: [][]int{{0, 3, 0, 4}, {0, 5, 3, 4}, {0, 4, 5, 3}, {5, 3, 0, 4}},
		Drone: 0.25, Pad: 0.6, Pluck: 1.0, Lead: 0.8, Bell: 0.1, Kind: leadFlute, Octave: 2, Busy: 0.85,
		Drums: drumsRitual, DrumGain: 0.5, Ostinato: 0.4, Bright: 8100, Reverb: 0.26, Gain: 1.5},
	// The Old Cellars: quiet, curious, a little uneasy.
	"cellars": {BPM: 58, Beats: 4, Root: 40, Scale: scaleDorian, Pedal: true,
		Progs: [][]int{{0, 0, 3, 0}, {0, 6, 0, 3}, {0, 3, 6, 0}, {0, 0, 6, 6}},
		Drone: 0.9, Pad: 0.7, Pluck: 0.75, Lead: 0.7, Bell: 0.3, Kind: leadFlute, Octave: 2, Busy: 0.45,
		Drums: drumsRitual, DrumGain: 0.9, Ostinato: 0.8, Bright: 6400, Reverb: 0.4, Gain: 1.0},
	// The Fungal Caverns: glowing, strange, dripping.
	"caverns": {BPM: 54, Beats: 4, Root: 43, Scale: scaleLydian, Pedal: true,
		Progs: [][]int{{0, 1, 0, 1}, {0, 1, 5, 1}, {0, 0, 1, 0}, {5, 1, 0, 0}},
		Drone: 0.8, Pad: 0.7, Pluck: 0.85, Lead: 0.5, Bell: 0.9, Kind: leadFlute, Octave: 3, Busy: 0.6,
		Drums: drumsRitual, DrumGain: 0.85, Ostinato: 0.8, Bright: 7200, Reverb: 0.45, Gain: 1.0},
	// The Sunken Crypts: tolling bells over a low choir.
	"crypts": {BPM: 48, Beats: 4, Root: 38, Scale: scalePhrygian, Pedal: true,
		Progs: [][]int{{0, 1, 0, 0}, {0, 1, 6, 0}, {0, 5, 1, 0}, {0, 0, 1, 1}},
		Drone: 1.0, Pad: 0.95, Pluck: 0.35, Lead: 0.6, Bell: 0.8, Kind: leadFlute, Octave: 1, Busy: 0.3,
		Drums: drumsHeartbeat, DrumGain: 1.0, Ostinato: 0.8, Bright: 4800, Reverb: 0.5, Gain: 1.05},
	// The Infernal Halls: heat, brass and distant drums.
	"infernal": {BPM: 72, Beats: 4, Root: 37, Scale: scaleHijaz, Pedal: true,
		Progs: [][]int{{0, 1, 0, 6}, {0, 1, 0, 1}, {0, 6, 1, 0}, {0, 3, 1, 0}},
		Drone: 1.0, Pad: 0.8, Pluck: 0.5, Lead: 0.75, Bell: 0.2, Kind: leadHorn, Octave: 1, Busy: 0.5,
		Drums: drumsRitual, DrumGain: 1.0, Ostinato: 0.9, Tension: 0.3, Bright: 5800, Reverb: 0.4, Gain: 1.0},
	// The Dragon's Abyss and the Throne: vast and lonely.
	"abyss": {BPM: 50, Beats: 4, Root: 36, Scale: scaleHarmonic, Pedal: true,
		Progs: [][]int{{0, 5, 0, 4}, {0, 3, 0, 4}, {0, 0, 5, 4}, {0, 5, 3, 4}},
		Drone: 1.0, Pad: 0.9, Pluck: 0.4, Lead: 0.7, Bell: 0.6, Kind: leadFlute, Octave: 3, Busy: 0.4,
		Drums: drumsHeartbeat, DrumGain: 1.0, Ostinato: 0.85, Tension: 0.2, Bright: 5500, Reverb: 0.55, Gain: 1.05},
	// Boss fights: war drums, low strings and horns.
	"boss": {BPM: 132, Beats: 4, Root: 38, Scale: scaleHarmonic,
		Progs: [][]int{{0, 0, 5, 4}, {0, 5, 3, 4}, {0, 6, 5, 4}, {0, 0, 3, 4}},
		Drone: 0.6, Pad: 0.7, Pluck: 0, Lead: 0.9, Bell: 0.15, Kind: leadHorn, Octave: 2, Busy: 0.9, Active: true,
		Drums: drumsWar, DrumGain: 1.0, Ostinato: 1.0, Tension: 1, Bright: 9400, Reverb: 0.25, Gain: 0.95},
}

// trackFor maps what the game asks for onto a mood (older names still work).
func trackFor(name string) (Mood, bool) {
	switch name {
	case "explore":
		name = "cellars"
	case "deep":
		name = "crypts"
	case "throne":
		name = "abyss"
	}
	m, ok := moods[name]
	return m, ok
}

func midiFreq(m float64) float64 { return 440 * math.Pow(2, (m-69)/12) }

// degree -> MIDI note in the mood's scale (degree 7 is one octave up).
func (m Mood) pitch(deg int) float64 {
	oct := int(math.Floor(float64(deg) / 7))
	return float64(m.Root + 12*oct + m.Scale[deg-oct*7])
}

func absi(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func roundTo(v, m int) int { return int(math.Round(float64(v)/float64(m))) * m }

// ------------------------------------------------------------------ composing

type motifNote struct {
	step, len int // 16th steps inside a two-bar phrase
	off       int // scale degrees above the chord root
}

// Two-bar rhythms as {start, length} in 16ths of a 4/4 bar.
var slowRhythms = [][][2]int{
	{{0, 6}, {6, 2}, {8, 8}, {16, 4}, {20, 4}, {24, 8}},
	{{0, 8}, {8, 4}, {12, 4}, {16, 12}},
	{{4, 4}, {8, 4}, {12, 4}, {16, 6}, {22, 2}, {24, 8}},
	{{0, 4}, {4, 4}, {8, 8}, {20, 4}, {24, 8}},
	{{0, 12}, {12, 4}, {16, 8}, {24, 6}},
	{{0, 6}, {6, 6}, {12, 4}, {16, 8}, {24, 4}, {28, 4}},
}
var fastRhythms = [][][2]int{
	{{0, 2}, {2, 2}, {4, 4}, {8, 2}, {10, 2}, {12, 4}, {16, 4}, {20, 2}, {22, 2}, {24, 8}},
	{{0, 4}, {4, 2}, {6, 2}, {8, 6}, {14, 2}, {16, 3}, {19, 3}, {22, 2}, {24, 8}},
	{{0, 3}, {3, 3}, {6, 2}, {8, 8}, {16, 3}, {19, 3}, {22, 2}, {24, 4}, {28, 4}},
	{{0, 6}, {6, 2}, {8, 4}, {12, 4}, {16, 2}, {18, 2}, {20, 4}, {24, 8}},
}

// Harp figures: indexes into the chord's tones (root, third, fifth, octave, tenth), -1 rests.
var pluckPatterns = [][]int{
	{0, 2, 3, 2, 4, 2, 3, 2},
	{0, 1, 2, 3, 4, 3, 2, 1},
	{0, -1, 2, 3, -1, 2, 4, -1},
	{0, 3, 2, 3, 1, 3, 2, 3},
	{0, -1, -1, 2, -1, -1, 3, -1},
	{0, 2, -1, 3, 2, -1, 4, 2},
}

type composer struct {
	m      Mood
	rng    *rand.Rand
	step   float64 // seconds per 16th
	steps  int     // 16ths per bar
	barLen int     // frames per bar

	bar     int
	prog    []int
	motifs  [2][]motifNote
	energy  float64
	leadOn  bool
	leadRun int // phrases in a row with (or without) melody
	pluckOn bool
	pattern []int
	phrase  int

	accB, accT   []float32 // stereo stems being written, bar + tails
	revB, revT   *reverb
	lpB, lpT     [2]float64
	fadeIn       int
	framesPlayed int
}

const tailSeconds = 14

func newComposer(m Mood, seed int64) *composer {
	c := &composer{m: m, rng: rand.New(rand.NewSource(seed))}
	c.step = 60 / m.BPM / 4
	c.steps = m.Beats * 4
	c.barLen = int(c.step * float64(c.steps) * sampleRate)
	n := (c.barLen + tailSeconds*sampleRate) * 2
	c.accB, c.accT = make([]float32, n), make([]float32, n)
	c.revB, c.revT = newReverb(0.86, 0.35), newReverb(0.78, 0.45)
	c.prog = m.Progs[c.rng.Intn(len(m.Progs))]
	c.motifs[0], c.motifs[1] = c.makeMotif(7), c.makeMotif(9)
	c.energy = 0.3
	c.fadeIn = int(1.5 * sampleRate)
	return c
}

// makeMotif writes a two-bar melodic idea as offsets from the chord root, so it can
// be repeated over other chords and still fit the harmony.
func (c *composer) makeMotif(center int) []motifNote {
	pool := slowRhythms
	if c.m.Active {
		pool = fastRhythms
	}
	rh := pool[c.rng.Intn(len(pool))]
	chordTones := []int{0, 2, 4, 7}
	cur := center
	limit := c.steps * 2
	out := make([]motifNote, 0, len(rh))
	for i, r := range rh {
		start, length := r[0], r[1]
		if c.m.Beats == 3 { // squeeze 4/4 rhythms into a waltz
			start, length = start*3/4, max(2, length*3/4)
		}
		if start >= limit {
			continue
		}
		if start+length > limit {
			length = limit - start
		}
		strong := start%8 == 0 || i == len(rh)-1
		if strong {
			best, bestD := cur, 99
			for oct := -7; oct <= 14; oct += 7 {
				for _, t := range chordTones {
					d := absi(t + oct - (cur + c.rng.Intn(3) - 1))
					if d < bestD {
						best, bestD = t+oct, d
					}
				}
			}
			cur = best
		} else {
			st := []int{-2, -1, -1, 1, 1, 2, 0}[c.rng.Intn(7)]
			if cur > center+4 {
				st = -absi(st)
			} else if cur < center-3 {
				st = absi(st)
			}
			cur += st
		}
		out = append(out, motifNote{start, length, cur})
	}
	if n := len(out); n > 0 { // end on the root or the fifth
		if c.rng.Intn(2) == 0 {
			out[n-1].off = roundTo(out[n-1].off, 7)
		} else {
			out[n-1].off = roundTo(out[n-1].off-4, 7) + 4
		}
	}
	return out
}

// plan decides, every four bars, what the next phrase sounds like.
func (c *composer) plan() {
	m, r := c.m, c.rng
	c.phrase = c.bar / 4
	if c.bar%8 == 0 {
		c.energy = clampf(c.energy+r.NormFloat64()*0.28, 0.05, 1)
		if c.bar > 0 && r.Float64() < 0.5 {
			c.prog = m.Progs[r.Intn(len(m.Progs))]
		}
		// Now and then a motif is replaced, so the theme slowly evolves.
		if c.bar > 0 && c.bar%32 == 0 {
			c.motifs[r.Intn(2)] = c.makeMotif(7 + r.Intn(3))
		}
	}
	if c.bar == 0 && !m.Active {
		c.leadOn, c.pluckOn = false, m.Busy > 0.7
		c.pattern = pluckPatterns[4]
		return
	}
	want := r.Float64() < 0.25+0.55*m.Busy+0.25*(c.energy-0.5)
	if c.leadOn == want {
		c.leadRun++
	} else {
		c.leadRun = 1
	}
	// neither sing nor stay silent for too long
	if c.leadRun > 3 || (m.Active && !want && c.leadRun > 1) {
		want, c.leadRun = !want, 1
	}
	c.leadOn = want && m.Lead > 0
	c.pluckOn = m.Pluck > 0 && r.Float64() < 0.2+0.8*m.Busy*(0.6+0.4*c.energy)
	c.pattern = pluckPatterns[r.Intn(len(pluckPatterns))]
	if !c.leadOn && !c.pluckOn && m.Pluck > 0 && r.Float64() < 0.6 {
		c.pluckOn, c.pattern = true, pluckPatterns[4]
	}
}

func (c *composer) chordAt(bar int) int { return c.prog[bar%len(c.prog)] }

// writeBar renders the notes of the next bar into the stems.
func (c *composer) writeBar() {
	if c.bar%4 == 0 {
		c.plan()
	}
	m, r := c.m, c.rng
	b := c.bar
	step := c.step
	bar := step * float64(c.steps)
	deg := c.chordAt(b)
	tones := []int{deg, deg + 2, deg + 4, deg + 7, deg + 9}
	jit := func() float64 { return r.Float64() * 0.012 }
	e := 0.75 + 0.25*c.energy

	// Drone and bass.
	if m.Drone > 0 {
		root := m.pitch(0)
		if !m.Pedal {
			root = m.pitch(deg)
			if root > float64(m.Root)+7 {
				root -= 12
			}
		}
		c.drone(c.accB, 0, bar, root, 0.13*m.Drone)
		if m.Pedal && b%2 == 0 {
			c.drone(c.accB, 0, bar*2, m.pitch(4), 0.035*m.Drone)
		}
	}

	// Pad: the chord, swelling in and out so bars melt into each other.
	if m.Pad > 0 {
		voicing := []float64{m.pitch(tones[0]) + 12, m.pitch(tones[2]) + 12, m.pitch(tones[1]) + 24}
		if c.energy > 0.6 {
			voicing = append(voicing, m.pitch(tones[0])+24)
		}
		for i, p := range voicing {
			c.pad(c.accB, 0, bar, p, 0.095*m.Pad*e, float64(i%2)*2-1)
		}
	}

	// Harp.
	if c.pluckOn {
		eighths := c.steps / 2
		for i := 0; i < eighths; i++ {
			idx := c.pattern[i%len(c.pattern)]
			if idx < 0 || (i > 0 && r.Float64() > 0.55+0.45*m.Busy) {
				continue
			}
			vel := 0.27 * m.Pluck * (0.75 + 0.25*r.Float64())
			if i%2 == 0 {
				vel *= 1.2
			}
			pan := 0.35 * math.Sin(float64(i)*1.7+float64(b))
			c.pluck(c.accB, float64(i*2)*step+jit(), m.pitch(tones[idx])+12, vel, pan)
		}
	}

	// Melody: two-bar phrases. Over eight bars: A, A', B, A (ending on a long note).
	if c.leadOn && b%2 == 0 {
		ph := (b / 2) % 4
		motif := c.motifs[0]
		if ph == 2 {
			motif = c.motifs[1]
		}
		for i, mn := range motif {
			if !m.Active && c.energy < 0.3 && i%2 == 1 && i != len(motif)-1 {
				continue // thin it out when things are quiet
			}
			chord := c.chordAt(b + mn.step/c.steps)
			off, length := mn.off, float64(mn.len)
			last := i == len(motif)-1
			if ph == 1 && last {
				off += 2
			}
			if ph == 3 && last {
				length *= 1.5
			}
			p := m.pitch(chord+off) + float64(12*(m.Octave-1))
			t := float64(mn.step)*step + jit()
			if m.Kind == leadHorn {
				c.horn(c.accB, t, length*step*0.95, p, 0.21*m.Lead, 0.1)
			} else {
				c.flute(c.accB, t, length*step*0.95, p, 0.27*m.Lead, 0.12)
			}
		}
	}

	// Bells.
	if m.Bell > 0 && r.Float64() < 0.3*m.Bell+0.15*m.Bell*c.energy {
		at := float64(r.Intn(m.Beats)*4) * step
		c.bell(c.accB, at, m.pitch(tones[r.Intn(3)])+24+float64(12*r.Intn(2)), 0.15*m.Bell*(0.6+0.4*r.Float64()), r.Float64()*1.2-0.6)
	}

	// ---- tension stem: drums and a low string ostinato
	g := m.DrumGain
	fill := b%4 == 3
	for st := 0; st < c.steps; st++ {
		t := float64(st) * step
		switch m.Drums {
		case drumsRitual:
			switch {
			case st == 0:
				c.taiko(c.accT, t, 0.85*g, 0)
			case st == 10 || (st == 6 && c.steps > 12):
				c.taiko(c.accT, t, 0.5*g, 0.1)
			case st%4 == 2 && st != 2:
				c.tom(c.accT, t, 0.3*g, -0.3)
			case fill && st >= c.steps-3:
				c.tom(c.accT, t, 0.25*g+0.08*float64(st-c.steps+3), 0.3)
			}
		case drumsHeartbeat:
			if st == 0 {
				c.taiko(c.accT, t, 0.9*g, 0)
			} else if st == 3 {
				c.taiko(c.accT, t, 0.55*g, 0)
			} else if st == 8 && b%2 == 1 {
				c.tom(c.accT, t, 0.3*g, 0.3)
			}
		case drumsWar:
			switch {
			case st == 0 || st == 8:
				c.taiko(c.accT, t, 0.9*g, 0)
			case st == 3 || st == 6 || st == 11:
				c.taiko(c.accT, t, 0.5*g, 0.15)
			case st == 4 || st == 12:
				c.snare(c.accT, t, 0.42*g, -0.1)
			case fill && st >= 13:
				c.tom(c.accT, t, 0.4*g, 0.35-0.2*float64(st-13))
			}
			if st%2 == 0 {
				c.shaker(c.accT, t, 0.09*g*(1+float64(st%4)/4), 0.4)
			}
		}
	}
	if m.Ostinato > 0 {
		figure := []int{0, 0, 4, 0, 2, 0, 4, 0}
		root := deg
		if m.Pedal {
			root = 0
		}
		for i := 0; i < c.steps/2; i++ {
			vel := 0.13 * m.Ostinato
			if i%4 == 0 {
				vel *= 1.35
			}
			c.staccato(c.accT, float64(i*2)*step, step*1.6, m.pitch(root+figure[i%len(figure)])+12, vel, -0.2)
		}
	}
	c.bar++
}

// nextBar returns the finished audio of one bar: two interleaved stereo stems.
func (c *composer) nextBar() (base, tens []float32) {
	c.writeBar()
	n := c.barLen * 2
	base, tens = make([]float32, n), make([]float32, n)
	copy(base, c.accB[:n])
	copy(tens, c.accT[:n])
	for _, acc := range [][]float32{c.accB, c.accT} {
		copy(acc, acc[n:])
		clear(acc[len(acc)-n:])
	}
	c.revB.process(base, c.m.Reverb)
	c.revT.process(tens, c.m.Reverb*0.6)
	alpha := 1 - math.Exp(-2*math.Pi*c.m.Bright/sampleRate)
	gain := float32(c.m.Gain)
	for i := 0; i < n; i += 2 {
		for ch := 0; ch < 2; ch++ {
			c.lpB[ch] += (float64(base[i+ch]) - c.lpB[ch]) * alpha
			c.lpT[ch] += (float64(tens[i+ch]) - c.lpT[ch]) * alpha
			f := gain
			if c.framesPlayed < c.fadeIn {
				f *= float32(c.framesPlayed) / float32(c.fadeIn)
			}
			base[i+ch], tens[i+ch] = float32(c.lpB[ch])*f, float32(c.lpT[ch])*f
		}
		c.framesPlayed++
	}
	return base, tens
}

// ---------------------------------------------------------------- instruments

// add mixes one mono sample into a stereo stem with constant-power panning.
type panner struct{ l, r float32 }

func panOf(pan float64) panner {
	a := (clampf(pan, -1, 1) + 1) * math.Pi / 4
	return panner{float32(math.Cos(a)), float32(math.Sin(a))}
}

func frameAt(t float64) int { return int(t * sampleRate) }

// drone: a low sine with a quiet fifth of harmonics, breathing slowly.
func (c *composer) drone(acc []float32, t, dur, midi, vel float64) {
	i0, n := frameAt(t), frameAt(dur+2.5)
	dt := midiFreq(midi) / sampleRate
	ph, lp := c.rng.Float64(), 0.0
	lfo := c.rng.Float64() * 6
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		env := math.Min(1, ts/1.5)
		if ts > dur {
			env *= math.Max(0, 1-(ts-dur)/2.5)
		}
		saw := 2*ph - 1
		lp += (saw - lp) * 0.06
		v := (math.Sin(2*math.Pi*ph) + 0.6*math.Sin(4*math.Pi*ph) + 0.3*math.Sin(6*math.Pi*ph) + lp*1.6) * env * vel * (0.85 + 0.15*math.Sin(lfo+ts*0.7))
		ph += dt
		if ph >= 1 {
			ph--
		}
		acc[(i0+k)*2] += float32(v)
		acc[(i0+k)*2+1] += float32(v)
	}
}

// pad: three detuned saws through a soft low-pass. A string section or a choir.
func (c *composer) pad(acc []float32, t, dur, midi, vel, side float64) {
	const attack, release = 0.9, 1.8
	i0, n := frameAt(t), frameAt(dur+release)
	f := midiFreq(midi)
	det := [3]float64{1, 1.004, 0.9965}
	var ph [3]float64
	for i := range ph {
		ph[i] = c.rng.Float64()
	}
	cut := 1 - math.Exp(-2*math.Pi*math.Min(4200, f*3.2+600)/sampleRate)
	var l1, l2, r1, r2 float64
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		env := math.Min(1, ts/attack)
		env *= env
		if ts > dur {
			env *= math.Max(0, 1-(ts-dur)/release)
		}
		var s [3]float64
		for i := range ph {
			d := f * det[i] / sampleRate
			s[i] = 2*ph[i] - 1 - polyBLEP(ph[i], d)
			ph[i] += d
			if ph[i] >= 1 {
				ph[i]--
			}
		}
		// the detuned voices sit left and right for width
		l := s[0] + s[1]*(0.6+0.4*side)
		r := s[0] + s[2]*(0.6-0.4*side)
		l1 += (l - l1) * cut
		l2 += (l1 - l2) * cut
		r1 += (r - r1) * cut
		r2 += (r1 - r2) * cut
		acc[(i0+k)*2] += float32(l2 * env * vel)
		acc[(i0+k)*2+1] += float32(r2 * env * vel)
	}
}

// pluck: a Karplus-Strong string - harp in the high register, lute lower down.
func (c *composer) pluck(acc []float32, t, midi, vel, pan float64) {
	period := sampleRate/midiFreq(midi) - 0.5
	size := int(period) + 2
	if size < 4 {
		return
	}
	line := make([]float64, size)
	lp := 0.0
	for i := range line { // a soft pick: low-passed noise
		lp += (c.rng.Float64()*2 - 1 - lp) * 0.7
		line[i] = lp
	}
	frac := period - math.Floor(period)
	decay := 0.9965 - 0.0012*math.Max(0, (midi-60)/12)
	i0, n := frameAt(t), frameAt(2.6)
	p := panOf(pan)
	pos := 0
	prev := 0.0
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		cur := line[pos]
		nxt := line[(pos+1)%size]
		out := cur*(1-frac) + nxt*frac
		line[pos] = (out + prev) * 0.5 * decay
		prev = out
		pos = (pos + 1) % size
		env := 1.0
		if k < 60 {
			env = float64(k) / 60
		}
		if rest := n - k; rest < 2000 {
			env *= float64(rest) / 2000
		}
		v := float32(out * env * vel)
		acc[(i0+k)*2] += v * p.l
		acc[(i0+k)*2+1] += v * p.r
	}
}

// flute: a breathy sine with a slow vibrato.
func (c *composer) flute(acc []float32, t, dur, midi, vel, pan float64) {
	const attack, release = 0.07, 0.25
	i0, n := frameAt(t), frameAt(dur+release)
	dt := midiFreq(midi) / sampleRate
	p := panOf(pan)
	ph, breath := 0.0, 0.0
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		env := math.Min(1, ts/attack)
		if ts > dur {
			env *= math.Max(0, 1-(ts-dur)/release)
		}
		vib := 1.0
		if ts > 0.25 {
			vib = 1 + 0.006*math.Sin(2*math.Pi*5.2*ts)*math.Min(1, (ts-0.25)*2.5)
		}
		breath += (c.rng.Float64()*2 - 1 - breath) * 0.25
		v := math.Sin(2*math.Pi*ph) + 0.28*math.Sin(4*math.Pi*ph) + 0.08*math.Sin(6*math.Pi*ph)
		v = (v + breath*0.10*(1+2*math.Exp(-ts*18))) * env * vel
		ph += dt * vib
		if ph >= 1 {
			ph--
		}
		acc[(i0+k)*2] += float32(v) * p.l
		acc[(i0+k)*2+1] += float32(v) * p.r
	}
}

// horn: a saw whose filter opens with the note, like brass swelling.
func (c *composer) horn(acc []float32, t, dur, midi, vel, pan float64) {
	const attack, release = 0.06, 0.22
	i0, n := frameAt(t), frameAt(dur+release)
	f := midiFreq(midi)
	dt := f / sampleRate
	p := panOf(pan)
	ph, ph2, l1, l2 := 0.0, 0.3, 0.0, 0.0
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		env := math.Min(1, ts/attack)
		if ts > dur {
			env *= math.Max(0, 1-(ts-dur)/release)
		}
		open := 0.35 + 0.65*math.Min(1, ts/0.18)*math.Exp(-ts*0.8)
		cut := 1 - math.Exp(-2*math.Pi*math.Min(5000, f*(1.5+4*open))/sampleRate)
		s := 2*ph - 1 - polyBLEP(ph, dt) + 0.6*(2*ph2-1-polyBLEP(ph2, dt*1.003))
		l1 += (s - l1) * cut
		l2 += (l1 - l2) * cut
		ph += dt
		ph2 += dt * 1.003
		if ph >= 1 {
			ph--
		}
		if ph2 >= 1 {
			ph2--
		}
		v := float32(l2 * env * vel)
		acc[(i0+k)*2] += v * p.l
		acc[(i0+k)*2+1] += v * p.r
	}
}

// staccato: short low strings for the ostinato.
func (c *composer) staccato(acc []float32, t, dur, midi, vel, pan float64) {
	i0, n := frameAt(t), frameAt(dur+0.12)
	f := midiFreq(midi)
	dt := f / sampleRate
	p := panOf(pan)
	ph, ph2, l1, l2 := c.rng.Float64(), c.rng.Float64(), 0.0, 0.0
	cut := 1 - math.Exp(-2*math.Pi*math.Min(3000, f*5)/sampleRate)
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		env := math.Min(1, ts/0.012) * math.Exp(-ts*7)
		s := 2*ph - 1 - polyBLEP(ph, dt) + (2*ph2 - 1 - polyBLEP(ph2, dt*1.006))
		l1 += (s - l1) * cut
		l2 += (l1 - l2) * cut
		ph += dt
		ph2 += dt * 1.006
		if ph >= 1 {
			ph--
		}
		if ph2 >= 1 {
			ph2--
		}
		v := float32(l2 * env * vel)
		acc[(i0+k)*2] += v * p.l
		acc[(i0+k)*2+1] += v * p.r
	}
}

// bell: a handful of inharmonic partials ringing out.
func (c *composer) bell(acc []float32, t, midi, vel, pan float64) {
	f := midiFreq(midi)
	ratios := [5]float64{1, 2.0, 2.76, 5.4, 8.93}
	amps := [5]float64{1, 0.5, 0.35, 0.18, 0.08}
	i0, n := frameAt(t), frameAt(4.5)
	p := panOf(pan)
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		ts := float64(k) / sampleRate
		v := 0.0
		for j, r := range ratios {
			if f*r > 9000 {
				break
			}
			v += amps[j] * math.Sin(2*math.Pi*f*r*ts) * math.Exp(-ts*(0.9+0.7*float64(j)))
		}
		v *= math.Min(1, ts/0.004) * vel
		acc[(i0+k)*2] += float32(v) * p.l
		acc[(i0+k)*2+1] += float32(v) * p.r
	}
}

func (c *composer) drumHit(acc []float32, t, length float64, pan float64, f func(ts float64) float64) {
	i0, n := frameAt(t), frameAt(length)
	p := panOf(pan)
	for k := 0; k < n && (i0+k)*2+1 < len(acc); k++ {
		v := float32(f(float64(k) / sampleRate))
		acc[(i0+k)*2] += v * p.l
		acc[(i0+k)*2+1] += v * p.r
	}
}

func (c *composer) taiko(acc []float32, t, vel, pan float64) {
	ph, lp := 0.0, 0.0
	c.drumHit(acc, t, 0.7, pan, func(ts float64) float64 {
		ph += (62 + 95*math.Exp(-ts*20)) / sampleRate
		lp += (c.rng.Float64()*2 - 1 - lp) * 0.2
		return (math.Sin(2*math.Pi*ph)*math.Exp(-ts*8) + 0.3*math.Sin(4*math.Pi*ph)*math.Exp(-ts*12) + lp*1.8*math.Exp(-ts*26)) * vel * 0.7
	})
}

func (c *composer) tom(acc []float32, t, vel, pan float64) {
	ph, lp := 0.0, 0.0
	c.drumHit(acc, t, 0.4, pan, func(ts float64) float64 {
		ph += (120 + 80*math.Exp(-ts*30)) / sampleRate
		lp += (c.rng.Float64()*2 - 1 - lp) * 0.15
		return (math.Sin(2*math.Pi*ph)*math.Exp(-ts*11) + lp*math.Exp(-ts*45)) * vel * 0.8
	})
}

func (c *composer) snare(acc []float32, t, vel, pan float64) {
	ph, lp, hp := 0.0, 0.0, 0.0
	c.drumHit(acc, t, 0.25, pan, func(ts float64) float64 {
		ph += 180.0 / sampleRate
		w := c.rng.Float64()*2 - 1
		lp += (w - lp) * 0.45
		hp += (lp - hp) * 0.05
		return ((lp-hp)*math.Exp(-ts*20) + 0.4*math.Sin(2*math.Pi*ph)*math.Exp(-ts*35)) * vel
	})
}

func (c *composer) shaker(acc []float32, t, vel, pan float64) {
	prev := 0.0
	c.drumHit(acc, t, 0.06, pan, func(ts float64) float64 {
		w := c.rng.Float64()*2 - 1
		v := w - prev
		prev = w
		return v * math.Exp(-ts*70) * vel
	})
}

// polyBLEP smooths the jump of a naive saw wave (less harsh aliasing).
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

// --------------------------------------------------------------------- reverb

// A small Freeverb: parallel damped combs into series all-passes, per channel.
type reverb struct {
	combs [2][]comb
	alls  [2][]allpass
}

type comb struct {
	buf      []float32
	pos      int
	feedback float32
	damp     float32
	store    float32
}

type allpass struct {
	buf []float32
	pos int
}

func newReverb(room, damp float64) *reverb {
	r := &reverb{}
	for ch := 0; ch < 2; ch++ {
		for _, n := range []int{1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617} {
			r.combs[ch] = append(r.combs[ch], comb{buf: make([]float32, n+ch*23), feedback: float32(room), damp: float32(damp)})
		}
		for _, n := range []int{556, 441, 341, 225} {
			r.alls[ch] = append(r.alls[ch], allpass{buf: make([]float32, n+ch*23)})
		}
	}
	return r
}

// process adds reverb to an interleaved stereo buffer in place.
func (r *reverb) process(buf []float32, wet float64) {
	if wet <= 0 {
		return
	}
	w, dry := float32(wet), float32(1-wet*0.35)
	for i := 0; i+1 < len(buf); i += 2 {
		in := (buf[i] + buf[i+1]) * 0.03
		for ch := 0; ch < 2; ch++ {
			var out float32
			for j := range r.combs[ch] {
				c := &r.combs[ch][j]
				y := c.buf[c.pos]
				c.store = y*(1-c.damp) + c.store*c.damp
				c.buf[c.pos] = in + c.store*c.feedback
				if c.pos++; c.pos == len(c.buf) {
					c.pos = 0
				}
				out += y
			}
			for j := range r.alls[ch] {
				a := &r.alls[ch][j]
				b := a.buf[a.pos]
				a.buf[a.pos] = out + b*0.5
				if a.pos++; a.pos == len(a.buf) {
					a.pos = 0
				}
				out = b - out
			}
			buf[i+ch] = buf[i+ch]*dry + out*w
		}
	}
}

// --------------------------------------------------------------------- stream

type musicBlock struct{ base, tens []float32 }

// MusicStream composes a mood ahead of playback in its own goroutine.
type MusicStream struct {
	mood   Mood
	blocks chan musicBlock
	stop   chan struct{}
	cur    musicBlock
	pos    int
}

func newMusicStream(m Mood, seed int64) *MusicStream {
	s := &MusicStream{mood: m, blocks: make(chan musicBlock, 1), stop: make(chan struct{})}
	go func() {
		c := newComposer(m, seed)
		for {
			base, tens := c.nextBar()
			select {
			case s.blocks <- musicBlock{base, tens}:
			case <-s.stop:
				return
			}
		}
	}()
	return s
}

func (s *MusicStream) Close() { close(s.stop) }

// mix adds the stream to dst (interleaved stereo). tension is 0..1; g0 -> g1 is the
// gain ramp across the buffer. If the composer is not ready yet it adds silence.
func (s *MusicStream) mix(dst []float32, tension, g0, g1 float32) {
	frames := len(dst) / 2
	tension = max(tension, float32(s.mood.Tension))
	for i := 0; i < frames; {
		if s.pos >= len(s.cur.base) {
			select {
			case s.cur = <-s.blocks:
				s.pos = 0
			default:
				return
			}
		}
		n := min(frames-i, (len(s.cur.base)-s.pos)/2)
		for k := 0; k < n; k++ {
			g := g0 + (g1-g0)*float32(i+k)/float32(frames)
			j := s.pos + k*2
			dst[(i+k)*2] += (s.cur.base[j] + s.cur.tens[j]*tension) * g
			dst[(i+k)*2+1] += (s.cur.base[j+1] + s.cur.tens[j+1]*tension) * g
		}
		s.pos += n * 2
		i += n
	}
}
