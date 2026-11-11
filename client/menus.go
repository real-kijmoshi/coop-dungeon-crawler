package main

import (
	"fmt"
	"strings"
)

// ----------------------------------------------------------------- settings

// Settings rows, shared by the in-game menu and the main menu. Rows starting
// with "#" are section headings.
var settingRows = []string{
	"#Sound", "music", "musicVolume", "sounds", "soundVolume",
	"#Graphics", "theme", "animations", "decor", "floaters", "screenFlash", "lowHpPulse", "banners", "minimap", "nameTags",
	"#Gameplay", "preset", "keys", "combatLog", "confirmSell",
	"#", "mainMenu", "quit",
}

// Rows the main menu leaves out (they only make sense in a game).
var gameOnlyRows = map[string]bool{"mainMenu": true, "quit": true, "#": true}

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

func volumeBar(v int) string {
	return strings.Repeat("▮", v) + strings.Repeat("▯", 10-v) + fmt.Sprintf(" %d", v)
}

// settingInfo returns the label and current value of a row.
func settingInfo(s Settings, id string) (string, string) {
	switch id {
	case "music":
		return "Music", onOff(s.Music)
	case "musicVolume":
		return "Music volume", volumeBar(s.MusicVolume)
	case "sounds":
		return "Sound effects", onOff(s.Sounds)
	case "soundVolume":
		return "Sound effect volume", volumeBar(s.SoundVolume)
	case "theme":
		return "Color theme", s.Theme
	case "animations":
		return "Animations (torches, embers, flicker)", onOff(s.Animations)
	case "decor":
		return "Dungeon details (bones, moss, lava...)", onOff(s.Decor)
	case "preset":
		return "Key layout", s.Preset
	case "floaters":
		return "Floating combat numbers", onOff(s.Floaters)
	case "screenFlash":
		return "Screen flash on hits / level ups", onOff(s.ScreenFlash)
	case "lowHpPulse":
		return "Pulse the frame at low HP", onOff(s.LowHPPulse)
	case "banners":
		return "Big banners (achievements, bosses...)", onOff(s.Banners)
	case "combatLog":
		return "Show every hit in the log", onOff(s.CombatLog)
	case "confirmSell":
		return "Confirm before selling Rare+ items", onOff(s.ConfirmSell)
	case "minimap":
		return "Minimap", onOff(s.Minimap)
	case "nameTags":
		return "Name tags over other heroes", onOff(s.NameTags)
	case "keys":
		return "Rebind keys…", ""
	case "mainMenu":
		return "Back to the main menu", ""
	case "quit":
		return "Quit game", ""
	}
	return id, ""
}

// changeSetting edits a row. It returns an action for rows that open something
// ("keys", "mainMenu", "quit"), or "" after saving a changed value.
func (s *Settings) change(id string, back bool) string {
	step := 1
	if back {
		step = -1
	}
	switch id {
	case "music":
		s.Music = !s.Music
	case "musicVolume":
		s.MusicVolume = clampi(s.MusicVolume+step, 0, 10)
		s.Music = s.MusicVolume > 0
	case "sounds":
		s.Sounds = !s.Sounds
	case "soundVolume":
		s.SoundVolume = clampi(s.SoundVolume+step, 0, 10)
		s.Sounds = s.SoundVolume > 0
	case "theme":
		s.Theme = cycle(themeOrder, s.Theme, back)
		applyTheme(s.Theme)
	case "animations":
		s.Animations = !s.Animations
	case "decor":
		s.Decor = !s.Decor
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
	case "keys", "mainMenu", "quit":
		return id
	}
	s.save()
	return ""
}

// settingLines draws the rows as overlay lines; cursor indexes into rows.
func settingLines(s Settings, rows []string, cursor int, audioStatus string) []Line {
	var lines []Line
	for i, id := range rows {
		if strings.HasPrefix(id, "#") {
			if len(lines) > 0 {
				lines = append(lines, L("", cWhite))
			}
			if id != "#" {
				lines = append(lines, Line{Segs: []Seg{{Text: strings.ToUpper(id[1:]), Color: theme.title, Bold: true}}})
			}
			continue
		}
		label, val := settingInfo(s, id)
		sel := i == cursor
		valColor := cCyan
		if val == "off" {
			valColor = theme.faint
		}
		if strings.Contains(val, "▮") || strings.Contains(val, "▯") {
			valColor = Color{255, 200, 110}
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{
			{Text: marker + pad(label, 40), Color: theme.text, Bold: sel},
			{Text: val, Color: valColor, Bold: true},
		}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	if audioStatus != "" {
		lines = append(lines, L("", cWhite), L("Audio: "+audioStatus, theme.faint))
	}
	return lines
}

// nextRow moves a cursor over rows, skipping headings.
func nextRow(rows []string, cur, dir int) int {
	n := len(rows)
	for i := 0; i < n; i++ {
		cur = (cur + dir + n) % n
		if !strings.HasPrefix(rows[cur], "#") {
			return cur
		}
	}
	return cur
}

func (g *Game) changeSetting(row string, back bool) {
	switch g.settings.change(row, back) {
	case "keys":
		g.menuCursor = 0
		g.showKeys()
		return
	case "mainMenu":
		g.settings.save()
		g.toMenu = true
		g.quit = true
		return
	case "quit":
		g.settings.save()
		g.quit = true
		return
	}
	if g.app != nil {
		g.app.settings = g.settings
		g.app.audio.Apply(g.settings)
	}
}

func (g *Game) showSettings() {
	if strings.HasPrefix(settingRows[g.menuCursor], "#") {
		g.menuCursor = nextRow(settingRows, g.menuCursor, 1)
	}
	lines := []Line{L("Changes save automatically and apply right away.", theme.muted), L("", cWhite)}
	status := ""
	if g.app != nil {
		status = g.app.audio.Status()
	}
	lines = append(lines, settingLines(g.settings, settingRows, g.menuCursor, status)...)
	lines = append(lines, L("Saved to "+settingsPath(), theme.faint))
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
		L("Party perks: full XP for every party kill within 30 tiles, +10% per member,", theme.faint),
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
