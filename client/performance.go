package main

import (
	"fmt"
	"time"
)

func (g *Game) drawPerformance() {
	network := "waiting"
	if g.conn != nil {
		if rtt, fresh := g.conn.latency(); fresh {
			network = fmt.Sprintf("%.1fms", float64(rtt)/float64(time.Millisecond))
		}
	}
	state := "waiting"
	if !g.lastStateAt.IsZero() {
		state = fmt.Sprintf("%dms", time.Since(g.lastStateAt).Milliseconds())
	}
	text := fmt.Sprintf(" F3 stats | net %s | render %.1fms | cells %d | state %s ", network, float64(g.drawTime)/float64(time.Millisecond), g.cv.changed, state)
	bg := theme.topbar
	g.cv.Fill(0, g.cv.H-1, g.cv.W, 1, bg)
	g.cv.Text(0, g.cv.H-1, text, cCyan, &bg, false, g.cv.W)
}
