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

## Host on Windows — Cloudflare, Direct, or Both

Download [cdc-host-windows-amd64.exe](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases/latest/download/cdc-host-windows-amd64.exe) and double-click it. Node.js and the server dependencies are bundled. No domain or VPS is required.

| Menu | Mode | What friends receive |
| --- | --- | --- |
| 1 | Cloudflare | A temporary HTTPS URL; no router changes or Administrator access |
| 2 | Direct Internet | An encrypted direct invite with your public IPv4, port, and server key |
| 3 | Both | Both addresses for the same world |
| 4 | LAN | Your computer's local-network address |
| 5 | Local | This computer only |

For command-line use:

```powershell
.\cdc-host-windows-amd64.exe --public
.\cdc-host-windows-amd64.exe --direct
.\cdc-host-windows-amd64.exe --public --direct
```

**Direct mode:** the host requests elevation only to configure its own Windows firewall rule. The rule allows this executable's TCP port (3143 by default) on Private/Public networks, without disabling the firewall. It tries UPnP/NAT-PMP router forwarding, renews a finite lease while running, and removes its own mapping on normal shutdown. If automatic forwarding or firewall setup is unavailable, it starts Cloudflare as a fallback. Router support and a reachable public IPv4 are still required for direct Internet access; CGNAT or upstream NAT can prevent it. Every direct invite is marked **externally unverified** because router configuration does not prove reachability from a friend's network.

Paste the **entire direct invite**, including `#key=...`, into the Server field in **client v0.3.0 or later**. The client verifies the host's persistent TLS public key for registration, login, and WebSocket traffic. Direct invites are for the game client; a browser does not automatically trust this self-signed certificate. Cloudflare links continue to work normally in browsers. Local players should use the local address printed by the host; in Direct mode this is a stable, pinned loopback HTTPS invite.

If automatic router mapping is unavailable, configure a TCP port-forward from your router to the hosting PC's LAN IPv4 and printed local port. `--external-port` requests a different public port; if the router grants another port, the invite shows the actual one. The public IPv4 can still change when your ISP changes it.

Advanced options: `--no-upnp` for manual forwarding, `--public-ip <IPv4>` to override address discovery, `--no-firewall` to manage firewall rules yourself, and `--no-fallback` to prevent automatic Cloudflare fallback. `--public --direct` explicitly runs both even with `--no-fallback`.

The firewall rule persists so later launches in the same location do not repeatedly request elevation. Remove only this mode's own rule with:

```powershell
.\cdc-host-windows-amd64.exe --direct --remove-firewall
```

LAN mode's optional `--lan --open-firewall` rule remains limited to the local subnet and Private profile. It does not forward your router port.

Press **Enter** to save and stop. Saves remain in `%LOCALAPPDATA%/CoopDungeonHost/saves`; the direct TLS identity is stored separately in `%LOCALAPPDATA%/CoopDungeonHost/tls`. Preserve the latter to keep the same server key. Back up both before upgrading. Only one host may use a save folder at a time. Closing the Windows launcher also stops its server/tunnel child processes; use Enter for a graceful save.

Cloudflare uses Quick Tunnels: the URL changes after restarting, no account/domain is needed, and no uptime guarantee is provided. It remains the account-free fallback when a router or ISP prevents direct hosting.

### Tunnel performance

**Local lag:** update the client to v0.3.1 or later. Earlier clients invalidated the entire terminal on every frame, even when most cells were unchanged. Press **F3** in game to toggle live WebSocket RTT, previous frame rendering time (including terminal output), changed-cell count, and time since the last state arrived. The state timer can increase normally while the world is idle; it is not network latency. The rendering fix works with a v0.3.0 host, so existing hosts do not need a server update for it.

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

**Automatic updates:** updater-enabled release clients check the official GitHub Releases feed on startup. They verify the platform binary against its SHA-256 digest and install it for the next launch. If the check or download fails, the current client still starts. Use `-no-update` or set `CDC_NO_UPDATE=1` to skip the check. Development builds and server packages are updated manually.

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

The client talks to the server over WebSocket at `/ws` (WSS for HTTPS addresses), with JSON events and an optional compressed snapshot codec, so writing another client
(web, mobile, bots) is easy. See [`server/net/hub.js`](server/net/hub.js) for the message format. Accounts are
created through `POST /register` and checked with `POST /login`. The main menu uses `POST /account/info`,
`POST /account/password` and `POST /account/delete` (all take `username` and `password`).

Clients may advertise `features: ["state-deflate-v1"]` in the top-level authentication frame. For those clients, snapshots of at least 1 KiB are sent as binary WebSocket frames: ASCII `CDC1`, followed by raw DEFLATE of the usual JSON game-state event. Other events remain JSON text. Clients without this feature receive the existing JSON-only protocol. The Go client accepts both formats and limits decompressed frames to 4 MiB.

A real four-client tunnel benchmark and repeatable test are in [`diagnostics/`](diagnostics/README.md). The test distinguishes native WebSocket compression from application compression and records what tunnel protocol was actually negotiated.

## Documentation

### The interface

The client is a full-screen true-color terminal UI (works best in a modern terminal such as Windows Terminal,
iTerm2, Kitty, WezTerm, Alacritty or GNOME Terminal, at 100×30 or larger):

- **Main menu** with an animated cave, torches and drifting embers. From there you can play as your last hero,
  manage your **heroes and accounts**, change **settings** and read **how to play**
- **Map** with a flickering torchlight that fades with distance and **colored light** from allies, waystones,
  lava, glowing mushrooms and crystals, shrines, legendary loot and angry bosses. Walls show a lit top and a
  shaded face, floors get soft shadows near walls, and each biome has its own **floor details** (straw, moss,
  bones, lava cracks, crystals, gold) and **particles** (dust, spores, embers)
- Cool-blue memory of explored areas and outlined rooms
- **Floating combat text** for damage, crits, heals, dodges and gold, and big banners for level-ups,
  achievements, legendary drops, bounties and death
- **Sidebar** with your character (smooth HP/XP bars, stats, buffs, combo timer), a **minimap**, enemies in sight,
  bounties and your party; on small terminals it collapses into a compact top bar
- **Skill bar** with cooldown sweeps, a message log that stacks repeats, and a chat line
- The client keeps its own frame buffer and only sends the cells that changed, so it stays light over SSH
  (a few KB/s while you play)

### Main menu and accounts

The menu opens when you start `cdc`. **Heroes & accounts** lists every hero saved on this computer, with their
class, level, title, kills and whether they're online, and lets you:

| Key | Action |
| --- | ------ |
| `Enter` | Play as that hero |
| `E` | Edit the saved login (server address, name, password) |
| `P` | Change the hero's password on the server |
| `F` | Forget the login on this computer (the hero stays on the server) |
| `X` | Delete the hero from the server for good (type its name to confirm) |
| `U` | Move the hero up the list |
| `R` | Refresh |

You can also create a new hero or log in to an existing one from the menu. In game, the `Esc` menu has
**Back to the main menu** to switch heroes without restarting.

### Music and sound

The game has its own **dark-fantasy soundtrack** - harp, choir, flute, horns, bells and war drums - and it is
**composed live while you play**, bar by bar. There is no loop, so it never cuts and never repeats exactly; each track
has themes that come back and slowly change.

- **A mood for every place:** the title theme, a lute waltz in the safe room, and one for each biome (cellars,
  caverns, crypts, infernal halls, abyss), plus a boss fight track. Tracks crossfade into each other.
- **It reacts to the fight:** when monsters start hunting you, drums and low strings fade into the same piece of
  music, and fade out again when it's over.
- **Sound effects for everything:** hits, crits, kills, getting hurt, dodges, every skill, pickups, chests, urns,
  shrines, fountains, telegraphed attacks, team combos, revives, level ups and more. They are positional: a fight to
  your left sounds like it's on your left, and distant ones are quieter.

Everything is synthesized by the client itself - there are no audio files. Windows and macOS play it directly;
on Linux the client streams it into `paplay`, `pw-cat`, `aplay` or `ffplay`, whichever is installed. Without a
sound device (e.g. over SSH) the game simply runs silent.

- Turn music and sounds on or off and set their volumes in **Settings** (changes are heard immediately), or start
  with `cdc -no-music`.
- To use another player on Linux, set `CDC_AUDIO_PLAYER` to a command that reads raw 16-bit 44.1 kHz stereo audio
  from its standard input, e.g. `CDC_AUDIO_PLAYER="sox -t raw -r 44100 -e signed -b 16 -c 2 - -d"`.

### Game Controls

These are the default (**WASD**) keys. Press `O` (or `Esc`) for the menu, where you can switch to the **Vim (hjkl)**
or **Arrows** layout, or rebind every key yourself.

| Key | Action |
| --- | ------ |
| `W/A/S/D` or arrow keys | Move. Walk into a monster to attack, into the Merchant to shop, into a downed ally to revive them |
| `1` `2` `3` `4` | Class skills (unlock at level 1, 6, 15 and 30) |
| `H` | Drink a healing potion |
| `I` | Inventory: `E` equip, `X` sell, `D` drop; at the merchant also `U` upgrade and `R` reforge |
| `J` | Journal: bounties and achievements, `Tab` for lore, `N` changes your title |
| `P` | Party: invite heroes, see your party, leave |
| `F` | Talk to a nearby NPC, operate a hinge, or take a route. You can also walk into its marker |
| `M` | Open the world atlas and inspect the routes you have walked |
| `V` | Travel from a safe district or waystone to Emberfall, the dungeon safe room, a discovered waystone, or a party member |
| `G` | Ping: marks the nearest enemy (or your spot) for your party |
| `T` / `Enter` | Chat with everyone (`Tab` switches to party chat) |
| `Tab` | Party chat |
| `Y` / `N` | Accept / decline a party invite |
| `L` | Leaderboard (Hall of Heroes) |
| `O` / `Esc` | Menu and settings |
| `?` | Help |
| `Q` or `Ctrl+C` | Quit |

### Settings

Settings are in the main menu and in game (`O` or `Esc`). They save to your config folder and apply right away:

- **Sound:** music on/off and volume, sound effects on/off and volume
- **Graphics:** color theme (Classic, High contrast, Colorblind-friendly with blue/yellow/magenta instead of
  green/red), animations (torches, embers, flicker; turn off for slow connections), dungeon details, floating
  combat numbers, screen flash, low-HP pulse, big banners, minimap, name tags
- **Gameplay:** key layout (WASD, Vim (hjkl) or Arrows) and per-action rebinding, combat messages in the log,
  confirm before selling Rare+ items

### How to play

**The goal:** level your hero from **1 to 100** on the way through six biomes, uncover the story of Emberfall,
take down the lair bosses, and defeat the **Abyss Lord** waiting at the edge of the world. Then be reborn at level 100
and do it again, stronger. Reaching level 100 takes roughly 15-25 hours of play (see
[BALANCE.md](BALANCE.md)).

#### First session

Preview a class with the arrows or number keys. Press Enter to review the permanent choice and Enter again to confirm. Three short terminal scenes introduce Emberfall before the Field Guide covers movement, attacks, chat, parties, and the merchant. Advance with Enter or skip to the guide with Esc. Replay the intro with **C** in **Journal → Lore**. Press your Help key (default **?**) to reopen it.

Default **T** opens world chat and **Tab** opens party chat after you join a party. While typing, **Tab** switches the labeled channel, **Enter** sends, and **Esc** cancels.

At the merchant, the arrows or number keys preview an offer, including its effect, cost, and availability. Press Enter to review the purchase and Enter again to pay.

#### Cities and roads of Orraveth

New heroes meet in **Emberfall's Post Court**. Talk to Postmaster Dena (`D`) and deliver both Mill Stair letters to open the way to the Old Cellars. The survey hinge (`H`) moves ten steps between Market Stair and Rescue Landing. Wait for your party to clear the moving path before operating it.

Walk the western road through the goblin-held Tollworks to Rootmarket and Sporehold, or take the rescue route to Bellhaven and Siltwatch. Safe city districts have people to talk to and time to recover. Clear defenders at the armed Foundry Gate and the Glass Aqueduct to open their onward routes. The aqueduct ladder opens a shortcut to Emberfall. Follow the fourth stamp through Kilnward to Long Ward and face Chief Surveyor Veyr in the proving chamber.

The atlas (`M`) remembers your discoveries and walked routes. The host saves the hinge setting, cleared encounters and the unlocked ladder. Existing dungeon positions still load. The Old Cellars connects to the procedural dungeon, and its safe room is also a destination on the travel menu.

#### The procedural dungeon

Each depth band is its own **biome** with its own look. Monsters get stronger the further you go from the dungeon safe room, and their level is shown in the title bar and enemy list:

| Depth | Monster level | Biome | |
| ----- | ------------- | ----- | - |
| 0-2 | 1-8 | The Old Cellars | damp stone, rats, bats and slimes |
| 3-5 | 8-21 | The Fungal Caverns | glowing mushrooms, goblins, spiders and the first skeletons |
| 6-9 | 21-40 | The Sunken Crypts | tombs, zombies, orcs, cultists and wraiths |
| 10-13 | 40-61 | The Infernal Halls | fire and brimstone, golems, trolls and demons |
| 14-17 | 61-84 | The Dragon's Abyss | drakes, liches and the Ancient Dragon |
| 18+ | 84-110 | The Throne of the Abyss | the Abyss Lord |

**Emberfall chronicles** unlock as your deepest explored depth increases. Read them alongside the tale and collected scrolls under **Journal → Lore**.

**Lore scrolls** (`§`) are scattered through the dungeon (more common deeper down, and every boss drops one).
Each one reveals the next part of the story, 12 in all. Read them in the journal (`J`, then `Tab`).

#### Classes

You pick a class the first time you play (it's permanent for that hero, so make another account to try another).

| Class | Style | Skills (level) |
| ----- | ----- | -------------- |
| **Warrior** | Tank: most HP and DEF, holds monsters' attention | Cleave (1), War Cry (6, taunt + DEF), Iron Skin (15, -70% damage), Berserk (30, +60% ATK & lifesteal) |
| **Rogue** | Burst: 20% crit, 12% dodge | Backstab (1, 2.5x, crits unaware foes), Smoke Bomb (6, vanish), Fan of Knives (15), Shadow Strike (30, teleport 4x hit) |
| **Mage** | Ranged glass cannon | Fireball (1), Frost Nova (6, freeze), Chain Lightning (15), Meteor (30) |
| **Cleric** | Healer & undead-slayer | Heal (1, also revives), Smite (6, 3x vs undead), Sanctuary (15, party heal/revive/DEF), Holy Nova (30) |

#### Co-op

- **Parties** of up to 4 (`P` to invite, `Y` to accept). Every party member within 30 tiles gets the **full XP of every
  kill** (nothing is split), plus **+10% XP for each member fighting nearby**. More heroes in one place also means more
  monsters spawn around them. Parties get a panel showing where everyone is, party chat (`Tab`), and each other's
  positions on the minimap.
- **Pings** (`G`) mark the nearest enemy (bosses first) or your position, for everyone in your party, with distance and
  direction in their log.
- **Travel to your party:** from the safe room or a waystone, `V` takes you straight to a party member.
- **Going down instead of dying:** if you fall while an ally is nearby you go **DOWN** (`%`). They have 20 seconds to
  walk into you (or use Heal / Sanctuary) to bring you back.
- **Bosses are built for groups:** they introduce themselves, get tougher for each hero they face, **telegraph a ground
  slam** (the floor around the boss turns red: get out!), **call for help** at 60% health and **enrage** at 30%. Their
  **doom mark** (☠) works the other way round: the blow is split between everyone standing next to the marked hero, so
  run *towards* your friend. Everyone who fought gets **personal loot** and boss credit, so there's no loot stealing.
- **Team combos:** most skills leave a mark on the monsters they hit (they get a tint and a ✦ in the enemy list). When
  an **ally** then hits a marked monster - even with a plain attack - the mark detonates: Frost Nova → **SHATTER**
  (2x damage), Fireball → **IGNITE** (splashes to monsters next to it), Chain Lightning → **OVERLOAD** (stuns),
  Smite → **JUDGEMENT** (heals heroes nearby), Cleave → **CRUSH** and Backstab → **RUPTURE** (+75%). Alone, a different
  kind of skill on your own mark gives a smaller bonus.
- **Fight side by side:** standing next to an ally puts you both in **Formation** (15% less damage taken). Hitting a
  monster another hero hit in the last 3 seconds **flanks** it (+15% damage per extra hero). A party builds **one kill
  combo** together.

#### Combat

- **Dodge** with **Space**, then a movement direction. You move up to two open tiles, and a successful dodge takes 2.4 seconds to recharge. A blocked dodge spends nothing.
- **Attack warnings** name the move when you're in its path. A `!` also marks threatened tiles, and early enemies give you more time to react.
- **Openings** appear when a monster's telegraphed attack misses everyone. The next hit against it deals 25% more damage if it lands within 2.4 seconds.

- **Red floor means move.** Many monsters have a special attack that marks the tiles it will hit before it lands: orcs, trolls, golems and zombies **smash** three tiles in front of them, goblins throw **bombs**,
  spiders **pounce**, cultists and liches drop a **hex**, imps and drakes breathe a **line of fire**, wraiths **blink**
  next to you. Step off the marked tiles to take no damage. Freezing or stunning the monster cancels the attack, and
  so does killing it.
- **Rats and goblins call their pack** when you hit one, **slimes split** in two when they die.
- **Elites have an affix:** *Volatile* (explodes a moment after dying), *Frenzied* (acts faster), *Warding* (monsters
  near it take 40% less damage - kill it first) or *Vampiric* (heals when it hits you).

#### Things to find

| | |
| --- | --- |
| `&` Urn | Smash it by walking over it: gold, sometimes a potion, sometimes something that was hiding inside. |
| `≈` Fountain | Heals you fully (once every 45 seconds). |
| `≡` Sealed vault | Has two locks. With an ally standing beside you it opens with better loot for both. Alone you can force it (step on it twice) and fight its guardians. |
| `¤` Cursed chest | Opening it starts a fight in three waves. Everyone who survives gets their own gold and item. |
| `=` Chest | From level 10 on, some of them are **mimics**. Kill it to get the real chest. |

Walking into a chamber for the first time gives a little **XP**, and there are bounties for discovering rooms, breaking
curses and landing team combos.

#### Loot and the blacksmith

Monsters, chests, bosses and the merchant's gamble drop **randomly generated gear** for three slots
(weapon `/`, armor `]`, trinket `"`) in five rarities, shown by color:
**Common**, **Magic** (blue), **Rare** (yellow), **Epic** (purple) and **Legendary** (orange, with a unique name).
Gear rolls ATK, DEF, HP, crit, dodge, lifesteal, gold find, XP bonus and HP regen. An item's level is the level of
the monster or area it came from, so gear keeps pace with you all the way to 100. Your backpack holds 15 items, and
the inventory compares each item to what you wear.

At the merchant, the **blacksmith** can **upgrade** any item up to **+10** (each step adds 4% of the item's base
stats) or **reforge** it to re-roll its stats while keeping its rarity and upgrades.

#### The dungeon

- **Levels and depth.** The green **safe room** is home: monsters can't enter it, and you heal fast inside. The
  further you go from it, the higher the monsters' level (1 next to the safe room, 100 near the edge of the world),
  and the better the loot and XP. Monsters far below your level give little XP, monsters above it give up to +50%,
  so keep moving out as you grow. Monsters only chase you about 10 tiles from where they live. Depth records pay gold.
- **Waystones** (`Ω`) sit in each new depth. Step next to one to attune, then travel back to it from the safe room or
  any other waystone (`V`), so you never have to walk all the way down again.
- **Vision.** You only see what's in your line of sight (rooms you stand in are lit). Explored areas stay on your
  map, dimmed. Monsters only notice you if they can see you, and some shoot from range.
- **Elites** (bold) are tougher and always drop gear. **Bosses** (capital letters) guard treasure chests in their lairs:
  Goblin King (level 8+), Bone Lord (18+), Orc Warlord (30+), Wraith Queen (42+), Troll Chieftain (54+), Demon
  Prince (66+), the **Ancient Dragon** (78+) and the **Abyss Lord** (95+).
- **Shrines** `^` give a random buff for a minute or more: Power, Fortune, Wisdom, Haste, Protection or Blood.
- **Other pickups:** `$` gold, `!` healing potion (up to 9), `♥` heart crystal (+1% max HP permanently, up to 25),
  `=` treasure chest (gold, potion and gear), `§` lore scroll.

#### Endgame and reasons to keep playing

- **Rebirth:** at level 100 (the max) the merchant can **rebirth** you: back to level 1, but you keep your gear and gold and gain a
  permanent **+5% ATK and HP and +10% XP** per rebirth (shown as `✦N` next to your name and on the leaderboard).
- **Kill combos:** chain kills within 4 seconds for up to +100% XP.
- **Bounties:** you always have three, scaled to your progress. Each pays gold, XP and often an item.
- **32 achievements**, each unlocking a title ("the Dragonslayer", "the Loremaster", "of the Fellowship", ...).
- **World events** every 6-9 minutes: **Gold Rush**, **Blood Moon**, **Loot Frenzy** and **Treasure Goblins**.
- **The Merchant** (`M`) sells potions, permanent percentage upgrades (up to +50% ATK, +60% DEF, +60% HP) and a
  mystery-item gamble.
- **Death** drops half your gold where you fell. Respawn in Emberfall from an authored road, or in the safe room from the procedural dungeon. Your gear is safe.

Everything is saved on the server: class, level, rebirths, gear, backpack, bounties, achievements, lore, waystones,
records and position.

> Tip for server admins: set `EVENT_INTERVAL_MS` (e.g. `60000`) to make world events happen more often.

### Quick start (local)

1. Start the server: `cd server && npm install && npm start`
2. In another terminal start the client: `cd client && go run .` (or run a downloaded `cdc` binary)
3. Choose **Register**, keep the default server address (`localhost:3143`) and pick a username/password.
4. Start more clients (with other accounts) to play together - you'll see each other on the map.

### Tests and the balance simulator

- `cd server && npm test` runs the engine checks; `cd client && go test ./...` runs the client's.
- `cd server && node sim/simulate.js --hours 25` fast-forwards AI heroes through 25 hours of play on the real engine
  and reports how the climb to level 100 went. See [BALANCE.md](BALANCE.md).

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
