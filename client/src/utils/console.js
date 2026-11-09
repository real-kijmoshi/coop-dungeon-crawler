const {
  bottomMargin,
  topMargin,
  leftMargin,
  rightMargin,
} = require("../../const.json");

const COLORS = {
  WHITE: [255, 255, 255],
  GRAY: [130, 130, 130],
  DARK: [60, 60, 60],
  FLOOR: [150, 130, 100],
  CORRIDOR: [100, 100, 140],
  WALL: [100, 80, 65],
  GREEN: [80, 230, 80],
  RED: [255, 70, 70],
  BLUE: [80, 160, 255],
  YELLOW: [255, 220, 0],
  CYAN: [120, 220, 255],
};

const RESET = "\x1b[0m";
const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;
const dim = (c, f = 0.35) => c.map((v) => Math.round(v * f));

// Each map tile is drawn 2 characters wide so it looks roughly square.
const TILE_W = 2;

const TILES = {
  wall: { color: COLORS.WALL, chars: "██" },
  floor: { color: COLORS.FLOOR, chars: " ." },
  corridor: { color: COLORS.CORRIDOR, chars: "░░" },
};

const tileFor = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (cell === 0) return TILES.wall;
  if (cell === -1) return TILES.corridor;
  return TILES.floor;
};

const screenSize = () => ({
  width: process.stdout.columns || 100,
  height: process.stdout.rows || 30,
});

const enterScreen = () => process.stdout.write("\x1b[?1049h\x1b[?25l");
const leaveScreen = () => process.stdout.write(RESET + "\x1b[?25h\x1b[?1049l");

const pad = (str, len) => {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
};

const bar = (value, max, len) => {
  const filled = max > 0 ? Math.round((Math.max(0, value) / max) * len) : 0;
  return "█".repeat(filled) + "░".repeat(Math.max(0, len - filled));
};

const hpColor = (hp, max) => {
  const r = max > 0 ? hp / max : 0;
  if (r > 0.6) return COLORS.GREEN;
  if (r > 0.3) return COLORS.YELLOW;
  return COLORS.RED;
};

/**
 * Remembers every tile the player has seen so explored areas stay visible
 * (dimmed) after you walk away.
 */
class MapMemory {
  constructor() {
    this.cells = new Map();
  }
  remember(view) {
    if (!view) return;
    const { originX, originY, grid } = view;
    for (let gy = 0; gy < grid.length; gy++) {
      for (let gx = 0; gx < grid[gy].length; gx++) {
        const cell = grid[gy][gx];
        if (cell !== null) this.cells.set(`${originX + gx},${originY + gy}`, cell);
      }
    }
  }
  get(x, y) {
    return this.cells.get(`${x},${y}`);
  }
}

/**
 * Draws the whole frame.
 * @param {object} state  game state received from the server
 * @param {MapMemory} memory  explored tiles
 * @param {{text:string,color:number[]}[]} messages  recent log (newest last)
 * @param {string|null} input  chat text being typed, or null
 */
const drawGame = (state, memory, messages = [], input = null) => {
  const { width, height } = screenSize();
  const panelWidth = Math.min(rightMargin, Math.max(0, width - 30));
  const viewW = Math.max(6, width - leftMargin - panelWidth);
  const viewH = Math.max(6, height - topMargin - bottomMargin);

  const innerCols = Math.floor((viewW - 2) / TILE_W);
  const innerRows = viewH - 2;

  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Array.from({ length: width }, () => [RESET, " "]));
  }
  const put = (x, y, color, ch) => {
    if (x >= 0 && y >= 0 && y < height && x < width) rows[y][x] = [color, ch];
  };
  const text = (x, y, color, str, maxLen = width) => {
    str = String(str).slice(0, Math.max(0, maxLen));
    for (let i = 0; i < str.length; i++) put(x + i, y, color, str[i]);
  };

  // Border around the map view
  const border = fg(COLORS.GRAY);
  const bx0 = leftMargin;
  const by0 = topMargin;
  const bx1 = leftMargin + viewW - 1;
  const by1 = topMargin + viewH - 1;
  for (let x = bx0; x <= bx1; x++) {
    put(x, by0, border, "─");
    put(x, by1, border, "─");
  }
  for (let y = by0; y <= by1; y++) {
    put(bx0, y, border, "│");
    put(bx1, y, border, "│");
  }
  put(bx0, by0, border, "┌");
  put(bx1, by0, border, "┐");
  put(bx0, by1, border, "└");
  put(bx1, by1, border, "┘");

  const player = state && state.player;
  if (player && state.view) {
    const { originX, originY, grid } = state.view;
    const camX = player.x - Math.floor(innerCols / 2);
    const camY = player.y - Math.floor(innerRows / 2);
    const toScreen = (wx, wy) => {
      const tx = wx - camX;
      const ty = wy - camY;
      if (tx < 0 || ty < 0 || tx >= innerCols || ty >= innerRows) return null;
      return { sx: bx0 + 1 + tx * TILE_W, sy: by0 + 1 + ty };
    };

    // Map tiles: visible ones bright, remembered ones dim.
    for (let ty = 0; ty < innerRows; ty++) {
      for (let tx = 0; tx < innerCols; tx++) {
        const wx = camX + tx;
        const wy = camY + ty;
        const row = grid[wy - originY];
        const visible = row !== undefined && row[wx - originX] !== undefined;
        const cell = visible ? row[wx - originX] : memory.get(wx, wy);
        const tile = tileFor(cell);
        if (!tile) continue;
        const color = fg(visible ? tile.color : dim(tile.color));
        const sx = bx0 + 1 + tx * TILE_W;
        const sy = by0 + 1 + ty;
        for (let i = 0; i < TILE_W; i++) put(sx + i, sy, color, tile.chars[i]);
      }
    }

    for (const item of state.items || []) {
      const p = toScreen(item.x, item.y);
      if (p) put(p.sx, p.sy, fg(item.color), item.char);
    }

    for (const m of state.monsters || []) {
      const p = toScreen(m.x, m.y);
      if (!p) continue;
      put(p.sx, p.sy, fg(m.color), m.char);
      // tiny health pip next to the monster
      const r = m.hp / m.maxHp;
      put(p.sx + 1, p.sy, fg(hpColor(m.hp, m.maxHp)), r > 0.66 ? "▮" : r > 0.33 ? "▯" : ".");
    }

    const drawActor = (p, color) => {
      const s = toScreen(p.x, p.y);
      if (!s) return;
      put(s.sx, s.sy, fg(color), "@");
      put(s.sx + 1, s.sy, fg(color), " ");
      const tag = p.username.slice(0, 10);
      const tagX = s.sx - Math.floor(tag.length / 2) + 1;
      if (s.sy - 1 > by0) {
        for (let i = 0; i < tag.length; i++) {
          const x = tagX + i;
          if (x > bx0 && x < bx1) put(x, s.sy - 1, fg(color), tag[i]);
        }
      }
    };
    for (const other of state.nearbyPlayers || []) drawActor(other, COLORS.CYAN);
    drawActor(player, COLORS.YELLOW);
  } else {
    text(bx0 + 2, by0 + 2, fg(COLORS.WHITE), "Waiting for game state...");
  }

  // Side panel
  if (panelWidth > 6) {
    const px = bx1 + 2;
    const w = panelWidth - 3;
    let py = topMargin;
    const line = (str, color = COLORS.WHITE) => {
      if (py < height - bottomMargin) text(px, py++, fg(color), pad(str, w), w);
    };
    const barLine = (label, value, max, color) => {
      if (py >= height - bottomMargin) return;
      const len = Math.max(4, w - 18);
      text(px, py, fg(COLORS.WHITE), pad(label, 4));
      text(px + 4, py, fg(color), bar(value, max, len));
      text(px + 5 + len, py, fg(COLORS.WHITE), `${Math.max(0, value)}/${max}`, w - len - 5);
      py++;
    };

    line("COOP DUNGEON CRAWLER", COLORS.YELLOW);
    if (player) {
      const s = player.stats || {};
      line(`${player.username}  Lv ${s.level}   Depth ${state.depth ?? 0}`);
      barLine("HP", s.hp, s.maxHp, hpColor(s.hp, s.maxHp));
      barLine("XP", s.xp, s.xpNext, COLORS.BLUE);
      line(`ATK ${s.atk}  DEF ${s.def}  Gold ${s.gold}`, COLORS.YELLOW);
      line(`Potions ${s.potions}  Kills ${s.kills}  Deaths ${s.deaths}`, COLORS.GRAY);
      line("");

      const enemies = (state.monsters || [])
        .map((m) => ({ ...m, d: Math.abs(m.x - player.x) + Math.abs(m.y - player.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      line(enemies.length ? "Enemies in sight:" : "No enemies in sight.", COLORS.RED);
      for (const m of enemies) {
        if (py >= height - bottomMargin) break;
        text(px, py, fg(m.color), `${m.char} `);
        text(px + 2, py, fg(COLORS.WHITE), pad(`${m.name}${m.hunting ? "!" : ""}`, 10));
        text(px + 13, py, fg(hpColor(m.hp, m.maxHp)), bar(m.hp, m.maxHp, 8));
        text(px + 22, py, fg(COLORS.GRAY), `${m.hp}/${m.maxHp}`, w - 22);
        py++;
      }
      line("");

      const online = state.online || [];
      line(`Party online (${online.length}):`, COLORS.GREEN);
      for (const o of online.slice(0, 6)) {
        const me = o.username === player.username;
        line(`${me ? "*" : " "} ${pad(o.username, 12)} Lv${pad(o.level, 3)} ${o.hp}/${o.maxHp}`, me ? COLORS.YELLOW : COLORS.CYAN);
      }
      if (online.length > 6) line(`  ...and ${online.length - 6} more`, COLORS.GRAY);
    }
    line("");
    line("WASD/arrows move+attack", COLORS.GRAY);
    line("H potion  T chat  Q quit", COLORS.GRAY);
  }

  // Message log + input line at the bottom
  const logLines = Math.max(0, bottomMargin - 1);
  const recent = messages.slice(-logLines);
  for (let i = 0; i < recent.length; i++) {
    const y = by1 + 1 + i;
    text(leftMargin, y, fg(recent[i].color || COLORS.GRAY), pad(recent[i].text, width - leftMargin));
  }
  const inputY = height - 1;
  if (input !== null) {
    const shown = `Say: ${input}_`;
    text(leftMargin, inputY, fg(COLORS.CYAN), shown.slice(-width));
  } else {
    text(leftMargin, inputY, fg(COLORS.DARK), "Press T to chat");
  }

  // Flush, only emitting color codes when they change
  let out = "\x1b[H";
  for (let y = 0; y < height; y++) {
    let last = null;
    let line = "";
    for (let x = 0; x < width; x++) {
      const [color, ch] = rows[y][x];
      if (color !== last) {
        line += color;
        last = color;
      }
      line += ch;
    }
    out += line + RESET + (y < height - 1 ? "\n" : "");
  }
  process.stdout.write(out);
};

module.exports = { drawGame, enterScreen, leaveScreen, MapMemory, COLORS };
