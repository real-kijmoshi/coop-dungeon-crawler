package main

import (
	"strings"
	"testing"

	"github.com/gdamore/tcell/v2"
)

func TestEnemyListShowsLevels(t *testing.T) {
	s := tcell.NewSimulationScreen("UTF-8")
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
	s.SetSize(150, 42)
	cv := &Canvas{s: s}
	g := &Game{cv: cv, settings: defaultSettings(), profile: &Profile{}}
	st := &GameState{Depth: 3, AreaLevel: 12, MaxLevel: 100}
	st.Player.Stats.Level = 10
	st.Player.Stats.HP, st.Player.Stats.MaxHP = 100, 100
	st.Player.ClassName = "Rogue"
	st.Player.X, st.Player.Y = 50, 50
	st.View = View{OriginX: 38, OriginY: 38}
	st.Monsters = []Monster{
		{Name: "Goblin", Char: "g", Level: 9, HP: 30, MaxHP: 40, X: 52, Y: 50},
		{Name: "Elite Skeleton", Char: "s", Level: 17, HP: 80, MaxHP: 80, Elite: true, X: 55, Y: 50},
		{Name: "Goblin King", Char: "G", Level: 104, HP: 900, MaxHP: 900, Boss: true, X: 58, Y: 50},
	}
	g.state = st
	g.draw()
	s.Show()
	cells, w, h := s.GetContents()
	var b strings.Builder
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r := cells[y*w+x].Runes
			if len(r) == 0 {
				b.WriteRune(' ')
			} else {
				b.WriteRune(r[0])
			}
		}
		b.WriteRune('\n')
	}
	out := b.String()
	for _, want := range []string{"9 Goblin", "17 Elite Skeleton", "104 Goblin King", "MONSTERS LV 12", "Area Lv 12"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q", want)
		}
	}
}

// Telegraphed attacks: the server lists the tiles, the client paints them red and
// shows which monsters are winding up or carry a team-combo mark.
func TestDangerTilesAndCombatMarks(t *testing.T) {
	s := tcell.NewSimulationScreen("UTF-8")
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
	s.SetSize(150, 42)
	g := &Game{cv: &Canvas{s: s}, settings: defaultSettings(), profile: &Profile{}, mem: Memory{cells: map[[2]int]int{}}}
	g.settings.Animations = false
	st := &GameState{Depth: 1, AreaLevel: 5, MaxLevel: 100}
	st.Player.Stats.Level, st.Player.Stats.HP, st.Player.Stats.MaxHP = 5, 100, 100
	st.Player.X, st.Player.Y = 50, 50
	one := 1
	st.View = View{OriginX: 38, OriginY: 38}
	for y := 0; y < 25; y++ {
		row := make([]*int, 25)
		for x := range row {
			row[x] = &one
		}
		st.View.Grid = append(st.View.Grid, row)
	}
	st.Monsters = []Monster{{ID: 1, Name: "Orc", Char: "o", Level: 5, HP: 40, MaxHP: 40, X: 53, Y: 50, Primed: "frost"}}
	redness := func() (danger, safe int32) {
		g.state = st
		g.mem.remember(st.View)
		g.draw()
		s.Show()
		cells, w, _ := s.GetContents()
		// find the hero, then look at the tile to the right and one two rows down
		for i, c := range cells {
			if len(c.Runes) > 0 && c.Runes[0] == '@' {
				_, bg, _ := cells[i+2].Style.Decompose()
				r1, g1, _ := bg.RGB()
				_, bg2, _ := cells[i+2*w+2].Style.Decompose()
				r2, g2, _ := bg2.RGB()
				return r1 - g1, r2 - g2
			}
		}
		t.Fatal("hero not drawn")
		return 0, 0
	}
	before, _ := redness()
	st.Danger = [][2]int{{51, 50}, {52, 50}}
	after, elsewhere := redness()
	if after < before+40 {
		t.Errorf("a danger tile must turn red: %d -> %d", before, after)
	}
	if elsewhere > before+20 {
		t.Errorf("tiles outside the danger zone must not change (%d vs %d)", elsewhere, before)
	}
	cells, w, h := s.GetContents()
	var b strings.Builder
	for i := 0; i < w*h; i++ {
		if len(cells[i].Runes) > 0 {
			b.WriteRune(cells[i].Runes[0])
		}
	}
	if !strings.Contains(b.String(), "Orc ✦") {
		t.Error("a marked monster must be flagged in the enemy list")
	}
}
