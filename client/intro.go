package main

import (
	"fmt"
	"time"
)

type introScene struct {
	title string
	text  string
	color Color
	art   []string
}

var introScenes = []introScene{
	{
		title: "The lights of Emberfall",
		text:  "Emberfall grew above old wine cellars. When the cellars filled, the townsfolk built higher. No one could say who dug the stairs that went the other way.",
		color: Color{158, 187, 239},
		art: []string{
			"       ·      ✦          ·          ☾",
			"                   ·",
			"      ╱╲        ╱╲            ╱╲",
			"     ╱__╲      ╱__╲     ╱╲   ╱__╲",
			"  ╱╲ │▪ │ ╱╲  │▪ │    ╱__╲  │▪ │",
			" ╱__╲│  │╱__╲ │  │    │▪ │  │  │",
			" ──────╴  ╶───────────────╴  ╶────",
		},
	},
	{
		title: "The night the wells burned",
		text:  "Last winter the ground shook. Fire came up the wells. By dawn, the rope had burned through and something below was pulling at the chain.",
		color: Color{255, 153, 93},
		art: []string{
			"                  ·",
			"               ·     ✦",
			"                 ╱╲",
			"               ╱╱  ╲   ·",
			"             ╱╱ ╱╲  ╲╲",
			"           ╭════════════╮",
			"           │░░▓░▓░░▓░▓░░│",
			"           ╰════════════╯",
		},
	},
	{
		title: "The last safe room",
		text:  "A merchant waits at the foot of the cellar stairs. “The dragon woke first,” he says. He hands you a torch. “I heard what it was guarding wake next.”",
		color: Color{255, 207, 132},
		art: []string{
			"              ▄▄████▄▄",
			"            ▄█▀      ▀█▄",
			"           ██          ██",
			"       ♦   ██          ██   ♦",
			"       │   ██    M     ██   │",
			"           ██          ██",
			"          ────╴    ╶──────",
			"           ───╴  ╶──────",
		},
	},
}

var cityIntroScenes = []introScene{
	{
		title: "The lights of Emberfall",
		text:  "Rain slips through the plateau and fills the cisterns below. Emberfall built its market around one of them. Lanterns mark the bridge to the post office.",
		color: Color{158, 187, 239},
		art:   introScenes[0].art,
	},
	{
		title: "The roads below",
		text:  "Survey hinges shift distance between roads. When food could no longer reach the cities one winter, Orraveth took their extra miles onto its own bridge.",
		color: Color{255, 153, 93},
		art:   introScenes[1].art,
	},
	{
		title: "Two letters for one house",
		text:  "Dena has two letters for 8 Mill Stair. One says Emberfall. The other says Orraveth, a city crossed out on the atlas. She is waiting in the Post Court.",
		color: Color{255, 207, 132},
		art:   introScenes[2].art,
	},
}

type introPlayback struct {
	scene  int
	scenes []introScene
	since  time.Time
	replay bool
}

func (g *Game) beginHeroIntro() {
	if g.heroIntroShown {
		return
	}
	g.heroIntroShown = true
	g.playIntro(false)
}

func (g *Game) playIntro(replay bool) {
	scenes := introScenes
	if g.hasCities() {
		scenes = cityIntroScenes
	}
	g.intro = &introPlayback{since: time.Now(), replay: replay, scenes: scenes}
	g.overlay = &Overlay{Kind: "intro"}
}

func (g *Game) introKey(key string) {
	switch key {
	case "Left":
		if g.intro.scene > 0 {
			g.intro.scene--
			g.intro.since = time.Now()
		}
	case "Enter", "Right", "Space":
		if g.intro.scene+1 < len(g.intro.scenes) {
			g.intro.scene++
			g.intro.since = time.Now()
			return
		}
		g.finishIntro()
	case "Esc":
		g.finishIntro()
	}
}

func (g *Game) finishIntro() {
	replay := g.intro.replay
	g.intro = nil
	if replay {
		g.showJournal()
	} else {
		g.showHelp()
	}
}

func (g *Game) drawIntro(now time.Time) {
	cv := g.cv
	intro := g.intro
	scene := intro.scenes[intro.scene]
	back := Color{13, 11, 17}
	cv.Fill(0, 0, cv.W, cv.H, back)

	width := mini(cv.W-4, 72)
	if width < 16 || cv.H < 8 {
		cv.Text(0, 0, "Esc skip", scene.color, &back, true, cv.W)
		return
	}
	body := wrap(scene.text, width-4)
	title := wrap(scene.title, width-4)
	art := scene.art
	if width < 39 || cv.H < len(art)+len(title)+len(body)+8 {
		art = nil // Preserve the story text and controls in compact terminals.
	}
	height := mini(cv.H-2, len(art)+len(title)+len(body)+7)
	x, y := (cv.W-width)/2, (cv.H-height)/2
	panel := Color{21, 17, 25}
	cv.Box(x, y, width, height, BoxOpts{Color: mix(panel, scene.color, 0.42), BG: panel})
	center := func(row int, value string, color Color, bold bool) {
		cv.Text(x+maxi(2, (width-runeLen(value))/2), row, value, color, &panel, bold, width-4)
	}
	center(y+1, fmt.Sprintf("EMBERFALL  ·  %d / %d", intro.scene+1, len(g.intro.scenes)), scene.color, false)
	for i, line := range title {
		center(y+2+i, line, scene.color, true)
	}
	contentY := y + 3 + len(title)

	if len(art) > 0 {
		phase := 0
		if g.settings.Animations {
			phase = int(now.Sub(intro.since) / (140 * time.Millisecond))
		}
		artWidth := 0
		for _, row := range art {
			artWidth = maxi(artWidth, runeLen(row))
		}
		left := x + (width-artWidth)/2
		for i, row := range art {
			for j, ch := range []rune(row) {
				if ch == ' ' {
					continue
				}
				color := mix(panel, scene.color, .46+float64(i%3)*.13)
				if ch == '♦' || ch == '✦' || ch == '▪' || ch == '☾' || ch == '·' {
					color = mix(panel, scene.color, .67+float64((phase+j+i)%4)*.11)
				}
				cv.Put(left+j, contentY+i, ch, color, &panel, false)
			}
		}
	}

	for i, line := range body {
		row := contentY + len(art) + i
		if row >= y+height-2 {
			break
		}
		center(row, line, theme.text, false)
	}
	footer := "← back   Enter next   Esc skip"
	if intro.scene+1 == len(g.intro.scenes) {
		footer = "← back   Enter continue"
	}
	if width < 37 {
		footer = "Enter · Esc"
	}
	center(y+height-2, footer, scene.color, false)
}
