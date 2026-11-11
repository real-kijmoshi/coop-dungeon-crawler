# Local renderer regression — v0.3.1

Measured on Linux amd64 / AMD EPYC 9V74 with Go 1.24.7, using the same static 120×40 game fixture. The screen wrapper tracks tcell 2.7.4 CellBuffer dirty rules and forwards to its simulation screen. This measures rendering CPU and invalidation behavior, not physical Windows Terminal latency or network performance.

| Metric | v0.3.0 | v0.3.1 |
| --- | ---: | ---: |
| Rendering time per frame | 4.87 ms | 1.39 ms |
| SetContent calls per unchanged frame | 11,575 | 0 |
| Dirty cells per unchanged frame | 4,800 | 0 |

Run: `cd client && go test -run '^$' -bench '^BenchmarkGameDraw$' -benchtime=1s`.

The previous path filled the screen, filled panels, then painted text and tiles directly into tcell. Clearing a glyph invalidates its physical cell even when later drawing restores the same value. Windows tcell emits synchronous cursor/style/text console writes for dirty runs, so false invalidation can stall the UI and input loop.

The replacement composes the final frame in memory, preserves layered backgrounds, and submits only cells whose final rune or style changed. Resizing invalidates the composition cache. Regression tests check no output for unchanged scenes, updates for new messages, matching layered/Unicode output and resizing.

F3 reports the last frame render duration (including terminal Show), final cell submissions, recent WebSocket ping/pong RTT measured outside the UI loop, and elapsed time since the latest state arrived. An idle world does not continuously publish snapshots, so that final timer is not a latency measurement.
