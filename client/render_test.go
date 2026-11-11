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
