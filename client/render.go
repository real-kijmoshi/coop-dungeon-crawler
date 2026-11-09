package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const (
	sight = 12 // matches the server's vision radius
	tileW = 2  // each map tile is two cells wide so it looks square
)

type rect struct{ x, y, w, h int }

func hash2(x, y int) float64 {
	h := uint32(int32(x)*374761393 + int32(y)*668265263)
	h = (h ^ (h >> 13)) * 1274126177
	return float64(h^(h>>16)) / 4294967296.0
}

func compass(dx, dy int) string {
	if dx == 0 && dy == 0 {
		return "here"
	}
	a := math.Atan2(float64(dy), float64(dx)) * 180 / math.Pi
	names := []string{"→ E", "↘ SE", "↓ S", "↙ SW", "← W", "↖ NW", "↑ N", "↗ NE"}
	return names[int(math.Round(math.Mod(a+360, 360)/45))%8]
}

func firstRune(s string) rune {
	for _, r := range s {
		return r
	}
	return '?'
}

type tileStyle struct {
	fg, bg Color
	chars  [2]rune
}

var (
	tileFloor    = tileStyle{Color{96, 84, 68}, Color{44, 37, 30}, [2]rune{' ', '·'}}
	tileSafe     = tileStyle{Color{70, 130, 90}, Color{26, 50, 34}, [2]rune{' ', '·'}}
	tileCorridor = tileStyle{Color{70, 70, 92}, Color{40, 40, 56}, [2]rune{' ', ' '}}
	tileWall     = tileStyle{Color{92, 78, 64}, Color{92, 78, 64}, [2]rune{' ', ' '}}
)

// ------------------------------------------------------------------ frame
func (g *Game) draw() {
	started := time.Now()
	cv := g.cv
	cv.BeginFrame()
	W, H := cv.W, cv.H
	cv.Fill(0, 0, W, H, theme.bg)
	now := time.Now()

	compact := W < 96 || H < 26
	sidebarW := 0
	if !compact {
		sidebarW = clampi(int(float64(W)*0.3), 34, 40)
	}
	logH := 8
	if H < 26 {
		logH = 5
	} else if H < 34 {
		logH = 7
	}
	top := 1
	mapW := W - sidebarW
	mapH := H - top - 1 - logH

	g.drawTopBar(W, compact)

	st := g.state
	border := theme.border
	if g.flash != nil && now.Before(g.flashUntil) {
		border = *g.flash
	} else if g.settings.LowHPPulse && st != nil && st.Player.Stats.HP > 0 && st.Player.Stats.HP/st.Player.Stats.MaxHP < 0.3 {
		pulse := 0.5 + 0.5*math.Sin(float64(now.UnixMilli())/160)
		border = mix(Color{90, 30, 30}, Color{255, 60, 60}, pulse)
	}
	title, titleColor, right := "CONNECTING", Color{200, 160, 255}, ""
	if st != nil {
		title = fmt.Sprintf("DEPTH %d", st.Depth)
		if st.Biome.Name != "" {
			title += " · " + strings.ToUpper(st.Biome.Name)
		}
		if st.Player.Safe {
			title, titleColor = "SAFE ROOM", cGreen
		}
		right = fmt.Sprintf("%d,%d", st.Player.X, st.Player.Y)
	}
	cv.Box(0, top, mapW, mapH, BoxOpts{Color: border, BG: theme.bg, Title: title, TitleColor: &titleColor, RightTitle: right, RightColr: ptr(theme.faint)})
	inner := rect{1, top + 1, mapW - 2, mapH - 2}

	if st != nil {
		g.drawMap(inner)
		if sidebarW > 0 {
			g.drawSidebar(rect{mapW, top, sidebarW, mapH + 1 + logH})
		}
		g.drawHotbar(rect{0, top + mapH, mapW, 1})
		if st.Invite != nil {
			secs := int(math.Max(0, math.Ceil((st.Invite.Until-g.serverNow())/1000)))
			msg := fmt.Sprintf("  ✉ %s invites you to their party  ·  %s accept  ·  %s decline  (%ds)  ", st.Invite.From, g.settings.keyLabel("accept"), g.settings.keyLabel("decline"), secs)
			cv.Text(inner.x+maxi(0, (inner.w-runeLen(msg))/2), inner.y+inner.h-1, msg, Color{15, 15, 20}, ptr(Color{140, 220, 255}), true, inner.w)
		}
	} else {
		t := "Entering the dungeon..."
		cv.Text((mapW-runeLen(t))/2, top+mapH/2, t, theme.muted, &theme.bg, false, -1)
	}
	g.drawLog(rect{0, top + mapH + 1, mapW, logH})

	if g.toast != nil && now.Sub(g.toast.Born) < 2600*time.Millisecond {
		g.drawToast(inner)
	}
	if g.overlay != nil {
		g.drawOverlay(rect{0, top, W, H - top})
	}
	if !g.connected {
		msg := "  ⚠ Connection lost — reconnecting...  "
		cv.Text(maxi(0, (W-runeLen(msg))/2), 0, msg, Color{20, 20, 20}, ptr(Color{255, 180, 60}), true, -1)
	}
	if g.showPerformance {
		g.drawPerformance()
	}
	cv.Show()
	g.drawTime = time.Since(started)
}

// ------------------------------------------------------------------ top bar
func (g *Game) drawTopBar(w int, compact bool) {
	cv := g.cv
	bg := theme.topbar
	cv.Fill(0, 0, w, 1, bg)
	titleText := "⚔ COOP DUNGEON CRAWLER"
	if compact {
		titleText = "⚔ CDC"
	}
	left := 1 + cv.Text(1, 0, titleText, theme.title, &bg, true, -1) + 2
	k := g.settings.keyLabel
	right := k("help") + " help "
	if w > 110 {
		right = fmt.Sprintf("%s items · %s journal · %s party · %s settings · %s help ", k("inventory"), k("journal"), k("party"), k("settings"), k("help"))
	}
	rightX := w - runeLen(right)
	st := g.state
	if st != nil && st.Event != nil {
		secs := int(math.Max(0, math.Ceil((st.Event.Until-g.serverNow())/1000)))
		t := fmt.Sprintf(" ★ %s %d:%02d ", st.Event.Name, secs/60, secs%60)
		pulse := 0.75 + 0.25*math.Sin(float64(time.Now().UnixMilli())/250)
		ex := maxi(left, (w-runeLen(t))/2)
		left = ex + cv.Text(ex, 0, t, Color{15, 15, 20}, ptr(scale(st.Event.Color, pulse)), true, rightX-ex-1) + 1
	}
	if st != nil && compact {
		p := st.Player
		s := p.Stats
		xx := left + 1
		seg := func(str string, c Color, bold bool) {
			if xx+runeLen(str) < rightX {
				xx += cv.Text(xx, 0, str, c, &bg, bold, -1) + 2
			}
		}
		seg(fmt.Sprintf("HP %d/%d", int(math.Max(0, s.HP)), int(s.MaxHP)), hpColor(s.HP, s.MaxHP), true)
		seg(fmt.Sprintf("Lv %d", s.Level), p.ClassColor, true)
		seg(fmt.Sprintf("D%d", st.Depth), Color{200, 160, 255}, false)
		seg(fmt.Sprintf("◆%d", int(s.Gold)), Color{255, 215, 0}, false)
		if p.Combo != nil && p.Combo.Count >= 2 {
			seg(fmt.Sprintf("x%d", p.Combo.Count), Color{255, 170, 40}, true)
		}
	}
	cv.Text(rightX, 0, right, theme.muted, &bg, false, -1)
}

// ---------------------------------------------------------------------- map
func (g *Game) drawMap(r rect) {
	cv := g.cv
	st := g.state
	p := st.Player
	v := st.View
	cols := r.w / tileW
	camX := p.X - cols/2
	camY := p.Y - r.h/2
	offX := r.x + (r.w-cols*tileW)/2

	live := func(wx, wy int) *int {
		gy := wy - v.OriginY
		gx := wx - v.OriginX
		if gy < 0 || gy >= len(v.Grid) || gx < 0 || gx >= len(v.Grid[gy]) {
			return nil
		}
		return v.Grid[gy][gx]
	}
	known := func(wx, wy int) (int, bool) {
		if c := live(wx, wy); c != nil {
			return *c, true
		}
		c, ok := g.mem.cells[[2]int{wx, wy}]
		return c, ok
	}
	isOpen := func(wx, wy int) bool {
		c, ok := known(wx, wy)
		return ok && c != 0
	}
	warm := Color{255, 220, 170}
	pulse := 0.5 + 0.5*math.Sin(float64(time.Now().UnixMilli())/110)

	// Red danger zone around bosses that are about to slam.
	danger := map[[2]int]bool{}
	for _, m := range st.Monsters {
		if !m.Charging {
			continue
		}
		for dy := -2; dy <= 2; dy++ {
			for dx := -2; dx <= 2; dx++ {
				danger[[2]int{m.X + dx, m.Y + dy}] = true
			}
		}
	}

	for ty := 0; ty < r.h; ty++ {
		for tx := 0; tx < cols; tx++ {
			wx, wy := camX+tx, camY+ty
			sx, sy := offX+tx*tileW, r.y+ty
			lc := live(wx, wy)
			visible := lc != nil
			var cell int
			var ok bool
			if visible {
				cell, ok = *lc, true
			} else {
				cell, ok = g.mem.cells[[2]int{wx, wy}]
			}
			if !ok {
				continue // unknown: leave background
			}
			var t tileStyle
			switch {
			case cell == 0:
				edge := false
				for dy := -1; dy <= 1 && !edge; dy++ {
					for dx := -1; dx <= 1 && !edge; dx++ {
						if isOpen(wx+dx, wy+dy) {
							edge = true
						}
					}
				}
				if !edge {
					continue // solid rock: draw nothing, rooms get clean outlines
				}
				t = tileWall
			case cell == -1:
				t = tileCorridor
			case g.mem.hasSafe && cell == g.mem.safeRoom:
				t = tileSafe
			default:
				t = tileFloor
			}
			// Each depth band (biome) has its own colors.
			if b := g.biomeFor(wx, wy); b != nil && t != tileSafe {
				switch t {
				case tileWall:
					t = tileStyle{b.Wall, b.Wall, t.chars}
				case tileCorridor:
					t = tileStyle{b.Corridor.FG, b.Corridor.BG, t.chars}
				default:
					t = tileStyle{b.Floor.FG, b.Floor.BG, t.chars}
				}
			}

			jitter := 0.9 + hash2(wx, wy)*0.2
			var fg, bg Color
			if visible {
				d := math.Hypot(float64(wx-p.X), float64(wy-p.Y))
				light := clampf(1.15-d/float64(sight+3), 0.35, 1.1) * jitter * activePalette.light
				fg = mix(scale(t.fg, light), warm, 0.08*light)
				bg = mix(scale(t.bg, light), warm, 0.05*light)
				if cell == 0 && isOpen(wx, wy+1) {
					bg = mix(bg, warm, 0.12)
				}
			} else {
				fg = mix(scale(t.fg, activePalette.memory*jitter), Color{40, 50, 90}, 0.35)
				bg = mix(scale(t.bg, activePalette.memory*jitter), Color{16, 20, 40}, 0.4)
			}
			if danger[[2]int{wx, wy}] && cell != 0 {
				bg = mix(bg, Color{255, 40, 30}, 0.35+0.3*pulse)
			}
			cv.Put(sx, sy, t.chars[0], fg, &bg, false)
			cv.Put(sx+1, sy, t.chars[1], fg, &bg, false)
		}
	}

	toScreen := func(wx, wy int) (int, int, bool) {
		tx, ty := wx-camX, wy-camY
		if tx < 0 || ty < 0 || tx >= cols || ty >= r.h {
			return 0, 0, false
		}
		return offX + tx*tileW, r.y + ty, true
	}

	for _, it := range st.Items {
		if sx, sy, ok := toScreen(it.X, it.Y); ok {
			cv.Put(sx, sy, firstRune(it.Char), it.Color, nil, true)
		}
	}
	for _, n := range st.NPCs {
		sx, sy, ok := toScreen(n.X, n.Y)
		if !ok {
			continue
		}
		if n.Name == "Merchant" {
			bg := Color{70, 50, 20}
			cv.Put(sx, sy, firstRune(n.Char), n.Color, &bg, true)
			cv.Put(sx+1, sy, '$', Color{255, 215, 0}, &bg, false)
			continue
		}
		// Waystone: bright when attuned, dim when not yet discovered.
		bg, col := Color{20, 60, 70}, n.Color
		if n.Known == nil || !*n.Known {
			bg, col = Color{20, 36, 44}, scale(n.Color, 0.6+0.4*pulse)
		}
		cv.Put(sx, sy, firstRune(n.Char), col, &bg, true)
		cv.Put(sx+1, sy, ' ', col, &bg, false)
	}
	for _, m := range st.Monsters {
		sx, sy, ok := toScreen(m.X, m.Y)
		if !ok {
			continue
		}
		var bg *Color
		switch {
		case m.Hit:
			bg = ptr(Color{200, 200, 200})
		case m.Charging:
			bg = ptr(mix(Color{150, 30, 30}, Color{255, 200, 60}, pulse))
		case m.Enraged:
			bg = ptr(Color{150, 20, 20})
		case m.Frozen:
			bg = ptr(Color{40, 90, 140})
		case m.Boss:
			bg = ptr(Color{90, 20, 20})
		case m.Elite:
			bg = ptr(Color{60, 50, 10})
		}
		fg := m.Color
		if m.Hit {
			fg = Color{20, 20, 20}
		}
		cv.Put(sx, sy, firstRune(m.Char), fg, bg, m.Boss || m.Elite)
		ratio := m.HP / m.MaxHP
		pip := '▁'
		switch {
		case ratio > 0.75:
			pip = '▇'
		case ratio > 0.5:
			pip = '▅'
		case ratio > 0.25:
			pip = '▃'
		}
		cv.Put(sx+1, sy, pip, scale(hpColor(m.HP, m.MaxHP), 0.85), bg, false)
	}

	drawActor := func(x, y int, name string, col Color, downed, me bool) {
		sx, sy, ok := toScreen(x, y)
		if !ok {
			return
		}
		bg := Color{20, 50, 70}
		if downed {
			bg = Color{110, 20, 20}
		} else if me {
			bg = Color{70, 60, 20}
		}
		glyph, gcol := '@', col
		if downed {
			glyph, gcol = '%', Color{255, 120, 120}
		}
		cv.Put(sx, sy, glyph, gcol, &bg, true)
		cv.Put(sx+1, sy, ' ', col, &bg, false)
		if me || sy-1 < r.y || !g.settings.NameTags {
			return
		}
		tag := name
		if runeLen(tag) > 10 {
			tag = string([]rune(tag)[:10])
		}
		tcol := col
		if downed {
			tag, tcol = "✚ "+tag, cRed
		}
		tx := sx + 1 - runeLen(tag)/2
		i := 0
		for _, ch := range tag {
			if tx+i >= r.x && tx+i < r.x+r.w {
				cv.Put(tx+i, sy-1, ch, tcol, nil, true)
			}
			i++
		}
	}
	for _, a := range st.NearbyPlayers {
		col := cCyan
		if a.Color != nil {
			col = *a.Color
		}
		drawActor(a.X, a.Y, a.Username, col, a.Downed, false)
	}
	drawActor(p.X, p.Y, p.Username, Color{255, 230, 120}, p.DownedUntil != nil, true)

	// Pings: blinking markers from you and your party.
	for _, pg := range st.Pings {
		if sx, sy, ok := toScreen(pg.X, pg.Y); ok {
			bg := mix(Color{20, 80, 110}, Color{120, 230, 255}, pulse)
			cv.Put(sx+1, sy, '!', Color{10, 20, 30}, &bg, true)
		}
	}

	// Floating combat text
	now := time.Now()
	for _, f := range g.floaters {
		age := now.Sub(f.Born).Milliseconds()
		sx, sy, ok := toScreen(f.X, f.Y)
		if !ok {
			continue
		}
		y := sy - 1 - f.Stack - int(age/300)
		if y < r.y {
			continue
		}
		fade := clampf(1.2-float64(age)/900, 0.4, 1)
		x := sx + 1 - runeLen(f.Text)/2
		i := 0
		for _, ch := range f.Text {
			if x+i >= r.x && x+i < r.x+r.w {
				cv.Put(x+i, y, ch, scale(f.Color, fade), nil, true)
			}
			i++
		}
	}

	if p.DownedUntil != nil {
		secs := int(math.Max(0, math.Ceil((*p.DownedUntil-g.serverNow())/1000)))
		msg := fmt.Sprintf("  ✚ YOU ARE DOWN — an ally can revive you (%ds)  ", secs)
		cv.Text(r.x+maxi(0, (r.w-runeLen(msg))/2), r.y+1, msg, cWhite, ptr(Color{150, 20, 20}), true, r.w)
	}
}

// ------------------------------------------------------------------ minimap
func (g *Game) drawMinimap(r rect) {
	st := g.state
	p := st.Player
	camX := p.X - r.w/2
	camY := p.Y - r.h // each cell row shows 2 tiles
	marks := map[[2]int]Color{}
	for _, a := range st.NearbyPlayers {
		c := cCyan
		if a.Color != nil {
			c = *a.Color
		}
		marks[[2]int{a.X, a.Y}] = c
	}
	for _, m := range st.Monsters {
		if m.Boss {
			marks[[2]int{m.X, m.Y}] = Color{255, 60, 60}
		}
	}
	if st.Home != nil {
		marks[[2]int{st.Home.X, st.Home.Y}] = Color{80, 220, 120}
	}
	if st.Party != nil {
		for _, m := range st.Party.Members {
			marks[[2]int{m.X, m.Y}] = m.Color
		}
	}
	for _, pg := range st.Pings {
		marks[[2]int{pg.X, pg.Y}] = Color{120, 230, 255}
	}
	for _, n := range st.NPCs {
		if n.Name != "Merchant" {
			marks[[2]int{n.X, n.Y}] = n.Color
		}
	}
	marks[[2]int{p.X, p.Y}] = Color{255, 230, 80}
	colorAt := func(x, y int) Color {
		if c, ok := marks[[2]int{x, y}]; ok {
			return c
		}
		v, ok := g.mem.cells[[2]int{x, y}]
		switch {
		case !ok || v == 0:
			return theme.panel
		case v == -1:
			return Color{70, 70, 100}
		case g.mem.hasSafe && v == g.mem.safeRoom:
			return Color{50, 120, 70}
		default:
			if b := g.biomeFor(x, y); b != nil {
				return mix(b.Floor.FG, b.Wall, 0.4)
			}
			return Color{120, 100, 75}
		}
	}
	for row := 0; row < r.h; row++ {
		for col := 0; col < r.w; col++ {
			wx := camX + col
			topC := colorAt(wx, camY+row*2)
			bot := colorAt(wx, camY+row*2+1)
			g.cv.Put(r.x+col, r.y+row, '▀', topC, &bot, false)
		}
	}
}

// ------------------------------------------------------------------ sidebar
func (g *Game) drawSidebar(r rect) {
	cv := g.cv
	st := g.state
	p := st.Player
	s := p.Stats
	x, w := r.x, r.w
	y := r.y
	bottom := r.y + r.h
	inner := w - 4
	pb := theme.panel
	secs := func(until float64) int { return int(math.Max(0, math.Ceil((until-g.serverNow())/1000))) }

	// Character
	lines := 6
	if len(p.Buffs) > 0 {
		lines++
	}
	if p.Combo != nil && p.Combo.Count >= 2 {
		lines++
	}
	ch := mini(lines+2, bottom-y)
	cv.Box(x, y, w, ch, BoxOpts{Color: theme.border, BG: pb, Title: strings.ToUpper(p.ClassName), TitleColor: &p.ClassColor, RightTitle: fmt.Sprintf("Lv %d", s.Level), RightColr: ptr(theme.title)})
	cy := y + 1
	row := func(fn func(yy int)) {
		if cy < y+ch-1 {
			fn(cy)
			cy++
		}
	}
	row(func(yy int) {
		name := p.Username
		if p.Prestige > 0 {
			name = fmt.Sprintf("✦%d %s", p.Prestige, p.Username)
		}
		n := cv.Text(x+2, yy, name, p.ClassColor, &pb, true, inner)
		if p.Title != "" {
			cv.Text(x+3+n, yy, p.Title, theme.muted, &pb, false, inner-n-1)
		}
	})
	row(func(yy int) {
		cv.Text(x+2, yy, "HP", theme.muted, &pb, false, -1)
		cv.Bar(x+5, yy, inner-3, s.HP, s.MaxHP, hpColor(s.HP, s.MaxHP), fmt.Sprintf("%d / %d", int(math.Max(0, s.HP)), int(s.MaxHP)))
	})
	row(func(yy int) {
		cv.Text(x+2, yy, "XP", theme.muted, &pb, false, -1)
		cv.Bar(x+5, yy, inner-3, s.XP, s.XPNext, Color{90, 140, 255}, fmt.Sprintf("%d / %d", int(s.XP), int(s.XPNext)))
	})
	row(func(yy int) {
		xx := x + 2
		kv := func(k, v string, c Color) {
			xx += cv.Text(xx, yy, k+" ", theme.muted, &pb, false, -1)
			xx += cv.Text(xx, yy, v, c, &pb, true, -1) + 2
		}
		boosted := Color{120, 255, 140}
		atkC, defC := theme.text, theme.text
		if p.EffAtk != s.Atk {
			atkC = boosted
		}
		if p.EffDef != s.Def {
			defC = boosted
		}
		kv("ATK", fmt.Sprint(int(p.EffAtk)), atkC)
		kv("DEF", fmt.Sprint(int(p.EffDef)), defC)
		kv("CRIT", fmt.Sprintf("%d%%", int(math.Round(s.Crit*100))), theme.text)
		if xx+10 < x+w {
			kv("DGE", fmt.Sprintf("%d%%", int(math.Round(s.Dodge*100))), theme.text)
		}
	})
	row(func(yy int) {
		xx := x + 2
		xx += cv.Text(xx, yy, "◆ ", Color{255, 215, 0}, &pb, false, -1)
		xx += cv.Text(xx, yy, commas(int(s.Gold)), Color{255, 215, 0}, &pb, true, -1) + 3
		xx += cv.Text(xx, yy, "! ", Color{255, 80, 160}, &pb, true, -1)
		xx += cv.Text(xx, yy, fmt.Sprint(s.Potions), theme.text, &pb, true, -1) + 3
		xx += cv.Text(xx, yy, "☠ ", theme.muted, &pb, false, -1)
		cv.Text(xx, yy, fmt.Sprint(s.Kills), theme.text, &pb, false, -1)
	})
	row(func(yy int) {
		cv.Text(x+2, yy, fmt.Sprintf("Depth %d", st.Depth), Color{200, 160, 255}, &pb, true, -1)
		cv.Text(x+11, yy, fmt.Sprintf("best %d", s.MaxDepth), theme.muted, &pb, false, -1)
		if st.Home != nil {
			dx, dy := st.Home.X-p.X, st.Home.Y-p.Y
			txt, col := fmt.Sprintf("⌂ %d %s", int(math.Round(math.Hypot(float64(dx), float64(dy)))), compass(dx, dy)), theme.muted
			if p.Safe {
				txt, col = "⌂ safe room", cGreen
			}
			cv.Text(x+w-2-runeLen(txt), yy, txt, col, &pb, false, -1)
		}
	})
	if p.Combo != nil && p.Combo.Count >= 2 {
		row(func(yy int) {
			t := fmt.Sprintf("COMBO x%d", p.Combo.Count)
			cv.Text(x+2, yy, t, Color{255, 170, 40}, &pb, true, -1)
			cv.Bar(x+3+len(t), yy, inner-len(t)-1, p.Combo.Until-g.serverNow(), 4000, Color{255, 140, 40}, "")
		})
	}
	if len(p.Buffs) > 0 {
		row(func(yy int) {
			xx := x + 2
			for _, b := range p.Buffs {
				t := fmt.Sprintf(" %s %ds ", b.Name, secs(b.Until))
				if xx+runeLen(t) > x+w-2 {
					break
				}
				xx += cv.Text(xx, yy, t, Color{20, 30, 40}, ptr(Color{110, 210, 230}), true, -1) + 1
			}
		})
	}
	y += ch

	// Minimap
	if mmH := mini(9, bottom-y-2); mmH >= 4 && g.settings.Minimap {
		cv.Box(x, y, w, mmH+2, BoxOpts{Color: theme.border, BG: pb, Title: "MAP", TitleColor: ptr(theme.title)})
		g.drawMinimap(rect{x + 1, y + 1, w - 2, mmH})
		y += mmH + 2
	}

	// Enemies
	enemies := append([]Monster(nil), st.Monsters...)
	dist := func(m Monster) int { return iabs(m.X-p.X) + iabs(m.Y-p.Y) }
	sort.SliceStable(enemies, func(i, j int) bool {
		if enemies[i].Boss != enemies[j].Boss {
			return enemies[i].Boss
		}
		return dist(enemies[i]) < dist(enemies[j])
	})
	if eh := mini(maxi(1, mini(4, len(enemies)))+2, bottom-y); eh >= 3 {
		rt := ""
		if len(enemies) > 0 {
			rt = fmt.Sprintf("%d in sight", len(enemies))
		}
		cv.Box(x, y, w, eh, BoxOpts{Color: theme.border, BG: pb, Title: "ENEMIES", TitleColor: ptr(Color{255, 120, 120}), RightTitle: rt, RightColr: ptr(theme.muted)})
		if len(enemies) == 0 {
			cv.Text(x+2, y+1, "All quiet...", theme.faint, &pb, false, -1)
		}
		for i, m := range enemies {
			if i >= eh-2 {
				break
			}
			yy := y + 1 + i
			bg := pb
			if m.Boss {
				bg = Color{90, 20, 20}
			}
			cv.Put(x+2, yy, firstRune(m.Char), m.Color, &bg, true)
			nameW := inner - 12
			name := m.Name
			if m.Hunting {
				name += " !"
			}
			if m.Frozen {
				name += " ❄"
			}
			nc := theme.text
			if m.Boss {
				nc = Color{255, 150, 60}
			} else if m.Elite {
				nc = Color{255, 220, 90}
			}
			cv.Text(x+4, yy, pad(name, nameW), nc, &pb, m.Boss || m.Elite, nameW)
			cv.Bar(x+4+nameW, yy, 8, m.HP, m.MaxHP, hpColor(m.HP, m.MaxHP), "")
		}
		y += eh
	}

	// Bounties
	if qh := mini(len(p.Quests)+2, bottom-y); qh >= 3 {
		cv.Box(x, y, w, qh, BoxOpts{Color: theme.border, BG: pb, Title: "BOUNTIES", TitleColor: ptr(Color{255, 190, 110}), RightTitle: "J", RightColr: ptr(theme.faint)})
		for i, q := range p.Quests {
			if i >= qh-2 {
				break
			}
			yy := y + 1 + i
			done := q.Have >= q.Need
			prog := ""
			if q.Need > 1 {
				prog = fmt.Sprintf("%d/%d", int(q.Have), int(q.Need))
			} else if done {
				prog = "✓"
			}
			icon, col := "◇", Color{255, 190, 110}
			tc := theme.text
			if done {
				icon, col, tc = "✓", cGreen, cGreen
			}
			cv.Text(x+2, yy, icon, col, &pb, false, -1)
			cv.Text(x+4, yy, q.Desc, tc, &pb, false, inner-3-runeLen(prog))
			cv.Text(x+w-2-runeLen(prog), yy, prog, theme.muted, &pb, false, -1)
		}
		y += qh
	}

	// Party (when in one): members with distance and direction.
	if st.Party != nil {
		if ph := mini(len(st.Party.Members)+2, bottom-y); ph >= 3 {
			cv.Box(x, y, w, ph, BoxOpts{Color: theme.border, BG: pb, Title: "PARTY", TitleColor: ptr(cGreen), RightTitle: fmt.Sprintf("%d/4 · %d online", len(st.Party.Members), len(st.Online)), RightColr: ptr(theme.muted)})
			for i, m := range st.Party.Members {
				if i >= ph-2 {
					break
				}
				yy := y + 1 + i
				me := m.Username == p.Username
				lead := "  "
				if m.Username == st.Party.Leader {
					lead = "♛ "
				}
				cv.Text(x+2, yy, pad(lead+m.Username, 12), m.Color, &pb, me, 12)
				where := "you"
				if !me {
					dx, dy := m.X-p.X, m.Y-p.Y
					where = fmt.Sprintf("%d%s", int(math.Hypot(float64(dx), float64(dy))), strings.Fields(compass(dx, dy))[0])
				}
				cv.Text(x+14, yy, pad(where, 6), theme.muted, &pb, false, -1)
				if m.Downed {
					cv.Text(x+21, yy, "DOWN!", cRed, &pb, true, -1)
				} else {
					cv.Bar(x+21, yy, maxi(3, w-23), m.HP, m.MaxHP, hpColor(m.HP, m.MaxHP), "")
				}
			}
			y += ph
		}
	} else if ph := mini(len(st.Online)+2, bottom-y); ph >= 3 {
		cv.Box(x, y, w, ph, BoxOpts{Color: theme.border, BG: pb, Title: "PARTY", TitleColor: ptr(cGreen), RightTitle: fmt.Sprintf("%d online", len(st.Online)), RightColr: ptr(theme.muted)})
		for i, o := range st.Online {
			if i >= ph-2 {
				break
			}
			yy := y + 1 + i
			me := o.Username == p.Username
			prefix := "  "
			if me {
				prefix = "★ "
			}
			cv.Text(x+2, yy, pad(prefix+o.Username, 13), o.Color, &pb, me, 13)
			cls := o.Cls
			if len(cls) > 3 {
				cls = cls[:3]
			}
			cv.Text(x+15, yy, pad(fmt.Sprintf("%s %d", cls, o.Level), 7), theme.muted, &pb, false, -1)
			if o.Downed {
				cv.Text(x+22, yy, "DOWN!", cRed, &pb, true, -1)
			} else {
				cv.Bar(x+22, yy, maxi(3, w-24), o.HP, o.MaxHP, hpColor(o.HP, o.MaxHP), "")
			}
		}
	}
}

func iabs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func commas(n int) string {
	s := fmt.Sprint(n)
	if n < 0 {
		return s
	}
	out := ""
	for len(s) > 3 {
		out = "," + s[len(s)-3:] + out
		s = s[:len(s)-3]
	}
	return s + out
}

// ------------------------------------------------------------------- hotbar
func (g *Game) drawHotbar(r rect) {
	cv := g.cv
	p := g.state.Player
	cv.Fill(r.x, r.y, r.w, 1, theme.bg)
	slotW := r.w / (len(p.Skills) + 1)
	now := g.serverNow()
	dark := Color{15, 15, 20}
	for i, sk := range p.Skills {
		sx := r.x + i*slotW
		locked := p.Stats.Level < sk.Level
		remaining := math.Max(0, sk.ReadyAt-now)
		ready := !locked && remaining == 0
		keyBg := Color{90, 90, 110}
		if locked {
			keyBg = Color{40, 40, 50}
		} else if ready {
			keyBg = Color{255, 210, 90}
		}
		cv.Text(sx, r.y, " "+sk.Key+" ", dark, &keyBg, true, -1)
		nameW := slotW - 4
		switch {
		case locked:
			cv.Text(sx+3, r.y, pad(fmt.Sprintf(" %s · Lv%d", sk.Name, sk.Level), nameW), theme.faint, ptr(Color{24, 24, 32}), false, nameW)
		case ready:
			cv.Text(sx+3, r.y, pad(" "+sk.Name, nameW), Color{255, 240, 200}, ptr(Color{60, 52, 30}), true, nameW)
		default:
			frac := 0.0
			if sk.Cooldown > 0 {
				frac = 1 - remaining/sk.Cooldown
			}
			label := []rune(pad(fmt.Sprintf(" %s %ds", sk.Name, int(math.Ceil(remaining/1000))), nameW))
			filled := int(frac * float64(nameW))
			for j := 0; j < nameW && j < len(label); j++ {
				bg := Color{28, 28, 38}
				if j < filled {
					bg = Color{50, 50, 70}
				}
				cv.Put(sx+3+j, r.y, label[j], theme.muted, &bg, false)
			}
		}
	}
	px := r.x + len(p.Skills)*slotW
	potW := r.w - len(p.Skills)*slotW
	keyBg, txt := Color{255, 120, 180}, Color{255, 200, 230}
	if p.Stats.Potions == 0 {
		keyBg, txt = Color{60, 40, 50}, theme.faint
	}
	cv.Text(px, r.y, " H ", dark, &keyBg, true, -1)
	cv.Text(px+3, r.y, pad(fmt.Sprintf(" Potion ×%d", p.Stats.Potions), potW-3), txt, ptr(Color{45, 25, 38}), true, potW-3)
}

// ---------------------------------------------------------------------- log
func (g *Game) drawLog(r rect) {
	cv := g.cv
	pb := theme.panel
	title, hint := "LOG", g.settings.keyLabel("chat")+" chat · "+g.settings.keyLabel("partychat")+" party chat"
	if g.chatting {
		title, hint = "CHAT", "Enter send · Tab channel · Esc cancel"
		if g.partyChannel {
			title = "PARTY CHAT"
		}
	}
	cv.Box(r.x, r.y, r.w, r.h, BoxOpts{Color: theme.border, BG: pb, Title: title, TitleColor: ptr(theme.title), RightTitle: hint, RightColr: ptr(theme.faint)})
	lines := r.h - 2
	if g.chatting {
		lines--
	}
	// Collapse consecutive duplicates.
	type row struct {
		Msg
		count int
	}
	var rows []row
	for _, m := range g.msgs {
		if n := len(rows); n > 0 && rows[n-1].Text == m.Text {
			rows[n-1].count++
			continue
		}
		rows = append(rows, row{m, 1})
	}
	if len(rows) > lines {
		rows = rows[len(rows)-lines:]
	}
	for i, m := range rows {
		age := len(rows) - 1 - i
		fade := clampf(1-float64(age)*0.13, 0.45, 1)
		if !activePalette.logFade {
			fade = 1
		}
		text := m.Text
		if m.count > 1 {
			text = fmt.Sprintf("%s (x%d)", text, m.count)
		}
		cv.Text(r.x+2, r.y+1+i, text, scale(m.Color, fade), &pb, age == 0, r.w-4)
	}
	if g.chatting {
		shown := []rune("› " + g.chat + "▌")
		if len(shown) > r.w-4 {
			shown = shown[len(shown)-(r.w-4):]
		}
		cv.Text(r.x+2, r.y+r.h-2, string(shown), Color{140, 220, 255}, ptr(Color{30, 34, 50}), true, r.w-4)
	}
}

// ------------------------------------------------------------------ overlays
func (g *Game) drawOverlay(r rect) {
	cv := g.cv
	o := g.overlay
	col := Color{255, 200, 110}
	if o.Color != nil {
		col = *o.Color
	}
	contentW := maxi(36, maxi(runeLen(o.Title)+8, runeLen(o.Footer)+6))
	for _, l := range o.Lines {
		contentW = maxi(contentW, l.width()+4)
	}
	w := mini(r.w-2, contentW)
	h := mini(r.h-1, len(o.Lines)+4)
	x := r.x + (r.w-w)/2
	y := r.y + maxi(0, (r.h-h)/2)
	cv.Fill(x+1, y+1, w, h, Color{5, 5, 8}) // shadow
	bg := Color{24, 22, 34}
	cv.Box(x, y, w, h, BoxOpts{Color: col, BG: bg, Title: o.Title, TitleColor: &col})
	for i, l := range o.Lines {
		if i >= h-4 {
			break
		}
		lb := bg
		if l.BG != nil {
			lb = *l.BG
			cv.Fill(x+1, y+2+i, w-2, 1, lb)
		}
		xx := x + 2
		for _, sg := range l.Segs {
			xx += cv.Text(xx, y+2+i, sg.Text, sg.Color, &lb, sg.Bold, x+w-2-xx)
		}
	}
	if o.Footer != "" {
		f := " " + o.Footer + " "
		cv.Text(x+maxi(2, (w-runeLen(f))/2), y+h-1, f, Color{20, 20, 25}, &col, true, w-4)
	}
}

func (g *Game) drawToast(r rect) {
	cv := g.cv
	t := g.toast
	age := time.Since(t.Born)
	text := "  " + t.Text + "  "
	w := mini(r.w-4, runeLen(text)+2)
	x := r.x + (r.w-w)/2
	y := r.y + 2
	c := t.Color
	if age < 120*time.Millisecond {
		c = scale(c, 1.25)
	}
	bg := scale(t.Color, 0.25)
	cv.Box(x, y, w, 3, BoxOpts{Color: c, BG: bg})
	cv.Text(x+1+maxi(0, (w-2-runeLen(text))/2), y+1, text, c, &bg, true, w-2)
}

// biomeFor returns the biome a world tile belongs to (by its distance from home).
func (g *Game) biomeFor(x, y int) *BiomeInfo {
	if g.world == nil || g.state == nil || g.state.Home == nil || g.world.TierDistance <= 0 {
		return nil
	}
	d := math.Hypot(float64(x-g.state.Home.X), float64(y-g.state.Home.Y))
	tier := int(d / g.world.TierDistance)
	for i := range g.world.Biomes {
		b := &g.world.Biomes[i]
		if tier >= b.From && tier <= b.To {
			return b
		}
	}
	return nil
}
