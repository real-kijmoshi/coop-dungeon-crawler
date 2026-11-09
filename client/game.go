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
}

func nowMs() float64 { return float64(time.Now().UnixMilli()) }

func (g *Game) serverNow() float64 { return nowMs() + g.clockOffset }

func (g *Game) log(text string, c Color) {
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
			if fx.Text != "" {
				g.toast = &Toast{fx.Text, c, time.Now()}
			}
		}
	case "floater":
		var f Floater
		if json.Unmarshal(ev.D, &f) == nil {
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
var moveKeys = map[rune]string{'w': "north", 's': "south", 'a': "west", 'd': "east"}

func arrowDir(k tcell.Key) string {
	switch k {
	case tcell.KeyUp:
		return "north"
	case tcell.KeyDown:
		return "south"
	case tcell.KeyLeft:
		return "west"
	case tcell.KeyRight:
		return "east"
	}
	return ""
}

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
			g.conn.Send("chat", t)
		}
		g.chatting, g.chat = false, ""
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
	if ev.Key() == tcell.KeyEscape {
		g.quit = true
		return
	}
	if ev.Key() == tcell.KeyEnter {
		g.chatting = true
		return
	}
	if d := arrowDir(ev.Key()); d != "" {
		g.move(d)
		return
	}
	if ev.Key() != tcell.KeyRune {
		return
	}
	r := ev.Rune()
	lr := []rune(strings.ToLower(string(r)))[0]
	switch {
	case lr == 'q':
		g.quit = true
	case r == '?' || r == '/':
		g.showHelp()
	case lr == 'l':
		g.conn.Request("leaderboard", func(raw json.RawMessage) {
			var rows []LeaderRow
			_ = json.Unmarshal(raw, &rows)
			g.showLeaderboard(rows)
		})
	case lr == 'i':
		g.invCursor = 0
		if g.profile != nil && len(g.profile.Inventory) > 0 {
			g.invCursor = 3
		}
		g.showInventory(nil)
	case lr == 'j':
		g.showJournal()
	case lr == 't':
		g.chatting = true
	case lr == 'h':
		g.conn.Send("potion")
	case r >= '1' && r <= '4':
		g.conn.Send("skill", int(r-'1'))
	default:
		if d, ok := moveKeys[lr]; ok {
			g.move(d)
		}
	}
}

func (g *Game) move(dir string) {
	if g.state != nil && g.connected {
		g.conn.Send("move", dir)
	}
}

func (g *Game) overlayKey(ev *tcell.EventKey) {
	o := g.overlay
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
					if json.Unmarshal(raw, &res) == nil && res.OK {
						g.overlay = nil
						g.showHelp()
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
							g.showShop(res.Shop, &Line{Segs: []Seg{{Text: "Bought " + item.Name + "!", Color: cGreen}}})
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
		case ev.Key() == tcell.KeyUp || (isRune && lr == 'w'):
			g.invCursor = maxi(0, g.invCursor-1)
			g.showInventory(nil)
			return
		case ev.Key() == tcell.KeyDown || (isRune && lr == 's'):
			g.invCursor = mini(len(entries)-1, g.invCursor+1)
			g.showInventory(nil)
			return
		case ev.Key() == tcell.KeyEnter || (isRune && lr == 'e'):
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
				g.invAction("sell", sel.item.UID)
			}
			return
		case isRune && lr == 'd':
			if sel != nil && sel.item != nil && !sel.equipped {
				g.invAction("drop", sel.item.UID)
			}
			return
		case ev.Key() == tcell.KeyEscape || (isRune && (lr == 'i' || lr == 'q')):
			// close below
		default:
			return
		}
	case "journal":
		if isRune && lr == 'n' {
			g.invAction("title", nil)
			return
		}
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
			if g.state != nil && g.state.Player.Stats.MaxHP > 0 && g.state.Player.Stats.HP/g.state.Player.Stats.MaxHP < 0.3 {
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
