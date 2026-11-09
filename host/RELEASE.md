# Cloudflare + Direct Internet hosting

Download **cdc-host-windows-amd64.exe**, double-click it and choose:

1. **Cloudflare** — temporary HTTPS URL; no router setup.
2. **Direct Internet** — opens the game port and tries automatic router forwarding.
3. **Both** — both addresses point to the same saved world.
4. **LAN**.
5. **Local**.

Node.js and dependencies are bundled. No domain or VPS is required.

Direct mode creates an app-specific TCP firewall rule, tries UPnP/NAT-PMP mapping, renews its finite lease, and removes its own router mapping on normal shutdown. Only firewall configuration requests Administrator permission; the game stays under the normal user account. The firewall rule persists between launches and can be removed with `--direct --remove-firewall`. It covers this executable's game port on Private/Public profiles. The LAN rule remains Private/local-subnet only.

Direct invitations use HTTPS plus the host's persistent public-key fingerprint. **Friends must use client v0.3.0+ and paste the entire invite, including `#key=...`, into the Server field.** Registration, login and game traffic are encrypted and pinned to that key. Direct invites are for the game client; browsers do not automatically trust the self-signed certificate. Cloudflare links work normally in a browser.

The host prints the actual public port granted by the router. It labels direct reachability as **not independently verified**. Unsupported routers, CGNAT/upstream NAT, or firewall restrictions can prevent direct connections; automatic Cloudflare fallback is available. Use `--no-upnp`, `--public-ip`, `--external-port`, `--no-firewall` and `--no-fallback` for manual setup.

Command line: `--public`, `--direct`, or `--public --direct`.

Press **Enter** to save and stop. Saves remain in `%LOCALAPPDATA%/CoopDungeonHost/saves`; TLS identity is in `.../tls`. Stop the old host and back up these folders before upgrading. The new host prevents concurrent use of the same save folder and stops its Windows server/tunnel child processes if the launcher closes.

All six client platforms, source-server ZIP and SHA256 checksums are included. Executables are unsigned. Existing Cloudflare/LAN protocols remain compatible; new clients are required for key-bearing direct invitations.

Router mapping behavior is tested with mock devices; actual router/ISP forwarding cannot be established by those tests. External direct reachability must be checked from another network.
