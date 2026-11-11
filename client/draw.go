package main

import (
	"fmt"
	"math"

	"github.com/gdamore/tcell/v2"
)

// Canvas is a frame buffer on top of a tcell screen. Every frame is drawn into
// buf from scratch; Show() hands tcell only the cells that differ from the
// previous frame, so the terminal gets a minimal update (cheap over SSH).
type Canvas struct {
	s    tcell.Screen
	W, H int
	buf  []cellData
	prev []cellData
	bw   int // size the buffers were made for
	bh   int

	changed int // cells sent to the terminal by the last Show (F3 stats)
}

// BeginFrame starts a new frame at the terminal's current size.
func (c *Canvas) BeginFrame() {
	c.W, c.H = c.s.Size()
	c.ensure()
}

type cellData struct {
	r      rune
	fg, bg Color
	bold   bool
	set    bool
}

func (c *Canvas) ensure() {
	if c.bw == c.W && c.bh == c.H && len(c.buf) == c.W*c.H {
		return
	}
	c.bw, c.bh = c.W, c.H
	c.buf = make([]cellData, maxi(0, c.W*c.H))
	c.prev = nil // repaint everything
}

// Get returns what has been drawn at a cell this frame.
func (c *Canvas) Get(x, y int) (rune, Color, Color) {
	c.ensure()
	if x < 0 || y < 0 || x >= c.W || y >= c.H {
		return ' ', Color{}, Color{}
	}
	cd := c.buf[y*c.W+x]
	if !cd.set {
		return ' ', theme.text, theme.bg
	}
	return cd.r, cd.fg, cd.bg
}

// Show sends the changed cells to the terminal.
func (c *Canvas) Show() {
	c.ensure()
	c.changed = 0
	for i, cd := range c.buf {
		if !cd.set {
			cd = cellData{' ', theme.text, theme.bg, false, true}
		}
		if c.prev != nil && c.prev[i] == cd {
			continue
		}
		c.changed++
		x, y := i%c.W, i/c.W
		c.s.SetContent(x, y, cd.r, noComb, tcell.StyleDefault.Foreground(tc(cd.fg)).Background(tc(cd.bg)).Bold(cd.bold))
	}
	if c.prev == nil || len(c.prev) != len(c.buf) {
		c.prev = make([]cellData, len(c.buf))
	}
	for i, cd := range c.buf {
		if !cd.set {
			cd = cellData{' ', theme.text, theme.bg, false, true}
		}
		c.prev[i] = cd
	}
	c.s.Show()
}

// Invalidate forces a full repaint (after a resize).
func (c *Canvas) Invalidate() {
	c.prev = nil
	c.s.Sync()
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

// noComb must be a non-nil empty slice: tcell 2.7 compares combining runes with
// reflect.DeepEqual, and nil != []rune{}, so passing nil marks every cell dirty
// and the whole screen gets resent on every frame.
var noComb = []rune{}

// Put draws one cell. bg == nil keeps the background already there.
func (c *Canvas) Put(x, y int, r rune, fg Color, bg *Color, bold bool) {
	if x < 0 || y < 0 || x >= c.W || y >= c.H {
		return
	}
	c.ensure()
	i := y*c.W + x
	back := theme.bg
	if bg != nil {
		back = *bg
	} else if c.buf[i].set {
		back = c.buf[i].bg
	}
	c.buf[i] = cellData{r, clampColor(fg), clampColor(back), bold, true}
}

func clampColor(c Color) Color {
	return Color{clampi(c[0], 0, 255), clampi(c[1], 0, 255), clampi(c[2], 0, 255)}
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
		// darker at the start, bright at the leading edge
		cc := mix(scale(col, 0.62), col, math.Min(1, float64(i+1)/math.Max(1, total)))
		c.Put(x+i, y, ch, cc, &bg, false)
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

// levelColor shows how dangerous something of level `lvl` is for a hero of level `hero`.
func levelColor(lvl, hero int) Color {
	switch d := lvl - hero; {
	case d >= 6:
		return activePalette.hpLow
	case d >= 3:
		return Color{255, 150, 60}
	case d >= -2:
		return theme.text
	case d >= -8:
		return activePalette.hpHigh
	default:
		return theme.faint
	}
}

func levelLabel(level, max int) string {
	if max > 0 && level >= max {
		return "Lv MAX"
	}
	return fmt.Sprintf("Lv %d", level)
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
