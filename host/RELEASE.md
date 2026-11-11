# Descend Together: levels 1–100, music, a new menu and torchlight

The biggest update yet. **Update both your server (or Windows host) and your client.**

## A balanced climb from level 1 to 100

- Monsters now have a **level** set by how far you are from the safe room: level 1 next to it, 100 near the edge of the world. You'll see it in the title bar and the enemy list, colored by danger.
- Monsters, bosses, gear and gold all scale with level, and armor is percentage-based, so fights stay tense from level 1 to 100. Reaching 100 takes roughly 15–25 hours of play.
- The balance was tuned with a new simulator (`node server/sim/simulate.js`) that plays AI heroes through the real game engine for thousands of hours. See [BALANCE.md](https://github.com/real-kijmoshi/coop-dungeon-crawler/blob/main/BALANCE.md).
- Skills unlock at levels 1, 6, 15 and 30. Rebirth is at level 100. New achievements for levels 50, 75 and 100.
- **Co-op pays:** party members within 30 tiles get the full XP of every party kill, and more heroes in one place means more monsters spawn around them.
- Monsters now stay near where they live (no more elites camping the safe-room door), and respawns keep the area around every hero populated.

## A main menu, with account management

`cdc` now opens on an animated title screen with torches and drifting embers. From there you can:
- see every saved hero with class, level and title
- play, create a hero, or log in
- edit a saved login, change your password on the server, forget a login, or delete a hero
- open all the settings and the how-to-play page

In game, **Esc → Back to the main menu** switches heroes without restarting.

## An original soundtrack

The client composes and synthesizes its own chiptune music: a title theme, the safe room, the upper dungeon, the deep, and a boss fight. The music follows what's happening. There are also sound effects for level ups, bounties, achievements, legendary drops and death.

Sound plays through your system's own player (afplay on macOS, PowerShell on Windows, PipeWire/PulseAudio/ALSA/ffplay on Linux), so the client is still a single small binary. Without a player or sound device the game simply runs silent. Turn music and sounds on or off and set volumes in Settings, or start with `cdc -no-music`.

## Torchlight graphics

- Colored light from torches, waystones, lava, mushrooms, crystals, shrines, legendary loot and angry bosses.
- A flickering torch around your hero, walls with a lit top and a shaded face, and soft shadows.
- Biome floor details (moss, bones, lava cracks, crystals, gold) and drifting dust, spores and embers.
- Settings to turn off animations and details, for slow connections.

## Upgrading

- **Saves carry over.** Old merchant upgrades become the new percentage upgrades, and heroes above level 100 are set to 100. Windows host saves stay in `%LOCALAPPDATA%/CoopDungeonHost/saves`; keep the adjacent `tls` folder to keep your direct-invite identity.
- Account management in the menu needs a v0.4.0 server; on older servers the menu says so, and playing still works.
- v0.3 clients can still connect to a v0.4.0 server, but update to get the new menu, music and graphics.
- Everything from v0.3.x still applies: Cloudflare, Direct (`#key=…` invites), Both, LAN and Local hosting modes, compressed snapshots, and F3 for network and rendering stats.

All six client platforms, the Windows host executable, the server ZIP and SHA256 checksums are attached.
