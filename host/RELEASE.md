# Fix local terminal rendering lag

Update your **client to v0.3.1**. Existing v0.3.0 hosts remain compatible; the client update contains this rendering fix.

The old renderer cleared and repainted directly into the terminal library on every frame. That invalidated cells even if their final content was unchanged. On a static 120×40 test scene, every frame still dirtied all 4,800 cells.

Frames are now composed in memory, and only final changed cells are submitted. The same unchanged scene produces zero terminal cell updates. This avoids unnecessary console output, especially on Windows. It does not claim to eliminate every source of lag.

Press **F3** in game for live WebSocket RTT, render time, changed-cell count and time since the last snapshot arrived. RTT is measured using WebSocket control frames, independently of the UI loop. The snapshot timer can increase while the game is idle.

The Windows host still offers Cloudflare, Direct HTTPS, Both, LAN and Local. Direct invite links require client v0.3.0+ and the complete `#key=...` suffix. The host configures only its game-port firewall rule and attempts UPnP/NAT-PMP router forwarding; CGNAT and unsupported routers can require Cloudflare. Cloudflare Quick Tunnel URLs change after a restart.

Stop the old host before replacing it. Keep `%LOCALAPPDATA%/CoopDungeonHost/saves` and the adjacent `tls` folder to preserve heroes, world and direct server identity. All six client platforms, Windows host executable, server ZIP and SHA256 checksums are included.

Validation covers unchanged and changed frames, layering/backgrounds, Unicode, resizing, real WebSocket latency probes, compressed snapshots and pinned HTTPS/WSS joins. The renderer benchmark uses a simulated screen, not a measurement of physical Windows Terminal FPS. Router mapping tests remain simulated; remote direct reachability still requires checking from another network.
