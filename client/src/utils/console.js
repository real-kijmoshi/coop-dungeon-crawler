const {
  bottomMargin,
  topMargin,
  leftMargin,
  rightMargin,
} = require("../../const.json");

const COLORS = {
  WHITE: [255, 255, 255],
  GRAY: [130, 130, 130],
  DARK: [70, 70, 70],
  FLOOR: [150, 130, 100],
  CORRIDOR: [100, 100, 140],
  WALL: [110, 88, 70],
  SAFE: [90, 150, 110],
  GREEN: [80, 230, 80],
  RED: [255, 70, 70],
  BLUE: [80, 160, 255],
  YELLOW: [255, 220, 0],
  ORANGE: [255, 160, 40],
  CYAN: [120, 220, 255],
};

const RESET = "\x1b[0m";
// Every color code starts with a reset so attributes never leak between cells.
const fg = (c) => `\x1b[0;38;2;${c[0]};${c[1]};${c[2]}m`;
const bold = (c) => `\x1b[0;1;38;2;${c[0]};${c[1]};${c[2]}m`;
const inverse = (c) => `\x1b[0;7;38;2;${c[0]};${c[1]};${c[2]}m`;
const dim = (c, f = 0.35) => c.map((v) => Math.round(v * f));

// Each map tile is drawn 2 characters wide so it looks roughly square.
const TILE_W = 2;

const tileFor = (cell, safeRoomId) => {
  if (cell === null || cell === undefined) return null;
  if (cell === 0) return { color: COLORS.WALL, chars: "██" };
  if (cell === -1) return { color: COLORS.CORRIDOR, chars: "░░" };
  if (cell === safeRoomId) return { color: COLORS.SAFE, chars: " +" };
  return { color: COLORS.FLOOR, chars: " ." };
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
  const filled = max > 0 ? Math.round((Math.max(0, Math.min(value, max)) / max) * len) : 0;
  return "█".repeat(filled) + "░".repeat(Math.max(0, len - filled));
};

const hpColor = (hp, max) => {
  const r = max > 0 ? hp / max : 0;
  if (r > 0.6) return COLORS.GREEN;
  if (r > 0.3) return COLORS.YELLOW;
  return COLORS.RED;
};

const compass = (dx, dy) => {
  if (dx === 0 && dy === 0) return "here";
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  const names = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return names[Math.round(((a + 360) % 360) / 45) % 8];
};

/** Remembers every tile the player has seen; explored areas stay visible (dimmed). */
class MapMemory {
  constructor() {
    this.cells = new Map();
    this.safeRoomId = null;
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
 * ui: { messages, input, overlay: {title, lines:[{text,color}], footer}, flash, now }
 */
const drawGame = (state, memory, ui) => {
  const { messages = [], input = null, overlay = null, flash = null } = ui;
  const now = ui.now || Date.now();
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

  // Border around the map view (flashes red when hurt, gold on level up)
  const border = fg(flash || COLORS.GRAY);
  const bx0 = leftMargin;
  const by0 = topMargin;
  const bx1 = leftMargin + viewW - 1;
  const by1 = topMargin + viewH - 1;
  const hch = flash ? "━" : "─";
  const vch = flash ? "┃" : "│";
  for (let x = bx0; x <= bx1; x++) {
    put(x, by0, border, hch);
    put(x, by1, border, hch);
  }
  for (let y = by0; y <= by1; y++) {
    put(bx0, y, border, vch);
    put(bx1, y, border, vch);
  }
  put(bx0, by0, border, flash ? "┏" : "┌");
  put(bx1, by0, border, flash ? "┓" : "┐");
  put(bx0, by1, border, flash ? "┗" : "└");
  put(bx1, by1, border, flash ? "┛" : "┘");

  const player = state && state.player;
  if (player && state.view) {
    const { originX, originY, grid } = state.view;
    const safeId = memory.safeRoomId;
    const camX = player.x - Math.floor(innerCols / 2);
    const camY = player.y - Math.floor(innerRows / 2);
    const toScreen = (wx, wy) => {
      const tx = wx - camX;
      const ty = wy - camY;
      if (tx < 0 || ty < 0 || tx >= innerCols || ty >= innerRows) return null;
      return { sx: bx0 + 1 + tx * TILE_W, sy: by0 + 1 + ty };
    };

    for (let ty = 0; ty < innerRows; ty++) {
      for (let tx = 0; tx < innerCols; tx++) {
        const wx = camX + tx;
        const wy = camY + ty;
        const row = grid[wy - originY];
        const live = row ? row[wx - originX] : undefined;
        const visible = live !== undefined && live !== null;
        const tile = tileFor(visible ? live : memory.get(wx, wy), safeId);
        if (!tile) continue;
        const color = fg(visible ? tile.color : dim(tile.color));
        const sx = bx0 + 1 + tx * TILE_W;
        const sy = by0 + 1 + ty;
        for (let i = 0; i < TILE_W; i++) put(sx + i, sy, color, tile.chars[i]);
      }
    }

    for (const item of state.items || []) {
      const p = toScreen(item.x, item.y);
      if (p) put(p.sx, p.sy, item.kind === "chest" ? bold(item.color) : fg(item.color), item.char);
    }

    for (const npc of state.npcs || []) {
      const p = toScreen(npc.x, npc.y);
      if (p) put(p.sx, p.sy, bold(npc.color), npc.char);
    }

    for (const m of state.monsters || []) {
      const p = toScreen(m.x, m.y);
      if (!p) continue;
      const style = m.hit ? inverse(m.color) : m.boss || m.elite ? bold(m.color) : fg(m.color);
      put(p.sx, p.sy, style, m.char);
      const r = m.hp / m.maxHp;
      put(p.sx + 1, p.sy, fg(hpColor(m.hp, m.maxHp)), r > 0.66 ? "▮" : r > 0.33 ? "▯" : ".");
    }

    const drawActor = (p, color, downed) => {
      const s = toScreen(p.x, p.y);
      if (!s) return;
      put(s.sx, s.sy, downed ? bold(COLORS.RED) : bold(color), downed ? "%" : "@");
      put(s.sx + 1, s.sy, fg(color), " ");
      const tag = (downed ? "HELP " : "") + p.username.slice(0, 10);
      const tagX = s.sx - Math.floor(tag.length / 2) + 1;
      if (s.sy - 1 > by0) {
        for (let i = 0; i < tag.length; i++) {
          const x = tagX + i;
          if (x > bx0 && x < bx1) put(x, s.sy - 1, fg(downed ? COLORS.RED : color), tag[i]);
        }
      }
    };
    for (const other of state.nearbyPlayers || []) drawActor(other, COLORS.CYAN, other.downed);
    drawActor(player, COLORS.YELLOW, !!player.downedUntil);

    if (player.downedUntil) {
      const secs = Math.max(0, Math.ceil((player.downedUntil - now) / 1000));
      const msg = ` YOU ARE DOWN - an ally can revive you (${secs}s) `;
      text(bx0 + Math.max(1, Math.floor((viewW - msg.length) / 2)), by0 + 2, inverse(COLORS.RED), msg, viewW - 2);
    }
  } else {
    text(bx0 + 2, by0 + 2, fg(COLORS.WHITE), "Waiting for game state...");
  }

  // Overlay box (help, shop, leaderboard)
  if (overlay) {
    const lines = overlay.lines || [];
    const boxW = Math.min(viewW - 4, Math.max(30, ...lines.map((l) => l.text.length + 4), (overlay.title || "").length + 6));
    const boxH = Math.min(viewH - 2, lines.length + 4);
    const ox = bx0 + Math.floor((viewW - boxW) / 2);
    const oy = by0 + Math.floor((viewH - boxH) / 2);
    const bc = fg(COLORS.YELLOW);
    for (let y = oy; y < oy + boxH; y++) {
      for (let x = ox; x < ox + boxW; x++) {
        const edgeY = y === oy || y === oy + boxH - 1;
        const edgeX = x === ox || x === ox + boxW - 1;
        let ch = " ";
        if (edgeY && edgeX) ch = "+";
        else if (edgeY) ch = "═";
        else if (edgeX) ch = "║";
        put(x, y, edgeX || edgeY ? bc : RESET, ch);
      }
    }
    if (overlay.title) text(ox + 2, oy, bold(COLORS.YELLOW), ` ${overlay.title} `, boxW - 4);
    for (let i = 0; i < lines.length && i < boxH - 4; i++) {
      text(ox + 2, oy + 2 + i, fg(lines[i].color || COLORS.WHITE), lines[i].text, boxW - 4);
    }
    if (overlay.footer) text(ox + 2, oy + boxH - 1, fg(COLORS.GRAY), ` ${overlay.footer} `, boxW - 4);
  }

  // Side panel
  if (panelWidth > 6) {
    const px = bx1 + 2;
    const w = panelWidth - 3;
    let py = topMargin;
    const limit = height - bottomMargin;
    const line = (str, color = COLORS.WHITE) => {
      if (py < limit) text(px, py++, fg(color), pad(str, w), w);
    };
    const barLine = (label, value, max, color) => {
      if (py >= limit) return;
      const len = Math.max(4, w - 14);
      text(px, py, fg(COLORS.WHITE), pad(label, 3));
      text(px + 3, py, fg(color), bar(value, max, len));
      text(px + 4 + len, py, fg(COLORS.WHITE), `${Math.max(0, value)}/${max}`, w - len - 4);
      py++;
    };

    line("COOP DUNGEON CRAWLER", COLORS.YELLOW);
    if (player) {
      const s = player.stats || {};
      line(`${player.username}  Lv ${s.level}  Depth ${state.depth ?? 0} (best ${s.maxDepth ?? 0})`);
      barLine("HP", s.hp, s.maxHp, hpColor(s.hp, s.maxHp));
      barLine("XP", s.xp, s.xpNext, COLORS.BLUE);
      line(`ATK ${s.atk}  DEF ${s.def}  Gold ${s.gold}  Potions ${s.potions}`, COLORS.YELLOW);
      line(`Kills ${s.kills}  Bosses ${s.bossKills}  Deaths ${s.deaths}`, COLORS.GRAY);
      if (state.home) {
        const dx = state.home.x - player.x;
        const dy = state.home.y - player.y;
        const d = Math.round(Math.hypot(dx, dy));
        line(player.safe ? "You are in the safe room." : `Safe room: ${d} tiles ${compass(dx, dy)}`, player.safe ? COLORS.GREEN : COLORS.GRAY);
      }

      // Skills
      if (py < limit) py++;
      line("Skills:", COLORS.CYAN);
      for (const sk of player.skills || []) {
        if (py >= limit) break;
        let status;
        let color;
        if (s.level < sk.level) {
          status = `unlocks at Lv ${sk.level}`;
          color = COLORS.DARK;
        } else if (sk.readyAt > now) {
          status = `${Math.ceil((sk.readyAt - now) / 1000)}s`;
          color = COLORS.GRAY;
        } else {
          status = "READY";
          color = COLORS.GREEN;
        }
        text(px, py, fg(COLORS.WHITE), `[${sk.key}] `);
        text(px + 4, py, fg(color), pad(`${sk.name}  ${status}`, w - 4), w - 4);
        py++;
      }

      if (py < limit) py++;
      const enemies = (state.monsters || [])
        .map((m) => ({ ...m, d: Math.abs(m.x - player.x) + Math.abs(m.y - player.y) }))
        .sort((a, b) => b.boss - a.boss || a.d - b.d)
        .slice(0, 5);
      line(enemies.length ? "Enemies in sight:" : "No enemies in sight.", COLORS.RED);
      for (const m of enemies) {
        if (py >= limit) break;
        const nameW = Math.max(6, w - 16);
        text(px, py, m.boss || m.elite ? bold(m.color) : fg(m.color), m.char);
        text(px + 2, py, fg(m.boss ? COLORS.ORANGE : m.elite ? COLORS.YELLOW : COLORS.WHITE), pad(`${m.name}${m.hunting ? "!" : ""}`, nameW), nameW);
        text(px + 3 + nameW, py, fg(hpColor(m.hp, m.maxHp)), bar(m.hp, m.maxHp, 6));
        text(px + 10 + nameW, py, fg(COLORS.GRAY), `${m.hp}`, 5);
        py++;
      }

      if (py < limit) py++;
      const online = state.online || [];
      line(`Party online (${online.length}):`, COLORS.GREEN);
      for (const o of online.slice(0, 5)) {
        const me = o.username === player.username;
        const status = o.downed ? "DOWN!" : `${o.hp}/${o.maxHp}`;
        line(`${me ? "*" : " "} ${pad(o.username, 11)} Lv${pad(o.level, 3)}D${pad(o.depth, 2)} ${status}`, o.downed ? COLORS.RED : me ? COLORS.YELLOW : COLORS.CYAN);
      }
      if (online.length > 5) line(`  ...and ${online.length - 5} more`, COLORS.GRAY);
    }
    if (py < limit) py++;
    line("? help  L leaderboard  Q quit", COLORS.GRAY);
  }

  // Message log + input line at the bottom
  const logLines = Math.max(0, bottomMargin - 1);
  const recent = messages.slice(-logLines);
  for (let i = 0; i < recent.length; i++) {
    text(leftMargin, by1 + 1 + i, fg(recent[i].color || COLORS.GRAY), pad(recent[i].text, width - leftMargin));
  }
  const inputY = height - 1;
  if (input !== null) {
    text(leftMargin, inputY, fg(COLORS.CYAN), `Say: ${input}_`.slice(-width));
  } else {
    text(leftMargin, inputY, fg(COLORS.DARK), "WASD move/attack · 1-3 skills · H potion · T chat · ? help");
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
