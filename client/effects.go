package main

// Visual effects for the map: colored light sources, biome floor details and
// ambient particles (embers, dust, spores).

import (
	"math"
	"math/rand"
	"time"
)

// ------------------------------------------------------------------ lighting

type light struct {
	x, y, r, i float64
	c          Color
}

type lightField []light

// at blends every light that reaches a tile: the mixed color and its strength.
func (lf lightField) at(x, y int) (Color, float64) {
	var sr, sg, sb, total float64
	for _, l := range lf {
		dx, dy := float64(x)-l.x, float64(y)-l.y
		if math.Abs(dx) > l.r || math.Abs(dy) > l.r {
			continue
		}
		d := math.Hypot(dx, dy)
		if d >= l.r {
			continue
		}
		f := 1 - d/l.r
		w := l.i * f * f
		sr += float64(l.c[0]) * w
		sg += float64(l.c[1]) * w
		sb += float64(l.c[2]) * w
		total += w
	}
	if total <= 0 {
		return Color{}, 0
	}
	return Color{int(sr / total), int(sg / total), int(sb / total)}, math.Min(1, total)
}

// lightSources collects what glows on screen this frame.
func (g *Game) lightSources(t float64) lightField {
	st := g.state
	var lf lightField
	add := func(x, y int, r, i float64, c Color) {
		lf = append(lf, light{float64(x), float64(y), r, i, c})
	}
	wave := func(speed, phase float64) float64 {
		if !g.settings.Animations {
			return 1
		}
		return 0.85 + 0.15*math.Sin(t*speed+phase)
	}
	for _, a := range st.NearbyPlayers {
		if !a.Downed {
			add(a.X, a.Y, 5, 0.45*wave(9, float64(a.X)), Color{255, 190, 110})
		} else {
			add(a.X, a.Y, 3, 0.6*wave(6, 0), Color{255, 50, 50})
		}
	}
	for _, n := range st.NPCs {
		if n.Name == "Merchant" {
			add(n.X, n.Y, 4, 0.45, Color{255, 200, 110})
		} else {
			add(n.X, n.Y, 5.5, 0.8*wave(2, 0), Color{90, 220, 255})
		}
	}
	for _, m := range st.Monsters {
		switch {
		case m.Charging:
			add(m.X, m.Y, 4.5, 0.9*wave(14, 0), Color{255, 170, 50})
		case m.Enraged:
			add(m.X, m.Y, 4.5, 0.8*wave(10, 0), Color{255, 40, 30})
		case m.Boss:
			add(m.X, m.Y, 4, 0.55*wave(3, 0), Color{255, 60, 50})
		case m.Frozen:
			add(m.X, m.Y, 2.5, 0.6, Color{120, 200, 255})
		case m.Elite:
			add(m.X, m.Y, 2.5, 0.35*wave(4, float64(m.ID)), Color{255, 210, 80})
		}
	}
	for _, it := range st.Items {
		switch {
		case it.Kind == "shrine":
			add(it.X, it.Y, 3.5, 0.6*wave(3, 1), Color{110, 255, 255})
		case it.Kind == "gear" && it.Color == rarityColors["legendary"]:
			add(it.X, it.Y, 3.5, 0.7*wave(5, 0), Color{255, 150, 30})
		case it.Kind == "gear" && it.Color == rarityColors["epic"]:
			add(it.X, it.Y, 2.5, 0.5*wave(5, 0), rarityColors["epic"])
		case it.Kind == "chest" || it.Kind == "gold":
			add(it.X, it.Y, 2, 0.3, Color{255, 210, 80})
		}
	}
	for _, pg := range st.Pings {
		add(pg.X, pg.Y, 3, 0.7*wave(8, 0), Color{120, 230, 255})
	}
	// Glowing floor details (lava, mushrooms, crystals) within sight.
	if g.settings.Decor {
		v := st.View
		for gy, row := range v.Grid {
			for gx, c := range row {
				if c == nil || *c <= 0 {
					continue
				}
				x, y := v.OriginX+gx, v.OriginY+gy
				if g.mem.hasSafe && *c == g.mem.safeRoom {
					continue
				}
				if d := decorAt(g.biomeFor(x, y), x, y); d != nil && d.glow > 0 {
					add(x, y, 2.5, d.glow*wave(3, float64(x*7+y*3)), d.color)
				}
			}
		}
	}
	return lf
}

// ------------------------------------------------------------------ decor

type decorLook struct {
	ch    rune
	color Color
	glow  float64
	side  int // which of the tile's two cells
}

type decorDef struct {
	ch    rune
	color Color
	glow  float64
}

var biomeDecor = map[string][]decorDef{
	"cellars":  {{',', Color{150, 130, 100}, 0}, {'"', Color{175, 155, 95}, 0}, {'·', Color{140, 120, 100}, 0}, {'o', Color{150, 100, 60}, 0}, {'%', Color{150, 150, 150}, 0}},
	"caverns":  {{'♠', Color{90, 230, 190}, 0.35}, {'"', Color{80, 170, 90}, 0}, {',', Color{100, 150, 110}, 0}, {'♣', Color{120, 240, 170}, 0.3}},
	"crypts":   {{'~', Color{200, 200, 180}, 0}, {'☠', Color{215, 215, 205}, 0}, {'≈', Color{70, 100, 160}, 0}, {'†', Color{150, 150, 175}, 0}},
	"infernal": {{'≈', Color{255, 110, 30}, 0.55}, {'∙', Color{255, 70, 40}, 0.2}, {'^', Color{200, 90, 40}, 0}, {'≈', Color{255, 140, 40}, 0.5}},
	"abyss":    {{'◊', Color{200, 120, 255}, 0.45}, {'*', Color{150, 110, 200}, 0}, {'·', Color{120, 100, 180}, 0}, {'☠', Color{190, 180, 210}, 0}},
	"throne":   {{'◦', Color{255, 215, 90}, 0.3}, {'☠', Color{220, 200, 170}, 0}, {'†', Color{230, 190, 90}, 0}, {'♦', Color{255, 80, 80}, 0.35}},
}

// decorAt gives the (deterministic) floor detail of a tile, if it has one.
func decorAt(b *BiomeInfo, x, y int) *decorLook {
	if hash2(x*13+5, y*29+11) > 0.085 {
		return nil
	}
	id := "cellars"
	if b != nil {
		id = b.ID
	}
	defs := biomeDecor[id]
	if len(defs) == 0 {
		return nil
	}
	d := defs[int(hash2(x*7+1, y*3+2)*float64(len(defs)))%len(defs)]
	return &decorLook{d.ch, d.color, d.glow, int(hash2(x, y*5+3) * 2)}
}

// ------------------------------------------------------------------ particles

type ambientStyle struct {
	rate     float64 // per second
	vy, vx   float64
	colors   [2]Color
	chars    []rune
	lifetime float64
}

var ambientStyles = map[string]ambientStyle{
	"cellars":  {1.5, -0.15, 0.25, [2]Color{{150, 140, 120}, {80, 75, 70}}, []rune{'·'}, 5},
	"caverns":  {3, -0.35, 0.2, [2]Color{{120, 255, 210}, {40, 120, 100}}, []rune{'·', '∙'}, 5},
	"crypts":   {2.5, 0.12, 0.3, [2]Color{{170, 180, 210}, {70, 75, 100}}, []rune{'·'}, 6},
	"infernal": {7, -1.6, 0.4, [2]Color{{255, 220, 120}, {200, 50, 20}}, []rune{'•', '·'}, 2.5},
	"abyss":    {4, -0.5, 0.3, [2]Color{{220, 160, 255}, {80, 50, 120}}, []rune{'·', '∙', '*'}, 4},
	"throne":   {4, -0.8, 0.3, [2]Color{{255, 230, 140}, {160, 100, 40}}, []rune{'·', '•'}, 3},
}

func (g *Game) drawAmbient(r rect, camX, camY, offX, cols int, now time.Time, live func(int, int) *int) {
	st := g.state
	p := st.Player
	dt := now.Sub(g.lastFrame).Seconds()
	if dt > 0.25 || g.lastFrame.IsZero() {
		dt = 0.05
	}
	g.lastFrame = now
	id := "cellars"
	if b := g.biomeFor(p.X, p.Y); b != nil {
		id = b.ID
	}
	if p.Safe {
		id = "cellars"
	}
	style := ambientStyles[id]

	kept := g.ambient[:0]
	for _, e := range g.ambient {
		e.life += dt
		e.x += (e.vx + 0.3*math.Sin(e.life*1.7+e.seed)) * dt
		e.y += e.vy * dt
		if e.life < e.max && math.Abs(e.x-float64(p.X)) < float64(sight+2) && math.Abs(e.y-float64(p.Y)) < float64(sight+2) {
			kept = append(kept, e)
		}
	}
	g.ambient = kept
	for n := style.rate * dt; n > 0; n-- {
		if rand.Float64() >= n || len(g.ambient) > 60 {
			continue
		}
		x := p.X + rand.Intn(sight*2+1) - sight
		y := p.Y + rand.Intn(sight*2+1) - sight
		if c := live(x, y); c == nil || *c == 0 {
			continue
		}
		g.ambient = append(g.ambient, ember{
			x: float64(x) + rand.Float64(), y: float64(y) + rand.Float64(),
			vx: (rand.Float64()*2 - 1) * style.vx, vy: style.vy * (0.6 + rand.Float64()*0.8),
			max: style.lifetime * (0.6 + rand.Float64()*0.8), seed: rand.Float64() * 6,
		})
	}
	for _, e := range g.ambient {
		wx, wy := int(math.Floor(e.x)), int(math.Floor(e.y))
		if c := live(wx, wy); c == nil || *c == 0 {
			continue
		}
		tx, ty := wx-camX, wy-camY
		if tx < 0 || ty < 0 || tx >= cols || ty >= r.h {
			continue
		}
		sx := offX + tx*tileW
		if e.x-math.Floor(e.x) >= 0.5 {
			sx++
		}
		f := e.life / e.max
		fade := math.Min(1, math.Min(e.life*3, (1-f)*3))
		c := scale(mix(style.colors[0], style.colors[1], f), 0.4+0.6*fade)
		ch := style.chars[int(e.seed*10)%len(style.chars)]
		// don't draw over monsters, players or items
		existing, _, _ := g.cv.Get(sx, r.y+ty)
		if existing != ' ' && existing != '·' && existing != '▀' {
			continue
		}
		g.cv.Put(sx, r.y+ty, ch, c, nil, false)
	}
}
