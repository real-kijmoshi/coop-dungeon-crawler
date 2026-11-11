package main

import (
	"strings"
	"testing"

	"github.com/gdamore/tcell/v2"
)

func TestOnboardingAndShopPreview(t *testing.T) {
	screen := tcell.NewSimulationScreen("UTF-8")
	if err := screen.Init(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(screen.Fini)
	screen.SetSize(64, 24)
	g := &Game{cv: &Canvas{s: screen}, settings: defaultSettings(), connected: true}
	g.onProfile(&Profile{Classes: []ClassInfo{
		{ID: "warrior", Name: "Warrior", HP: 42},
		{ID: "mage", Name: "Mage", HP: 32, SkillDetails: []ClassSkill{{Name: "Fireball", Desc: "2x damage to a foe in sight", Level: 1}}},
	}})
	press := func(key tcell.Key, r rune) {
		g.handleKey(tcell.NewEventKey(key, r, tcell.ModNone))
	}
	press(tcell.KeyRune, '2')
	if g.classCursor != 1 || g.classConfirm || g.selectionPending {
		t.Fatal("number key should preview a class without selecting it")
	}
	press(tcell.KeyEnter, 0)
	if !g.classConfirm || g.selectionPending {
		t.Fatal("first Enter should confirm intent without a network request")
	}
	press(tcell.KeyEscape, 0)
	if g.classConfirm {
		t.Fatal("Escape should cancel the class confirmation")
	}

	g.handleNet(NetEvent{T: "story", D: []byte(`["Emberfall"]`)})
	if g.intro == nil || g.overlay.Kind != "intro" {
		t.Fatal("the first hero should see the intro")
	}
	press(tcell.KeyEscape, 0)
	if g.intro != nil || g.overlay.Kind != "tutorial" {
		t.Fatal("skipping the intro should open the Field Guide")
	}
	press(tcell.KeyRight, 0)
	press(tcell.KeyRight, 0)
	if g.tutorialPage != 2 {
		t.Fatal("expected chat lesson")
	}
	press(tcell.KeyEscape, 0)
	g.openChat(true)
	if g.chatting || len(g.msgs) == 0 || !strings.Contains(g.msgs[len(g.msgs)-1].Text, "Join a party") {
		t.Fatal("opening party chat outside a party must not open world chat")
	}

	stock := &Shop{Gold: 100, PotionLimit: 9, Items: []ShopItem{
		{Key: "1", ID: "potion", Name: "Potion", Price: 20},
		{Key: "2", ID: "gamble", Name: "Mystery item", Price: 60},
	}}
	g.showShop(stock, nil)
	press(tcell.KeyRune, '2')
	if g.shopCursor != 1 || g.shopConfirm || g.selectionPending {
		t.Fatal("number key should preview an offer without buying")
	}
	press(tcell.KeyEnter, 0)
	if !g.shopConfirm || g.selectionPending {
		t.Fatal("first Enter should preview remaining gold")
	}
	if got := g.overlay.Lines[len(g.overlay.Lines)-1].Segs[0].Text; !strings.Contains(got, "Gold after: 40") {
		t.Fatalf("expected purchase total, got %q", got)
	}
	press(tcell.KeyEscape, 0)
	if g.shopConfirm || g.overlay == nil || g.overlay.Kind != "shop" {
		t.Fatal("Escape should return to the offers")
	}
}
