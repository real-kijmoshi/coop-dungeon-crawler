// Text renderers for terminals: the `curl <server>` welcome screen and the
// parrot.live-style `curl <server>/watch` live spectator stream.

const ESC = "\x1b[";
const fg = (c) => `${ESC}38;2;${c[0]};${c[1]};${c[2]}m`;
const bg = (c) => `${ESC}48;2;${c[0]};${c[1]};${c[2]}m`;
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const scale = (c, f) => c.map((v) => clamp(Math.round(v * f), 0, 255));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

const LOGO = [
  "   ___                    ___                                ",
  "  / __|___  ___ _ __     |   \\ _  _ _ _  __ _ ___ ___ _ _   ",
  " | (__/ _ \\/ _ \\ '_ \\    | |) | || | ' \\/ _` / -_) _ \\ ' \\  ",
  "  \\___\\___/\\___/ .__/    |___/ \\_,_|_||_\\__, \\___\\___/_||_| ",
  "               |_|                       |___/              ",
];
const GRADIENT = [[255, 215, 120], [255, 180, 90], [255, 140, 70], [230, 100, 70], [190, 70, 90]];

const hsl = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
};

const center = (text, width) => " ".repeat(Math.max(0, Math.floor((width - text.length) / 2))) + text;

// ----------------------------------------------------------------- welcome
const welcome = ({ base, online, top }) => {
  const W = 72;
  const out = ["", ...LOGO.map((l, i) => BOLD + fg(GRADIENT[i]) + center(l, W) + RESET)];
  const muted = fg([140, 140, 160]);
  const cmd = (c) => bg([30, 30, 44]) + fg([255, 230, 150]) + BOLD + ` ${c} ` + RESET;
  out.push(muted + center("⚔  a co-op terminal dungeon crawler  ⚔", W) + RESET, "");
  out.push(`  ${BOLD}Play now${RESET} ${muted}(macOS / Linux)${RESET}`);
  out.push(`    ${cmd(`curl -fsSL ${base}/play | sh`)}`, "");
  out.push(`  ${BOLD}Play now${RESET} ${muted}(Windows PowerShell)${RESET}`);
  out.push(`    ${cmd(`irm ${base}/play.ps1 | iex`)}`, "");
  out.push(`  ${BOLD}Install${RESET} ${muted}(adds a \`cdc\` command)${RESET}`);
  out.push(`    ${cmd(`curl -fsSL ${base}/install | sh`)}`, "");
  out.push(`  ${BOLD}Watch live${RESET} ${muted}(no install, Ctrl+C to stop)${RESET}`);
  out.push(`    ${cmd(`curl ${base}/watch`)}`, "");
  const dot = online > 0 ? fg([90, 230, 110]) + "●" : fg([120, 120, 130]) + "○";
  out.push(`  ${dot}${RESET} ${online} hero${online === 1 ? "" : "es"} in the dungeon right now`);
  if (top.length) {
    out.push("", `  ${BOLD}${fg([255, 215, 120])}Hall of Heroes${RESET}`);
    top.slice(0, 5).forEach((r, i) => {
      out.push(`   ${muted}${i + 1}.${RESET} ${r.username.padEnd(16)} ${muted}${(r.cls || "").padEnd(8)}${RESET} Lv ${String(r.level).padStart(2)}  ${muted}depth ${r.maxDepth}${RESET}`);
    });
  }
  out.push("", `  ${muted}More at ${base} in your browser.${RESET}`, "");
  return out.join("\n") + "\n";
};

// ---------------------------------------------------------- spectator view
const TILE = {
  floor: { bg: [44, 37, 30], fg: [96, 84, 68], ch: " ·" },
  safe: { bg: [26, 50, 34], fg: [70, 130, 90], ch: " ·" },
  corridor: { bg: [40, 40, 56], fg: [70, 70, 92], ch: "  " },
  wall: { bg: [92, 78, 64], fg: [92, 78, 64], ch: "  " },
};
const BG = [14, 14, 20];

const CLASS_COLORS = {
  warrior: [255, 120, 80],
  rogue: [180, 255, 120],
  mage: [140, 170, 255],
  cleric: [255, 240, 150],
};

/**
 * One frame of the live view, following `target` (a world player) or showing
 * the attract screen when nobody is online.
 * Returns a string that redraws a W x H area from the top-left corner.
 */
const watchFrame = ({ world, target, W, H, tick, base, news, top }) => {
  // grid of [char, fg, bg, bold]
  const cells = Array.from({ length: H }, () => Array.from({ length: W }, () => [" ", [200, 200, 200], BG, false]));
  const put = (x, y, ch, f, b, bold = false) => {
    if (x >= 0 && y >= 0 && x < W && y < H) cells[y][x] = [ch, f, b === undefined ? cells[y][x][2] : b, bold];
  };
  const text = (x, y, str, f, b, bold) => {
    for (let i = 0; i < str.length; i++) put(x + i, y, str[i], f, b, bold);
  };

  const topbar = [28, 26, 42];
  for (let x = 0; x < W; x++) put(x, 0, " ", topbar, topbar);
  text(1, 0, "⚔ COOP DUNGEON CRAWLER · LIVE", [255, 215, 120], topbar, true);
  const blink = tick % 6 < 3;
  text(W - 9, 0, blink ? "● LIVE " : "○ LIVE ", [255, 80, 80], topbar, true);

  const footerY = H - 1;
  for (let x = 0; x < W; x++) put(x, footerY, " ", topbar, topbar);
  const playCmd = `play: curl -fsSL ${base}/play | sh`;
  text(Math.max(1, Math.floor((W - playCmd.length) / 2)), footerY, playCmd, [255, 230, 150], topbar, true);

  if (!target) {
    // Attract mode: rainbow-cycling logo, parrot style.
    const top0 = Math.max(2, Math.floor(H / 2) - 7);
    LOGO.forEach((line, i) => {
      const x0 = Math.floor((W - line.length) / 2);
      for (let j = 0; j < line.length; j++) {
        if (line[j] === " ") continue;
        put(x0 + j, top0 + i, line[j], hsl((tick * 12 + j * 6 + i * 20) % 360, 0.85, 0.62), BG, true);
      }
    });
    const msg = "The dungeon is quiet... be the first hero in!";
    text(Math.floor((W - msg.length) / 2), top0 + LOGO.length + 2, msg, [200, 200, 215], BG, false);
    if (top.length) {
      const t = "Hall of Heroes";
      text(Math.floor((W - t.length) / 2), top0 + LOGO.length + 4, t, [255, 215, 120], BG, true);
      top.slice(0, 3).forEach((r, i) => {
        const line = `${i + 1}. ${r.username} · ${r.cls || "?"} · Lv ${r.level} · depth ${r.maxDepth}`;
        text(Math.floor((W - line.length) / 2), top0 + LOGO.length + 5 + i, line, [170, 170, 190], BG, false);
      });
    }
    return serialize(cells, W, H);
  }

  // Map centered on the target
  const mapTop = 1;
  const mapH = H - 4; // header + 2 news lines + footer
  const cols = Math.floor(W / 2);
  const camX = target.x - Math.floor(cols / 2);
  const camY = target.y - Math.floor(mapH / 2);
  const safeId = world.safeRoomId;
  const open = (x, y) => world.cell(x, y) !== 0;
  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const wx = camX + tx;
      const wy = camY + ty;
      const c = world.cell(wx, wy);
      let t;
      const biome = world.biomeAt(wx, wy);
      if (c === 0) {
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1 && !edge; dx++) if (open(wx + dx, wy + dy)) edge = true;
        if (!edge) continue;
        t = { bg: biome.wall, fg: biome.wall, ch: "  " };
      } else if (c === -1) t = { ...biome.corridor, ch: "  " };
      else if (c === safeId) t = TILE.safe;
      else t = { ...biome.floor, ch: " ·" };
      const d = Math.hypot(wx - target.x, wy - target.y);
      const light = clamp(1.15 - d / 22, 0.3, 1.1);
      const warm = [255, 220, 170];
      const f = mix(scale(t.fg, light), warm, 0.08 * light);
      const b = mix(scale(t.bg, light), warm, 0.05 * light);
      put(tx * 2, mapTop + ty, t.ch[0], f, b);
      put(tx * 2 + 1, mapTop + ty, t.ch[1], f, b);
    }
  }
  const at = (x, y) => {
    const tx = x - camX;
    const ty = y - camY;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= mapH) return null;
    return [tx * 2, mapTop + ty];
  };
  for (const [k, list] of world.items) {
    if (!list.length) continue;
    const [x, y] = k.split(",").map(Number);
    const p = at(x, y);
    if (!p) continue;
    const top = list.find((i) => i.kind === "chest") || list[list.length - 1];
    const ch = top.kind === "gold" ? "$" : top.kind === "potion" ? "!" : top.kind === "chest" ? "=" : top.kind === "shrine" ? "^" : top.kind === "heart" ? "♥" : "*";
    const col = top.kind === "gold" ? [255, 215, 0] : top.kind === "potion" ? [255, 80, 160] : top.kind === "chest" ? [230, 170, 60] : [120, 255, 255];
    put(p[0], p[1], ch, col, undefined, true);
  }
  if (world.merchant) {
    const p = at(world.merchant.x, world.merchant.y);
    if (p) {
      put(p[0], p[1], "M", [255, 200, 120], [70, 50, 20], true);
      put(p[0] + 1, p[1], "$", [255, 215, 0], [70, 50, 20]);
    }
  }
  const now = Date.now();
  for (const m of world.monsters.values()) {
    const p = at(m.x, m.y);
    if (!p) continue;
    const b = now - m.lastHit < 250 ? [200, 200, 200] : m.boss ? [90, 20, 20] : m.elite ? [60, 50, 10] : undefined;
    put(p[0], p[1], m.char, now - m.lastHit < 250 ? [20, 20, 20] : m.color, b, m.boss || m.elite);
  }
  for (const pl of world.players.values()) {
    const p = at(pl.x, pl.y);
    if (!p) continue;
    const col = CLASS_COLORS[pl.cls] || [120, 220, 255];
    const me = pl === target;
    const b = pl.downed ? [110, 20, 20] : me ? [70, 60, 20] : [20, 50, 70];
    put(p[0], p[1], pl.downed ? "%" : "@", me ? [255, 230, 120] : col, b, true);
    put(p[0] + 1, p[1], " ", col, b);
    const tag = pl.username.slice(0, 12);
    if (p[1] - 1 > mapTop) text(p[0] + 1 - Math.floor(tag.length / 2), p[1] - 1, tag, col, undefined, true);
  }

  // Header: who we follow
  const s = target.stats;
  // Header: who we follow, kept between the title and the LIVE badge.
  const who = `▶ ${target.username} · ${world.classOf(target).name} Lv ${s.level} · HP ${Math.max(0, s.hp)}/${s.maxHp} · D${world.tierAt(target.x, target.y)}`;
  const room = W - 32 - 11;
  const clipped = who.length > room ? who.slice(0, room - 1) + "…" : who;
  text(32 + Math.max(0, Math.floor((room - clipped.length) / 2)), 0, clipped, CLASS_COLORS[target.cls] || [225, 225, 230], topbar, true);

  // News lines (latest global announcements)
  const newsTop = H - 3;
  for (let i = 0; i < 2; i++) {
    for (let x = 0; x < W; x++) put(x, newsTop + i, " ", BG, [20, 20, 28]);
    const n = news[news.length - 2 + i];
    if (n) text(1, newsTop + i, n.text.slice(0, W - 2), n.color || [200, 200, 200], [20, 20, 28], i === 1);
  }
  if (world.event) {
    const e = ` ★ ${world.event.name} `;
    text(W - e.length - 1, newsTop, e, [15, 15, 20], world.event.color, true);
  }
  return serialize(cells, W, H);
};

const serialize = (cells, W, H) => {
  let out = `${ESC}H`;
  for (let y = 0; y < H; y++) {
    let lastF = null;
    let lastB = null;
    let lastBold = null;
    let line = "";
    for (let x = 0; x < W; x++) {
      const [ch, f, b, bold] = cells[y][x];
      const fk = f.join();
      const bk = b.join();
      if (fk !== lastF || bk !== lastB || bold !== lastBold) {
        line += RESET + (bold ? BOLD : "") + fg(f) + bg(b);
        lastF = fk;
        lastB = bk;
        lastBold = bold;
      }
      line += ch;
    }
    out += line + RESET + (y < H - 1 ? "\n" : "");
  }
  return out;
};

module.exports = { welcome, watchFrame, ESC, RESET };
