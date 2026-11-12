package main

import (
	"encoding/json"
	"fmt"
)

func (g *Game) hasCities() bool {
	return (g.world != nil && g.world.Cities) || (g.state != nil && g.state.District != nil)
}

func (g *Game) showDialogue(dialogue Dialogue) {
	w, _ := g.cv.s.Size()
	lines := []Line{}
	for _, line := range wrap(dialogue.Text, clampi(w-10, 12, 62)) {
		lines = append(lines, L(line, theme.text))
	}
	g.overlay = &Overlay{Kind: "dialogue", Title: dialogue.Name, Lines: lines, Footer: "Enter or Esc close"}
}

func (g *Game) openAtlas() {
	if !g.connected || !g.hasCities() {
		g.log("The world atlas is unavailable on this server.", cYellow)
		return
	}
	g.conn.Request("atlas", func(raw json.RawMessage) {
		var atlas Atlas
		if json.Unmarshal(raw, &atlas) != nil || len(atlas.Places) == 0 {
			return
		}
		g.atlas, g.atlasCursor = &atlas, 0
		for i, place := range atlas.Places {
			if place.ID == atlas.Current {
				g.atlasCursor = i
				break
			}
		}
		g.showAtlas(false)
	})
}

func (g *Game) showAtlas(detail bool) {
	atlas := g.atlas
	if atlas == nil || len(atlas.Places) == 0 {
		return
	}
	place := atlas.Places[g.atlasCursor]
	if detail {
		lines := []Line{L(place.Label, cCyan), L("", cWhite)}
		w, _ := g.cv.s.Size()
		description := "Marked on the old survey. You haven't walked here yet."
		if place.Visited {
			description = place.Description
			if place.Safe {
				lines = append(lines, L("Safe district", cGreen))
			}
		}
		for _, line := range wrap(description, clampi(w-10, 12, 58)) {
			lines = append(lines, L(line, theme.text))
		}
		lines = append(lines, L("", cWhite))
		for _, route := range place.Routes {
			marker, col := "·", theme.muted
			if route.Walked {
				marker, col = "✓", cGreen
			}
			lines = append(lines, L(fmt.Sprintf("%s %s", marker, route.Name), col))
		}
		g.overlay = &Overlay{Kind: "atlasPlace", Title: place.Name, Lines: lines, Footer: "✓ walked · Esc back"}
		return
	}
	w, h := g.cv.s.Size()
	lines := []Line{}
	for _, line := range wrap(atlas.Lead, clampi(w-10, 12, 58)) {
		lines = append(lines, L(line, cYellow))
	}
	lines = append(lines, L("", cWhite))
	count := clampi(h-len(lines)-7, 1, len(atlas.Places))
	start := clampi(g.atlasCursor-count+1, 0, len(atlas.Places)-count)
	for i := start; i < start+count; i++ {
		p := atlas.Places[i]
		cursor, marker, col := " ", "·", theme.muted
		if p.Visited {
			marker, col = "✓", theme.text
		}
		if p.ID == atlas.Current {
			marker, col = "@", cCyan
		}
		if i == g.atlasCursor {
			cursor, col = "›", cYellow
		}
		lines = append(lines, L(fmt.Sprintf("%s %s  %s", cursor, marker, p.Name), col))
	}
	g.overlay = &Overlay{Kind: "atlas", Title: "WORLD ATLAS", Lines: lines, Footer: "↑/↓ choose · Enter routes · Esc close"}
}

func (g *Game) atlasKey(kind, name, act string, up, down, closeKey bool) {
	if g.atlas == nil {
		g.overlay = nil
		return
	}
	switch {
	case act == "atlas":
		g.overlay = nil
	case kind == "atlasPlace":
		if closeKey || name == "Enter" {
			g.showAtlas(false)
		}
	case closeKey:
		g.overlay = nil
	case up:
		g.atlasCursor = maxi(0, g.atlasCursor-1)
		g.showAtlas(false)
	case down:
		g.atlasCursor = mini(len(g.atlas.Places)-1, g.atlasCursor+1)
		g.showAtlas(false)
	case name == "Enter":
		g.showAtlas(true)
	}
}
