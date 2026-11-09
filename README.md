<div align="center">

# Terminal Coop Dungeon Drawler

<!-- ![Game Preview](https://via.placeholder.com/600x300) -->

A procedurally generated cooperative dungeon crawler that runs in your terminal.
The server is Node.js; the client is a single small Go binary for Windows, macOS and Linux.

its somewhat working for now all contrributions are welcome


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/server-node%20%3E%3D%2018-brightgreen)](https://nodejs.org)
[![Go Version](https://img.shields.io/badge/client-go%201.24-00ADD8)](https://go.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

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

Requires Node.js 18 or newer.

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

### Protocol

The client talks to the server over a plain WebSocket at `/ws` with JSON messages, so writing another client
(web, mobile, bots) is easy. See [`server/net/hub.js`](server/net/hub.js) for the message format. Accounts are
created through `POST /register` and checked with `POST /login`.

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

| Key | Action |
| --- | ------ |
| `W/A/S/D` or arrow keys | Move. Walk into a monster to attack, into the Merchant to shop, into a downed ally to revive them |
| `1` `2` `3` `4` | Class skills (unlock at level 1, 3, 5 and 8) |
| `H` | Drink a healing potion |
| `I` | Inventory: `W/S` select, `E` equip/unequip, `X` sell (at the merchant), `D` drop |
| `J` | Journal: bounties and achievements, `N` changes your title |
| `T` or `Enter` | Chat with everyone online (`Enter` sends, `Esc` cancels) |
| `L` | Leaderboard (Hall of Heroes) |
| `?` | Help |
| `Q`, `Esc` or `Ctrl+C` | Quit |

### How to play

**The goal:** loot better gear, finish bounties, collect titles, go deeper than anyone else,
take down the lair bosses and become a **Dragonslayer**.

#### Classes

You pick a class the first time you play (it's permanent for that hero, so make another account to try another).

| Class | Style | Skills (level) |
| ----- | ----- | -------------- |
| **Warrior** | Tank: most HP and DEF, holds monsters' attention | Cleave (1), War Cry (3, taunt + DEF), Iron Skin (5, -70% damage), Berserk (8, +60% ATK & lifesteal) |
| **Rogue** | Burst: 20% crit, 12% dodge | Backstab (1, 2.5x, crits unaware foes), Smoke Bomb (3, vanish), Fan of Knives (5), Shadow Strike (8, teleport 4x hit) |
| **Mage** | Ranged glass cannon | Fireball (1), Frost Nova (3, freeze), Chain Lightning (5), Meteor (8) |
| **Cleric** | Healer & undead-slayer | Heal (1, also revives), Smite (3, 3x vs undead), Sanctuary (5, party heal/revive/DEF), Holy Nova (8) |

#### Loot

Monsters, chests, bosses and the merchant's gamble drop **randomly generated gear** for three slots
(weapon `/`, armor `]`, trinket `"`) in five rarities, shown by color:
**Common**, **Magic** (blue), **Rare** (yellow), **Epic** (purple) and **Legendary** (orange, with a unique name).
Gear rolls ATK, DEF, HP, crit, dodge, lifesteal, gold find, XP bonus and HP regen. Deeper depths mean
better item levels. Your backpack holds 15 items. The inventory shows how each item compares to what you
wear, and you can sell loot to the merchant.

#### The dungeon

- **Depth.** The green **safe room** is home: monsters can't enter it, and you heal fast inside. The further
  you go from it, the deeper and deadlier the dungeon (rats → goblins → skeletons → orcs → wraiths → golems →
  trolls → demons → drakes → liches), but loot and XP get better. Depth records pay gold.
- **Vision.** You only see what's in your line of sight (rooms you stand in are lit). Explored areas stay on your
  map, dimmed. Monsters only notice you if they can see you, and some shoot from range.
- **Elites** (bold) are tougher and always drop gear. **Bosses** (capital letters) guard treasure chests in their lairs:
  Goblin King, Bone Lord, Orc Warlord, Wraith Queen, Troll Chieftain, Demon Prince and the **Ancient Dragon** (depth 8+).
- **Shrines** `^` give a random buff for a minute or more: Power, Fortune, Wisdom, Haste, Protection or Blood.
- **Other pickups:** `$` gold, `!` healing potion (up to 9), `♥` heart crystal (+5 max HP permanently),
  `=` treasure chest (gold, potion and gear).

#### Reasons to keep playing

- **Kill combos:** chain kills within 4 seconds for up to +100% XP.
- **Bounties:** you always have three, scaled to your progress. Examples: slay 10 goblins, defeat the Bone Lord,
  reach depth 5, open chests, hit a x6 combo. Each pays gold, XP and often an item, and a new one replaces it.
- **22 achievements**, each unlocking a title shown on the leaderboard ("the Dragonslayer", "the Unstoppable", ...).
- **World events** every 6-9 minutes, announced to everyone:
  **Gold Rush** (double gold), **Blood Moon** (stronger monsters, +75% XP, more loot), **Loot Frenzy** (3x item drops)
  and **Treasure Goblins** (they run from you and drop piles of loot if you catch them before they escape).
- **The Merchant** (`M`) sells potions, permanent ATK/DEF/HP upgrades (prices rise each time) and a mystery-item gamble.

#### Co-op

- If you fall while an ally is nearby you go **DOWN** (`%`) instead of dying. They have 20 seconds to walk into you
  (or use Heal, Sanctuary) to bring you back.
- Allies near a kill share half its XP. Reviving someone earns XP too.
- Classes complement each other: a Warrior taunts, a Cleric heals, a Mage freezes and nukes, a Rogue bursts down bosses.
- **Death** drops half your gold where you fell and sends you back to the safe room. Your gear is safe.

Everything is saved on the server: class, level, gear, backpack, bounties, achievements, records and position.

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
