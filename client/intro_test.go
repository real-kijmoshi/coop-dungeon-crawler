package main

import (
	"strings"
	"testing"

	"github.com/gdamore/tcell/v2"
)

func TestIntroScenesAndJournalReplay(t *testing.T) {
	screen := tcell.NewSimulationScreen("UTF-8")
	if err := screen.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(screen.Fini)
	screen.SetSize(64, 24)
	g := &Game{cv: &Canvas{s: screen}, settings: defaultSettings(), profile: &Profile{}}
	g.settings.Animations = false
	press := func(key tcell.Key, r rune) {
		g.handleKey(tcell.NewEventKey(key, r, tcell.ModNone))
	}
	read := func() string {
		g.draw()
		cells, w, _ := screen.GetContents()
		var out strings.Builder
		for i, cell := range cells {
			if i > 0 && i%w == 0 {
				out.WriteByte('\n')
			}
			if len(cell.Runes) > 0 {
				out.WriteRune(cell.Runes[0])
			}
		}
		return out.String()
	}
	g.beginHeroIntro()
	for _, title := range []string{"The lights of Emberfall", "The night the wells burned", "The last safe room"} {
		if !strings.Contains(read(), title) {
			t.Errorf("scene title %q missing", title)
		}
		press(tcell.KeyEnter, 0)
	}
	if g.intro != nil || g.overlay == nil || g.overlay.Kind != "tutorial" {
		t.Fatal("finishing the first intro should open the Field Guide")
	}
	g.beginHeroIntro()
	if g.intro != nil {
		t.Fatal("a delayed class confirmation must not restart the intro")
	}

	g.journalPage = 1
	g.showJournal()
	press(tcell.KeyRune, 'c')
	press(tcell.KeyRight, 0)
	press(tcell.KeyLeft, 0)
	if g.intro == nil || g.intro.scene != 0 {
		t.Fatal("replay should allow moving backward")
	}
	screen.SetSize(32, 16)
	got := read()
	for _, want := range []string{"The lights of Emberfall", "Emberfall grew", "Enter · Esc"} {
		if !strings.Contains(got, want) {
			t.Errorf("compact terminal did not render %q", want)
		}
	}
	press(tcell.KeyEscape, 0)
	if g.intro != nil || g.overlay == nil || g.overlay.Kind != "journal" || g.journalPage != 1 {
		t.Fatal("leaving the replay should return to journal lore")
	}
}
