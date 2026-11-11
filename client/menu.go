package main

// The main menu: an animated title screen with your heroes, account
// management (log in, create, edit, change password, forget, delete), all the
// settings (sound, graphics, keys) and the how-to-play page.

import (
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
)

// App is shared by the menu and the game.
type App struct {
	cv       *Canvas
	events   chan tcell.Event
	audio    *Audio
	settings Settings
	server   string // server asked for on the command line, if any
}

var logo = []string{
	`   ___                    ___                                `,
	`  / __|___  ___ _ __     |   \ _  _ _ _  __ _ ___ ___ _ _   `,
	` | (__/ _ \/ _ \ '_ \    | |) | || | ' \/ _` + "`" + ` / -_) _ \ ' \  `,
	`  \___\___/\___/ .__/    |___/ \_,_|_||_\__, \___\___/_||_| `,
	`               |_|                       |___/              `,
}
var logoGradient = []Color{{255, 230, 140}, {255, 190, 90}, {255, 145, 70}, {235, 100, 70}, {190, 70, 90}}

type menuItem struct {
	id, label, hint string
}

type formField struct {
	label  string
	value  string
	secret bool
}

type form struct {
	kind   string // login, register, edit, password, delete
	title  string
	intro  []string
	fields []formField
	focus  int
	index  int // account the form is about
	submit string
	back   string // screen to return to
}

type infoResult struct {
	key  string
	info *HeroInfo
	err  error
}

type menu struct {
	app       *App
	screen    string // main, heroes, form, settings, keys, help
	cursor    int
	accounts  []Account
	info      map[string]*HeroInfo
	infoErr   map[string]string
	infoCh    chan infoResult
	form      *form
	status    string
	isError   bool
	rebinding string
	scroll    int
	embers    []ember
	start     time.Time
	last      time.Time
}

func accKey(a Account) string { return a.Server + "|" + a.Username }

// runMenu shows the main menu until the player starts a game (returns the
// connection) or quits (ok == false).
func runMenu(app *App, status string) (*Conn, Account, bool) {
	m := &menu{
		app: app, screen: "main", accounts: loadAccounts(),
		info: map[string]*HeroInfo{}, infoErr: map[string]string{}, infoCh: make(chan infoResult, 16),
		status: status, start: time.Now(),
	}
	app.audio.Play("title")
	if len(m.accounts) == 0 {
		m.openForm("register", -1)
	} else if app.server != "" && !m.hasServer(app.server) {
		m.openForm("register", -1)
	}
	m.refreshInfo()

	ticker := time.NewTicker(66 * time.Millisecond)
	defer ticker.Stop()
	m.draw()
	for {
		select {
		case ev := <-app.events:
			switch e := ev.(type) {
			case *tcell.EventResize:
				app.cv.Invalidate()
			case *tcell.EventKey:
				if e.Key() == tcell.KeyCtrlC {
					return nil, Account{}, false
				}
				acc, quit := m.key(e)
				if quit {
					return nil, Account{}, false
				}
				if acc != nil {
					if conn := m.connect(*acc); conn != nil {
						return conn, *acc, true
					}
				}
			}
			m.draw()
		case r := <-m.infoCh:
			if r.err != nil {
				m.infoErr[r.key] = r.err.Error()
				delete(m.info, r.key)
			} else {
				m.info[r.key] = r.info
				delete(m.infoErr, r.key)
			}
			m.draw()
		case <-ticker.C:
			if app.settings.Animations || time.Since(m.last) > time.Second {
				m.draw()
			}
		}
	}
}

func (m *menu) hasServer(s string) bool {
	for _, a := range m.accounts {
		if a.Server == s {
			return true
		}
	}
	return false
}

func (m *menu) refreshInfo() {
	for _, a := range m.accounts {
		a := a
		go func() {
			h, err := heroInfo(a)
			m.infoCh <- infoResult{accKey(a), h, err}
		}()
	}
}

func (m *menu) setStatus(text string, isErr bool) {
	m.status, m.isError = text, isErr
}

func (m *menu) connect(acc Account) *Conn {
	m.setStatus("Connecting to "+acc.Server+"...", false)
	m.draw()
	conn, err := Dial(acc.Server, acc.Username, acc.Password)
	if err != nil {
		m.setStatus(err.Error(), true)
		m.app.audio.SFX("back")
		return nil
	}
	m.accounts = rememberAccount(m.accounts, acc)
	_ = saveAccounts(m.accounts)
	m.app.audio.SFX("start")
	return conn
}

// ------------------------------------------------------------------ screens

func (m *menu) mainItems() []menuItem {
	var items []menuItem
	if len(m.accounts) > 0 {
		a := m.accounts[0]
		items = append(items, menuItem{"play", "Play as " + a.Username, hostOf(a.Server)})
	}
	items = append(items,
		menuItem{"heroes", "Heroes & accounts", fmt.Sprintf("%d saved", len(m.accounts))},
		menuItem{"new", "Create a new hero", ""},
		menuItem{"login", "Log in to an existing hero", ""},
		menuItem{"settings", "Settings", "sound · graphics · keys"},
		menuItem{"help", "How to play", ""},
		menuItem{"quit", "Quit", ""},
	)
	return items
}

func hostOf(server string) string {
	s := strings.TrimPrefix(strings.TrimPrefix(server, "http://"), "https://")
	return s
}

func (m *menu) menuRows() []string {
	var rows []string
	for _, r := range settingRows {
		if !gameOnlyRows[r] {
			rows = append(rows, r)
		}
	}
	return rows
}

// key handles a key press; returns an account to play, or quit.
func (m *menu) key(e *tcell.EventKey) (*Account, bool) {
	name := keyName(e)
	up := name == "Up" || (m.screen != "form" && (name == "k" || name == "w"))
	down := name == "Down" || (m.screen != "form" && (name == "j" || name == "s"))
	sfx := m.app.audio.SFX
	switch m.screen {
	case "main":
		items := m.mainItems()
		switch {
		case up:
			m.cursor = (m.cursor - 1 + len(items)) % len(items)
		case down, name == "Tab":
			m.cursor = (m.cursor + 1) % len(items)
		case name == "Esc" || name == "q":
			return nil, true
		case name == "Enter" || name == "Space" || name == "Right":
			sfx("select")
			switch items[clampi(m.cursor, 0, len(items)-1)].id {
			case "play":
				acc := m.accounts[0]
				return &acc, false
			case "heroes":
				m.screen, m.cursor = "heroes", 0
				m.refreshInfo()
			case "new":
				m.openForm("register", -1)
			case "login":
				m.openForm("login", -1)
			case "settings":
				m.screen, m.cursor = "settings", nextRow(m.menuRows(), -1, 1)
			case "help":
				m.screen, m.scroll = "help", 0
			case "quit":
				return nil, true
			}
		}

	case "heroes":
		n := len(m.accounts) + 2
		var sel *Account
		if m.cursor < len(m.accounts) {
			sel = &m.accounts[m.cursor]
		}
		switch {
		case up:
			m.cursor = (m.cursor - 1 + n) % n
		case down, name == "Tab":
			m.cursor = (m.cursor + 1) % n
		case name == "Esc" || name == "q" || name == "Left":
			sfx("back")
			m.screen, m.cursor = "main", 0
		case name == "Enter" || name == "Right":
			sfx("select")
			if sel != nil {
				acc := *sel
				return &acc, false
			}
			if m.cursor == len(m.accounts) {
				m.openForm("register", -1)
			} else {
				m.openForm("login", -1)
			}
		case name == "r":
			m.info, m.infoErr = map[string]*HeroInfo{}, map[string]string{}
			m.refreshInfo()
			m.setStatus("Refreshing...", false)
		case sel != nil && name == "e":
			m.openForm("edit", m.cursor)
		case sel != nil && name == "p":
			m.openForm("password", m.cursor)
		case sel != nil && (name == "f" || name == "Delete"):
			who := sel.Username
			m.accounts = append(m.accounts[:m.cursor], m.accounts[m.cursor+1:]...)
			_ = saveAccounts(m.accounts)
			m.cursor = mini(m.cursor, len(m.accounts))
			m.setStatus(fmt.Sprintf("Forgot %s on this computer (the hero is still on the server).", who), false)
		case sel != nil && name == "x":
			m.openForm("delete", m.cursor)
		case sel != nil && name == "u" && m.cursor > 0:
			m.accounts[m.cursor-1], m.accounts[m.cursor] = m.accounts[m.cursor], m.accounts[m.cursor-1]
			m.cursor--
			_ = saveAccounts(m.accounts)
		}

	case "form":
		return m.formKey(e), false

	case "settings":
		rows := m.menuRows()
		switch {
		case up:
			m.cursor = nextRow(rows, m.cursor, -1)
		case down:
			m.cursor = nextRow(rows, m.cursor, 1)
		case name == "Esc" || name == "q":
			sfx("back")
			m.app.settings.save()
			m.screen, m.cursor = "main", indexOfItem(m.mainItems(), "settings")
		case name == "Enter" || name == "Space" || name == "Right" || name == "Left":
			if m.app.settings.change(rows[m.cursor], name == "Left") == "keys" {
				m.screen, m.cursor = "keys", 0
				break
			}
			m.app.audio.Apply(m.app.settings)
			if strings.HasPrefix(rows[m.cursor], "sound") {
				sfx("levelup") // let them hear the new volume
			}
		}

	case "keys":
		s := &m.app.settings
		if m.rebinding != "" {
			if name != "" && name != "Esc" {
				s.bind(m.rebinding, name)
				s.save()
			}
			m.rebinding = ""
			break
		}
		n := len(actions)
		switch {
		case name == "Up":
			m.cursor = (m.cursor - 1 + n) % n
		case name == "Down":
			m.cursor = (m.cursor + 1) % n
		case name == "Enter":
			m.rebinding = actions[m.cursor].ID
		case name == "Esc" || name == "q":
			m.screen, m.cursor = "settings", indexOf(m.menuRows(), "keys")
		}

	case "help":
		switch {
		case up:
			m.scroll = maxi(0, m.scroll-1)
		case down:
			m.scroll++
		default:
			sfx("back")
			m.screen, m.cursor = "main", indexOfItem(m.mainItems(), "help")
		}
	}
	return nil, false
}

func indexOfItem(items []menuItem, id string) int {
	for i, it := range items {
		if it.id == id {
			return i
		}
	}
	return 0
}

// ------------------------------------------------------------------ forms

func (m *menu) openForm(kind string, index int) {
	server := preferredServer()
	if server == defaultServer && len(m.accounts) > 0 {
		server = m.accounts[0].Server
	}
	if m.app.server != "" {
		server = m.app.server
	}
	f := &form{kind: kind, index: index, back: m.screen}
	if f.back == "form" || f.back == "" {
		f.back = "main"
	}
	var acc Account
	if index >= 0 && index < len(m.accounts) {
		acc = m.accounts[index]
	}
	switch kind {
	case "register":
		f.title, f.submit = "CREATE A NEW HERO", "Create hero"
		f.intro = []string{"Pick a name (1-16 letters, digits, _ or -) and a password.", "You'll choose your class when you enter the dungeon."}
		f.fields = []formField{{"Server", server, false}, {"Hero name", "", false}, {"Password", "", true}, {"Repeat", "", true}}
		f.focus = 1
	case "login":
		f.title, f.submit = "LOG IN", "Log in"
		f.intro = []string{"Log in to a hero you already have (on this or any server)."}
		f.fields = []formField{{"Server", server, false}, {"Hero name", "", false}, {"Password", "", true}}
		f.focus = 1
	case "edit":
		f.title, f.submit = "EDIT SAVED LOGIN · "+acc.Username, "Save"
		f.intro = []string{"Change the server address or the password saved on this computer.", "(To change the password on the server, use P on the hero list.)"}
		f.fields = []formField{{"Server", acc.Server, false}, {"Hero name", acc.Username, false}, {"Password", acc.Password, true}}
	case "password":
		f.title, f.submit = "CHANGE PASSWORD · "+acc.Username, "Change password"
		f.intro = []string{"Sets a new password for this hero on " + hostOf(acc.Server) + "."}
		f.fields = []formField{{"New password", "", true}, {"Repeat", "", true}}
	case "delete":
		f.title, f.submit = "DELETE HERO · "+acc.Username, "Delete forever"
		f.intro = []string{"This deletes the hero, gear and progress from " + hostOf(acc.Server) + ".", "It can't be undone. Type the hero's name to confirm."}
		f.fields = []formField{{"Hero name", "", false}}
	}
	m.form = f
	m.screen = "form"
	m.status = ""
}

func (m *menu) closeForm() {
	back := "main"
	if m.form != nil {
		back = m.form.back
	}
	m.form = nil
	if back == "heroes" && len(m.accounts) > 0 {
		m.screen = "heroes"
		m.cursor = clampi(m.cursor, 0, len(m.accounts)+1)
		return
	}
	m.screen, m.cursor = "main", 0
}

func (m *menu) formKey(e *tcell.EventKey) *Account {
	f := m.form
	n := len(f.fields) + 1 // + the button
	switch e.Key() {
	case tcell.KeyEscape:
		m.app.audio.SFX("back")
		m.closeForm()
	case tcell.KeyTab, tcell.KeyDown:
		f.focus = (f.focus + 1) % n
	case tcell.KeyBacktab, tcell.KeyUp:
		f.focus = (f.focus - 1 + n) % n
	case tcell.KeyBackspace, tcell.KeyBackspace2:
		if f.focus < len(f.fields) {
			r := []rune(f.fields[f.focus].value)
			if len(r) > 0 {
				f.fields[f.focus].value = string(r[:len(r)-1])
			}
		}
	case tcell.KeyCtrlU:
		if f.focus < len(f.fields) {
			f.fields[f.focus].value = ""
		}
	case tcell.KeyEnter:
		if f.focus < len(f.fields)-1 {
			f.focus++
			return nil
		}
		return m.submit()
	case tcell.KeyRune:
		if f.focus < len(f.fields) && runeLen(f.fields[f.focus].value) < 64 {
			f.fields[f.focus].value += string(e.Rune())
		} else if f.focus == len(f.fields) && e.Rune() == ' ' {
			return m.submit()
		}
	}
	return nil
}

func (m *menu) submit() *Account {
	f := m.form
	val := func(i int) string { return f.fields[i].value }
	fail := func(msg string) *Account {
		m.setStatus(msg, true)
		m.app.audio.SFX("back")
		return nil
	}
	switch f.kind {
	case "register", "login":
		server := normalizeServer(val(0))
		user := strings.TrimSpace(val(1))
		pass := val(2)
		if user == "" || pass == "" {
			return fail("A hero name and a password are required.")
		}
		if f.kind == "register" {
			if pass != val(3) {
				return fail("The two passwords don't match.")
			}
			m.setStatus("Creating your hero...", false)
			m.draw()
			if err := register(server, user, pass); err != nil {
				return fail(err.Error())
			}
		} else {
			m.setStatus("Checking...", false)
			m.draw()
			if err := login(server, user, pass); err != nil {
				return fail(err.Error())
			}
		}
		m.form = nil
		m.screen = "main"
		return &Account{Server: server, Username: user, Password: pass}

	case "edit":
		acc := Account{Server: normalizeServer(val(0)), Username: strings.TrimSpace(val(1)), Password: val(2)}
		if acc.Username == "" {
			return fail("The hero name can't be empty.")
		}
		m.accounts[f.index] = acc
		_ = saveAccounts(m.accounts)
		m.refreshInfo()
		m.closeForm()
		m.setStatus("Saved.", false)

	case "password":
		if val(0) == "" {
			return fail("The new password can't be empty.")
		}
		if val(0) != val(1) {
			return fail("The two passwords don't match.")
		}
		acc := m.accounts[f.index]
		m.setStatus("Changing password...", false)
		m.draw()
		if err := changePassword(acc, val(0)); err != nil {
			return fail(err.Error())
		}
		m.accounts[f.index].Password = val(0)
		_ = saveAccounts(m.accounts)
		m.closeForm()
		m.setStatus("Password changed for "+acc.Username+".", false)

	case "delete":
		acc := m.accounts[f.index]
		if strings.TrimSpace(val(0)) != acc.Username {
			return fail("Type the hero's name exactly to confirm.")
		}
		m.setStatus("Deleting...", false)
		m.draw()
		if err := deleteHero(acc, acc.Username); err != nil {
			return fail(err.Error())
		}
		m.accounts = append(m.accounts[:f.index], m.accounts[f.index+1:]...)
		_ = saveAccounts(m.accounts)
		m.closeForm()
		m.setStatus(acc.Username+" has been deleted. Rest in peace, brave hero.", false)
	}
	return nil
}

// ------------------------------------------------------------------ drawing

func (m *menu) draw() {
	cv := m.app.cv
	cv.W, cv.H = cv.s.Size()
	now := time.Now()
	dt := now.Sub(m.last).Seconds()
	if dt > 0.2 || m.last.IsZero() {
		dt = 0.04
	}
	m.last = now
	t := now.Sub(m.start).Seconds()
	anim := m.app.settings.Animations
	if !anim {
		t = 0
	}

	drawBackdrop(cv, t)

	// Logo with a slow fire shimmer.
	y := maxi(0, cv.H/2-15)
	if cv.H < 34 {
		y = 0
	}
	for i, l := range logo {
		x0 := maxi(0, (cv.W-runeLen(l))/2)
		j := 0
		for _, ch := range l {
			if ch != ' ' {
				ts := math.Floor(t*2) / 2
				f := 0.85 + math.Round(0.15*math.Sin(ts*2.5+float64(j)*0.3-float64(i)*0.7)*20)/20
				c := scale(logoGradient[i], f)
				cv.Put(x0+j, y+i+1, ch, c, nil, true)
			}
			j++
		}
	}
	y += len(logo) + 1
	sub := "⚔  a co-op terminal dungeon crawler  ⚔"
	cv.Text((cv.W-runeLen(sub))/2, y, sub, Color{190, 170, 150}, nil, false, -1)
	y += 2

	// The panel for the current screen.
	var lines []Line
	title, footer := "", ""
	panelW := 64
	switch m.screen {
	case "main":
		title, footer, lines = "", "↑/↓ choose · Enter select · Q quit", m.mainLines()
		panelW = 54
	case "heroes":
		title, footer, lines = "HEROES & ACCOUNTS", "Enter play · E edit · P password · F forget · X delete · U move up · R refresh · Esc back", m.heroLines()
		panelW = 72
	case "form":
		title, footer, lines = m.form.title, "Tab/↑/↓ field · Enter next/confirm · Ctrl+U clear · Esc back", m.formLines()
	case "settings":
		title, footer = "SETTINGS", "↑/↓ choose · ←/→/Enter change · Esc back"
		lines = settingLines(m.app.settings, m.menuRows(), m.cursor, m.app.audio.Status())
		panelW = 70
	case "keys":
		title, footer, lines = "KEY BINDINGS · "+m.app.settings.Preset, "↑/↓ choose · Enter rebind · Esc back", m.keyLines()
	case "help":
		title, footer = "HOW TO PLAY", "↑/↓ scroll · any other key: back"
		lines = helpLines(m.app.settings)
		panelW = 82
	}
	w := mini(cv.W-2, panelW)
	for _, l := range lines {
		w = mini(cv.W-2, maxi(w, l.width()+4))
	}
	avail := cv.H - y - 3
	h := mini(len(lines)+2, maxi(5, avail))
	if m.screen == "help" {
		m.scroll = clampi(m.scroll, 0, maxi(0, len(lines)-(h-2)))
		lines = lines[m.scroll:]
	}
	x := (cv.W - w) / 2
	if y+h > cv.H-2 { // small terminal: drop the logo spacing
		y = maxi(0, cv.H-2-h)
	}

	// Torches on both sides of the panel.
	if x > 6 {
		drawTorch(cv, x-4, y+2, t, anim)
		drawTorch(cv, x+w+3, y+2, t+1.7, anim)
	}
	panelBG := Color{18, 16, 26}
	cv.Fill(x+1, y+1, w, h, Color{6, 5, 9})
	cv.Box(x, y, w, h, BoxOpts{Color: Color{120, 95, 70}, BG: panelBG, Title: title, TitleColor: ptr(theme.title)})
	for i, l := range lines {
		if i >= h-2 {
			break
		}
		lb := panelBG
		if l.BG != nil {
			lb = *l.BG
			cv.Fill(x+1, y+1+i, w-2, 1, lb)
		}
		xx := x + 2
		for _, sg := range l.Segs {
			sb := &lb
			if sg.BG != nil {
				sb = sg.BG
			}
			xx += cv.Text(xx, y+1+i, sg.Text, sg.Color, sb, sg.Bold, x+w-2-xx)
		}
	}
	if footer != "" && y+h+1 < cv.H-1 {
		cv.Text(maxi(0, (cv.W-runeLen(footer))/2), y+h+1, footer, Color{150, 135, 125}, nil, false, cv.W)
	}

	// Embers drift up over everything except the panel text.
	if anim {
		m.embers = stepEmbers(m.embers, cv.W, cv.H, dt, 9)
		for _, e := range m.embers {
			ex, ey := int(e.x), int(e.y)
			if (ex >= x && ex < x+w && ey >= y && ey < y+h) || ey == y+h+1 || ey == cv.H-1 {
				continue
			}
			drawEmber(cv, e)
		}
	}

	// Status line and version.
	if m.status != "" {
		c := Color{170, 200, 170}
		if m.isError {
			c = cRed
		}
		cv.Text(maxi(0, (cv.W-runeLen(m.status))/2), cv.H-1, m.status, c, nil, true, cv.W)
	}
	cv.Text(cv.W-runeLen(version)-2, cv.H-1, version, Color{90, 80, 90}, nil, false, -1)
	cv.Show()
}

func (m *menu) mainLines() []Line {
	items := m.mainItems()
	m.cursor = clampi(m.cursor, 0, len(items)-1)
	lines := []Line{L("", cWhite)}
	for i, it := range items {
		sel := i == m.cursor
		label := it.label
		col := theme.text
		if it.id == "play" {
			col = Color{255, 220, 140}
		}
		if it.id == "quit" {
			col = theme.muted
		}
		segs := []Seg{{Text: "   " + label, Color: col}}
		if sel {
			segs = []Seg{{Text: " ▶ ", Color: Color{255, 170, 60}, Bold: true}, {Text: label, Color: cWhite, Bold: true}}
		}
		if it.hint != "" {
			segs = append(segs, Seg{Text: "  " + it.hint, Color: theme.faint})
		}
		line := Line{Segs: segs}
		if sel {
			line.BG = ptr(Color{60, 40, 40})
		}
		lines = append(lines, line)
		if it.id == "play" {
			lines = append(lines, m.heroSummary(m.accounts[0], "      "))
		}
	}
	lines = append(lines, L("", cWhite))
	return lines
}

// heroSummary is a one-line description of a saved hero.
func (m *menu) heroSummary(a Account, indent string) Line {
	k := accKey(a)
	if e, ok := m.infoErr[k]; ok {
		return Line{Segs: []Seg{{Text: indent + "⚠ " + e, Color: Color{220, 120, 100}}}}
	}
	h := m.info[k]
	if h == nil {
		return Line{Segs: []Seg{{Text: indent + "…", Color: theme.faint}}}
	}
	if h.Cls == nil {
		return Line{Segs: []Seg{{Text: indent + "New hero - no class chosen yet", Color: theme.muted}}}
	}
	look := classLooks[*h.Cls]
	segs := []Seg{{Text: indent + "@ ", Color: look.Color, Bold: true}, {Text: fmt.Sprintf("%s Lv %d", look.Name, h.Level), Color: look.Color, Bold: true}}
	if h.Prestige > 0 {
		segs = append(segs, Seg{Text: fmt.Sprintf(" ✦%d", h.Prestige), Color: Color{255, 215, 120}, Bold: true})
	}
	if h.Title != nil && *h.Title != "" {
		segs = append(segs, Seg{Text: " " + *h.Title, Color: theme.muted})
	}
	segs = append(segs, Seg{Text: fmt.Sprintf("  ☠ %d  best depth %d", h.Kills, h.MaxDepth), Color: theme.faint})
	if h.Online {
		segs = append(segs, Seg{Text: "  ● online", Color: cGreen})
	}
	return Line{Segs: segs}
}

func (m *menu) heroLines() []Line {
	var lines []Line
	if len(m.accounts) == 0 {
		lines = append(lines, L("No saved heroes on this computer yet.", theme.muted), L("", cWhite))
	}
	for i, a := range m.accounts {
		sel := i == m.cursor
		marker := "  "
		if sel {
			marker = "▶ "
		}
		head := Line{Segs: []Seg{
			{Text: marker + pad(a.Username, 18), Color: cWhite, Bold: true},
			{Text: hostOf(a.Server), Color: theme.muted},
		}}
		if i == 0 {
			head.Segs = append(head.Segs, Seg{Text: "  (last played)", Color: theme.faint})
		}
		sum := m.heroSummary(a, "    ")
		if sel {
			head.BG = ptr(Color{55, 45, 70})
			sum.BG = ptr(Color{55, 45, 70})
		}
		lines = append(lines, head, sum)
	}
	lines = append(lines, L("", cWhite))
	for j, label := range []string{"＋ Create a new hero", "＋ Log in to an existing hero"} {
		i := len(m.accounts) + j
		l := Line{Segs: []Seg{{Text: "  " + label, Color: cGreen}}}
		if i == m.cursor {
			l = Line{Segs: []Seg{{Text: "▶ " + label, Color: cGreen, Bold: true}}, BG: ptr(Color{55, 45, 70})}
		}
		lines = append(lines, l)
	}
	lines = append(lines, L("", cWhite), L("Logins are saved in "+accountsPath(), theme.faint))
	return lines
}

func (m *menu) formLines() []Line {
	f := m.form
	lines := []Line{}
	for _, s := range f.intro {
		lines = append(lines, L(s, theme.muted))
	}
	lines = append(lines, L("", cWhite))
	fieldW := 34
	for i, fl := range f.fields {
		val := fl.value
		if fl.secret {
			val = strings.Repeat("•", runeLen(val))
		}
		focused := i == f.focus
		if focused {
			val += "▌"
		}
		r := []rune(val)
		if len(r) > fieldW {
			r = r[len(r)-fieldW:]
		}
		bg := Color{32, 30, 44}
		lc := theme.muted
		if focused {
			bg, lc = Color{52, 46, 78}, cWhite
		}
		lines = append(lines, fieldLine(fl.label, string(r), fieldW, focused, bg, lc))
	}
	lines = append(lines, L("", cWhite))
	btn := " " + f.submit + " "
	bc, bb := theme.muted, Color{40, 36, 52}
	if f.focus == len(f.fields) {
		bc, bb = Color{20, 15, 10}, Color{255, 190, 90}
		if f.kind == "delete" {
			bb = Color{255, 90, 80}
		}
	}
	lines = append(lines, Line{Segs: []Seg{{Text: pad("", 15)}, {Text: btn, Color: bc, Bold: true, BG: &bb}}})
	return lines
}

func fieldLine(label, val string, w int, focused bool, bg, lc Color) Line {
	fg := theme.text
	if focused {
		fg = cWhite
	}
	return Line{Segs: []Seg{
		{Text: pad(label, 14) + " ", Color: lc, Bold: focused},
		{Text: " " + pad(val, w) + " ", Color: fg, Bold: focused, BG: &bg},
	}}
}

func (m *menu) keyLines() []Line {
	s := m.app.settings
	lines := []Line{L("Select an action and press Enter, then press the new key.", theme.muted), L("", cWhite)}
	room := maxi(6, m.app.cv.H-22)
	first := clampi(m.cursor-room/2, 0, maxi(0, len(actions)-room))
	for i, a := range actions {
		if i < first || i >= first+room {
			continue
		}
		sel := i == m.cursor
		key := s.keyLabel(a.ID)
		if sel && m.rebinding == a.ID {
			key = "press a key…"
		}
		marker := "  "
		if sel {
			marker = "▶ "
		}
		line := Line{Segs: []Seg{{Text: marker + pad(a.Label, 24), Color: theme.text, Bold: sel}, {Text: key, Color: cYellow, Bold: true}}}
		if sel {
			line.BG = ptr(Color{55, 50, 80})
		}
		lines = append(lines, line)
	}
	return lines
}

// ------------------------------------------------------------------ backdrop

// valueNoise is smooth 1-D noise in [0,1].
func valueNoise(x float64, seed int) float64 {
	i := math.Floor(x)
	f := x - i
	a := hash2(int(i), seed)
	b := hash2(int(i)+1, seed)
	f = f * f * (3 - 2*f)
	return a + (b-a)*f
}

// drawBackdrop paints a cave: a warm glow from below, stalactites, and two
// layers of rock. It doesn't change between frames, so it costs nothing to
// keep on screen; the torches and embers bring it to life.
func drawBackdrop(cv *Canvas, t float64) {
	W, H := cv.W, cv.H
	top, mid, low := Color{8, 7, 14}, Color{20, 12, 24}, Color{58, 24, 18}
	for y := 0; y < H; y++ {
		f := float64(y) / float64(maxi(1, H-1))
		var c Color
		if f < 0.6 {
			c = mix(top, mid, f/0.6)
		} else {
			c = mix(mid, low, (f-0.6)/0.4)
		}
		for x := 0; x < W; x++ {
			cv.Put(x, y, ' ', c, &c, false)
		}
	}
	// stalactites
	for x := 0; x < W; x++ {
		n := valueNoise(float64(x)/3.5, 7)
		h := int(n*n*5) + 1
		if hash2(x, 99) > 0.8 {
			h++
		}
		for y := 0; y < h && y < H; y++ {
			c := mix(Color{30, 24, 34}, Color{14, 12, 20}, float64(y)/float64(h))
			cv.Put(x, y, ' ', c, &c, false)
		}
		if h < H {
			c := Color{30, 24, 34}
			cv.Put(x, h, '▀', c, nil, false)
		}
	}
	// rock layers (far, near)
	layers := []struct {
		speed, scaleX, base, amp float64
		color                    Color
		seed                     int
	}{
		{0.7, 9, 0.30, 0.18, Color{34, 18, 28}, 3},
		{1.8, 5, 0.15, 0.14, Color{14, 9, 14}, 5},
	}
	for _, l := range layers {
		for x := 0; x < W; x++ {
			wx := float64(x) + l.speed*7 // fixed: moving rock would repaint half the screen
			n := valueNoise(wx/l.scaleX, l.seed)*0.7 + valueNoise(wx/(l.scaleX/3), l.seed+1)*0.3
			h := int((l.base + l.amp*n) * float64(H))
			for y := H - h; y < H; y++ {
				if y >= 0 {
					c := l.color
					cv.Put(x, y, ' ', c, &c, false)
				}
			}
			if H-h-1 >= 0 {
				cv.Put(x, H-h-1, '▄', l.color, nil, false)
			}
		}
	}
}

// drawTorch draws a wall torch with a flickering flame and warm glow.
func drawTorch(cv *Canvas, x, y int, t float64, anim bool) {
	fl := math.Round((0.5+0.5*math.Sin(t*11)*math.Sin(t*7.3+1))*4) / 4
	if !anim {
		fl = 0.6
	}
	// glow
	for dy := -5; dy <= 5; dy++ {
		for dx := -10; dx <= 10; dx++ {
			d := math.Hypot(float64(dx)/2, float64(dy)) / 5
			if d >= 1 {
				continue
			}
			px, py := x+dx, y+dy
			if px < 0 || py < 0 || px >= cv.W || py >= cv.H {
				continue
			}
			ch, fg, bg := cv.Get(px, py)
			glow := (1 - d) * (1 - d) * 0.35 // steady glow; only the flame flickers
			c := mix(bg, Color{255, 140, 50}, glow)
			cv.Put(px, py, ch, fg, &c, false)
		}
	}
	tips := []rune{'\'', '^', '*', '`'}
	tip := tips[int(t*9)%len(tips)]
	if !anim {
		tip = '^'
	}
	cv.Put(x, y-2, tip, mix(Color{255, 240, 180}, Color{255, 200, 90}, fl), nil, true)
	cv.Put(x, y-1, '▲', mix(Color{255, 150, 40}, Color{255, 220, 90}, fl), nil, true)
	cv.Put(x, y, '█', Color{255, 110, 40}, nil, false)
	cv.Put(x-1, y, '▐', Color{110, 70, 40}, nil, false)
	cv.Put(x+1, y, '▌', Color{110, 70, 40}, nil, false)
	for i := 1; i <= 3; i++ {
		cv.Put(x, y+i, '║', Color{110, 75, 45}, nil, false)
	}
}

// ------------------------------------------------------------------ embers

type ember struct {
	x, y, vx, vy, life, max float64
	seed                    float64
}

func stepEmbers(list []ember, W, H int, dt float64, perSecond float64) []ember {
	kept := list[:0]
	for _, e := range list {
		e.life += dt
		e.x += (e.vx + math.Sin(e.life*2+e.seed)*0.8) * dt
		e.y += e.vy * dt
		if e.life < e.max && e.y > -1 && e.x >= 0 && e.x < float64(W) {
			kept = append(kept, e)
		}
	}
	spawn := perSecond * dt
	for spawn > 0 {
		if rand.Float64() < spawn {
			kept = append(kept, ember{
				x: rand.Float64() * float64(W), y: float64(H) - rand.Float64()*3,
				vx: rand.Float64()*1.2 - 0.6, vy: -(2 + rand.Float64()*4),
				max: 3 + rand.Float64()*5, seed: rand.Float64() * 6,
			})
		}
		spawn--
	}
	return kept
}

func drawEmber(cv *Canvas, e ember) {
	f := e.life / e.max
	c := mix(Color{255, 230, 140}, Color{200, 50, 20}, f)
	ch := '•'
	if f > 0.5 {
		ch = '·'
	}
	if math.Sin(e.life*12+e.seed) > 0.6 {
		c = scale(c, 1.2)
	}
	cv.Put(int(e.x), int(e.y), ch, c, nil, false)
}
