package main

import (
	"math"

	"github.com/gdamore/tcell/v2"
)

// Canvas wraps a tcell screen with the drawing helpers the UI needs.
// tcell keeps a back buffer and only sends changed cells to the terminal.
type Canvas struct {
	s    tcell.Screen
	W, H int
}

func tc(c Color) tcell.Color {
	return tcell.NewRGBColor(int32(clampi(c[0], 0, 255)), int32(clampi(c[1], 0, 255)), int32(clampi(c[2], 0, 255)))
}

func clampi(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampf(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

func scale(c Color, f float64) Color {
	return Color{int(math.Round(float64(c[0]) * f)), int(math.Round(float64(c[1]) * f)), int(math.Round(float64(c[2]) * f))}
}

func mix(a, b Color, t float64) Color {
	return Color{
		int(math.Round(float64(a[0]) + float64(b[0]-a[0])*t)),
		int(math.Round(float64(a[1]) + float64(b[1]-a[1])*t)),
		int(math.Round(float64(a[2]) + float64(b[2]-a[2])*t)),
	}
}

// Put draws one cell. bg == nil keeps the background already there.
func (c *Canvas) Put(x, y int, r rune, fg Color, bg *Color, bold bool) {
	if x < 0 || y < 0 || x >= c.W || y >= c.H {
		return
	}
	var back tcell.Color
	if bg != nil {
		back = tc(*bg)
	} else {
		_, _, st, _ := c.s.GetContent(x, y)
		_, back, _ = st.Decompose()
	}
	c.s.SetContent(x, y, r, nil, tcell.StyleDefault.Foreground(tc(fg)).Background(back).Bold(bold))
}

// Text draws a string and returns how many cells it used.
func (c *Canvas) Text(x, y int, s string, fg Color, bg *Color, bold bool, max int) int {
	n := 0
	for _, r := range s {
		if max >= 0 && n >= max {
			break
		}
		c.Put(x+n, y, r, fg, bg, bold)
		n++
	}
	return n
}

func (c *Canvas) Fill(x, y, w, h int, bg Color) {
	for yy := y; yy < y+h; yy++ {
		for xx := x; xx < x+w; xx++ {
			c.Put(xx, yy, ' ', bg, &bg, false)
		}
	}
}

type BoxOpts struct {
	Color, BG             Color
	Title, RightTitle     string
	TitleColor, RightColr *Color
}

// Box draws a rounded panel with an optional title on the top edge.
func (c *Canvas) Box(x, y, w, h int, o BoxOpts) {
	if w < 2 || h < 2 {
		return
	}
	bg := o.BG
	c.Fill(x, y, w, h, bg)
	for i := 1; i < w-1; i++ {
		c.Put(x+i, y, '─', o.Color, &bg, false)
		c.Put(x+i, y+h-1, '─', o.Color, &bg, false)
	}
	for j := 1; j < h-1; j++ {
		c.Put(x, y+j, '│', o.Color, &bg, false)
		c.Put(x+w-1, y+j, '│', o.Color, &bg, false)
	}
	c.Put(x, y, '╭', o.Color, &bg, false)
	c.Put(x+w-1, y, '╮', o.Color, &bg, false)
	c.Put(x, y+h-1, '╰', o.Color, &bg, false)
	c.Put(x+w-1, y+h-1, '╯', o.Color, &bg, false)
	if o.Title != "" {
		tcol := o.Color
		if o.TitleColor != nil {
			tcol = *o.TitleColor
		}
		c.Text(x+2, y, " "+o.Title+" ", tcol, &bg, true, w-4)
	}
	if o.RightTitle != "" {
		rcol := o.Color
		if o.RightColr != nil {
			rcol = *o.RightColr
		}
		t := " " + o.RightTitle + " "
		c.Text(x+w-2-runeLen(t), y, t, rcol, &bg, false, w-4)
	}
}

var partials = []rune{' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉'}

// Bar draws a smooth progress bar (eighth blocks) with an optional centered label.
func (c *Canvas) Bar(x, y, w int, value, max float64, col Color, label string) {
	if w <= 0 {
		return
	}
	r := 0.0
	if max > 0 {
		r = clampf(value/max, 0, 1)
	}
	total := r * float64(w)
	full := int(total)
	part := int((total - float64(full)) * 8)
	bg := theme.barBg
	for i := 0; i < w; i++ {
		ch := ' '
		if i < full {
			ch = '█'
		} else if i == full && part > 0 {
			ch = partials[part]
		}
		c.Put(x+i, y, ch, col, &bg, false)
	}
	if label != "" {
		lx := x + maxi(0, (w-runeLen(label))/2)
		i := 0
		for _, ch := range label {
			if i >= w {
				break
			}
			if lx+i-x < full {
				c.Put(lx+i, y, ch, Color{15, 15, 20}, &col, true)
			} else {
				c.Put(lx+i, y, ch, theme.text, &bg, true)
			}
			i++
		}
	}
}

func runeLen(s string) int {
	return len([]rune(s))
}

func maxi(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func mini(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// pad right-pads (or cuts) s to n runes.
func pad(s string, n int) string {
	r := []rune(s)
	if len(r) >= n {
		return string(r[:maxi(0, n)])
	}
	out := make([]rune, n)
	copy(out, r)
	for i := len(r); i < n; i++ {
		out[i] = ' '
	}
	return string(out)
}

type Theme struct {
	bg, panel, border, title, text, muted, faint, topbar, barBg Color
}

var theme = Theme{
	bg:     Color{14, 14, 20},
	panel:  Color{20, 20, 28},
	border: Color{70, 70, 95},
	title:  Color{255, 215, 120},
	text:   Color{225, 225, 230},
	muted:  Color{125, 125, 140},
	faint:  Color{70, 70, 85},
	topbar: Color{28, 26, 42},
	barBg:  Color{40, 40, 52},
}

var (
	cWhite  = Color{235, 235, 235}
	cGray   = Color{140, 140, 150}
	cDark   = Color{80, 80, 90}
	cGreen  = Color{90, 230, 110}
	cRed    = Color{255, 80, 80}
	cBlue   = Color{90, 160, 255}
	cYellow = Color{255, 215, 60}
	cOrange = Color{255, 160, 50}
	cCyan   = Color{110, 220, 255}
	cPink   = Color{255, 120, 255}
)

var rarityColors = map[string]Color{
	"common":    {210, 210, 210},
	"magic":     {100, 150, 255},
	"rare":      {255, 230, 70},
	"epic":      {200, 100, 255},
	"legendary": {255, 140, 0},
}

func hpColor(hp, max float64) Color {
	r := 0.0
	if max > 0 {
		r = hp / max
	}
	switch {
	case r > 0.6:
		return activePalette.hpHigh
	case r > 0.3:
		return activePalette.hpMid
	default:
		return activePalette.hpLow
	}
}

func ptr(c Color) *Color { return &c }
