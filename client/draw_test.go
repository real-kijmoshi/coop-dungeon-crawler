package main

import (
	"github.com/gdamore/tcell/v2"
	"testing"
)

// Track tcell's real dirty-cell rules, including invalidation caused by
// clearing a glyph and then drawing the identical glyph again.
type measuredScreen struct {
	tcell.Screen
	cells       tcell.CellBuffer
	dirty, sets int
}

func measureScreen(t testing.TB, w, h int) *measuredScreen {
	t.Helper()
	s := tcell.NewSimulationScreen("UTF-8")
	if err := s.Init(); err != nil {
		t.Fatal(err)
	}
	s.SetSize(w, h)
	t.Cleanup(s.Fini)
	m := &measuredScreen{Screen: s}
	m.cells.Resize(w, h)
	return m
}
func (s *measuredScreen) SetContent(x, y int, r rune, comb []rune, st tcell.Style) {
	s.sets++
	s.cells.SetContent(x, y, r, comb, st)
	s.Screen.SetContent(x, y, r, comb, st)
}
func (s *measuredScreen) Show() {
	s.dirty = 0
	w, h := s.Size()
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if s.cells.Dirty(x, y) {
				s.dirty++
			}
			s.cells.SetDirty(x, y, false)
		}
	}
	s.Screen.Show()
}
func fixtureGame(t testing.TB, w, h int) (*Game, *measuredScreen) {
	s := measureScreen(t, w, h)
	g := &Game{cv: &Canvas{s: s}, connected: true, settings: defaultSettings(), mem: Memory{cells: map[[2]int]int{}, hasSafe: true, safeRoom: 1}}
	v := View{OriginX: -12, OriginY: -12, Grid: make([][]*int, 25)}
	floor := 1
	for y := range v.Grid {
		v.Grid[y] = make([]*int, 25)
		for x := range v.Grid[y] {
			v.Grid[y][x] = &floor
		}
	}
	g.state = &GameState{View: v, Player: PlayerState{Username: "benchmark", ClassName: "Warrior", ClassColor: cGreen, Safe: true, Stats: Stats{HP: 100, MaxHP: 100, XPNext: 100, Level: 1}}}
	g.mem.remember(v)
	return g, s
}
func BenchmarkGameDraw(b *testing.B) {
	g, s := fixtureGame(b, 120, 40)
	g.draw()
	s.sets = 0
	dirty := 0
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		g.draw()
		dirty += s.dirty
	}
	b.StopTimer()
	b.ReportMetric(float64(dirty)/float64(b.N), "dirty-cells/frame")
	b.ReportMetric(float64(s.sets)/float64(b.N), "SetContent/frame")
}

func TestUnchangedGameFrameDoesNotInvalidateTerminal(t *testing.T) {
	g, s := fixtureGame(t, 120, 40)
	g.draw()
	s.sets = 0
	g.draw()
	if s.dirty != 0 || s.sets != 0 {
		t.Fatalf("unchanged scene repainted: %d submissions, %d dirty cells", s.sets, s.dirty)
	}
	g.log("A new message", cCyan)
	g.draw()
	if s.sets == 0 || s.dirty >= 120*40 {
		t.Fatalf("small change caused a full repaint: %d dirty cells", s.dirty)
	}
}

func TestComposedFramesMatchDirectDrawing(t *testing.T) {
	composed := measureScreen(t, 24, 8)
	direct := measureScreen(t, 24, 8)
	a, b := &Canvas{s: composed}, &Canvas{s: direct, W: 24, H: 8}
	scene := func(c *Canvas, variant int) {
		c.Fill(0, 0, c.W, c.H, theme.bg)
		c.Box(0, 0, c.W, c.H, BoxOpts{BG: theme.panel, Color: cCyan, Title: "Test"})
		c.Text(2, 2, "Wide 界 · ⚔", cGreen, nil, true, -1)
		if variant > 0 {
			c.Fill(2, 2, 12, 1, theme.bg)
			c.Text(4, 3, "replacement", cRed, nil, false, -1)
		}
		if variant > 1 {
			c.Box(3, 1, 16, 6, BoxOpts{BG: theme.bg, Color: cYellow, Title: "Overlay"})
		}
	}
	for variant := 0; variant < 3; variant++ {
		a.BeginFrame()
		scene(a, variant)
		a.Show()
		scene(b, variant)
		b.Show()
		for y := 0; y < 8; y++ {
			for x := 0; x < 24; x++ {
				ar, _, as, aw := composed.GetContent(x, y)
				br, _, bs, bw := direct.GetContent(x, y)
				if ar != br || as != bs || aw != bw {
					t.Fatalf("frame %d cell %d,%d differs", variant, x, y)
				}
			}
		}
	}
	composed.Screen.(tcell.SimulationScreen).SetSize(15, 6)
	composed.cells.Resize(15, 6)
	a.BeginFrame()
	scene(a, 0)
	a.Show()
	if composed.sets == 0 || a.W != 15 || a.H != 6 {
		t.Fatal("resize did not rebuild the frame")
	}
}
