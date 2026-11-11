package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gdamore/tcell/v2"
)

// Action is something a key can be bound to.
type Action struct {
	ID    string
	Label string
}

// Actions in the order the key-binding screen lists them.
var actions = []Action{
	{"up", "Move up"}, {"down", "Move down"}, {"left", "Move left"}, {"right", "Move right"},
	{"skill1", "Skill 1"}, {"skill2", "Skill 2"}, {"skill3", "Skill 3"}, {"skill4", "Skill 4"},
	{"potion", "Drink potion"}, {"inventory", "Inventory"}, {"journal", "Journal"},
	{"party", "Party"}, {"travel", "Travel (waystones)"}, {"ping", "Ping / mark target"},
	{"chat", "Chat"}, {"partychat", "Party chat"}, {"leaderboard", "Leaderboard"},
	{"help", "Help"}, {"settings", "Settings"}, {"accept", "Accept invite"}, {"decline", "Decline invite"},
	{"quit", "Quit"},
}

var presets = map[string]map[string]string{
	"WASD": {
		"up": "w", "down": "s", "left": "a", "right": "d",
		"skill1": "1", "skill2": "2", "skill3": "3", "skill4": "4",
		"potion": "h", "inventory": "i", "journal": "j", "party": "p", "travel": "v", "ping": "g",
		"chat": "t", "partychat": "Tab", "leaderboard": "l", "help": "?", "settings": "o",
		"accept": "y", "decline": "n", "quit": "q",
	},
	"Vim (hjkl)": {
		"up": "k", "down": "j", "left": "h", "right": "l",
		"skill1": "1", "skill2": "2", "skill3": "3", "skill4": "4",
		"potion": "e", "inventory": "i", "journal": "u", "party": "p", "travel": "v", "ping": "g",
		"chat": "t", "partychat": "Tab", "leaderboard": "r", "help": "?", "settings": "o",
		"accept": "y", "decline": "n", "quit": "q",
	},
	"Arrows": {
		"up": "Up", "down": "Down", "left": "Left", "right": "Right",
		"skill1": "1", "skill2": "2", "skill3": "3", "skill4": "4",
		"potion": "h", "inventory": "i", "journal": "j", "party": "p", "travel": "v", "ping": "g",
		"chat": "t", "partychat": "Tab", "leaderboard": "l", "help": "?", "settings": "o",
		"accept": "y", "decline": "n", "quit": "q",
	},
}
var presetOrder = []string{"WASD", "Vim (hjkl)", "Arrows"}
var themeOrder = []string{"Classic", "High contrast", "Colorblind-friendly"}

type Settings struct {
	Preset      string            `json:"preset"`
	Keys        map[string]string `json:"keys"`
	Theme       string            `json:"theme"`
	Floaters    bool              `json:"floaters"`
	ScreenFlash bool              `json:"screenFlash"`
	LowHPPulse  bool              `json:"lowHpPulse"`
	Banners     bool              `json:"banners"`
	CombatLog   bool              `json:"combatLog"`
	ConfirmSell bool              `json:"confirmSell"`
	Minimap     bool              `json:"minimap"`
	NameTags    bool              `json:"nameTags"`
	Music       bool              `json:"music"`
	MusicVolume int               `json:"musicVolume"` // 0..10
	Sounds      bool              `json:"sounds"`
	SoundVolume int               `json:"soundVolume"` // 0..10
	Animations  bool              `json:"animations"`  // title screen embers, torch flicker, ...
	Decor       bool              `json:"decor"`       // biome details on the floor
}

func defaultSettings() Settings {
	s := Settings{
		Preset: "WASD", Theme: "Classic", Floaters: true, ScreenFlash: true, LowHPPulse: true,
		Banners: true, CombatLog: true, ConfirmSell: true, Minimap: true, NameTags: true,
		Music: true, MusicVolume: 6, Sounds: true, SoundVolume: 7, Animations: true, Decor: true,
	}
	s.Keys = copyKeys(presets["WASD"])
	return s
}

func copyKeys(m map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range m {
		out[k] = v
	}
	return out
}

func settingsPath() string { return filepath.Join(configDir(), "settings.json") }

func loadSettings() Settings {
	s := defaultSettings()
	raw, err := os.ReadFile(settingsPath())
	if err != nil {
		return s
	}
	_ = json.Unmarshal(raw, &s)
	// Fill bindings added in newer versions.
	base := presets["WASD"]
	if p, ok := presets[s.Preset]; ok {
		base = p
	}
	for k, v := range base {
		if _, ok := s.Keys[k]; !ok {
			s.Keys[k] = v
		}
	}
	applyTheme(s.Theme)
	return s
}

func (s *Settings) save() {
	_ = os.MkdirAll(configDir(), 0o700)
	raw, _ := json.MarshalIndent(s, "", "  ")
	_ = os.WriteFile(settingsPath(), raw, 0o600)
}

// keyName turns a key event into the name used in bindings.
func keyName(ev *tcell.EventKey) string {
	switch ev.Key() {
	case tcell.KeyRune:
		r := ev.Rune()
		if r == ' ' {
			return "Space"
		}
		return strings.ToLower(string(r))
	case tcell.KeyUp:
		return "Up"
	case tcell.KeyDown:
		return "Down"
	case tcell.KeyLeft:
		return "Left"
	case tcell.KeyRight:
		return "Right"
	case tcell.KeyEnter:
		return "Enter"
	case tcell.KeyTab:
		return "Tab"
	case tcell.KeyEscape:
		return "Esc"
	case tcell.KeyBackspace, tcell.KeyBackspace2:
		return "Backspace"
	case tcell.KeyDelete:
		return "Delete"
	}
	if ev.Key() >= tcell.KeyF1 && ev.Key() <= tcell.KeyF12 {
		return fmt.Sprintf("F%d", int(ev.Key()-tcell.KeyF1)+1)
	}
	return ""
}

// actionFor finds the action bound to a key. Arrow keys always move unless
// the player bound them to something else.
func (s *Settings) actionFor(name string) string {
	for _, a := range actions {
		if s.Keys[a.ID] == name {
			return a.ID
		}
	}
	switch name {
	case "Up":
		return "up"
	case "Down":
		return "down"
	case "Left":
		return "left"
	case "Right":
		return "right"
	}
	return ""
}

// bind assigns a key; if another action used it, the two swap keys.
func (s *Settings) bind(action, key string) {
	old := s.Keys[action]
	for _, a := range actions {
		if a.ID != action && s.Keys[a.ID] == key {
			s.Keys[a.ID] = old
		}
	}
	s.Keys[action] = key
	s.Preset = "Custom"
}

func (s *Settings) keyLabel(action string) string {
	k := s.Keys[action]
	if len(k) == 1 {
		return strings.ToUpper(k)
	}
	return k
}

// ------------------------------------------------------------------ themes
type palette struct {
	hpHigh, hpMid, hpLow Color
	light, memory        float64 // tile brightness for visible / remembered
	logFade              bool
	hurt, heal           Color
}

var activePalette = paletteFor("Classic")

func paletteFor(name string) palette {
	p := palette{
		hpHigh: Color{80, 220, 100}, hpMid: Color{240, 200, 60}, hpLow: Color{240, 70, 70},
		light: 1, memory: 0.32, logFade: true,
		hurt: Color{255, 90, 90}, heal: Color{110, 255, 130},
	}
	switch name {
	case "High contrast":
		p.light, p.memory, p.logFade = 1.35, 0.5, false
		p.hpHigh, p.hpMid, p.hpLow = Color{90, 255, 120}, Color{255, 230, 0}, Color{255, 60, 60}
	case "Colorblind-friendly":
		// Blue / yellow / magenta instead of green / yellow / red.
		p.hpHigh, p.hpMid, p.hpLow = Color{60, 170, 255}, Color{255, 210, 0}, Color{255, 80, 200}
		p.hurt, p.heal = Color{255, 150, 0}, Color{0, 210, 255}
	}
	return p
}

func applyTheme(name string) {
	activePalette = paletteFor(name)
	switch name {
	case "High contrast":
		theme.border, theme.text, theme.muted, theme.faint = Color{150, 150, 190}, Color{255, 255, 255}, Color{190, 190, 205}, Color{120, 120, 140}
		rarityColors["magic"] = Color{110, 170, 255}
	case "Colorblind-friendly":
		resetThemeColors()
		rarityColors["magic"] = Color{0, 150, 255}
		rarityColors["epic"] = Color{255, 100, 255}
		cGreen = Color{60, 170, 255}
		cRed = Color{255, 140, 0}
	default:
		resetThemeColors()
	}
}

func resetThemeColors() {
	theme.border, theme.text, theme.muted, theme.faint = Color{70, 70, 95}, Color{225, 225, 230}, Color{125, 125, 140}, Color{70, 70, 85}
	rarityColors["magic"] = Color{100, 150, 255}
	rarityColors["epic"] = Color{200, 100, 255}
	cGreen = Color{90, 230, 110}
	cRed = Color{255, 80, 80}
}

// themeFloater adjusts server colors for color-blind players.
func themeFloater(c Color) Color {
	if activePalette.hurt == (Color{255, 90, 90}) {
		return c
	}
	if c[1] > c[0]+60 && c[1] > c[2] { // green-ish -> heal color
		return activePalette.heal
	}
	if c[0] > c[1]+80 && c[0] > c[2]+80 { // red-ish -> hurt color
		return activePalette.hurt
	}
	return c
}

// isCombatSpam reports routine hit messages that the "combat log" toggle hides.
func isCombatSpam(text string) bool {
	return strings.HasPrefix(text, "You hit the ") || strings.HasPrefix(text, "CRIT! You hit") ||
		(strings.HasPrefix(text, "The ") && strings.Contains(text, " you for ")) ||
		strings.HasSuffix(text, "'s attack!") || strings.Contains(text, " slays the ")
}
