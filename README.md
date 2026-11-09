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
| `W/A/S/D` or arrow keys | Move. Walking into a monster attacks it |
| `H` | Drink a healing potion |
| `T` or `Enter` | Chat with everyone online (`Enter` sends, `Esc` cancels) |
| `Q`, `Esc` or `Ctrl+C` | Quit |

### How to play

- You start in a safe room in the middle of the dungeon. The **further you go from it, the deeper you are**
  (shown as *Depth* in the side panel) and the more dangerous the monsters get:
  rats and bats → goblins → skeletons → orcs → wraiths → trolls → **dragons**.
- Kill monsters for **XP** and **gold**. Each level gives more max HP and ATK (and DEF every other level) and fully heals you.
- Loot found in rooms or dropped by monsters:

  | Symbol | Item |
  | ------ | ---- |
  | `$` | Gold |
  | `!` | Healing potion (heals 40% of max HP, carry up to 9) |
  | `/` | Sharper blade: ATK +1 |
  | `]` | Armor plate: DEF +1 |
  | `♥` | Heart crystal: max HP +5 |

- HP slowly regenerates when you haven't been hit for a few seconds.
- If you die you drop half your gold where you fell and respawn in the starting room. Go back and pick it up!
- **Co-op:** when a party member kills a monster near you, you get half its XP too. Other players are
  shown in cyan with their name above them, and the side panel lists everyone online with their level and HP.
- The map is endless-feeling and generated as you explore. Places you've already seen stay on screen, dimmed.
- Your character (level, stats, gold, potions, position) is saved on the server.

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
