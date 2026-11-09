## Compression that survives tunnels

Update **both the Windows host and all game clients**. Back up saves and keep the same save folder.

A real Cloudflare test showed that WebSocket permessage-deflate was not negotiated on the tested public tunnel, even though it worked locally. v0.2.2 adds opt-in, application-level DEFLATE for game snapshots so compression does not depend on the proxy negotiating a WebSocket extension.

In the real four-client Cloudflare benchmark, total received game traffic fell from about **410 KiB/s to 72 KiB/s** (about **82% less**) while maintaining roughly 20 snapshots/s per player, with no disconnects during the short test. Both ends ran on US GitHub runners; this does not establish latency from Poland. [Raw results and method](https://github.com/real-kijmoshi/coop-dungeon-crawler/blob/main/diagnostics/README.md).

- New clients advertise the codec; older clients continue receiving JSON text.
- Snapshots remain coalesced and limited to one in-flight compression/write per connection.
- Clients bound decompression size and reject corrupted binary frames.
- Reliable game events keep their existing event stream.
- Includes tests for legacy clients/servers, mixed client versions, compressed snapshots without WebSocket extensions, and Node-to-Go codec compatibility.

The temporary tunnel address still changes after a restart. No save format or save location changes.

## Windows host

Download **cdc-host-windows-amd64.exe** on Windows x64, double-click it and choose a hosting mode. Node.js, the server dependencies and cloudflared are bundled; no installation or Administrator access is needed for public mode.

- **Internet:** creates a temporary Cloudflare HTTPS URL and prints the full address to share. Friends paste that URL into the game client's Server field or open it in a browser for launch commands. Anyone with the URL can reach the game server. No Cloudflare account, inbound firewall rule or router configuration is required. The URL changes on restart. Quick Tunnels have no uptime guarantee and are intended for testing/development, rather than permanent hosting.
- **LAN:** prints the computer's local addresses. Allow the bundled Node runtime on your private network if Windows asks. For an explicit local-subnet-only rule, run from an Administrator terminal: `cdc-host-windows-amd64.exe --lan --open-firewall`. This does not open a router port.
- **Local:** only this computer can connect.

Keep the host window open. Press **Enter** to save and stop. Saves are kept in `%LOCALAPPDATA%/CoopDungeonHost/saves`, independently of versioned runtimes. Back up this folder before updates. Public mode stops exposing the server when the host closes. Internet connectivity to Cloudflare is required.

All six client platforms, the source-based server ZIP and SHA256 checksums are also included. macOS client binaries are unsigned. The Windows executable is unsigned too; it is not code-signed.

[Website](https://real-kijmoshi.github.io/coop-dungeon-crawler/) · [Cloudflare Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
