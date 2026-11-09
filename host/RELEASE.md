## Tunnel performance update

Update **both the host and the game clients** for the full improvement. Back up your saves before replacing the executable; use the same save folder.

- Negotiate WebSocket compression to shrink repetitive game snapshots.
- Coalesce world changes into at most 20 snapshots per second.
- Keep only the latest pending snapshot for slow connections; preserve reliable game events.
- Keep only the latest received snapshot in the client and limit terminal rendering to approximately 30 FPS.
- Test compressed and uncompressed connections, slow-client backpressure, reliable events and snapshot bursts.

These changes address application-side backlog. They cannot remove latency or outages on the Internet/tunnel route. The temporary URL still changes after restarting.

## Windows host

Download **cdc-host-windows-amd64.exe** on Windows x64, double-click it and choose a hosting mode. Node.js, the server dependencies and cloudflared are bundled; no installation or Administrator access is needed for public mode.

- **Internet:** creates a temporary Cloudflare HTTPS URL and prints the full address to share. Friends paste that URL into the game client's Server field or open it in a browser for launch commands. Anyone with the URL can reach the game server. No Cloudflare account, inbound firewall rule or router configuration is required. The URL changes on restart. Quick Tunnels have no uptime guarantee and are intended for testing/development, rather than permanent hosting.
- **LAN:** prints the computer's local addresses. Allow the bundled Node runtime on your private network if Windows asks. For an explicit local-subnet-only rule, run from an Administrator terminal: `cdc-host-windows-amd64.exe --lan --open-firewall`. This does not open a router port.
- **Local:** only this computer can connect.

Keep the host window open. Press **Enter** to save and stop. Saves are kept in `%LOCALAPPDATA%/CoopDungeonHost/saves`, independently of versioned runtimes. Back up this folder before updates. Public mode stops exposing the server when the host closes. Internet connectivity to Cloudflare is required.

All six client platforms, the source-based server ZIP and SHA256 checksums are also included. macOS client binaries are unsigned. The Windows executable is unsigned too; it is not code-signed.

[Website](https://real-kijmoshi.github.io/coop-dungeon-crawler/) · [Cloudflare Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
