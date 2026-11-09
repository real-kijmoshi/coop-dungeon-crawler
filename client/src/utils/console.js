const {
  bottomMargin,
  topMargin,
  leftMargin,
  rightMargin,
} = require("../../const.json");

const COLORS = {
  WHITE: [255, 255, 255],
  GRAY: [110, 110, 110],
  DARK: [60, 60, 60],
  FLOOR: [150, 130, 100],
  CORRIDOR: [100, 100, 130],
  WALL: [90, 70, 60],
  GREEN: [0, 255, 0],
  RED: [255, 60, 60],
  BLUE: [80, 160, 255],
  YELLOW: [255, 220, 0],
};

const RESET = "\x1b[0m";
const fg = (c) => `\x1b[38;2;${c[0]};${c[1]};${c[2]}m`;

// Each map tile is drawn 2 characters wide so it looks roughly square.
const TILE_W = 2;

const TILES = {
  wall: { color: COLORS.WALL, chars: "██" },
  floor: { color: COLORS.FLOOR, chars: " ." },
  corridor: { color: COLORS.CORRIDOR, chars: "░░" },
  unknown: { color: COLORS.DARK, chars: "  " },
};

const tileFor = (cell) => {
  if (cell === null || cell === undefined) return TILES.unknown;
  if (cell === 0) return TILES.wall;
  if (cell === -1) return TILES.corridor;
  return TILES.floor;
};

const screenSize = () => ({
  width: process.stdout.columns || 100,
  height: process.stdout.rows || 30,
});

const enterScreen = () => {
  // Alternate screen buffer + hide cursor.
  process.stdout.write("\x1b[?1049h\x1b[?25l");
};

const leaveScreen = () => {
  process.stdout.write(RESET + "\x1b[?25h\x1b[?1049l");
};

const pad = (str, len) => {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
};

/**
 * Draws the whole frame.
 * @param {object} state  game state received from the server
 * @param {string[]} messages  recent log messages (newest last)
 */
const drawGame = (state, messages = []) => {
  const { width, height } = screenSize();
  const panelWidth = Math.min(rightMargin, Math.max(0, width - 20));
  const viewW = Math.max(4, width - leftMargin - panelWidth);
  const viewH = Math.max(4, height - topMargin - bottomMargin);

  // Inner area (inside the border), in map tiles.
  const innerCols = Math.floor((viewW - 2) / TILE_W);
  const innerRows = viewH - 2;

  // buffer of [colorCode, char] cells
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(new Array(width).fill(null).map(() => [RESET, " "]));
  }
  const put = (x, y, color, ch) => {
    if (x >= 0 && y >= 0 && y < height && x < width) rows[y][x] = [color, ch];
  };
  const text = (x, y, color, str) => {
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

    // Map tiles
    for (let ty = 0; ty < innerRows; ty++) {
      for (let tx = 0; tx < innerCols; tx++) {
        const wx = camX + tx;
        const wy = camY + ty;
        const gy = wy - originY;
        const gx = wx - originX;
        const cell = grid[gy] !== undefined ? grid[gy][gx] : undefined;
        const tile = tileFor(cell);
        const sx = bx0 + 1 + tx * TILE_W;
        const sy = by0 + 1 + ty;
        for (let i = 0; i < TILE_W; i++) {
          put(sx + i, sy, fg(tile.color), tile.chars[i]);
        }
      }
    }

    const drawActor = (p, color) => {
      const tx = p.x - camX;
      const ty = p.y - camY;
      if (tx < 0 || ty < 0 || tx >= innerCols || ty >= innerRows) return;
      const sx = bx0 + 1 + tx * TILE_W;
      const sy = by0 + 1 + ty;
      put(sx, sy, fg(color), "@");
      put(sx + 1, sy, fg(color), " ");
      // name tag above
      const tag = p.username.slice(0, 10);
      const tagX = sx - Math.floor(tag.length / 2) + 1;
      if (sy - 1 > by0) {
        for (let i = 0; i < tag.length; i++) {
          const x = tagX + i;
          if (x > bx0 && x < bx1) put(x, sy - 1, fg(color), tag[i]);
        }
      }
    };

    for (const other of state.nearbyPlayers || []) drawActor(other, COLORS.BLUE);
    drawActor(player, COLORS.YELLOW);
  } else {
    text(bx0 + 2, by0 + 2, fg(COLORS.WHITE), "Waiting for game state...");
  }

  // Side panel
  if (panelWidth > 4) {
    const px = bx1 + 2;
    const w = panelWidth - 3;
    let py = topMargin + 1;
    const line = (str, color = COLORS.WHITE) => {
      if (py < height) text(px, py++, fg(color), pad(str, w));
    };

    line("COOP DUNGEON CRAWLER", COLORS.YELLOW);
    line("");
    if (player) {
      const s = player.stats || {};
      line(`Player: ${player.username}`);
      line(`Pos:    ${player.x}, ${player.y}`, COLORS.GRAY);
      line(`HP:     ${s.hp ?? "-"}`, COLORS.RED);
      line(`Level:  ${s.level ?? "-"}   XP: ${s.xp ?? "-"}`);
      line(`Gold:   ${s.gold ?? "-"}`, COLORS.YELLOW);
      line("");
      const online = state.online || [];
      line(`Online (${online.length}):`, COLORS.GREEN);
      for (const name of online.slice(0, 8)) {
        line(`  ${name === player.username ? "*" : " "} ${name}`);
      }
      if (online.length > 8) line(`   ...and ${online.length - 8} more`);
    }
    line("");
    line("Controls:", COLORS.GREEN);
    line("  W/A/S/D or arrows  move", COLORS.GRAY);
    line("  Q / Esc / Ctrl+C   quit", COLORS.GRAY);
  }

  // Message log at the bottom
  const logLines = Math.max(0, bottomMargin);
  const recent = messages.slice(-logLines);
  for (let i = 0; i < recent.length; i++) {
    const y = by1 + 1 + i;
    if (y < height) text(leftMargin, y, fg(COLORS.GRAY), pad(recent[i], width - leftMargin));
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

module.exports = { drawGame, enterScreen, leaveScreen, COLORS };
