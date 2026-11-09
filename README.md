<div align="center">

# Terminal Coop Dungeon Drawler

<!-- ![Game Preview](https://via.placeholder.com/600x300) -->

A procedurally generated cooperative dungeon crawler that runs in your terminal.
Built with Node.js and JavaScript.

its somewhat working for now all contrributions are welcome


[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2014.0.0-brightgreen)](https://nodejs.org)
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

### Prerequisites

- Node.js (v14.0.0 or higher)
- npm (usually comes with Node.js)
- Terminal with ANSI support

### Client Setup

1. Clone the repository:

```bash
git clone https://github.com/yourusername/terminal-dungeon-crawler
cd terminal-dungeon-crawler
```

2. Install dependencies:

```bash
cd client
npm install
```

## Usage

### Starting the Client

```bash
npm start
```

### Server Setup

1. Navigate to the server directory:

```bash
cd server
```

2. Create a `.env` file:

```bash
echo "PORT=3143" > .env
```

3. Install server dependencies and start:

```bash
npm install
npm start
```

## Documentation

### Game Controls

| Key | Action |
| --- | ------ |
| `W/A/S/D` or arrow keys | Move. Walk into a monster to attack, into the Merchant to shop, into a downed ally to revive them |
| `1` `2` `3` | Skills: **Whirlwind** (Lv 2), **Rally** (Lv 4), **Fireball** (Lv 6) |
| `H` | Drink a healing potion |
| `T` or `Enter` | Chat with everyone online (`Enter` sends, `Esc` cancels) |
| `L` | Leaderboard (Hall of Heroes) |
| `?` | Help |
| `Q`, `Esc` or `Ctrl+C` | Quit |

### How to play

**The goal:** get strong enough to go deeper than anyone else, take down the lair bosses, and become a **Dragonslayer**.

- **Depth.** You start in the green **safe room**; monsters can't enter it, and you heal quickly inside.
  The further you go from it, the deeper you are (shown as *Depth*) and the deadlier it gets:
  rats & bats → goblins → skeleton archers → orcs → wraiths → trolls → drakes.
  Every new depth record pays an explorer's bonus in gold. The side panel always points the way home.
- **Vision.** You only see what's in your line of sight (rooms you stand in are lit). Explored areas stay on
  your map, dimmed, and monsters only notice you if they can see you.
- **Combat.** Bump to attack, with random damage and critical hits. Skeletons, wraiths and drakes shoot from range.
  **Elite** monsters (bold, from depth 2) are tougher and always drop loot.
- **Bosses** (capital letters) guard **treasure chests** in their lairs and never leave them:
  Goblin King, Bone Lord, Orc Warlord, Wraith Queen, Troll Chieftain, and the **Ancient Dragon** at depth 8+.
- **Skills** unlock as you level:
  - `1` Whirlwind: hit every enemy around you (6s cooldown)
  - `2` Rally: heal yourself and allies nearby by 30% and revive downed allies (30s)
  - `3` Fireball: blast the nearest enemy you can see, up to 8 tiles away (9s)
- **The Merchant** (`M`, in the safe room) sells potions and permanent ATK / DEF / max HP upgrades. Prices rise as you grow.
- **Loot:**

  | Symbol | Item |
  | ------ | ---- |
  | `$` | Gold |
  | `!` | Healing potion (heals 40% of max HP, carry up to 9) |
  | `/` | Sharper blade: ATK +1 |
  | `]` | Armor plate: DEF +1 |
  | `♥` | Heart crystal: max HP +5 |
  | `=` | Treasure chest: lots of gold, a potion and gear |

- **Co-op.** If you fall while an ally is nearby you go **DOWN** (`%`) instead of dying. They have 20 seconds
  to walk into you (or use Rally) to bring you back. Allies near a kill share half its XP, and reviving
  someone earns XP too. Together you can take on lairs that would kill you alone.
- **Death** drops half your gold where you fell and sends you back to the safe room. Go get it back!
- Everything is saved on the server: your level, stats, gold, records and position. Check `L` to see who's on top.

### Quick start (local)

1. Start the server: `cd server && npm install && npm start`
2. In another terminal start the client: `cd client && npm install && npm start`
3. Choose **register**, keep the default server address (`http://localhost:3143`) and pick a username/password.
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
