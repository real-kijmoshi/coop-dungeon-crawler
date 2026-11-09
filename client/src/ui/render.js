// Full-screen game renderer: map with torchlight, panels, minimap, hotbar,
// message log, floating combat text, toasts and overlays.
const { Screen } = require("./screen");

const COLORS = {
  WHITE: [235, 235, 235],
  GRAY: [140, 140, 150],
  DARK: [80, 80, 90],
  GREEN: [90, 230, 110],
  RED: [255, 80, 80],
  BLUE: [90, 160, 255],
  YELLOW: [255, 215, 60],
  ORANGE: [255, 160, 50],
  CYAN: [110, 220, 255],
  PURPLE: [200, 110, 255],
};

// UI theme
const T = {
  bg: [14, 14, 20],
  panel: [20, 20, 28],
  border: [70, 70, 95],
  borderHi: [120, 120, 160],
  title: [255, 215, 120],
  text: [225, 225, 230],
  muted: [125, 125, 140],
  faint: [70, 70, 85],
  topbar: [28, 26, 42],
  barBg: [40, 40, 52],
};

const SIGHT = 12;
const TILE_W = 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const scale = (c, f) => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];
const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const pad = (str, len) => {
  str = String(str);
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
};
const hash = (x, y) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const hpColor = (hp, max) => {
  const r = max > 0 ? hp / max : 0;
  if (r > 0.6) return [80, 220, 100];
  if (r > 0.3) return [240, 200, 60];
  return [240, 70, 70];
};

const compass = (dx, dy) => {
  if (dx === 0 && dy === 0) return "here";
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  const names = ["→ E", "↘ SE", "↓ S", "↙ SW", "← W", "↖ NW", "↑ N", "↗ NE"];
  return names[Math.round(((a + 360) % 360) / 45) % 8];
};

/** Remembers every tile the player has seen. */
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

const screen = new Screen();
const enterScreen = () => process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
const leaveScreen = () => process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");

// ------------------------------------------------------------------ widgets
const PARTIALS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
// Smooth progress bar using eighth-blocks.
const drawBar = (x, y, w, value, max, color, label) => {
  const r = max > 0 ? clamp(value / max, 0, 1) : 0;
  const total = r * w;
  const full = Math.floor(total);
  const part = Math.floor((total - full) * 8);
  for (let i = 0; i < w; i++) {
    let ch = " ";
    if (i < full) ch = "█";
    else if (i === full && part > 0) ch = PARTIALS[part];
    screen.put(x + i, y, ch, color, T.barBg);
  }
  if (label) {
    const lx = x + Math.max(0, Math.floor((w - label.length) / 2));
    for (let i = 0; i < label.length && i < w; i++) {
      const filled = lx + i - x < full;
      screen.put(lx + i, y, label[i], filled ? [15, 15, 20] : T.text, filled ? color : T.barBg, true);
    }
  }
};

// ---------------------------------------------------------------------- map
const TILE = {
  floor: { bg: [44, 37, 30], fg: [96, 84, 68], chars: " ·" },
  safe: { bg: [26, 50, 34], fg: [70, 130, 90], chars: " ·" },
  corridor: { bg: [40, 40, 56], fg: [70, 70, 92], chars: "  " },
  wall: { fg: [92, 78, 64], bg: [92, 78, 64], chars: "  " },
};

const drawMap = (rect, state, memory, ui) => {
  const { x: rx, y: ry, w: rw, h: rh } = rect;
  const player = state.player;
  const { originX, originY, grid } = state.view;
  const cols = Math.floor(rw / TILE_W);
  const camX = player.x - Math.floor(cols / 2);
  const camY = player.y - Math.floor(rh / 2);
  const offX = rx + Math.floor((rw - cols * TILE_W) / 2);

  const live = (wx, wy) => {
    const row = grid[wy - originY];
    const v = row ? row[wx - originX] : undefined;
    return v === undefined ? null : v;
  };
  const known = (wx, wy) => {
    const v = live(wx, wy);
    return v !== null ? v : memory.get(wx, wy);
  };
  const isOpen = (v) => v !== undefined && v !== null && v !== 0;

  for (let ty = 0; ty < rh; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const wx = camX + tx;
      const wy = camY + ty;
      const sx = offX + tx * TILE_W;
      const sy = ry + ty;
      const lv = live(wx, wy);
      const visible = lv !== null;
      const v = visible ? lv : memory.get(wx, wy);
      if (v === undefined || v === null) {
        screen.put(sx, sy, " ", null, T.bg);
        screen.put(sx + 1, sy, " ", null, T.bg);
        continue;
      }
      let tile;
      if (v === 0) {
        // Only draw walls that touch known open space: rooms get clean outlines.
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) if (isOpen(known(wx + dx, wy + dy))) edge = true;
        }
        if (!edge) {
          screen.put(sx, sy, " ", null, T.bg);
          screen.put(sx + 1, sy, " ", null, T.bg);
          continue;
        }
        tile = TILE.wall;
      } else if (v === -1) tile = TILE.corridor;
      else if (v === memory.safeRoomId) tile = TILE.safe;
      else tile = TILE.floor;

      // Torchlight: bright near you, fading out; remembered tiles are cold and dim.
      let fgc;
      let bgc;
      const jitter = 0.9 + hash(wx, wy) * 0.2;
      if (visible) {
        const d = Math.hypot(wx - player.x, wy - player.y);
        const light = clamp(1.15 - d / (SIGHT + 3), 0.35, 1.1) * jitter;
        const warm = [255, 220, 170];
        fgc = mix(scale(tile.fg, light), warm, 0.08 * light);
        bgc = mix(scale(tile.bg, light), warm, 0.05 * light);
      } else {
        fgc = mix(scale(tile.fg, 0.32 * jitter), [40, 50, 90], 0.35);
        bgc = mix(scale(tile.bg, 0.32 * jitter), [16, 20, 40], 0.4);
      }
      const chars = tile.chars;
      // Walls get a subtle top highlight so they read as raised stone.
      if (v === 0 && isOpen(known(wx, wy + 1))) bgc = mix(bgc, [255, 230, 190], visible ? 0.12 : 0.04);
      screen.put(sx, sy, chars[0], fgc, bgc);
      screen.put(sx + 1, sy, chars[1], fgc, bgc);
    }
  }

  const toScreen = (wx, wy) => {
    const tx = wx - camX;
    const ty = wy - camY;
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rh) return null;
    return { sx: offX + tx * TILE_W, sy: ry + ty };
  };

  for (const item of state.items || []) {
    const p = toScreen(item.x, item.y);
    if (p) screen.put(p.sx, p.sy, item.char, item.color, undefined, true);
  }
  for (const npc of state.npcs || []) {
    const p = toScreen(npc.x, npc.y);
    if (p) {
      screen.put(p.sx, p.sy, npc.char, npc.color, [70, 50, 20], true);
      screen.put(p.sx + 1, p.sy, "$", [255, 215, 0], [70, 50, 20]);
    }
  }
  for (const m of state.monsters || []) {
    const p = toScreen(m.x, m.y);
    if (!p) continue;
    let bg;
    if (m.hit) bg = [200, 200, 200];
    else if (m.frozen) bg = [40, 90, 140];
    else if (m.boss) bg = [90, 20, 20];
    else if (m.elite) bg = [60, 50, 10];
    screen.put(p.sx, p.sy, m.char, m.hit ? [20, 20, 20] : m.color, bg, m.boss || m.elite);
    const r = m.hp / m.maxHp;
    screen.put(p.sx + 1, p.sy, r > 0.75 ? "▇" : r > 0.5 ? "▅" : r > 0.25 ? "▃" : "▁", scale(hpColor(m.hp, m.maxHp), 0.85), bg);
  }

  const drawActor = (p, color, downed, me) => {
    const s = toScreen(p.x, p.y);
    if (!s) return;
    const bg = downed ? [110, 20, 20] : me ? [70, 60, 20] : [20, 50, 70];
    screen.put(s.sx, s.sy, downed ? "%" : "@", downed ? [255, 120, 120] : color, bg, true);
    screen.put(s.sx + 1, s.sy, " ", color, bg);
    if (!me) {
      const tag = (downed ? "✚ " : "") + p.username.slice(0, 10);
      const tagX = s.sx + 1 - Math.floor(tag.length / 2);
      if (s.sy - 1 >= ry) {
        for (let i = 0; i < tag.length; i++) {
          const x = tagX + i;
          if (x >= rx && x < rx + rw) screen.put(x, s.sy - 1, tag[i], downed ? COLORS.RED : color, undefined, true);
        }
      }
    }
  };
  for (const other of state.nearbyPlayers || []) drawActor(other, other.color || COLORS.CYAN, other.downed, false);
  drawActor(player, [255, 230, 120], !!player.downedUntil, true);

  // Floating combat text rising from where it happened.
  const now = Date.now();
  for (const f of ui.floaters) {
    const age = now - f.born;
    const s = toScreen(f.x, f.y);
    if (!s) continue;
    const y = s.sy - 1 - (f.stack || 0) - Math.floor(age / 300);
    if (y < ry) continue;
    const fade = clamp(1.2 - age / 900, 0.4, 1);
    const x = s.sx + 1 - Math.floor(f.text.length / 2);
    for (let i = 0; i < f.text.length; i++) {
      if (x + i >= rx && x + i < rx + rw) screen.put(x + i, y, f.text[i], scale(f.color, fade), undefined, true);
    }
  }

  // Downed banner
  if (player.downedUntil) {
    const secs = Math.max(0, Math.ceil((player.downedUntil - ui.now) / 1000));
    const msg = `  ✚ YOU ARE DOWN — an ally can revive you (${secs}s)  `;
    screen.text(rx + Math.max(0, Math.floor((rw - msg.length) / 2)), ry + 1, msg, [255, 255, 255], [150, 20, 20], true, rw);
  }
};

// ------------------------------------------------------------------ minimap
const drawMinimap = (rect, state, memory) => {
  const { x, y, w, h } = rect;
  const p = state.player;
  const camX = p.x - Math.floor(w / 2);
  const camY = p.y - h; // 2 tiles per row
  const marks = new Map();
  for (const o of state.nearbyPlayers || []) marks.set(`${o.x},${o.y}`, o.color || COLORS.CYAN);
  for (const m of state.monsters || []) if (m.boss) marks.set(`${m.x},${m.y}`, [255, 60, 60]);
  if (state.home) marks.set(`${state.home.x},${state.home.y}`, [80, 220, 120]);
  marks.set(`${p.x},${p.y}`, [255, 230, 80]);
  const colorAt = (wx, wy) => {
    const mk = marks.get(`${wx},${wy}`);
    if (mk) return mk;
    const v = memory.get(wx, wy);
    if (v === undefined || v === 0) return T.panel;
    if (v === -1) return [70, 70, 100];
    if (v === memory.safeRoomId) return [50, 120, 70];
    return [120, 100, 75];
  };
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const wx = camX + col;
      const top = colorAt(wx, camY + row * 2);
      const bottom = colorAt(wx, camY + row * 2 + 1);
      screen.put(x + col, y + row, "▀", top, bottom);
    }
  }
};

// ------------------------------------------------------------------ sidebar
const drawSidebar = (rect, state, memory, ui) => {
  const { x, w } = rect;
  let y = rect.y;
  const bottom = rect.y + rect.h;
  const p = state.player;
  const s = p.stats;
  const inner = w - 4;
  const secs = (until) => Math.max(0, Math.ceil((until - ui.now) / 1000));

  // Character
  const charLines = 7 + (p.buffs.length ? 1 : 0) + (p.combo && p.combo.count >= 2 ? 1 : 0);
  const ch = Math.min(charLines + 2, bottom - y);
  screen.box(x, y, w, ch, { color: T.border, bg: T.panel, title: p.className.toUpperCase(), titleColor: p.classColor, rightTitle: `Lv ${s.level}`, rightColor: T.title });
  let cy = y + 1;
  const row = (fn) => {
    if (cy < y + ch - 1) fn(cy++);
  };
  row((yy) => {
    const n = screen.text(x + 2, yy, p.username, p.classColor, T.panel, true, inner);
    if (p.title) screen.text(x + 3 + n, yy, p.title, T.muted, T.panel, false, inner - n - 1);
  });
  row((yy) => {
    screen.text(x + 2, yy, "HP", T.muted, T.panel);
    drawBar(x + 5, yy, inner - 3, s.hp, s.maxHp, hpColor(s.hp, s.maxHp), `${Math.max(0, s.hp)} / ${s.maxHp}`);
  });
  row((yy) => {
    screen.text(x + 2, yy, "XP", T.muted, T.panel);
    drawBar(x + 5, yy, inner - 3, s.xp, s.xpNext, [90, 140, 255], `${s.xp} / ${s.xpNext}`);
  });
  row((yy) => {
    const atk = p.effAtk !== s.atk ? [120, 255, 140] : T.text;
    const def = p.effDef !== s.def ? [120, 255, 140] : T.text;
    let xx = x + 2;
    const kv = (k, v, c) => {
      xx += screen.text(xx, yy, k + " ", T.muted, T.panel);
      xx += screen.text(xx, yy, String(v), c, T.panel, true) + 2;
    };
    kv("ATK", p.effAtk, atk);
    kv("DEF", p.effDef, def);
    kv("CRIT", `${Math.round(s.crit * 100)}%`, T.text);
    if (xx + 10 < x + w) kv("DGE", `${Math.round(s.dodge * 100)}%`, T.text);
  });
  row((yy) => {
    let xx = x + 2;
    xx += screen.text(xx, yy, "◆ ", [255, 215, 0], T.panel);
    xx += screen.text(xx, yy, s.gold.toLocaleString("en-US"), [255, 215, 0], T.panel, true) + 3;
    xx += screen.text(xx, yy, "! ", [255, 80, 160], T.panel, true);
    xx += screen.text(xx, yy, `${s.potions}`, T.text, T.panel, true) + 3;
    xx += screen.text(xx, yy, "☠ ", T.muted, T.panel);
    screen.text(xx, yy, `${s.kills}`, T.text, T.panel);
  });
  row((yy) => {
    screen.text(x + 2, yy, `Depth ${state.depth}`, [200, 160, 255], T.panel, true);
    screen.text(x + 11, yy, `best ${s.maxDepth}`, T.muted, T.panel);
    if (state.home) {
      const dx = state.home.x - p.x;
      const dy = state.home.y - p.y;
      const txt = p.safe ? "⌂ safe room" : `⌂ ${Math.round(Math.hypot(dx, dy))} ${compass(dx, dy)}`;
      screen.text(x + w - 2 - txt.length, yy, txt, p.safe ? COLORS.GREEN : T.muted, T.panel);
    }
  });
  if (p.combo && p.combo.count >= 2) {
    row((yy) => {
      const t = `COMBO x${p.combo.count}`;
      screen.text(x + 2, yy, t, [255, 170, 40], T.panel, true);
      drawBar(x + 3 + t.length, yy, inner - t.length - 1, p.combo.until - ui.now, 4000, [255, 140, 40]);
    });
  }
  if (p.buffs.length) {
    row((yy) => {
      let xx = x + 2;
      for (const b of p.buffs) {
        const t = ` ${b.name} ${secs(b.until)}s `;
        if (xx + t.length > x + w - 2) break;
        xx += screen.text(xx, yy, t, [20, 30, 40], [110, 210, 230], true) + 1;
      }
    });
  }
  y += ch;

  // Minimap
  const mmH = Math.min(9, bottom - y - 2);
  if (mmH >= 4) {
    screen.box(x, y, w, mmH + 2, { color: T.border, bg: T.panel, title: "MAP", titleColor: T.title });
    drawMinimap({ x: x + 1, y: y + 1, w: w - 2, h: mmH }, state, memory);
    y += mmH + 2;
  }

  // Enemies
  const enemies = (state.monsters || [])
    .map((m) => ({ ...m, d: Math.abs(m.x - p.x) + Math.abs(m.y - p.y) }))
    .sort((a, b) => b.boss - a.boss || a.d - b.d);
  const eh = Math.min(Math.max(1, Math.min(4, enemies.length)) + 2, bottom - y);
  if (eh >= 3) {
    screen.box(x, y, w, eh, { color: T.border, bg: T.panel, title: "ENEMIES", titleColor: [255, 120, 120], rightTitle: enemies.length ? `${enemies.length} in sight` : "", rightColor: T.muted });
    if (!enemies.length) screen.text(x + 2, y + 1, "All quiet...", T.faint, T.panel);
    enemies.slice(0, eh - 2).forEach((m, i) => {
      const yy = y + 1 + i;
      screen.put(x + 2, yy, m.char, m.color, m.boss ? [90, 20, 20] : T.panel, true);
      const nameW = inner - 12;
      const nameColor = m.boss ? [255, 150, 60] : m.elite ? [255, 220, 90] : T.text;
      screen.text(x + 4, yy, pad(m.name + (m.hunting ? " !" : "") + (m.frozen ? " ❄" : ""), nameW), nameColor, T.panel, m.boss || m.elite, nameW);
      drawBar(x + 4 + nameW, yy, 8, m.hp, m.maxHp, hpColor(m.hp, m.maxHp));
    });
    y += eh;
  }

  // Bounties
  const quests = p.quests || [];
  const qh = Math.min(quests.length + 2, bottom - y);
  if (qh >= 3) {
    screen.box(x, y, w, qh, { color: T.border, bg: T.panel, title: "BOUNTIES", titleColor: [255, 190, 110], rightTitle: "J", rightColor: T.faint });
    quests.slice(0, qh - 2).forEach((q, i) => {
      const yy = y + 1 + i;
      const done = q.have >= q.need;
      const prog = q.need > 1 ? `${q.have}/${q.need}` : done ? "✓" : "";
      screen.text(x + 2, yy, done ? "✓" : "◇", done ? COLORS.GREEN : [255, 190, 110], T.panel);
      screen.text(x + 4, yy, pad(q.desc, inner - 2 - prog.length), done ? COLORS.GREEN : T.text, T.panel, false, inner - 3 - prog.length);
      screen.text(x + w - 2 - prog.length, yy, prog, T.muted, T.panel);
    });
    y += qh;
  }

  // Party
  const online = state.online || [];
  const ph = Math.min(online.length + 2, bottom - y);
  if (ph >= 3) {
    screen.box(x, y, w, ph, { color: T.border, bg: T.panel, title: "PARTY", titleColor: COLORS.GREEN, rightTitle: `${online.length} online`, rightColor: T.muted });
    online.slice(0, ph - 2).forEach((o, i) => {
      const yy = y + 1 + i;
      const me = o.username === p.username;
      screen.text(x + 2, yy, pad((me ? "★ " : "  ") + o.username, 13), o.color, T.panel, me, 13);
      screen.text(x + 15, yy, pad(`${o.cls.slice(0, 3)} ${o.level}`, 7), T.muted, T.panel);
      if (o.downed) screen.text(x + 22, yy, "DOWN!", COLORS.RED, T.panel, true);
      else drawBar(x + 22, yy, Math.max(3, w - 24), o.hp, o.maxHp, hpColor(o.hp, o.maxHp));
    });
    y += ph;
  }
  if (y < bottom) screen.fill(x, y, w, bottom - y, T.bg);
};

// ------------------------------------------------------------------- hotbar
const drawHotbar = (rect, state, ui) => {
  const { x, y, w } = rect;
  screen.fill(x, y, w, 1, T.bg);
  const p = state.player;
  const slots = [...(p.skills || [])];
  const slotW = Math.floor(w / (slots.length + 1));
  slots.forEach((sk, i) => {
    const sx = x + i * slotW;
    const locked = p.stats.level < sk.level;
    const remaining = Math.max(0, sk.readyAt - ui.now);
    const ready = !locked && remaining === 0;
    const keyBg = locked ? [40, 40, 50] : ready ? [255, 210, 90] : [90, 90, 110];
    screen.text(sx, y, ` ${sk.key} `, [15, 15, 20], keyBg, true);
    const nameW = slotW - 4;
    if (locked) {
      screen.text(sx + 3, y, pad(` ${sk.name} · Lv${sk.level}`, nameW), T.faint, [24, 24, 32], false, nameW);
    } else if (ready) {
      screen.text(sx + 3, y, pad(` ${sk.name}`, nameW), [255, 240, 200], [60, 52, 30], true, nameW);
    } else {
      // Cooldown fill sweeps across the slot.
      const frac = sk.cooldown ? 1 - remaining / sk.cooldown : 0;
      const label = pad(` ${sk.name} ${Math.ceil(remaining / 1000)}s`, nameW);
      const filled = Math.floor(frac * nameW);
      for (let j = 0; j < nameW; j++) {
        screen.put(sx + 3 + j, y, label[j], T.muted, j < filled ? [50, 50, 70] : [28, 28, 38]);
      }
    }
  });
  const px = x + slots.length * slotW;
  const potW = w - slots.length * slotW;
  screen.text(px, y, " H ", [15, 15, 20], p.stats.potions ? [255, 120, 180] : [60, 40, 50], true);
  screen.text(px + 3, y, pad(` Potion ×${p.stats.potions}`, potW - 3), p.stats.potions ? [255, 200, 230] : T.faint, [45, 25, 38], true, potW - 3);
};

// ---------------------------------------------------------------------- log
const drawLog = (rect, messages, input) => {
  const { x, y, w, h } = rect;
  screen.box(x, y, w, h, { color: T.border, bg: T.panel, title: input !== null ? "CHAT" : "LOG", titleColor: T.title, rightTitle: input !== null ? "Enter send · Esc cancel" : "T chat", rightColor: T.faint });
  const lines = h - 2 - (input !== null ? 1 : 0);
  // Collapse consecutive duplicates: "You hit the Rat for 3. (x4)"
  const collapsed = [];
  for (const m of messages) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.text === m.text) last.count++;
    else collapsed.push({ ...m, count: 1 });
  }
  const recent = collapsed.slice(-lines);
  recent.forEach((m, i) => {
    const age = recent.length - 1 - i;
    const fade = clamp(1 - age * 0.13, 0.45, 1);
    const text = m.count > 1 ? `${m.text} (x${m.count})` : m.text;
    screen.text(x + 2, y + 1 + i, text, scale(m.color || T.muted, fade), T.panel, age === 0, w - 4);
  });
  if (input !== null) {
    const yy = y + h - 2;
    const shown = `› ${input}▌`;
    screen.text(x + 2, yy, shown.slice(-(w - 4)), [140, 220, 255], [30, 34, 50], true, w - 4);
  }
};

// ------------------------------------------------------------------ top bar
const drawTopBar = (rect, state, ui, compact) => {
  const { x, y, w } = rect;
  screen.fill(x, y, w, 1, T.topbar);
  const titleText = compact ? "⚔ CDC" : "⚔ COOP DUNGEON CRAWLER";
  let left = x + 1 + screen.text(x + 1, y, titleText, [255, 215, 120], T.topbar, true) + 2;
  const p = state && state.player;
  const right = w > 110 ? "I items · J journal · L ranks · ? help " : "? help ";
  const rightX = x + w - right.length;

  if (state && state.event) {
    const secs = Math.max(0, Math.ceil((state.event.until - ui.now) / 1000));
    const t = ` ★ ${state.event.name} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} `;
    const pulse = 0.75 + 0.25 * Math.sin(Date.now() / 250);
    const ex = Math.max(left, x + Math.floor((w - t.length) / 2));
    left = ex + screen.text(ex, y, t, [15, 15, 20], scale(state.event.color, pulse), true, rightX - ex - 1) + 1;
  }
  if (p && compact) {
    // No sidebar: show the essentials up here.
    const s = p.stats;
    let xx = left + 1;
    const seg = (str, c, bold = false) => {
      if (xx + str.length < rightX) xx += screen.text(xx, y, str, c, T.topbar, bold) + 2;
    };
    seg(`HP ${Math.max(0, s.hp)}/${s.maxHp}`, hpColor(s.hp, s.maxHp), true);
    seg(`Lv ${s.level}`, p.classColor, true);
    seg(`D${state.depth}`, [200, 160, 255]);
    seg(`◆${s.gold}`, [255, 215, 0]);
    if (p.combo && p.combo.count >= 2) seg(`x${p.combo.count}`, [255, 170, 40], true);
  }
  screen.text(rightX, y, right, T.muted, T.topbar);
};

// ------------------------------------------------------------------ overlays
const drawOverlay = (rect, overlay) => {
  const lines = overlay.lines || [];
  const maxW = rect.w - 2;
  const contentW = Math.max(36, (overlay.title || "").length + 8, (overlay.footer || "").length + 6, ...lines.map((l) => l.text.length + 4));
  const w = Math.min(maxW, contentW);
  const h = Math.min(rect.h - 1, lines.length + 4);
  const x = rect.x + Math.floor((rect.w - w) / 2);
  const y = rect.y + Math.max(0, Math.floor((rect.h - h) / 2));
  // drop shadow
  screen.fill(x + 1, y + 1, w, h, [5, 5, 8]);
  const bg = [24, 22, 34];
  screen.box(x, y, w, h, { color: overlay.color || [255, 200, 110], bg, title: overlay.title, titleColor: overlay.color || [255, 215, 120] });
  for (let i = 0; i < lines.length && i < h - 4; i++) {
    const l = lines[i];
    if (l.bg) screen.fill(x + 1, y + 2 + i, w - 2, 1, l.bg);
    if (l.segments) {
      // multi-colored line: [{ text, color, bold }]
      let xx = x + 2;
      for (const seg of l.segments) {
        xx += screen.text(xx, y + 2 + i, seg.text, seg.color || T.text, l.bg || bg, !!seg.bold, x + w - 2 - xx);
      }
    } else {
      screen.text(x + 2, y + 2 + i, l.text, l.color || T.text, l.bg || bg, !!l.bold, w - 4);
    }
  }
  if (overlay.footer) {
    const f = ` ${overlay.footer} `;
    screen.text(x + Math.max(2, Math.floor((w - f.length) / 2)), y + h - 1, f, [20, 20, 25], overlay.color || [255, 200, 110], true, w - 4);
  }
};

const drawToast = (rect, toast, now) => {
  const age = now - toast.born;
  const text = `  ${toast.text}  `;
  const w = Math.min(rect.w - 4, text.length + 2);
  const x = rect.x + Math.floor((rect.w - w) / 2);
  const y = rect.y + 2;
  const pop = age < 120 ? 1.25 : 1;
  const c = scale(toast.color, Math.min(1.2, pop));
  const bg = scale(toast.color, 0.25);
  screen.box(x, y, w, 3, { color: c, bg });
  screen.text(x + 1 + Math.max(0, Math.floor((w - 2 - text.length) / 2)), y + 1, text, c, bg, true, w - 2);
};

// -------------------------------------------------------------------- frame
const drawGame = (state, memory, ui) => {
  const W = process.stdout.columns || 100;
  const H = process.stdout.rows || 30;
  screen.begin(W, H);
  screen.fill(0, 0, W, H, T.bg);

  const compact = W < 96 || H < 26;
  const sidebarW = compact ? 0 : Math.min(40, Math.max(34, Math.floor(W * 0.3)));
  const logH = H < 26 ? 5 : H < 34 ? 7 : 8;
  const top = 1;
  const mapW = W - sidebarW;
  const mapH = H - top - 1 - logH; // hotbar row + log

  drawTopBar({ x: 0, y: 0, w: W }, state, ui, compact);

  const mapRect = { x: 0, y: top, w: mapW, h: mapH };
  const titleDepth = state && state.player ? `DEPTH ${state.depth}` : "";
  // Pulse the frame red when health is low.
  const p0 = state && state.player;
  const low = p0 && p0.stats.hp > 0 && p0.stats.hp / p0.stats.maxHp < 0.3;
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 160);
  const flashColor = ui.flash || (low ? mix([90, 30, 30], [255, 60, 60], pulse) : T.border);
  screen.box(0, top, mapW, mapH, {
    color: flashColor,
    bg: T.bg,
    title: state && state.player ? (state.player.safe ? "SAFE ROOM" : titleDepth) : "CONNECTING",
    titleColor: state && state.player && state.player.safe ? COLORS.GREEN : [200, 160, 255],
    rightTitle: state && state.player ? `${state.player.x},${state.player.y}` : "",
    rightColor: T.faint,
  });
  const inner = { x: 1, y: top + 1, w: mapW - 2, h: mapH - 2 };

  if (state && state.player && state.view) {
    drawMap(inner, state, memory, ui);
    if (sidebarW) drawSidebar({ x: mapW, y: top, w: sidebarW, h: mapH + 1 + logH }, state, memory, ui);
    drawHotbar({ x: 0, y: top + mapH, w: mapW }, state, ui);
  } else {
    const t = "Entering the dungeon...";
    screen.text(Math.floor((mapW - t.length) / 2), top + Math.floor(mapH / 2), t, T.muted, T.bg);
  }
  drawLog({ x: 0, y: top + mapH + 1, w: mapW, h: logH }, ui.messages, ui.input);

  if (ui.toast && Date.now() - ui.toast.born < 2600) drawToast(inner, ui.toast, Date.now());
  if (ui.overlay) drawOverlay({ x: 0, y: top, w: W, h: H - top }, ui.overlay);

  screen.flush();
};

module.exports = { drawGame, enterScreen, leaveScreen, MapMemory, COLORS, pad, invalidate: () => screen.invalidate() };
