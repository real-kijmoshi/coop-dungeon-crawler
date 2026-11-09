package main

import (
	"strings"

	"github.com/gdamore/tcell/v2"
)

var logo = []string{
	`   ___                    ___                                `,
	`  / __|___  ___ _ __     |   \ _  _ _ _  __ _ ___ ___ _ _   `,
	` | (__/ _ \/ _ \ '_ \    | |) | || | ' \/ _` + "`" + ` / -_) _ \ ' \  `,
	`  \___\___/\___/ .__/    |___/ \_,_|_||_\__, \___\___/_||_| `,
	`               |_|                       |___/              `,
}
var logoGradient = []Color{{255, 215, 120}, {255, 180, 90}, {255, 140, 70}, {230, 100, 70}, {190, 70, 90}}

type loginUI struct {
	cv       *Canvas
	accounts []Account
	mode     string // "list" or "form"
	cursor   int
	fields   [3]string // server, username, password
	focus    int       // 0..2 fields, 3 = action
	register bool
	status   string
	isError  bool
}

// runLogin shows the account picker / login form and returns a live connection.
// server, if set, is the server the player asked for (e.g. from the launch script).
func runLogin(cv *Canvas, server string) (*Conn, Account, bool) {
	ui := &loginUI{cv: cv, accounts: loadAccounts(), mode: "list"}
	ui.fields[0] = preferredServer()
	if server != "" {
		ui.fields[0] = server
		// Put this server's heroes first; go straight to the form if there are none.
		known := false
		for _, a := range ui.accounts {
			if a.Server == server {
				known = true
			}
		}
		if !known {
			ui.mode = "form"
			ui.register = true
			ui.focus = 1
		}
	}
	if len(ui.accounts) == 0 {
		ui.mode = "form"
		ui.register = true
		if ui.focus == 0 && ui.fields[0] != defaultServer {
			ui.focus = 1
		}
	}
	for {
		ui.draw()
		ev := cv.s.PollEvent()
		switch e := ev.(type) {
		case *tcell.EventResize:
			cv.s.Sync()
		case *tcell.EventKey:
			if e.Key() == tcell.KeyCtrlC {
				return nil, Account{}, false
			}
			var acc *Account
			var quit bool
			if ui.mode == "list" {
				acc, quit = ui.listKey(e)
			} else {
				acc, quit = ui.formKey(e)
			}
			if quit {
				return nil, Account{}, false
			}
			if acc != nil {
				if conn := ui.connect(*acc); conn != nil {
					return conn, *acc, true
				}
			}
		}
	}
}

func (ui *loginUI) connect(acc Account) *Conn {
	ui.status, ui.isError = "Connecting to "+acc.Server+"...", false
	ui.draw()
	conn, err := Dial(acc.Server, acc.Username, acc.Password)
	if err != nil {
		ui.status, ui.isError = err.Error(), true
		return nil
	}
	ui.accounts = rememberAccount(ui.accounts, acc)
	_ = saveAccounts(ui.accounts)
	return conn
}

func (ui *loginUI) listKey(e *tcell.EventKey) (*Account, bool) {
	n := len(ui.accounts) + 1 // + "new account"
	switch e.Key() {
	case tcell.KeyUp:
		ui.cursor = (ui.cursor - 1 + n) % n
	case tcell.KeyDown, tcell.KeyTab:
		ui.cursor = (ui.cursor + 1) % n
	case tcell.KeyEscape:
		return nil, true
	case tcell.KeyDelete:
		ui.deleteSelected()
	case tcell.KeyEnter:
		if ui.cursor < len(ui.accounts) {
			acc := ui.accounts[ui.cursor]
			return &acc, false
		}
		ui.mode, ui.focus, ui.status = "form", 1, ""
	case tcell.KeyRune:
		switch e.Rune() {
		case 'q':
			return nil, true
		case 'n':
			ui.mode, ui.focus, ui.status = "form", 1, ""
		case 'x':
			ui.deleteSelected()
		case 'k':
			ui.cursor = (ui.cursor - 1 + n) % n
		case 'j':
			ui.cursor = (ui.cursor + 1) % n
		}
	}
	return nil, false
}

func (ui *loginUI) deleteSelected() {
	if ui.cursor < len(ui.accounts) {
		ui.accounts = append(ui.accounts[:ui.cursor], ui.accounts[ui.cursor+1:]...)
		_ = saveAccounts(ui.accounts)
		ui.cursor = mini(ui.cursor, len(ui.accounts))
	}
}

func (ui *loginUI) formKey(e *tcell.EventKey) (*Account, bool) {
	switch e.Key() {
	case tcell.KeyEscape:
		if len(ui.accounts) == 0 {
			return nil, true
		}
		ui.mode, ui.status = "list", ""
	case tcell.KeyTab, tcell.KeyDown:
		ui.focus = (ui.focus + 1) % 4
	case tcell.KeyBacktab, tcell.KeyUp:
		ui.focus = (ui.focus + 3) % 4
	case tcell.KeyLeft, tcell.KeyRight:
		if ui.focus == 3 {
			ui.register = !ui.register
		}
	case tcell.KeyBackspace, tcell.KeyBackspace2:
		if ui.focus < 3 {
			r := []rune(ui.fields[ui.focus])
			if len(r) > 0 {
				ui.fields[ui.focus] = string(r[:len(r)-1])
			}
		}
	case tcell.KeyEnter:
		if ui.focus < 2 {
			ui.focus++
			return nil, false
		}
		return ui.submit(), false
	case tcell.KeyRune:
		if ui.focus < 3 {
			limit := 64
			if ui.focus == 0 {
				limit = 2048
			}
			if runeLen(ui.fields[ui.focus]) < limit {
				ui.fields[ui.focus] += string(e.Rune())
			}
		} else if e.Rune() == ' ' {
			ui.register = !ui.register
		}
	}
	return nil, false
}

func (ui *loginUI) submit() *Account {
	server := normalizeServer(ui.fields[0])
	user := strings.TrimSpace(ui.fields[1])
	pass := ui.fields[2]
	if user == "" || pass == "" {
		ui.status, ui.isError = "Username and password are required.", true
		return nil
	}
	if ui.register {
		ui.status, ui.isError = "Creating your hero...", false
		ui.draw()
		if err := register(server, user, pass); err != nil {
			ui.status, ui.isError = err.Error(), true
			return nil
		}
	}
	return &Account{Server: server, Username: user, Password: pass}
}

func (ui *loginUI) draw() {
	cv := ui.cv
	cv.BeginFrame()
	cv.Fill(0, 0, cv.W, cv.H, theme.bg)
	y := maxi(1, cv.H/2-12)
	for i, l := range logo {
		cv.Text(maxi(0, (cv.W-runeLen(l))/2), y+i, l, logoGradient[i], &theme.bg, true, -1)
	}
	y += len(logo)
	sub := "⚔  a co-op terminal dungeon crawler  ⚔"
	cv.Text((cv.W-runeLen(sub))/2, y, sub, theme.muted, &theme.bg, false, -1)
	y += 2

	w := mini(cv.W-4, 56)
	x := (cv.W - w) / 2
	pb := theme.panel
	if ui.mode == "list" {
		h := len(ui.accounts) + 5
		cv.Box(x, y, w, h, BoxOpts{Color: theme.border, BG: pb, Title: "CHOOSE YOUR HERO", TitleColor: ptr(theme.title)})
		for i := 0; i <= len(ui.accounts); i++ {
			yy := y + 2 + i
			label := "＋ New account / login"
			col := cGreen
			if i < len(ui.accounts) {
				a := ui.accounts[i]
				label = a.Username + "  " + a.Server
				col = theme.text
			}
			if i == ui.cursor {
				cv.Fill(x+1, yy, w-2, 1, Color{55, 50, 80})
				cv.Text(x+2, yy, "▶ "+label, cYellow, ptr(Color{55, 50, 80}), true, w-4)
			} else {
				cv.Text(x+2, yy, "  "+label, col, &pb, false, w-4)
			}
		}
		ui.footer(x, y+h, w, "↑/↓ choose · Enter play · N new · X delete · Q quit")
	} else {
		h := 11
		title := "LOG IN"
		if ui.register {
			title = "NEW HERO"
		}
		cv.Box(x, y, w, h, BoxOpts{Color: theme.border, BG: pb, Title: title, TitleColor: ptr(theme.title)})
		labels := []string{"Server", "Username", "Password"}
		for i, l := range labels {
			yy := y + 2 + i*2
			cv.Text(x+2, yy, pad(l, 10), theme.muted, &pb, false, -1)
			val := ui.fields[i]
			if i == 2 {
				val = strings.Repeat("•", runeLen(val))
			}
			fb := Color{30, 30, 42}
			if ui.focus == i {
				fb = Color{45, 42, 70}
				val += "▌"
			}
			fw := w - 15
			cv.Fill(x+12, yy, fw, 1, fb)
			r := []rune(val)
			if len(r) > fw-1 {
				r = r[len(r)-(fw-1):]
			}
			cv.Text(x+13, yy, string(r), theme.text, &fb, ui.focus == i, fw-1)
		}
		yy := y + 8
		opt := func(xx int, label string, on bool) int {
			bg, fg := Color{30, 30, 42}, theme.muted
			if on {
				bg, fg = Color{255, 210, 90}, Color{20, 20, 25}
				if ui.focus != 3 {
					bg = Color{120, 100, 50}
				}
			}
			return cv.Text(xx, yy, " "+label+" ", fg, &bg, on, -1)
		}
		xx := x + 12
		xx += opt(xx, "Log in", !ui.register) + 2
		opt(xx, "Register", ui.register)
		hint := "Tab next · ←/→ login/register · Enter go · Esc back"
		ui.footer(x, y+h, w, hint)
	}
	if ui.status != "" {
		c := theme.muted
		if ui.isError {
			c = cRed
		}
		cv.Text(maxi(0, (cv.W-runeLen(ui.status))/2), cv.H-2, ui.status, c, &theme.bg, true, -1)
	}
	cv.Show()
}

func (ui *loginUI) footer(x, y, w int, text string) {
	ui.cv.Text(x+maxi(0, (w-runeLen(text))/2), y+1, text, theme.faint, &theme.bg, false, -1)
}
