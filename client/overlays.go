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
	lines := []Line{
		L("Explore an endless dungeon with your friends. The further from the", cWhite),
		L("safe room, the deeper and deadlier it gets - and the better the loot.", cWhite),
		L("", cWhite),
		L("WASD / arrows  move - walk into monsters to attack", cCyan),
		L("1 2 3 4        class skills (unlock at Lv 1, 3, 5, 8)", cCyan),
		L("H potion   I inventory   J journal (bounties & achievements)", cCyan),
		L("T / Enter chat    L leaderboard    ? help    Q / Esc quit", cCyan),
		L("", cWhite),
		L("M Merchant: upgrades, potions, gambling, sell loot (in the safe room)", cOrange),
		L("$ gold  ! potion  ♥ heart  = chest  ^ shrine (temporary buff)", cYellow),
		L("/ ] \" gear - color shows rarity:", cYellow),
		{Segs: []Seg{
			{Text: "   "},
			{Text: "Common  ", Color: rarityColors["common"], Bold: true},
			{Text: "Magic  ", Color: rarityColors["magic"], Bold: true},
			{Text: "Rare  ", Color: rarityColors["rare"], Bold: true},
			{Text: "Epic  ", Color: rarityColors["epic"], Bold: true},
			{Text: "LEGENDARY", Color: rarityColors["legendary"], Bold: true},
		}},
		L("Capital letters are BOSSES guarding treasure. Bold = elite.", cOrange),
		L("", cWhite),
		L("Chain kills within 4s for COMBO XP. Finish bounties for big rewards.", cGreen),
		L("Co-op: fall near an ally and you go DOWN (%) - they have 20s to", cGreen),
		L("walk into you and revive you. Allies near a kill share its XP.", cGreen),
		L("Watch for WORLD EVENTS: gold rush, blood moon, treasure goblins!", cRed),
	}
	g.overlay = &Overlay{Kind: "help", Title: "HOW TO PLAY", Lines: lines, Footer: "any key to close"}
}

func (g *Game) showClassSelect() {
	lines := []Line{L("Choose your class. This is permanent for this hero!", cYellow), L("", cWhite)}
	for i, c := range g.profile.Classes {
		lines = append(lines, Line{Segs: []Seg{
			{Text: fmt.Sprintf("[%d] ", i+1), Color: cWhite, Bold: true},
			{Text: strings.ToUpper(c.Name), Color: c.Color, Bold: true},
			{Text: fmt.Sprintf("  HP %d  ATK %d  DEF %d  crit %d%%  dodge %d%%", int(c.HP), int(c.Atk), int(c.Def), int(math.Round(c.Crit*100)), int(math.Round(c.Dodge*100))), Color: theme.muted},
		}})
		lines = append(lines, L("    "+c.Desc, cWhite))
		lines = append(lines, L("    "+strings.Join(c.Skills, ", "), cGray))
	}
	g.overlay = &Overlay{Kind: "class", Title: "CHOOSE YOUR CLASS", Lines: lines, Footer: "press 1-4"}
}

func (g *Game) showShop(s *Shop, note *Line) {
	if s == nil {
		return
	}
	g.lastShop = s
	lines := []Line{L("\"Welcome, traveller! Gold for steel, steel for glory.\"", cOrange), L("", cWhite)}
	for _, it := range s.Items {
		c := cWhite
		if s.Gold < it.Price {
			c = cDark
		}
		lines = append(lines, L(fmt.Sprintf("[%s] %s %5d g", it.Key, pad(it.Name, 30), int(it.Price)), c))
	}
	lines = append(lines,
		L("[X] Sell all Common & Magic items", cYellow),
		L("[I] Open inventory to sell single items", cYellow),
		L("", cWhite),
		L(fmt.Sprintf("Your gold: %s", commas(int(s.Gold))), cYellow),
	)
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "shop", Title: "MERCHANT", Lines: lines, Footer: "1-5 buy · X sell junk · I inventory · Esc close", shop: s}
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
			label, ilvl, col = e.item.Name, fmt.Sprintf("ilvl %d", e.item.Ilvl), rarityColors[e.item.Rarity]
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
			lines = append(lines, L(fmt.Sprintf("Sell value: %d gold", int(it.Value)), cYellow))
		}
	}
	if note != nil {
		lines = append(lines, *note)
	}
	g.overlay = &Overlay{Kind: "inventory", Title: "INVENTORY", Lines: lines, Footer: "W/S select · E equip/unequip · X sell · D drop · Esc close"}
}

func (g *Game) showJournal() {
	if g.profile == nil {
		return
	}
	p := g.profile
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
	g.overlay = &Overlay{Kind: "journal", Title: "JOURNAL", Lines: lines, Footer: "N change title · any key to close"}
}

func (g *Game) showLeaderboard(rows []LeaderRow) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Level > rows[j].Level })
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
		lines = append(lines, L(fmt.Sprintf("%s %s %s %3d %5d %5d %6d  %s", pad(fmt.Sprint(i+1), 2), pad(r.Username, 14), pad(cls, 8), r.Level, r.MaxDepth, r.Kills, r.BossKills, title), c))
	}
	if len(rows) == 0 {
		lines = append(lines, L("No heroes yet.", cWhite))
	}
	g.overlay = &Overlay{Kind: "leaderboard", Title: "HALL OF HEROES", Lines: lines, Footer: "any key to close"}
}
