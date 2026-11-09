package main

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
)

type Msg struct {
	Text  string
	Color Color
}

type Seg struct {
	Text  string
	Color Color
	Bold  bool
}

type Line struct {
	Segs []Seg
	BG   *Color
}

func (l Line) width() int {
	n := 0
	for _, s := range l.Segs {
		n += runeLen(s.Text)
	}
	return n
}

// L is a one-color overlay line.
func L(text string, c Color) Line { return Line{Segs: []Seg{{Text: text, Color: c}}} }

type Overlay struct {
	Kind   string // help, class, shop, inventory, journal, leaderboard
	Title  string
	Footer string
	Lines  []Line
	Color  *Color
	shop   *Shop
}

type Floating struct {
	Floater
	Born  time.Time
	Stack int
}

type Toast struct {
	Text  string
	Color Color
	Born  time.Time
}

// Memory remembers every tile the player has seen.
type Memory struct {
	cells    map[[2]int]int
	safeRoom int
	hasSafe  bool
}

func (m *Memory) remember(v View) {
	for gy, row := range v.Grid {
		for gx, c := range row {
			if c != nil {
				m.cells[[2]int{v.OriginX + gx, v.OriginY + gy}] = *c
			}
		}
	}
}

type Game struct {
	cv      *Canvas
	conn    *Conn
	account Account

	state   *GameState
	profile *Profile
	mem     Memory

	msgs      []Msg
	chatting  bool
	chat      string
	overlay   *Overlay
	invCursor int
	lastShop  *Shop

	flash      *Color
	flashUntil time.Time
	toast      *Toast
	floaters   []Floating

	clockOffset float64 // server ms - local ms
	connected   bool
	reconnectCh chan *Conn
	quit        bool
	exitReason  string

	settings       Settings
	world          *WorldInfo
	partyChannel   bool   // chat goes to the party
	confirmSellUID string // second X press confirms selling a rare+ item
	rebinding      string // action waiting for a new key
	menuCursor     int    // cursor for settings / party / travel menus
	journalPage    int
	travelOpts     *TravelOptions
}

func nowMs() float64 { return float64(time.Now().UnixMilli()) }

func (g *Game) serverNow() float64 { return nowMs() + g.clockOffset }

func (g *Game) log(text string, c Color) {
	if !g.settings.CombatLog && isCombatSpam(text) {
		return
	}
	g.msgs = append(g.msgs, Msg{text, c})
	if len(g.msgs) > 200 {
		g.msgs = g.msgs[len(g.msgs)-200:]
	}
}

// ---------------------------------------------------------------- network
func (g *Game) handleNet(ev NetEvent) {
	switch ev.T {
	case "_reply":
		ev.reply(ev.D)
	case "_closed":
		if g.quit {
			return
		}
		g.connected = false
		g.log("Disconnected from the server. Reconnecting...", cRed)
		go g.reconnect()
	case "gameState":
		var st GameState
		if json.Unmarshal(ev.D, &st) == nil {
			g.state = &st
			g.clockOffset = st.Now - nowMs()
			if st.SafeRoomID != nil {
				g.mem.safeRoom, g.mem.hasSafe = *st.SafeRoomID, true
			}
			g.mem.remember(st.View)
		}
	case "profile":
		var p Profile
		if json.Unmarshal(ev.D, &p) == nil {
			g.onProfile(&p)
		}
	case "message":
		var m ChatMessage
		if json.Unmarshal(ev.D, &m) == nil {
			c := cGray
			if m.Color != nil {
				c = *m.Color
			}
			g.log(m.Text, c)
		}
	case "story":
		var lines []string
		if json.Unmarshal(ev.D, &lines) == nil {
			g.showStory(lines)
		}
	case "fx":
		var fx Fx
		if json.Unmarshal(ev.D, &fx) == nil {
			c := cYellow
			if fx.Color != nil {
				c = *fx.Color
			}
			dur := 700 * time.Millisecond
			if fx.Type == "hurt" || fx.Type == "death" {
				c2 := cRed
				g.flash = &c2
				if fx.Type == "hurt" {
					dur = 160 * time.Millisecond
				}
			} else {
				g.flash = &c
			}
			g.flashUntil = time.Now().Add(dur)
			if !g.settings.ScreenFlash {
				g.flash = nil
			}
			if fx.Text != "" && g.settings.Banners {
				g.toast = &Toast{fx.Text, c, time.Now()}
			}
		}
	case "floater":
		var f Floater
		if json.Unmarshal(ev.D, &f) == nil && g.settings.Floaters {
			f.Color = themeFloater(f.Color)
			now := time.Now()
			stack := 0
			for _, o := range g.floaters {
				if o.X == f.X && o.Y == f.Y && now.Sub(o.Born) < 450*time.Millisecond {
					stack++
				}
			}
			g.floaters = append(g.floaters, Floating{f, now, stack})
			if len(g.floaters) > 40 {
				g.floaters = g.floaters[1:]
			}
		}
	case "shop":
		var s Shop
		if json.Unmarshal(ev.D, &s) == nil {
			g.showShop(&s, nil)
		}
	case "kicked":
		var reason string
		_ = json.Unmarshal(ev.D, &reason)
		g.exitReason = "Disconnected: " + reason
		g.quit = true
	}
}

func (g *Game) reconnect() {
	for !g.quit {
		time.Sleep(2 * time.Second)
		c, err := Dial(g.account.Server, g.account.Username, g.account.Password)
		if err == nil {
			g.reconnectCh <- c
			return
		}
	}
}

func (g *Game) onProfile(p *Profile) {
	g.profile = p
	if p.World != nil {
		g.world = p.World
	}
	if p.Cls == nil {
		g.showClassSelect()
	} else if g.overlay != nil && g.overlay.Kind == "class" {
		g.overlay = nil
	}
	if g.overlay != nil {
		switch g.overlay.Kind {
		case "inventory":
			g.showInventory(nil)
		case "journal":
			g.showJournal()
		case "party":
			g.showParty(nil)
		}
	}
}

func (g *Game) requestInitial() {
	g.conn.Request("getGameState", func(raw json.RawMessage) {
		g.handleNet(NetEvent{T: "gameState", D: raw})
	})
	g.conn.Request("getProfile", func(raw json.RawMessage) {
		g.handleNet(NetEvent{T: "profile", D: raw})
	})
}

func (g *Game) invAction(action string, arg any) {
	g.conn.Request("inventory", func(raw json.RawMessage) {
		var r Result
		if json.Unmarshal(raw, &r) == nil && !r.OK {
			if g.overlay != nil && g.overlay.Kind == "inventory" {
				g.showInventory(&Line{Segs: []Seg{{Text: r.Message, Color: cRed}}})
			} else {
				g.log(r.Message, cRed)
			}
		}
	}, action, arg)
}

// ------------------------------------------------------------------ input
func (g *Game) handleKey(ev *tcell.EventKey) {
	if ev.Key() == tcell.KeyCtrlC {
		g.quit = true
		return
	}
	switch {
	case g.chatting:
		g.chatKey(ev)
	case g.overlay != nil:
		g.overlayKey(ev)
	default:
		g.gameKey(ev)
	}
}

func (g *Game) chatKey(ev *tcell.EventKey) {
	switch ev.Key() {
	case tcell.KeyEnter:
		if t := strings.TrimSpace(g.chat); t != "" {
			if g.partyChannel && !strings.HasPrefix(t, "/") {
				t = "/p " + t
			}
			g.conn.Send("chat", t)
		}
		g.chatting, g.chat = false, ""
	case tcell.KeyTab:
		g.partyChannel = !g.partyChannel
	case tcell.KeyEscape:
		g.chatting, g.chat = false, ""
	case tcell.KeyBackspace, tcell.KeyBackspace2:
		if r := []rune(g.chat); len(r) > 0 {
			g.chat = string(r[:len(r)-1])
		}
	case tcell.KeyRune:
		if runeLen(g.chat) < 120 {
			g.chat += string(ev.Rune())
		}
	}
}

func (g *Game) gameKey(ev *tcell.EventKey) {
	name := keyName(ev)
	if name == "Esc" { // Esc opens the menu instead of quitting by accident
		g.menuCursor = 0
		g.showSettings()
		return
	}
	if name == "Enter" {
		g.openChat(false)
		return
	}
	switch g.settings.actionFor(name) {
	case "up":
		g.move("north")
	case "down":
		g.move("south")
	case "left":
		g.move("west")
	case "right":
		g.move("east")
	case "skill1", "skill2", "skill3", "skill4":
		g.conn.Send("skill", int(g.settings.actionFor(name)[5]-'1'))
	case "potion":
		g.conn.Send("potion")
	case "inventory":
		g.invCursor = 0
		if g.profile != nil && len(g.profile.Inventory) > 0 {
			g.invCursor = 3
		}
		g.showInventory(nil)
	case "journal":
		g.journalPage = 0
		g.showJournal()
	case "party":
		g.menuCursor = 0
		g.showParty(nil)
	case "travel":
		g.openTravel()
	case "ping":
		g.conn.Send("ping")
	case "chat":
		g.openChat(false)
	case "partychat":
		g.openChat(true)
	case "leaderboard":
		g.conn.Request("leaderboard", func(raw json.RawMessage) {
			var rows []LeaderRow
			_ = json.Unmarshal(raw, &rows)
			g.showLeaderboard(rows)
		})
	case "help":
		g.showHelp()
	case "settings":
		g.menuCursor = 0
		g.showSettings()
	case "accept":
		if g.state != nil && g.state.Invite != nil {
			g.partyRequest("accept", nil)
		}
	case "decline":
		if g.state != nil && g.state.Invite != nil {
			g.partyRequest("decline", nil)
		}
	case "quit":
		g.quit = true
	}
}

func (g *Game) openChat(party bool) {
	g.chatting = true
	g.partyChannel = party && g.state != nil && g.state.Party != nil
}

func (g *Game) partyRequest(action string, arg any) {
	g.conn.Request("party", func(raw json.RawMessage) {
		var r Result
		if json.Unmarshal(raw, &r) == nil && !r.OK {
			if g.overlay != nil && g.overlay.Kind == "party" {
				g.showParty(&Line{Segs: []Seg{{Text: r.Message, Color: cRed}}})
			} else {
				g.log(r.Message, cRed)
			}
		}
	}, action, arg)
}

func (g *Game) openTravel() {
	g.conn.Request("travelOptions", func(raw json.RawMessage) {
		var t TravelOptions
		if json.Unmarshal(raw, &t) == nil {
			g.travelOpts = &t
			g.menuCursor = 0
			g.showTravel(nil)
		}
	})
}

func (g *Game) move(dir string) {
	if g.state != nil && g.connected {
		g.conn.Send("move", dir)
	}
}

func (g *Game) overlayKey(ev *tcell.EventKey) {
	o := g.overlay
	name := keyName(ev)
	act := g.settings.actionFor(name)
	up := name == "Up" || act == "up"
	down := name == "Down" || act == "down"
	closeKey := name == "Esc" || name == "q"
	r := ev.Rune()
	isRune := ev.Key() == tcell.KeyRune
	lr := r
	if isRune {
		lr = []rune(strings.ToLower(string(r)))[0]
	}

	switch o.Kind {
	case "class":
		if isRune && lr == 'q' {
			g.quit = true
			return
		}
		if isRune && r >= '1' && r <= '9' && g.profile != nil {
			i := int(r - '1')
			if i < len(g.profile.Classes) {
				g.conn.Request("chooseClass", func(raw json.RawMessage) {
					var res Result
					if json.Unmarshal(raw, &res) == nil && res.OK && g.overlay != nil && g.overlay.Kind == "class" {
						g.overlay = nil
					}
				}, g.profile.Classes[i].ID)
			}
		}
		return

	case "shop":
		if isRune && r >= '1' && r <= '9' && o.shop != nil {
			for _, it := range o.shop.Items {
				if it.Key == string(r) {
					item := it
					g.conn.Request("buy", func(raw json.RawMessage) {
						var res Result
						if json.Unmarshal(raw, &res) != nil {
							return
						}
						if res.OK && res.Shop != nil {
							g.showShop(res.Shop, &Line{Segs: []Seg{{Text: "Done: " + item.Name, Color: cGreen}}})
						} else {
							g.showShop(g.lastShop, &Line{Segs: []Seg{{Text: res.Message, Color: cRed}}})
						}
					}, item.ID)
				}
			}
			return
		}
		if isRune && lr == 'x' {
			g.invAction("selljunk", nil)
			return
		}
		if isRune && lr == 'i' {
			g.invCursor = 3
			g.showInventory(nil)
			return
		}

	case "inventory":
		entries := g.inventoryEntries()
		var sel *invEntry
		if g.invCursor >= 0 && g.invCursor < len(entries) {
			sel = &entries[g.invCursor]
		}
		switch {
		case up:
			g.invCursor = maxi(0, g.invCursor-1)
			g.confirmSellUID = ""
			g.showInventory(nil)
			return
		case down:
			g.invCursor = mini(len(entries)-1, g.invCursor+1)
			g.confirmSellUID = ""
			g.showInventory(nil)
			return
		case name == "Enter" || (isRune && lr == 'e'):
			if sel != nil && sel.item != nil {
				if sel.equipped {
					g.invAction("unequip", sel.slot)
				} else {
					g.invAction("equip", sel.item.UID)
				}
			}
			return
		case isRune && lr == 'x':
			if sel != nil && sel.item != nil && !sel.equipped {
				rare := sel.item.Rarity == "rare" || sel.item.Rarity == "epic" || sel.item.Rarity == "legendary"
				if g.settings.ConfirmSell && rare && g.confirmSellUID != sel.item.UID {
					g.confirmSellUID = sel.item.UID
					g.showInventory(&Line{Segs: []Seg{{Text: "Sell this " + sel.item.Rarity + " item? Press X again to confirm.", Color: cYellow, Bold: true}}})
					return
				}
				g.confirmSellUID = ""
				g.invAction("sell", sel.item.UID)
			}
			return
		case isRune && lr == 'd':
			if sel != nil && sel.item != nil && !sel.equipped {
				g.invAction("drop", sel.item.UID)
			}
			return
		case isRune && (lr == 'u' || lr == 'r'):
			if sel != nil && sel.item != nil {
				action := "upgrade"
				if lr == 'r' {
					action = "reforge"
				}
				g.conn.Request("smith", func(raw json.RawMessage) {
					var res Result
					if json.Unmarshal(raw, &res) == nil && !res.OK {
						g.showInventory(&Line{Segs: []Seg{{Text: res.Message, Color: cRed}}})
					}
				}, action, sel.item.UID)
			}
			return
		case closeKey || (isRune && lr == 'i'):
			// close below
		default:
			return
		}

	case "journal":
		if isRune && lr == 'n' {
			g.invAction("title", nil)
			return
		}
		if name == "Tab" || name == "Right" || name == "Left" {
			g.journalPage = 1 - g.journalPage
			g.showJournal()
			return
		}

	case "settings":
		n := len(settingRows)
		switch {
		case up:
			g.menuCursor = (g.menuCursor - 1 + n) % n
		case down:
			g.menuCursor = (g.menuCursor + 1) % n
		case name == "Enter" || name == "Space" || name == "Right" || name == "Left":
			g.changeSetting(settingRows[g.menuCursor], name == "Left")
			if g.quit || (g.overlay != nil && g.overlay.Kind != "settings") {
				return // opened another screen (key bindings) or quit
			}
		case closeKey || name == g.settings.Keys["settings"]:
			g.settings.save()
			g.overlay = nil
			return
		}
		g.showSettings()
		return

	case "keys":
		if g.rebinding != "" {
			if name != "" && name != "Esc" {
				g.settings.bind(g.rebinding, name)
				g.settings.save()
			}
			g.rebinding = ""
			g.showKeys()
			return
		}
		n := len(actions)
		switch {
		case name == "Up":
			g.menuCursor = (g.menuCursor - 1 + n) % n
		case name == "Down":
			g.menuCursor = (g.menuCursor + 1) % n
		case name == "Enter":
			g.rebinding = actions[g.menuCursor].ID
		case closeKey:
			g.menuCursor = len(settingRows) - 2
			g.showSettings()
			return
		}
		g.showKeys()
		return

	case "party":
		cands := g.partyCandidates()
		switch {
		case up:
			g.menuCursor = maxi(0, g.menuCursor-1)
		case down:
			g.menuCursor = mini(maxi(0, len(cands)-1), g.menuCursor+1)
		case name == "Enter":
			if g.menuCursor < len(cands) {
				g.partyRequest("invite", cands[g.menuCursor])
			}
		case isRune && lr == 'l':
			g.partyRequest("leave", nil)
		case isRune && lr == 'k':
			if g.menuCursor < len(cands) {
				g.partyRequest("kick", cands[g.menuCursor])
			}
		case isRune && lr == 'c':
			g.overlay = nil
			g.openChat(true)
			return
		case closeKey || act == "party":
			g.overlay = nil
			return
		}
		g.showParty(nil)
		return

	case "travel":
		if g.travelOpts == nil {
			break
		}
		n := len(g.travelOpts.Destinations)
		switch {
		case up:
			g.menuCursor = (g.menuCursor - 1 + n) % n
		case down:
			g.menuCursor = (g.menuCursor + 1) % n
		case name == "Enter":
			dest := g.travelOpts.Destinations[g.menuCursor]
			g.conn.Request("travel", func(raw json.RawMessage) {
				var res Result
				if json.Unmarshal(raw, &res) == nil {
					if res.OK {
						g.overlay = nil
					} else {
						g.showTravel(&Line{Segs: []Seg{{Text: res.Message, Color: cRed}}})
					}
				}
			}, dest.ID)
			return
		case closeKey || act == "travel":
			g.overlay = nil
			return
		}
		g.showTravel(nil)
		return
	}
	g.overlay = nil
}

// --------------------------------------------------------------------- run
func runGame(cv *Canvas, conn *Conn, acc Account) string {
	g := &Game{
		cv:          cv,
		conn:        conn,
		account:     acc,
		mem:         Memory{cells: map[[2]int]int{}},
		settings:    loadSettings(),
		connected:   true,
		reconnectCh: make(chan *Conn, 1),
	}
	g.log("Connected to "+acc.Server+" as "+acc.Username, cGray)
	g.showHelp()
	g.requestInitial()

	keys := make(chan tcell.Event, 64)
	go func() {
		for {
			ev := cv.s.PollEvent()
			if ev == nil {
				return
			}
			keys <- ev
		}
	}()

	ticker := time.NewTicker(33 * time.Millisecond)
	defer ticker.Stop()
	dirty := true
	lastDraw := time.Time{}

	for !g.quit {
		select {
		case ev := <-keys:
			switch e := ev.(type) {
			case *tcell.EventKey:
				g.handleKey(e)
			case *tcell.EventResize:
				cv.s.Sync()
			}
			dirty = true
		case ev := <-g.conn.Events:
			g.handleNet(ev)
			dirty = true
		case c := <-g.reconnectCh:
			g.conn = c
			g.connected = true
			g.log("Reconnected.", cGreen)
			g.requestInitial()
			dirty = true
		case <-ticker.C:
			// prune animations
			now := time.Now()
			kept := g.floaters[:0]
			for _, f := range g.floaters {
				if now.Sub(f.Born) < time.Second {
					kept = append(kept, f)
				}
			}
			g.floaters = kept
			animating := len(g.floaters) > 0 || (g.toast != nil && now.Sub(g.toast.Born) < 3*time.Second) || now.Before(g.flashUntil.Add(100*time.Millisecond))
			if g.settings.LowHPPulse && g.state != nil && g.state.Player.Stats.MaxHP > 0 && g.state.Player.Stats.HP/g.state.Player.Stats.MaxHP < 0.3 {
				animating = true
			}
			// Timers (cooldowns, buffs, events) tick a few times a second.
			if animating || now.Sub(lastDraw) > 250*time.Millisecond {
				dirty = true
			}
		}
		if dirty {
			g.draw()
			lastDraw = time.Now()
			dirty = false
		}
	}
	g.conn.Close()
	if g.exitReason == "" {
		return "Thanks for playing!"
	}
	return g.exitReason
}
