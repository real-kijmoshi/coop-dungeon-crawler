package main

import "fmt"

type tutorialPage struct {
	title string
	steps []string
}

func (g *Game) tutorialPages() []tutorialPage {
	k := g.settings.keyLabel
	dodge := "Dodge with " + k("dodge") + ", then choose a direction. Dodge travels up to two tiles."
	if k("dodge") == "" {
		dodge = "Bind Dodge in Settings if you want a quick step of up to two tiles."
	}
	if g.state != nil && g.state.Player.DodgeReadyAt == nil {
		dodge = "Walk out of marked tiles. Dodging is available on newer servers."
	}
	opening := "You're in the safe room. Walk out when you're ready to fight."
	merchant := "Walk into the merchant (M) in the safe room."
	if g.hasCities() {
		opening = fmt.Sprintf("Start in Emberfall's Post Court. Walk into Dena (D) to talk, or stand next to her and press %s. Open the atlas with %s.", k("interact"), k("atlas"))
		merchant = "Walk into the merchant (M) in Post Court or in the dungeon safe room."
	}
	return []tutorialPage{
		{"Your first steps", []string{
			opening,
			fmt.Sprintf("Move with %s / %s / %s / %s or the arrow keys. Walk into an enemy to attack it.", k("up"), k("left"), k("down"), k("right")),
			fmt.Sprintf("%s uses your first class skill. %s drinks a potion when you need healing.", k("skill1"), k("potion")),
		}},
		{"Read the fight", []string{
			"Marked floor shows where an attack will land. Step out or interrupt it. When an enemy misses everyone, the next hit on it does more damage.",
			dodge,
			"An ally's hit detonates the mark your skill leaves. Stand beside allies to take less damage, and walk into a downed ally to revive them.",
		}},
		{"Talk and form a party", []string{
			fmt.Sprintf("%s opens chat for everyone on the server. %s opens private party chat once you've joined a party.", k("chat"), k("partychat")),
			"While typing, Tab changes channel and Enter sends. The channel is shown beside your message.",
			fmt.Sprintf("%s opens the party list. Select a hero and press Enter to invite them. They press %s to accept.", k("party"), k("accept")),
		}},
		{"Buy gear and find the story", []string{
			merchant + " Pick an offer to see its effect and price before you confirm.",
			fmt.Sprintf("%s opens your inventory. Select gear to compare it against what you're wearing.", k("inventory")),
			fmt.Sprintf("%s opens the journal. Switch to Lore to read the story of Emberfall, records unlocked by depth, and scrolls (§) you pick up.", k("journal")),
		}},
	}
}

func (g *Game) showTutorial() {
	pages := g.tutorialPages()
	page := pages[g.tutorialPage]
	lines := []Line{L(fmt.Sprintf("LESSON %d/%d · %s", g.tutorialPage+1, len(pages), page.title), cOrange)}
	w, _ := g.cv.s.Size()
	for _, step := range page.steps {
		lines = append(lines, L("", cWhite))
		for _, line := range wrap(step, clampi(w-10, 12, 66)) {
			lines = append(lines, L(line, theme.text))
		}
	}
	g.overlay = &Overlay{Kind: "tutorial", Title: "FIELD GUIDE", Lines: lines, Footer: "←/→ pages · Enter next · Esc close"}
}
