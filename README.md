<div align="center">

# Terminal Coop Dungeon Crawler

<!-- ![Game Preview](https://via.placeholder.com/600x300) -->

A procedurally generated cooperative dungeon crawler that runs in your terminal.
The server is Node.js; the client is a single small Go binary for Windows, macOS and Linux.

Early access — contributions and bug reports are welcome.


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/server-node%20%3E%3D%2022-brightgreen)](https://nodejs.org)
[![Go Version](https://img.shields.io/badge/client-go%201.24-00ADD8)](https://go.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

[Website](https://real-kijmoshi.github.io/coop-dungeon-crawler/) •
[Download](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases/latest) •
[Features](#features) •
[Installation](#installation) •
[Usage](#usage) •
[Documentation](#documentation) •
[Contributing](#contributing)

</div>

## Features

- Procedurally generated dungeons ensuring unique gameplay experiences
- Real-time cooperative multiplayer support
- Terminal-based retro-style graphics
- Persistent character progression
- Cross-platform compatibility (Windows, macOS, Linux)
- Custom server hosting capabilities

## Host on Windows — single executable

Download [cdc-host-windows-amd64.exe](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases/latest/download/cdc-host-windows-amd64.exe), double-click it and choose Internet, LAN or local hosting. Node.js and dependencies are bundled. No runtime installation is needed.

Internet mode prints a full temporary HTTPS URL to share with friends. They enter it in the client's Server field or open it for launch commands. It uses Cloudflare Quick Tunnels, so no inbound firewall rule or router forwarding is needed. Anyone with the URL can reach the server. The URL changes on restart, and Quick Tunnels have no uptime guarantee; use a named tunnel or a reachable host for permanent hosting.

LAN mode prints local addresses. If needed, use `cdc-host-windows-amd64.exe --lan --open-firewall` from an Administrator terminal to add a Windows Private-profile TCP rule limited to the local subnet. This does not configure your router. Public mode does not need Administrator access.

Press **Enter** in the window to save and stop. Saves live in `%LOCALAPPDATA%/CoopDungeonHost/saves`, separately from each bundled runtime version. Back up this folder before upgrades. `--local` binds only to loopback; `--port` and `--data-dir` override defaults.

### Tunnel performance

Use the latest **host and client** together. New clients request application-level snapshot compression, which remains effective when a proxy does not negotiate WebSocket compression. Game snapshots are coalesced to at most 20 per second, and slow connections retain only the latest pending state. The client also replaces old snapshots and caps terminal redraws at approximately 30 FPS. Reliable messages, profiles and request replies stay ordered within their event stream.

If movement is still delayed, compare a local connection (`localhost:3143`) against the public URL. The host player should connect locally to avoid going through the public tunnel. A permanent tunnel hostname keeps the address stable, but does not itself guarantee lower latency. Back up your saves before upgrading the host.

## Host a server from the ZIP — all platforms

1. Install [Node.js LTS](https://nodejs.org/) once.
2. Download [cdc-server.zip](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases/latest/download/cdc-server.zip) and **extract it**.
3. **Windows:** double-click `start-server.cmd`. **macOS / Linux:** open a terminal in the extracted folder and run `sh start-server.sh`.

The launcher installs dependencies on first use and starts the server. No Git or Go is required.
Open **http://localhost:3143** for the server's play launcher, or connect your downloaded client to `localhost:3143`.
The server window prints addresses for friends on the same network. Keep that window open; **Ctrl+C** stops the server.

Your heroes and world are saved in `server/users.db` and `server/utils/map.json` in the extracted folder.
Restart using the same launcher and folder. Back up those files before updating; do not overwrite or delete them.
For Internet play, use a reachable server address or forward TCP port 3143 on your router. A LAN address does not work across the Internet.
Use a modern Node.js LTS; the first launch needs Internet access for dependencies. If native dependency installation fails, use Node.js LTS and retry.

You can also run `node start-server.js` from a source checkout. Set `PORT` in `server/.env` to change the port.

## Play in one command

Every server hosts its own landing page and launchers. With the official server (or your own) at `<server>`:

```bash
curl -fsSL <server>/play | sh          # macOS / Linux: download (once) and start the game
irm <server>/play.ps1 | iex            # Windows PowerShell
curl -fsSL <server>/install | sh       # install a `cdc` command instead
curl <server>/watch                    # watch the dungeon live in your terminal, no install
curl <server>                          # all of the above, as colored text
```

Open `<server>` in a browser for the landing page with copy buttons, live stats and the Hall of Heroes.

> **Why `| sh` and not plain `curl` like parrot.live?** A curl stream is one-way: it can show you
> frames but can't send your key presses back. So `/watch` works exactly like parrot.live (live
> spectator view), while playing needs the tiny client the launcher downloads and caches for you.

## Installation

### Client

**Download** the binary for your system from the [Releases](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases)
page (`cdc-windows-amd64.exe`, `cdc-darwin-arm64`, `cdc-linux-amd64`, ...). It is a single ~6-7 MB file with
no dependencies. On macOS/Linux make it executable with `chmod +x cdc-*` and run it.

**Or build it yourself** with [Go 1.24+](https://go.dev/dl/):

```bash
cd client
go build -o cdc .          # just your platform
./build.sh                 # all platforms into client/dist/
```

### Server

Requires Node.js 22 or newer.

```bash
cd server
npm install
echo "PORT=3143" > .env    # optional, 3143 is the default
npm start
```

## Usage

Start the client and pick or create a hero on the login screen (server address defaults to `localhost:3143`):

```bash
./cdc
```

Or skip the login screen:

```bash
./cdc -server play.example.com:3143 -user alice -pass secret            # log in
./cdc -server play.example.com:3143 -user alice -pass secret -register  # create the account first
```

Saved accounts live in your user config folder (`~/.config/coop-dungeon-crawler/` on Linux,
`~/Library/Application Support/coop-dungeon-crawler/` on macOS, `%AppData%\coop-dungeon-crawler\` on Windows).

### Hosting the launchers and downloads

The server serves the client binaries from `client/dist/` (build them with `client/build.sh`) at `/dl/...`.
If they aren't built, `/dl/...` redirects to the latest GitHub release instead.

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `PUBLIC_URL` | Public address used in the scripts and landing page, e.g. `https://play.example.com` | taken from the request |
| `CLIENT_DIST` | Folder with the client binaries | `../client/dist` |
| `GITHUB_REPO` | Repository for the release fallback | `real-kijmoshi/coop-dungeon-crawler` |

Behind a reverse proxy, pass the `Host` and `X-Forwarded-Proto` headers (or set `PUBLIC_URL`), and turn off
response buffering for `/watch` so the live stream flows (nginx: `proxy_buffering off;`).

### Protocol

The client talks to the server over a plain WebSocket at `/ws` with JSON messages, so writing another client
(web, mobile, bots) is easy. See [`server/net/hub.js`](server/net/hub.js) for the message format. Accounts are
created through `POST /register` and checked with `POST /login`.

Clients may advertise `features: ["state-deflate-v1"]` in the top-level authentication frame. For those clients, snapshots of at least 1 KiB are sent as binary WebSocket frames: ASCII `CDC1`, followed by raw DEFLATE of the usual JSON game-state event. Other events remain JSON text. Clients without this feature receive the existing JSON-only protocol. The Go client accepts both formats and limits decompressed frames to 4 MiB.

A real four-client tunnel benchmark and repeatable test are in [`diagnostics/`](diagnostics/README.md). The test distinguishes native WebSocket compression from application compression and records what tunnel protocol was actually negotiated.

## Documentation

### The interface

The client is a full-screen true-color terminal UI (works best in a modern terminal such as Windows Terminal,
iTerm2, Kitty, WezTerm, Alacritty or GNOME Terminal, at 100×30 or larger):

- **Map** with torchlight that fades with distance, cool-blue memory of explored areas and outlined rooms
- **Floating combat text** for damage, crits, heals, dodges and gold, and big banners for level-ups,
  achievements, legendary drops, bounties and death
- **Sidebar** with your character (smooth HP/XP bars, stats, buffs, combo timer), a **minimap**, enemies in sight,
  bounties and your party; on small terminals it collapses into a compact top bar
- **Skill bar** with cooldown sweeps, a message log that stacks repeats, and a chat line
- Only changed cells are redrawn each frame, so it stays smooth even over SSH

### Game Controls

These are the default (**WASD**) keys. Press `O` (or `Esc`) for the menu, where you can switch to the **Vim (hjkl)**
or **Arrows** layout, or rebind every key yourself.

| Key | Action |
| --- | ------ |
| `W/A/S/D` or arrow keys | Move. Walk into a monster to attack, into the Merchant to shop, into a downed ally to revive them |
| `1` `2` `3` `4` | Class skills (unlock at level 1, 3, 5 and 8) |
| `H` | Drink a healing potion |
| `I` | Inventory: `E` equip, `X` sell, `D` drop; at the merchant also `U` upgrade and `R` reforge |
| `J` | Journal: bounties and achievements, `Tab` for lore, `N` changes your title |
| `P` | Party: invite heroes, see your party, leave |
| `V` | Travel to the safe room, discovered waystones or party members |
| `G` | Ping: marks the nearest enemy (or your spot) for your party |
| `T` / `Enter` | Chat with everyone (`Tab` switches to party chat) |
| `Tab` | Party chat |
| `Y` / `N` | Accept / decline a party invite |
| `L` | Leaderboard (Hall of Heroes) |
| `O` / `Esc` | Menu and settings |
| `?` | Help |
| `Q` or `Ctrl+C` | Quit |

### Settings

The menu (`O` or `Esc`) saves to your config folder and applies right away:

- **Color themes:** Classic, High contrast, and Colorblind-friendly (blue/yellow/magenta instead of green/red)
- **Key layout:** WASD, Vim (hjkl) or Arrows, plus per-action rebinding
- **Toggles:** floating combat numbers, screen flash, low-HP pulse, big banners, combat messages in the log,
  confirm before selling Rare+ items, minimap, name tags

### How to play

**The goal:** go down through six biomes, uncover the story of Emberfall, take down the lair bosses, and defeat
the **Abyss Lord** waiting past depth 12. Then be reborn and do it again, stronger.

#### The world of Emberfall

The town of Emberfall sits on top of old wine cellars. Last winter the ground shook, fire rose from the wells,
and the things below began to climb out. Each depth band is its own **biome** with its own look:

| Depth | Biome | |
| ----- | ----- | - |
| 0-1 | The Old Cellars | damp stone, rats and slimes |
| 2-3 | The Fungal Caverns | glowing mushrooms, goblins and spiders |
| 4-5 | The Sunken Crypts | tombs, skeletons, zombies and wraiths |
| 6-7 | The Infernal Halls | fire and brimstone, demons and trolls |
| 8-11 | The Dragon's Abyss | drakes, liches and the Ancient Dragon |
| 12+ | The Throne of the Abyss | the Abyss Lord |

**Lore scrolls** (`§`) are scattered through the dungeon (more common deeper down, and every boss drops one).
Each one reveals the next part of the story, 12 in all. Read them in the journal (`J`, then `Tab`).

#### Classes

You pick a class the first time you play (it's permanent for that hero, so make another account to try another).

| Class | Style | Skills (level) |
| ----- | ----- | -------------- |
| **Warrior** | Tank: most HP and DEF, holds monsters' attention | Cleave (1), War Cry (3, taunt + DEF), Iron Skin (5, -70% damage), Berserk (8, +60% ATK & lifesteal) |
| **Rogue** | Burst: 20% crit, 12% dodge | Backstab (1, 2.5x, crits unaware foes), Smoke Bomb (3, vanish), Fan of Knives (5), Shadow Strike (8, teleport 4x hit) |
| **Mage** | Ranged glass cannon | Fireball (1), Frost Nova (3, freeze), Chain Lightning (5), Meteor (8) |
| **Cleric** | Healer & undead-slayer | Heal (1, also revives), Smite (3, 3x vs undead), Sanctuary (5, party heal/revive/DEF), Holy Nova (8) |

#### Co-op

- **Parties** of up to 4 (`P` to invite, `Y` to accept). Party members get **+10% XP for each member fighting
  nearby**, a 60% share of every kill within 30 tiles, a party panel showing where everyone is, party chat (`Tab`),
  and each other's positions on the minimap.
- **Pings** (`G`) mark the nearest enemy (bosses first) or your position, for everyone in your party, with distance and
  direction in their log.
- **Travel to your party:** from the safe room or a waystone, `V` takes you straight to a party member.
- **Going down instead of dying:** if you fall while an ally is nearby you go **DOWN** (`%`). They have 20 seconds to
  walk into you (or use Heal / Sanctuary) to bring you back.
- **Bosses are built for groups:** they introduce themselves, get tougher for each hero they face, **telegraph a ground
  slam** (the boss glows and the floor around it turns red: get out!) and **enrage** at low health. Everyone who
  fought gets **personal loot** and boss credit, so there's no loot stealing.

#### Loot and the blacksmith

Monsters, chests, bosses and the merchant's gamble drop **randomly generated gear** for three slots
(weapon `/`, armor `]`, trinket `"`) in five rarities, shown by color:
**Common**, **Magic** (blue), **Rare** (yellow), **Epic** (purple) and **Legendary** (orange, with a unique name).
Gear rolls ATK, DEF, HP, crit, dodge, lifesteal, gold find, XP bonus and HP regen. Deeper depths mean
better item levels. Your backpack holds 15 items, and the inventory compares each item to what you wear.

At the merchant, the **blacksmith** can **upgrade** any item up to **+10** (each step improves every stat) or
**reforge** it to re-roll its stats while keeping its rarity and upgrades.

#### The dungeon

- **Depth.** The green **safe room** is home: monsters can't enter it, and you heal fast inside. The further
  you go from it, the deeper and deadlier the dungeon, but loot and XP get better. Depth records pay gold.
- **Waystones** (`Ω`) sit in each new depth. Step next to one to attune, then travel back to it from the safe room or
  any other waystone (`V`), so you never have to walk all the way down again.
- **Vision.** You only see what's in your line of sight (rooms you stand in are lit). Explored areas stay on your
  map, dimmed. Monsters only notice you if they can see you, and some shoot from range.
- **Elites** (bold) are tougher and always drop gear. **Bosses** (capital letters) guard treasure chests in their lairs:
  Goblin King, Bone Lord, Orc Warlord, Wraith Queen, Troll Chieftain, Demon Prince, the **Ancient Dragon** (depth 8+)
  and the **Abyss Lord** (depth 12+).
- **Shrines** `^` give a random buff for a minute or more: Power, Fortune, Wisdom, Haste, Protection or Blood.
- **Other pickups:** `$` gold, `!` healing potion (up to 9), `♥` heart crystal (+5 max HP permanently),
  `=` treasure chest (gold, potion and gear), `§` lore scroll.

#### Endgame and reasons to keep playing

- **Rebirth:** at level 15 the merchant can **rebirth** you: back to level 1, but you keep your gear and gold and gain a
  permanent **+5% ATK and HP and +10% XP** per rebirth (shown as `✦N` next to your name and on the leaderboard).
- **Kill combos:** chain kills within 4 seconds for up to +100% XP.
- **Bounties:** you always have three, scaled to your progress. Each pays gold, XP and often an item.
- **29 achievements**, each unlocking a title ("the Dragonslayer", "the Loremaster", "of the Fellowship", ...).
- **World events** every 6-9 minutes: **Gold Rush**, **Blood Moon**, **Loot Frenzy** and **Treasure Goblins**.
- **The Merchant** (`M`) sells potions, permanent ATK/DEF/HP upgrades and a mystery-item gamble.
- **Death** drops half your gold where you fell and sends you back to the safe room. Your gear is safe.

Everything is saved on the server: class, level, rebirths, gear, backpack, bounties, achievements, lore, waystones,
records and position.

> Tip for server admins: set `EVENT_INTERVAL_MS` (e.g. `60000`) to make world events happen more often.

### Quick start (local)

1. Start the server: `cd server && npm install && npm start`
2. In another terminal start the client: `cd client && go run .` (or run a downloaded `cdc` binary)
3. Choose **Register**, keep the default server address (`localhost:3143`) and pick a username/password.
4. Start more clients (with other accounts) to play together - you'll see each other on the map.

The map is saved to `server/utils/map.json` and accounts to `server/users.db`.
Delete both to start a fresh world.

### Server Configuration

The server can be configured using the following environment variables:

| Variable | Description | Default |
| -------- | ----------- | ------- |
| `PORT`   | Server port | 3143    |

## Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is [MIT](https://opensource.org/licenses/MIT) licensed.

## Author

**kijmoshi.xyz**

- Website: [kijmoshi.xyz](https://kijmoshi.xyz)
- GitHub: [@real-kijmoshi](https://github.com/real-kijmoshi)

---

<div align="center">
Made with ❤️ by kijmoshi.xyz

If you found this project helpful, please consider giving it a ⭐️

</div>
