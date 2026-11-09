package main

import (
	"fmt"
	"strings"
)

// ----------------------------------------------------------------- settings

var settingRows = []string{"theme", "preset", "floaters", "screenFlash", "lowHpPulse", "banners", "combatLog", "confirmSell", "minimap", "nameTags", "keys", "quit"}

func onOff(b bool) string {
	if b {
		return "ON"
	}
	return "off"
}

func cycle(list []string, cur string, back bool) string {
	for i, v := range list {
		if v == cur {
			if back {
				return list[(i-1+len(list))%len(list)]
			}
			return list[(i+1)%len(list)]
		}
	}
	return list[0]
}

func (g *Game) changeSetting(row string, back bool) {
	s := &g.settings
	switch row {
	case "theme":
		s.Theme = cycle(themeOrder, s.Theme, back)
		applyTheme(s.Theme)
	case "preset":
		s.Preset = cycle(presetOrder, s.Preset, back)
		s.Keys = copyKeys(presets[s.Preset])
	case "floaters":
		s.Floaters = !s.Floaters
	case "screenFlash":
		s.ScreenFlash = !s.ScreenFlash
	case "lowHpPulse":
		s.LowHPPulse = !s.LowHPPulse
	case "banners":
		s.Banners = !s.Banners
	case "combatLog":
		s.CombatLog = !s.CombatLog
	case "confirmSell":
		s.ConfirmSell = !s.ConfirmSell
	case "minimap":
		s.Minimap = !s.Minimap
	case "nameTags":
		s.NameTags = !s.NameTags
	case "keys":
		g.menuCursor = 0
		g.showKeys()
		return
	case "quit":
		g.settings.save()
		g.quit = true
		return
	}
	s.save()
}

func (g *Game) showSettings() {
	s := g.settings
	rows := map[string][2]string{
		"theme":       {"Color theme", s.Theme},
		"preset":      {"Key layout", s.Preset},
		"floaters":    {"Floating combat numbers", onOff(s.Floaters)},
		"screenFlash": {"Screen flash on hits / level ups", onOff(s.ScreenFlash)},
		"lowHpPulse":  {"Pulse the frame at low HP", onOff(s.LowHPPulse)},
		"banners":     {"Big banners (achievements, bosses...)", onOff(s.Banners)},
		"combatLog":   {"Show every hit in the log", onOff(s.CombatLog)},
		"confirmSell": {"Confirm before selling Rare+ items", onOff(s.ConfirmSell)},
		"minimap":     {"Minimap", onOff(s.Minimap)},
		"nameTags":    {"Name tags over other heroes", onOff(s.NameTags)},
		"keys":        {"Rebind keys…", ""},
		"quit":        {"Quit game", ""},
	}
	lines := []Line{L("Changes save automatically and apply right away.", theme.muted), L("", cWhite)}
	for i, id := range settingRows {
		r := rows[id]
		sel := i == g.menuCursor
		valColor := cCyan
		if r[1] == "off" {
			valColor = theme.faint
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{
			{Text: marker + pad(r[0], 40), Color: theme.text, Bold: sel},
			{Text: r[1], Color: valColor, Bold: true},
		}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	lines = append(lines, L("", cWhite), L("Saved to "+settingsPath(), theme.faint))
	g.overlay = &Overlay{Kind: "settings", Title: "MENU · SETTINGS", Lines: lines, Footer: "↑/↓ choose · ←/→/Enter change · Esc back to game"}
}

func (g *Game) showKeys() {
	lines := []Line{L("Select an action and press Enter, then press the new key.", theme.muted), L("", cWhite)}
	_, h := g.cv.s.Size()
	room := maxi(6, h-14)
	first := clampi(g.menuCursor-room/2, 0, maxi(0, len(actions)-room))
	for i, a := range actions {
		if i < first || i >= first+room {
			continue
		}
		sel := i == g.menuCursor
		key := g.settings.keyLabel(a.ID)
		if sel && g.rebinding == a.ID {
			key = "press a key…"
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{{Text: marker + pad(a.Label, 24), Color: theme.text, Bold: sel}, {Text: key, Color: cYellow, Bold: true}}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	lines = append(lines, L("", cWhite), L("Arrow keys always move unless you bind them to something else.", theme.faint))
	g.overlay = &Overlay{Kind: "keys", Title: "KEY BINDINGS · " + g.settings.Preset, Lines: lines, Footer: "↑/↓ choose · Enter rebind · Esc back"}
}

// -------------------------------------------------------------------- party

// partyCandidates lists names shown in the party menu: members first, then others online.
func (g *Game) partyCandidates() []string {
	if g.state == nil {
		return nil
	}
	var out []string
	if g.state.Party != nil {
		for _, m := range g.state.Party.Members {
			if m.Username != g.state.Player.Username {
				out = append(out, m.Username)
			}
		}
	}
	for _, o := range g.state.Online {
		if o.Username != g.state.Player.Username && !o.Party {
			out = append(out, o.Username)
		}
	}
	return out
}

func (g *Game) showParty(note *Line) {
	if g.state == nil {
		return
	}
	st := g.state
	lines := []Line{}
	if st.Party != nil {
		lines = append(lines, L(fmt.Sprintf("YOUR PARTY (%d/4) · leader: %s", len(st.Party.Members), st.Party.Leader), cGreen))
		for _, m := range st.Party.Members {
			status := fmt.Sprintf("%d/%d HP", int(m.HP), int(m.MaxHP))
			if m.Downed {
				status = "DOWN!"
			}
			where := "you"
			if m.Username != st.Player.Username {
				dx, dy := m.X-st.Player.X, m.Y-st.Player.Y
				where = fmt.Sprintf("%d tiles %s", int(hypot(dx, dy)), compass(dx, dy))
			}
			lines = append(lines, Line{Segs: []Seg{
				{Text: "  " + pad(m.Username, 14), Color: m.Color, Bold: true},
				{Text: pad(fmt.Sprintf("%s Lv %d", m.Cls, m.Level), 14), Color: theme.muted},
				{Text: pad(status, 12), Color: hpColor(m.HP, m.MaxHP)},
				{Text: fmt.Sprintf("depth %d · %s", m.Depth, where), Color: theme.muted},
			}})
		}
		lines = append(lines, L("", cWhite))
	} else {
		lines = append(lines, L("You're not in a party. Invite someone below - parties share XP, loot and travel.", theme.muted), L("", cWhite))
	}
	cands := g.partyCandidates()
	lines = append(lines, L("HEROES ONLINE", cYellow))
	if len(cands) == 0 {
		lines = append(lines, L("  Nobody else is online right now.", theme.faint))
	}
	members := map[string]bool{}
	if st.Party != nil {
		for _, m := range st.Party.Members {
			members[m.Username] = true
		}
	}
	for i, name := range cands {
		sel := i == g.menuCursor
		tag := "invite"
		if members[name] {
			tag = "in party"
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{{Text: marker + pad(name, 20), Color: theme.text, Bold: sel}, {Text: tag, Color: theme.muted}}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	lines = append(lines, L("", cWhite),
		L("Party perks: +10% XP per nearby member, 60% XP share up to 30 tiles,", theme.faint),
		L("personal boss loot, travel to members (V), party chat (Tab), pings (G).", theme.faint))
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "party", Title: "PARTY", Lines: lines, Footer: "Enter invite · L leave · K kick · C party chat · Esc close"}
}

// ------------------------------------------------------------------- travel
func (g *Game) showTravel(note *Line) {
	t := g.travelOpts
	lines := []Line{}
	if !t.Can && t.Reason != nil {
		lines = append(lines, L(*t.Reason, cOrange), L("", cWhite))
	} else {
		lines = append(lines, L("Choose where to go. Travel works from the safe room or a waystone (Ω).", theme.muted), L("", cWhite))
	}
	for i, d := range t.Destinations {
		sel := i == g.menuCursor
		icon, col := "⌂", cGreen
		switch d.Kind {
		case "waystone":
			icon, col = "Ω", Color{120, 230, 255}
		case "party":
			icon, col = "@", cYellow
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{{Text: marker + icon + " ", Color: col, Bold: true}, {Text: d.Label, Color: theme.text, Bold: sel}}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	if len(t.Destinations) <= 1 {
		lines = append(lines, L("", cWhite), L("Find waystones (Ω) as you explore to unlock more destinations.", theme.faint))
	}
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "travel", Title: "TRAVEL", Lines: lines, Footer: "↑/↓ choose · Enter travel · Esc close", Color: ptr(Color{120, 230, 255})}
}

// -------------------------------------------------------------------- story
func (g *Game) showStory(lines []string) {
	out := []Line{}
	for _, l := range lines {
		out = append(out, L(l, Color{240, 225, 190}))
	}
	out = append(out, L("", cWhite), L("Press ? for controls and O for settings at any time.", theme.muted))
	g.overlay = &Overlay{Kind: "story", Title: "THE TALE OF EMBERFALL", Lines: out, Footer: "any key to begin", Color: ptr(Color{240, 200, 120})}
}

// --------------------------------------------------------------- lore page
func (g *Game) loreLines() []Line {
	p := g.profile
	total := 12
	if g.world != nil {
		total = g.world.LoreTotal
	}
	lines := []Line{L(fmt.Sprintf("LORE SCROLLS %d/%d  -  find scrolls (§) in the dungeon to learn what woke up below", len(p.Lore), total), cOrange), L("", cWhite)}
	if len(p.Lore) == 0 {
		lines = append(lines, L("You haven't found any lore yet. Scrolls are more common deeper down.", theme.faint))
	}
	for _, l := range p.Lore {
		lines = append(lines, L(fmt.Sprintf("%d. %s", l.N, l.Title), Color{240, 220, 170}))
		for _, w := range wrap(l.Text, 66) {
			lines = append(lines, L("   "+w, theme.text))
		}
	}
	return lines
}

func wrap(text string, width int) []string {
	var out []string
	line := ""
	for _, w := range strings.Fields(text) {
		if runeLen(line)+runeLen(w)+1 > width && line != "" {
			out = append(out, line)
			line = w
		} else if line == "" {
			line = w
		} else {
			line += " " + w
		}
	}
	if line != "" {
		out = append(out, line)
	}
	return out
}

func hypot(dx, dy int) float64 {
	return sqrt(float64(dx*dx + dy*dy))
}
