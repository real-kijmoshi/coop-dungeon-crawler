package main

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Visuals for team combat: seal auras, stagger sparks, rally glow, the boss bar
// and the unity meter. The server side lives in server/game/teamplay.js.

var (
	sealColor    = Color{170, 110, 255}
	staggerColor = Color{255, 215, 90}
	unityColor   = Color{120, 255, 220}
)

type toScreenFn func(wx, wy int) (int, int, bool)

// tint blends the background of an already drawn map tile toward col.
func (g *Game) tint(sx, sy int, col Color, t float64) {
	for i := 0; i < tileW; i++ {
		r, fg, bg := g.cv.Get(sx+i, sy)
		nb := mix(bg, col, t)
		g.cv.Put(sx+i, sy, r, fg, &nb, false)
	}
}

func (g *Game) hasBuff(id string) bool {
	if g.state == nil {
		return false
	}
	for _, b := range g.state.Player.Buffs {
		if b.ID == id {
			return true
		}
	}
	return false
}

// drawTeamFloorFx paints effects onto the floor, under items and creatures.
func (g *Game) drawTeamFloorFx(st *GameState, toScreen toScreenFn, isOpen func(int, int) bool, pulse float64) {
	t := float64(time.Now().UnixMilli())
	for _, m := range st.Monsters {
		switch {
		case m.Sealed:
			// A shimmering ring of seal magic around the boss...
			for dy := -2; dy <= 2; dy++ {
				for dx := -2; dx <= 2; dx++ {
					d := math.Hypot(float64(dx), float64(dy))
					if d > 2.3 || !isOpen(m.X+dx, m.Y+dy) {
						continue
					}
					if sx, sy, ok := toScreen(m.X+dx, m.Y+dy); ok {
						wave := 0.5 + 0.5*math.Sin(t/180-d*1.6)
						g.tint(sx, sy, sealColor, 0.12+0.28*wave*(1-d/3))
					}
				}
			}
			// ...and a faint tether from every rune to it.
			for _, rn := range st.Runes {
				steps := maxi(iabs(rn.X-m.X), iabs(rn.Y-m.Y))
				for i := 1; i < steps; i++ {
					x := rn.X + int(math.Round(float64(m.X-rn.X)*float64(i)/float64(steps)))
					y := rn.Y + int(math.Round(float64(m.Y-rn.Y)*float64(i)/float64(steps)))
					if !isOpen(x, y) {
						continue
					}
					if sx, sy, ok := toScreen(x, y); ok {
						flow := 0.5 + 0.5*math.Sin(t/120-float64(i)*0.9)
						strength := 0.08 + 0.14*flow
						if rn.Lit {
							strength += 0.12
						}
						g.tint(sx, sy, sealColor, strength)
					}
				}
			}
		case m.Staggered:
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if (dx != 0 || dy != 0) && isOpen(m.X+dx, m.Y+dy) {
						if sx, sy, ok := toScreen(m.X+dx, m.Y+dy); ok {
							g.tint(sx, sy, staggerColor, 0.1+0.15*pulse)
						}
					}
				}
			}
		}
	}
	// Rally: every hero standing in it glows.
	if g.hasBuff("rally") {
		heroes := [][2]int{{st.Player.X, st.Player.Y}}
		for _, a := range st.NearbyPlayers {
			if a.Party && !a.Downed {
				heroes = append(heroes, [2]int{a.X, a.Y})
			}
		}
		for _, h := range heroes {
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					if isOpen(h[0]+dx, h[1]+dy) {
						if sx, sy, ok := toScreen(h[0]+dx, h[1]+dy); ok {
							g.tint(sx, sy, unityColor, 0.1+0.12*pulse)
						}
					}
				}
			}
		}
	}
}

// drawTeamSparks puts sparks orbiting staggered monsters, above the creatures.
func (g *Game) drawTeamSparks(st *GameState, toScreen toScreenFn, isOpen func(int, int) bool) {
	ring := [][2]int{{0, -1}, {1, -1}, {1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}}
	frame := int(time.Now().UnixMilli() / 140)
	for _, m := range st.Monsters {
		if !m.Staggered {
			continue
		}
		for k, glyph := range []rune{'✷', '✧'} {
			o := ring[(frame+k*4+m.ID)%len(ring)]
			x, y := m.X+o[0], m.Y+o[1]
			if !isOpen(x, y) {
				continue
			}
			sx, sy, ok := toScreen(x, y)
			if !ok {
				continue
			}
			r, _, bg := g.cv.Get(sx+1, sy)
			if r != ' ' && r != '·' && r != '.' && r != ',' && r != '\'' && r != '`' && r != '"' {
				continue // don't draw over anything that matters
			}
			g.cv.Put(sx+1, sy, glyph, staggerColor, &bg, true)
		}
	}
}

// drawBossBar shows the boss in sight across the top of the map: health, guard and
// what the party has to do right now. Returns the rows it used.
func (g *Game) drawBossBar(r rect) int {
	st := g.state
	var boss *Monster
	for i := range st.Monsters {
		if st.Monsters[i].Boss {
			boss = &st.Monsters[i]
			break
		}
	}
	if boss == nil || r.w < 30 || r.h < 8 {
		return 0
	}
	cv := g.cv
	pulse := 0.5 + 0.5*math.Sin(float64(time.Now().UnixMilli())/140)
	w := mini(r.w-2, 84)
	x := r.x + (r.w-w)/2
	y := r.y
	panel := Color{22, 14, 18}
	cv.Fill(x, y, w, 2, panel)

	// Row 1: name, level, health.
	name := " " + boss.Char + "  " + strings.ToUpper(boss.Name) + " "
	nameBg := Color{110, 30, 30}
	switch {
	case boss.Staggered:
		nameBg = mix(Color{150, 110, 20}, Color{230, 190, 70}, pulse)
	case boss.Sealed:
		nameBg = mix(Color{70, 35, 130}, Color{130, 80, 220}, pulse)
	case boss.Enraged:
		nameBg = mix(Color{140, 20, 20}, Color{220, 50, 40}, pulse)
	}
	xx := x + cv.Text(x, y, name, Color{255, 240, 230}, &nameBg, true, w)
	lv := fmt.Sprintf(" Lv%d ", boss.Level)
	xx += cv.Text(xx, y, lv, levelColor(boss.Level, st.Player.Stats.Level), &panel, true, -1)
	pct := 0
	if boss.MaxHP > 0 {
		pct = int(math.Round(boss.HP / boss.MaxHP * 100))
	}
	hpText := fmt.Sprintf(" %s/%s %d%%", commas(int(math.Max(0, boss.HP))), commas(int(boss.MaxHP)), pct)
	barW := x + w - xx - runeLen(hpText) - 1
	if barW > 4 {
		col := hpColor(boss.HP, boss.MaxHP)
		if boss.Sealed {
			col = mix(sealColor, Color{220, 200, 255}, pulse*0.4)
		}
		cv.Bar(xx, y, barW, boss.HP, boss.MaxHP, col, "")
		xx += barW
	}
	cv.Text(xx, y, hpText, Color{230, 220, 220}, &panel, false, -1)

	// Row 2: guard (poise) and the boss's state.
	y++
	xx = x + 1
	if boss.Poise != nil {
		xx += cv.Text(xx, y, "GUARD ", Color{200, 170, 110}, &panel, true, -1)
		segs := 12
		filled := int(math.Ceil(*boss.Poise * float64(segs)))
		for i := 0; i < segs; i++ {
			ch, col := '▱', Color{90, 75, 50}
			if i < filled {
				ch, col = '▰', staggerColor
			}
			if boss.Staggered {
				ch, col = '▱', mix(Color{120, 90, 30}, staggerColor, pulse)
			}
			cv.Put(xx+i, y, ch, col, &panel, true)
		}
		xx += segs + 2
	}
	chip := func(text string, fg, bg Color) {
		if xx+runeLen(text) <= x+w {
			xx += cv.Text(xx, y, text, fg, &bg, true, -1) + 1
		}
	}
	if boss.Sealed {
		held, total, left := 0, len(st.Runes), 0.0
		for _, rn := range st.Runes {
			if rn.Lit {
				held++
			}
			left = math.Max(left, rn.Until-g.serverNow())
		}
		text := " ◎ SEALED · stand on every rune "
		if total > 0 {
			text = fmt.Sprintf(" ◎ SEALED · runes held %d/%d · %ds ", held, total, int(math.Ceil(left/1000)))
		}
		chip(text, Color{255, 245, 255}, mix(Color{80, 40, 150}, Color{140, 90, 230}, pulse))
	}
	if boss.Staggered {
		chip(" ✷ STAGGERED · ALL IN! ✷ ", Color{50, 30, 0}, mix(Color{220, 170, 50}, Color{255, 235, 140}, pulse))
	}
	if boss.Enraged {
		chip(" ENRAGED ", Color{255, 230, 220}, Color{160, 30, 30})
	}
	if boss.Hunting {
		chip(" hunting you ", Color{255, 170, 150}, Color{70, 25, 25})
	}
	return 2
}

// drawUnity draws the shared unity meter (or RALLY READY) into a hotbar slot.
func (g *Game) drawUnity(x, y, w int, u *Unity) {
	cv := g.cv
	dark := Color{15, 15, 20}
	ready := u.Max > 0 && u.Value >= u.Max
	pulse := 0.5 + 0.5*math.Sin(float64(time.Now().UnixMilli())/150)
	key := " " + g.settings.keyLabel("rally") + " "
	keyBg := Color{60, 95, 88}
	if ready {
		keyBg = mix(Color{80, 220, 190}, Color{220, 255, 245}, pulse)
	}
	keyW := mini(w, runeLen(key))
	cv.Text(x, y, key, dark, &keyBg, true, keyW)
	x, w = x+keyW, w-keyW
	if w <= 0 {
		return
	}
	if ready {
		bg := mix(Color{40, 150, 130}, unityColor, pulse)
		cv.Text(x, y, pad(" ✦ RALLY READY ✦", w), Color{10, 35, 30}, &bg, true, w)
		return
	}
	bg := Color{20, 32, 32}
	cv.Fill(x, y, w, 1, bg)
	label := fmt.Sprintf(" UNITY %d%% ", int(u.Value))
	if w < 20 {
		label = fmt.Sprintf(" ✦%d%% ", int(u.Value)) // narrow window: room for the meter
	}
	cv.Text(x, y, label, Color{150, 230, 210}, &bg, true, w)
	segs := w - runeLen(label) - 1
	if segs < 3 {
		return
	}
	filled := 0.0
	if u.Max > 0 {
		filled = u.Value / u.Max * float64(segs)
	}
	for i := 0; i < segs; i++ {
		ch, col := '▱', Color{50, 80, 75}
		if float64(i) < filled {
			ch, col = '▰', mix(Color{60, 170, 150}, unityColor, float64(i)/float64(segs))
		}
		cv.Put(x+runeLen(label)+i, y, ch, col, &bg, false)
	}
}
