package main

import (
	"fmt"
	"html"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gdamore/tcell/v2"
)

// Dev tool: CDC_PREVIEW=out.html go test -run TestPreviewScene renders a team fight.
func TestPreviewScene(t *testing.T) {
	out := os.Getenv("CDC_PREVIEW")
	if out == "" {
		t.Skip("set CDC_PREVIEW")
	}
	s := tcell.NewSimulationScreen("UTF-8")
	_ = s.Init()
	s.SetSize(150, 44)
	g := &Game{cv: &Canvas{s: s}, settings: defaultSettings(), profile: &Profile{}, mem: Memory{cells: map[[2]int]int{}}, connected: true}
	st := &GameState{Depth: 4, AreaLevel: 14, MaxLevel: 100, Biome: Biome{ID: "crypts", Name: "Crypts"}}
	st.Now = float64(time.Now().UnixMilli())
	p := &st.Player
	p.Username, p.ClassName, p.Cls, p.ClassColor = "alice", "Warrior", "warrior", Color{255, 120, 80}
	p.Stats = Stats{Level: 14, HP: 310, MaxHP: 420, Atk: 40, Def: 22, Gold: 1240, Potions: 3, XP: 300, XPNext: 900}
	p.X, p.Y = 50, 50
	unity := 0.0
	fmt.Sscan(os.Getenv("CDC_UNITY"), &unity)
	p.Unity = &Unity{Value: unity, Max: 100}
	now := st.Now
	p.Skills = []Skill{{ID: "cleave", Key: "1", Name: "Cleave", Level: 1, Cooldown: 5000}, {ID: "warcry", Key: "2", Name: "War Cry", Level: 6, Cooldown: 20000, ReadyAt: now + 8000}, {ID: "ironskin", Key: "3", Name: "Iron Skin", Level: 15}, {ID: "berserk", Key: "4", Name: "Berserk", Level: 30}}
	p.Buffs = []Buff{{ID: "rally", Name: "Rally", Until: now + 6000}, {ID: "guarding", Name: "Guarding bob", Until: now + 1000}, {ID: "blessed", Name: "Blessed", Until: now + 1000}}
	dr := now + 1200
	p.DodgeReadyAt = &dr
	one := 3
	st.View = View{OriginX: 38, OriginY: 38}
	for y := 0; y < 25; y++ {
		row := make([]*int, 25)
		for x := range row {
			wx, wy := 38+x, 38+y
			if wx >= 41 && wx <= 61 && wy >= 43 && wy <= 57 {
				row[x] = &one
			} else {
				z := 0
				row[x] = &z
			}
		}
		st.View.Grid = append(st.View.Grid, row)
	}
	poiseB, poiseE := 0.35, 0.0
	st.Monsters = []Monster{
		{ID: 1, Name: "Goblin King", Char: "G", Color: Color{140, 255, 80}, Level: 16, HP: 1900, MaxHP: 4200, X: 55, Y: 47, Boss: true, Sealed: os.Getenv("CDC_SEAL") != "", Poise: &poiseB, Hunting: true},
		{ID: 2, Name: "Frenzied Orc", Char: "o", Color: Color{255, 180, 110}, Level: 15, HP: 300, MaxHP: 700, X: 51, Y: 51, Elite: true, Staggered: true, Poise: &poiseE},
		{ID: 3, Name: "Skeleton", Char: "s", Color: Color{230, 230, 210}, Level: 14, HP: 90, MaxHP: 160, X: 47, Y: 48, Primed: "frost", Chain: 2},
		{ID: 4, Name: "Goblin", Char: "g", Color: Color{90, 200, 90}, Level: 13, HP: 120, MaxHP: 120, X: 58, Y: 53, Windup: true},
	}
	st.Danger = [][2]int{{57, 52}, {58, 52}, {59, 52}, {57, 53}, {59, 53}, {57, 54}, {58, 54}, {59, 54}}
	if os.Getenv("CDC_SEAL") != "" {
		st.Runes = []Rune{{X: 44, Y: 45, Lit: true, Until: now + 12000}, {X: 59, Y: 45, Until: now + 12000}, {X: 52, Y: 56, Lit: true, Until: now + 12000}}
	}
	c1 := Color{255, 240, 150}
	c2 := Color{140, 170, 255}
	c3 := Color{180, 255, 120}
	st.NearbyPlayers = []Ally{
		{ID: 2, Username: "bob", X: 49, Y: 50, HP: 280, MaxHP: 360, Party: true, Color: &c1},
		{ID: 3, Username: "cara", X: 48, Y: 53, HP: 120, MaxHP: 300, Party: true, Color: &c2},
		{ID: 4, Username: "dex", X: 53, Y: 49, HP: 0, MaxHP: 320, Party: true, Downed: true, Color: &c3},
	}
	st.Party = &PartyState{Leader: "alice", Members: []PartyMember{
		{Username: "alice", Cls: "Warrior", Color: p.ClassColor, Level: 14, HP: 310, MaxHP: 420, X: 50, Y: 50, Depth: 4},
		{Username: "bob", Cls: "Cleric", Color: c1, Level: 13, HP: 280, MaxHP: 360, X: 49, Y: 50, Depth: 4},
		{Username: "cara", Cls: "Mage", Color: c2, Level: 14, HP: 120, MaxHP: 300, X: 48, Y: 53, Depth: 4},
		{Username: "dex", Cls: "Rogue", Color: c3, Level: 12, HP: 0, MaxHP: 320, X: 53, Y: 49, Depth: 4, Downed: true},
	}}
	st.Player.Quests = []QuestBrief{{Desc: "Slay 10 skeletons", Have: 4, Need: 10}}
	g.state = st
	g.mem.remember(st.View)
	t0 := time.Now()
	for _, f := range []Floater{{X: 51, Y: 51, Text: "STAGGERED!", Color: Color{255, 220, 90}}, {X: 47, Y: 48, Text: "SHATTER ×2!", Color: Color{150, 220, 255}}, {X: 49, Y: 50, Text: "-34⛨", Color: Color{255, 170, 110}}, {X: 55, Y: 47, Text: "212!", Color: Color{255, 230, 60}}} {
		g.floaters = append(g.floaters, Floating{f, t0.Add(-200 * time.Millisecond), 0})
	}
	for _, m := range []string{"You hit the Frenzied Orc for 48 (flanked).", "cara breaks the Frenzied Orc's guard - STAGGERED for 3.5s! Everyone hits 50% harder!", "TEAM COMBO with cara: SHATTER! CHAIN ×2! 212 damage.", "dex is DOWN! Walk into them within 30s to revive!"} {
		g.log(m, Color{220, 220, 220})
	}
	if tx := os.Getenv("CDC_TOAST"); tx != "" {
		g.toast = &Toast{Text: tx, Color: Color{120, 255, 220}, Born: time.Now()}
	}
	g.draw()
	s.Show()
	cells, w, h := s.GetContents()
	var b strings.Builder
	b.WriteString(`<html><body style="margin:0;background:#000"><pre style="font:15px/18px 'DejaVu Sans Mono',monospace;margin:0">`)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := cells[y*w+x]
			fg, bg, attr := c.Style.Decompose()
			r1, g1, b1 := fg.RGB()
			r2, g2, b2 := bg.RGB()
			ch := " "
			if len(c.Runes) > 0 {
				ch = string(c.Runes[0])
			}
			wt := ""
			if attr&tcell.AttrBold != 0 {
				wt = ";font-weight:bold"
			}
			fmt.Fprintf(&b, `<span style="color:rgb(%d,%d,%d);background:rgb(%d,%d,%d)%s">%s</span>`, r1, g1, b1, r2, g2, b2, wt, html.EscapeString(ch))
		}
		b.WriteString("\n")
	}
	b.WriteString("</pre></body></html>")
	_ = os.WriteFile(out, []byte(b.String()), 0o644)
}
