package main

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

var statLabels = map[string]string{
	"atk": "ATK", "def": "DEF", "maxHp": "HP", "crit": "crit", "dodge": "dodge",
	"lifesteal": "lifesteal", "goldFind": "gold find", "xpBonus": "XP", "regen": "regen",
}
var pctStats = map[string]bool{"crit": true, "dodge": true, "lifesteal": true, "goldFind": true, "xpBonus": true}
var statOrder = []string{"atk", "def", "maxHp", "crit", "dodge", "lifesteal", "goldFind", "xpBonus", "regen"}

func fmtStat(k string, v float64) string {
	sign := ""
	if v > 0 {
		sign = "+"
	}
	if pctStats[k] {
		return fmt.Sprintf("%s%d%% %s", sign, int(math.Round(v*100)), statLabels[k])
	}
	return fmt.Sprintf("%s%s %s", sign, trimFloat(v), statLabels[k])
}

func trimFloat(v float64) string {
	if v == math.Trunc(v) {
		return fmt.Sprint(int(v))
	}
	return fmt.Sprintf("%.1f", v)
}

func fmtStats(stats map[string]float64) string {
	var parts []string
	for _, k := range statOrder {
		if v, ok := stats[k]; ok {
			parts = append(parts, fmtStat(k, v))
		}
	}
	return strings.Join(parts, ", ")
}

func (g *Game) showHelp() {
	g.tutorialPage = 0
	g.showTutorial()
}

// helpLines is the how-to-play page (also shown from the main menu).
func helpLines(s Settings) []Line {
	k := s.keyLabel
	move := k("up") + k("left") + k("down") + k("right")
	lines := []Line{
		L("Explore an endless dungeon with your friends. The further from the", cWhite),
		L("safe room, the deeper and deadlier it gets - and the better the loot.", cWhite),
		L("", cWhite),
		L(fmt.Sprintf("%-6s / arrows  move - walk into monsters to attack", move), cCyan),
		L(fmt.Sprintf("%s %s %s %s        class skills (unlock at Lv 1, 6, 15, 30)", k("skill1"), k("skill2"), k("skill3"), k("skill4")), cCyan),
		L(fmt.Sprintf("%s potion   %s inventory   %s journal   %s party   %s travel", k("potion"), k("inventory"), k("journal"), k("party"), k("travel")), cCyan),
		L(fmt.Sprintf("%s ping   %s chat   %s party chat   %s ranks   %s settings   %s quit", k("ping"), k("chat"), k("partychat"), k("leaderboard"), k("settings"), k("quit")), cCyan),
		L("F3 toggles network latency and terminal rendering diagnostics", cCyan),
		L(k("dodge")+" then a direction: dodge up to two tiles (newer servers)", cCyan),
		L(k("rally")+" RALLY when Unity is full: every ally near you unleashes their ultimate", cCyan),
		L("", cWhite),
		L("M Merchant & blacksmith (safe room): potions, upgrades, +N gear, rebirth", cOrange),
		L("$ gold  ! potion  ♥ heart  = chest  ^ shrine  § lore scroll  Ω waystone", cYellow),
		L("& urn (smash it)  ≈ healing fountain  ≡ vault (needs 2 heroes)  ¤ cursed chest (a fight!)", cYellow),
		L("/ ] \" gear - color shows rarity:", cYellow),
		{Segs: []Seg{
			{Text: "   "},
			{Text: "Common  ", Color: rarityColors["common"], Bold: true},
			{Text: "Magic  ", Color: rarityColors["magic"], Bold: true},
			{Text: "Rare  ", Color: rarityColors["rare"], Bold: true},
			{Text: "Epic  ", Color: rarityColors["epic"], Bold: true},
			{Text: "LEGENDARY", Color: rarityColors["legendary"], Bold: true},
		}},
		L("Capital letters are BOSSES. RED FLOOR means an attack is about to land there: MOVE!", cOrange),
		L("Team combo: a skill marks a monster (✦) - when an ALLY hits it, it detonates for big damage.", cOrange),
		L("Stand next to an ally to take 15% less damage; hit the same monster together to flank it.", cOrange),
		L("A team combo made WITH a skill marks the foe again: pass the chain (×2, ×3...) round the party.", cOrange),
		L("Elites and bosses have POISE (yellow bar): break it together to STAGGER them (✷ +50% damage).", cOrange),
		L("Monsters chase whoever is most dangerous: warriors hold them, rogues slip under the radar.", cOrange),
		L("Auras: Warrior guards adjacent allies · Mage speeds allies' skills · Cleric mends allies and", cOrange),
		L("  keeps the downed alive longer · Rogue exposes weak points (+12% for allies' hits).", cOrange),
		L("Boss SEAL (◎): stand on every rune at the same time to shatter it and stagger the boss.", cOrange),
		L("", cWhite),
		L("Party up (P): shared XP, personal boss loot, travel to friends, pings.", cGreen),
		L("Fall near an ally and you go DOWN (%) - they have 20s to revive you.", cGreen),
		L("Monsters get stronger the further you go from the safe room: their level is", cGreen),
		L("shown in the title bar and the enemy list (white = your level, red = run).", cGreen),
		L("Waystones (Ω) let you travel back deep. At Lv 100 you can be REBORN stronger.", cGreen),
		L("At the edge of the world (monster level 95+) the Abyss Lord waits. Bring friends.", cRed),
	}
	return lines
}

func (g *Game) showClassSelect(note *Line) {
	classes := g.profile.Classes
	lines := []Line{L("Choose a role and preview its skills. Your choice is permanent.", cYellow)}
	if len(classes) == 0 {
		g.overlay = &Overlay{Kind: "class", Title: "CHOOSE YOUR CLASS", Lines: lines, Footer: "Waiting for class data · Q quit"}
		return
	}
	g.classCursor = clampi(g.classCursor, 0, len(classes)-1)
	for i, c := range classes {
		marker := " "
		if i == g.classCursor {
			marker = "▶"
		}
		lines = append(lines, L(fmt.Sprintf("%s %d  %-8s  HP %d · ATK %d · DEF %d", marker, i+1, c.Name, int(c.HP), int(c.Atk), int(c.Def)), c.Color))
	}
	selected := classes[g.classCursor]
	lines = append(lines, L("", cWhite), L(selected.Name, selected.Color))
	w, _ := g.cv.s.Size()
	for _, line := range wrap(selected.Desc, clampi(w-10, 12, 65)) {
		lines = append(lines, L(line, cWhite))
	}
	for _, skill := range selected.SkillDetails {
		lines = append(lines, L(fmt.Sprintf("Lv %-2d %s", skill.Level, skill.Name), cCyan))
		// Details matter most for the first skill a new hero can actually use.
		if skill.Level == 1 {
			lines = append(lines, L("  "+skill.Desc, theme.muted))
		}
	}
	if len(selected.SkillDetails) == 0 {
		for _, skill := range selected.Skills {
			lines = append(lines, L(skill, cCyan))
		}
	}
	footer := "↑/↓ or 1-4 preview · Enter choose · Q quit"
	if g.classConfirm {
		lines = append(lines, L("Choose "+selected.Name+" permanently?", cYellow))
		footer = "Enter confirm · Esc back"
	}
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "class", Title: "CHOOSE YOUR CLASS", Lines: lines, Footer: footer}
}

var legacyShopDescriptions = map[string]string{
	"potion":  "Adds one potion. It heals 40% of max HP, at least 15.",
	"atk":     "Permanent attack upgrade.",
	"def":     "Permanent defense upgrade.",
	"hp":      "Permanent max HP upgrade. Heals the amount gained.",
	"gamble":  "One random item at your level. Slot and rarity vary.",
	"rebirth": "Return to level 1. Keep gear and gold. Gain permanent ATK, HP and XP bonuses.",
}

func (g *Game) shopStatus(s *Shop, it ShopItem) string {
	switch {
	case it.Maxed:
		return "Maxed out"
	case it.ID == "potion" && s.PotionLimit > 0 && s.Potions >= s.PotionLimit:
		return "Potion bag full"
	case it.ID == "gamble" && g.profile != nil && g.profile.InventorySize > 0 && len(g.profile.Inventory) >= g.profile.InventorySize:
		return "Backpack full"
	case it.ID == "rebirth":
		level := 100
		if g.world != nil && g.world.RebirthLevel > 0 {
			level = g.world.RebirthLevel
		}
		if g.state == nil || g.state.Player.Stats.Level < level {
			return fmt.Sprintf("Unlocks at level %d", level)
		}
	case s.Gold < it.Price:
		return fmt.Sprintf("Need %s more gold", commas(int(it.Price-s.Gold)))
	}
	return ""
}

func (g *Game) showShop(s *Shop, note *Line) {
	if s == nil || len(s.Items) == 0 {
		return
	}
	g.shopCursor = clampi(g.shopCursor, 0, len(s.Items)-1)
	lines := []Line{L(fmt.Sprintf("Your gold: %s", commas(int(s.Gold))), cYellow)}
	if s.Greeting != "" {
		lines = append(lines, L(s.Greeting, cOrange))
	}
	for i, it := range s.Items {
		marker, color := " ", cWhite
		if i == g.shopCursor {
			marker, color = "▶", cYellow
		}
		if g.shopStatus(s, it) != "" && i != g.shopCursor {
			color = theme.muted
		}
		lines = append(lines, L(fmt.Sprintf("%s %s  %s  ·  %s g", marker, it.Key, it.Name, commas(int(it.Price))), color))
	}
	it := s.Items[g.shopCursor]
	desc := it.Description
	if desc == "" {
		desc = legacyShopDescriptions[it.ID]
	}
	lines = append(lines, L("", cWhite), L(fmt.Sprintf("%s · %s gold", it.Name, commas(int(it.Price))), cYellow))
	w, _ := g.cv.s.Size()
	for _, line := range wrap(desc, clampi(w-10, 12, 64)) {
		lines = append(lines, L(line, theme.text))
	}
	if it.ID == "potion" && s.PotionLimit > 0 {
		lines = append(lines, L(fmt.Sprintf("Potion bag: %d/%d", s.Potions, s.PotionLimit), theme.muted))
	}
	if status := g.shopStatus(s, it); status != "" {
		lines = append(lines, L(status, cRed))
	}
	footer := "↑/↓ or 1-6 preview · Enter select · I gear · X sell junk"
	if g.shopConfirm {
		lines = append(lines, L(fmt.Sprintf("Confirm purchase? Gold after: %s", commas(int(s.Gold-it.Price))), cYellow))
		footer = "Enter buy · Esc cancel"
	}
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "shop", Title: "MERCHANT & BLACKSMITH", Lines: lines, Footer: footer, shop: s}
}

type invEntry struct {
	slot     string
	item     *GearItem
	equipped bool
}

func (g *Game) inventoryEntries() []invEntry {
	if g.profile == nil {
		return nil
	}
	var out []invEntry
	for _, slot := range []string{"weapon", "armor", "trinket"} {
		out = append(out, invEntry{slot: slot, item: g.profile.Equipment[slot], equipped: true})
	}
	for i := range g.profile.Inventory {
		it := &g.profile.Inventory[i]
		out = append(out, invEntry{slot: it.Slot, item: it})
	}
	return out
}

func (g *Game) showInventory(note *Line) {
	if g.profile == nil {
		return
	}
	entries := g.inventoryEntries()
	g.invCursor = clampi(g.invCursor, 0, len(entries)-1)
	_, h := g.cv.s.Size()
	room := maxi(3, h-22)
	first := maxi(3, mini(g.invCursor-room/2, len(entries)-room))

	lines := []Line{L("EQUIPPED", cGray)}
	for i, e := range entries {
		if i == 3 {
			more := ""
			if first > 3 {
				more = "  ▲ more"
			}
			lines = append(lines, L(fmt.Sprintf("BACKPACK (%d/%d)%s", len(g.profile.Inventory), g.profile.InventorySize, more), cGray))
		}
		if i >= 3 && (i < first || i >= first+room) {
			continue
		}
		cur := " "
		if i == g.invCursor {
			cur = "▶"
		}
		label, ilvl, col := "(empty)", "", cDark
		if e.item != nil {
			label, ilvl, col = e.item.DisplayName(), fmt.Sprintf("ilvl %d", e.item.Ilvl), rarityColors[e.item.Rarity]
		}
		line := Line{Segs: []Seg{{Text: fmt.Sprintf("%s %s %s %s", cur, pad(e.slot, 8), pad(label, 34), ilvl), Color: col, Bold: i == g.invCursor}}}
		if i == g.invCursor {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	if len(g.profile.Inventory) == 0 {
		lines = append(lines, L("  (empty - go find some loot!)", cDark))
	}
	lines = append(lines, L("", cWhite))
	if g.invCursor < len(entries) {
		sel := entries[g.invCursor]
		if it := sel.item; it != nil {
			lines = append(lines, L(fmt.Sprintf("%s %s: %s", strings.ToUpper(it.Rarity), it.Slot, fmtStats(it.Stats)), rarityColors[it.Rarity]))
			if !sel.equipped {
				cur := g.profile.Equipment[it.Slot]
				keys := map[string]bool{}
				for k := range it.Stats {
					keys[k] = true
				}
				if cur != nil {
					for k := range cur.Stats {
						keys[k] = true
					}
				}
				var diffs []string
				score := 0.0
				for _, k := range statOrder {
					if !keys[k] {
						continue
					}
					d := it.Stats[k]
					if cur != nil {
						d -= cur.Stats[k]
					}
					d = math.Round(d*100) / 100
					if d == 0 {
						continue
					}
					diffs = append(diffs, fmtStat(k, d))
					w := 2.0
					if pctStats[k] {
						w = 50
					} else if k == "maxHp" {
						w = 0.4
					}
					score += d * w
				}
				txt := "same"
				if len(diffs) > 0 {
					txt = strings.Join(diffs, ", ")
				}
				c := cRed
				if score > 0 {
					c = cGreen
				}
				lines = append(lines, L("vs equipped: "+txt, c))
			}
			smith := ""
			if g.profile.Smith != nil {
				if c, ok := g.profile.Smith[it.UID]; ok {
					if c.Upgrade != nil {
						smith = fmt.Sprintf("   ·   U upgrade to +%d: %dg   ·   R reforge: %dg", it.Plus+1, int(*c.Upgrade), int(c.Reforge))
					} else {
						smith = fmt.Sprintf("   ·   max +10   ·   R reforge: %dg", int(c.Reforge))
					}
				}
			}
			lines = append(lines, L(fmt.Sprintf("Sell value: %d gold%s", int(it.Value), smith), cYellow))
		}
	}
	if note != nil {
		lines = append(lines, *note)
	}
	footer := "↑/↓ select · E equip · X sell · D drop · Esc close"
	if g.state != nil && g.state.Player.Safe {
		footer = "↑/↓ select · E equip · X sell · D drop · U upgrade · R reforge · Esc"
	}
	g.overlay = &Overlay{Kind: "inventory", Title: "INVENTORY", Lines: lines, Footer: footer}
}

func (g *Game) showJournal() {
	if g.profile == nil {
		return
	}
	p := g.profile
	if g.journalPage == 1 {
		g.overlay = &Overlay{Kind: "journal", Title: "JOURNAL · LORE", Lines: g.loreLines(), Footer: "↑/↓ entries · PgUp/PgDn scroll · C replay intro · Tab bounties"}
		return
	}
	lines := []Line{L("BOUNTIES - always 3 active, new ones appear when you finish one", cOrange)}
	for _, q := range p.Quests {
		mark := "·"
		if q.Have >= q.Need {
			mark = "✓"
		}
		extra := ""
		if q.Reward.Item {
			extra = " +item"
		}
		lines = append(lines, L(fmt.Sprintf("  %s %s %s %dg %dxp%s", mark, pad(q.Desc, 34), pad(fmt.Sprintf("%d/%d", int(q.Have), int(q.Need)), 9), int(q.Reward.Gold), int(q.Reward.XP), extra), cWhite))
	}
	lines = append(lines, L("", cWhite))
	unlocked := 0
	for _, a := range p.Achievements {
		if a.Unlocked {
			unlocked++
		}
	}
	title := "(none)"
	if p.Title != nil {
		title = *p.Title
	}
	lines = append(lines, L(fmt.Sprintf("ACHIEVEMENTS %d/%d   title: %s", unlocked, len(p.Achievements), title), cOrange))
	cell := func(a Achievement) Seg {
		txt, c := "· "+a.Name+": "+a.Desc, cGray
		if a.Unlocked {
			txt, c = "★ "+a.Name+": "+a.Title, cPink
		}
		return Seg{Text: pad(txt, 37), Color: c}
	}
	half := (len(p.Achievements) + 1) / 2
	for i := 0; i < half; i++ {
		segs := []Seg{cell(p.Achievements[i]), {Text: " "}}
		if i+half < len(p.Achievements) {
			segs = append(segs, cell(p.Achievements[i+half]))
		}
		lines = append(lines, Line{Segs: segs})
	}
	g.overlay = &Overlay{Kind: "journal", Title: "JOURNAL", Lines: lines, Footer: "Tab lore · N change title · any key to close"}
}

func (g *Game) showLeaderboard(rows []LeaderRow) {
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].Prestige != rows[j].Prestige {
			return rows[i].Prestige > rows[j].Prestige
		}
		return rows[i].Level > rows[j].Level
	})
	lines := []Line{L("#  Name           Class     Lv  Depth Kills Bosses  Title", cGray)}
	me := ""
	if g.state != nil {
		me = g.state.Player.Username
	}
	for i, r := range rows {
		cls, title := "-", ""
		if r.Cls != nil {
			cls = *r.Cls
		}
		if r.Title != nil {
			title = *r.Title
		}
		c := cWhite
		if r.Username == me {
			c = cYellow
		}
		name := r.Username
		if r.Prestige > 0 {
			name = fmt.Sprintf("✦%d %s", r.Prestige, r.Username)
		}
		lines = append(lines, L(fmt.Sprintf("%s %s %s %3d %5d %5d %6d  %s", pad(fmt.Sprint(i+1), 2), pad(name, 14), pad(cls, 8), r.Level, r.MaxDepth, r.Kills, r.BossKills, title), c))
	}
	if len(rows) == 0 {
		lines = append(lines, L("No heroes yet.", cWhite))
	}
	g.overlay = &Overlay{Kind: "leaderboard", Title: "HALL OF HEROES", Lines: lines, Footer: "any key to close"}
}
