const { framerate } = require("../settings.json");
const {
  drawGame,
  enterScreen,
  leaveScreen,
  MapMemory,
  COLORS,
  pad,
} = require("./utils/console");

const MOVE_KEYS = {
  w: "north",
  "\u001b[A": "north",
  s: "south",
  "\u001b[B": "south",
  d: "east",
  "\u001b[C": "east",
  a: "west",
  "\u001b[D": "west",
};
const UP_KEYS = new Set(["w", "W", "\u001b[A"]);
const DOWN_KEYS = new Set(["s", "S", "\u001b[B"]);

const RARITY_COLORS = {
  common: [210, 210, 210],
  magic: [100, 150, 255],
  rare: [255, 230, 70],
  epic: [200, 100, 255],
  legendary: [255, 140, 0],
};
const STAT_LABELS = {
  atk: "ATK",
  def: "DEF",
  maxHp: "HP",
  crit: "crit",
  dodge: "dodge",
  lifesteal: "lifesteal",
  goldFind: "gold find",
  xpBonus: "XP",
  regen: "regen",
};
const PCT = new Set(["crit", "dodge", "lifesteal", "goldFind", "xpBonus"]);
const fmtStat = (k, v) => (PCT.has(k) ? `${v > 0 ? "+" : ""}${Math.round(v * 100)}% ${STAT_LABELS[k]}` : `${v > 0 ? "+" : ""}${v} ${STAT_LABELS[k]}`);
const fmtStats = (stats) => Object.entries(stats).map(([k, v]) => fmtStat(k, v)).join(", ");

const HELP = [
  { text: "Explore an endless dungeon with your friends. The further from the", color: COLORS.WHITE },
  { text: "safe room, the deeper and deadlier it gets - and the better the loot.", color: COLORS.WHITE },
  { text: "" },
  { text: "WASD / arrows  move - walk into monsters to attack", color: COLORS.CYAN },
  { text: "1 2 3 4        class skills (unlock at Lv 1, 3, 5, 8)", color: COLORS.CYAN },
  { text: "H potion   I inventory   J journal (bounties & achievements)", color: COLORS.CYAN },
  { text: "T chat     L leaderboard   ? help   Q quit", color: COLORS.CYAN },
  { text: "" },
  { text: "M Merchant: upgrades, potions, gambling, sell loot (in the safe room)", color: COLORS.ORANGE },
  { text: "$ gold  ! potion  ♥ heart  = chest  ^ shrine (temporary buff)", color: COLORS.YELLOW },
  { text: "/ ] \" gear - color shows rarity:", color: COLORS.YELLOW },
  { text: "   Common  Magic  Rare  Epic  LEGENDARY", color: RARITY_COLORS.rare },
  { text: "Capital letters are BOSSES guarding treasure. Bold = elite.", color: COLORS.ORANGE },
  { text: "" },
  { text: "Chain kills within 4s for COMBO XP. Finish bounties for big rewards.", color: COLORS.GREEN },
  { text: "Co-op: fall near an ally and you go DOWN (%) - they have 20s to", color: COLORS.GREEN },
  { text: "walk into you and revive you. Allies near a kill share its XP.", color: COLORS.GREEN },
  { text: "Watch for WORLD EVENTS: gold rush, blood moon, treasure goblins!", color: COLORS.RED },
];

let gameState = null;
let profile = null;
const memory = new MapMemory();
const messages = [];
let chatInput = null; // null = not typing
let overlay = null; // { type, title, lines, footer, ... }
let invCursor = 0;
let lastShop = null;
let flash = null;
let flashUntil = 0;
let clockOffset = 0; // server time - local time
let dirty = true;

const log = (text, color = COLORS.GRAY) => {
  messages.push({ text, color });
  if (messages.length > 100) messages.shift();
  dirty = true;
};

const setState = (state) => {
  if (!state || !state.player) return;
  gameState = state;
  if (state.now) clockOffset = state.now - Date.now();
  if (state.safeRoomId !== undefined) memory.safeRoomId = state.safeRoomId;
  memory.remember(state.view);
  dirty = true;
};

// ---------------------------------------------------------------- overlays
const showHelp = () => {
  overlay = { type: "help", title: "HOW TO PLAY", lines: HELP, footer: "any key to close" };
  dirty = true;
};

const showClassSelect = () => {
  const lines = [{ text: "Choose your class. This is permanent for this hero!", color: COLORS.YELLOW }, { text: "" }];
  (profile.classes || []).forEach((c, i) => {
    lines.push({ text: `[${i + 1}] ${c.name.toUpperCase()}  HP ${c.hp}  ATK ${c.atk}  DEF ${c.def}  crit ${Math.round(c.crit * 100)}%  dodge ${Math.round(c.dodge * 100)}%`, color: c.color });
    lines.push({ text: `    ${c.desc}`, color: COLORS.WHITE });
    lines.push({ text: `    ${c.skills.join(", ")}`, color: COLORS.GRAY });
  });
  overlay = { type: "class", title: "CHOOSE YOUR CLASS", lines, footer: "press 1-4" };
  dirty = true;
};

const showShop = (shop, note) => {
  lastShop = shop;
  const lines = [
    { text: "\"Welcome, traveller! Gold for steel, steel for glory.\"", color: COLORS.ORANGE },
    { text: "" },
    ...shop.items.map((i) => ({
      text: `[${i.key}] ${pad(i.name, 30)} ${String(i.price).padStart(5)} g`,
      color: shop.gold >= i.price ? COLORS.WHITE : COLORS.DARK,
    })),
    { text: "[X] Sell all Common & Magic items", color: COLORS.YELLOW },
    { text: "[I] Open inventory to sell single items", color: COLORS.YELLOW },
    { text: "" },
    { text: `Your gold: ${shop.gold}`, color: COLORS.YELLOW },
  ];
  if (note) lines.push(note);
  overlay = { type: "shop", title: "MERCHANT", lines, footer: "1-5 buy · X sell junk · I inventory · Esc close", shop };
  dirty = true;
};

const inventoryEntries = () => {
  if (!profile) return [];
  const eq = ["weapon", "armor", "trinket"].map((slot) => ({ slot, item: profile.equipment[slot], equipped: true }));
  return [...eq, ...profile.inventory.map((item) => ({ slot: item.slot, item, equipped: false }))];
};

const showInventory = (note) => {
  if (!profile) return;
  const entries = inventoryEntries();
  invCursor = Math.max(0, Math.min(invCursor, entries.length - 1));
  const lines = [{ text: "EQUIPPED", color: COLORS.GRAY }];
  // Show a scrolling window of the backpack so it fits small terminals.
  const room = Math.max(3, (process.stdout.rows || 30) - 22);
  const first = Math.max(3, Math.min(invCursor - Math.floor(room / 2), entries.length - room));
  entries.forEach((e, i) => {
    if (i === 3) lines.push({ text: `BACKPACK (${profile.inventory.length}/${profile.inventorySize})${first > 3 ? "  ▲ more" : ""}`, color: COLORS.GRAY });
    if (i >= 3 && (i < first || i >= first + room)) return;
    const cur = i === invCursor ? "▶" : " ";
    const label = e.item ? `${e.item.name}` : "(empty)";
    const tag = e.equipped ? pad(e.slot, 8) : pad(e.slot, 8);
    lines.push({
      text: `${cur} ${tag} ${pad(label, 34)} ${e.item ? "ilvl " + e.item.ilvl : ""}`,
      color: e.item ? RARITY_COLORS[e.item.rarity] : COLORS.DARK,
    });
  });
  if (!profile.inventory.length) lines.push({ text: "  (empty - go find some loot!)", color: COLORS.DARK });

  const sel = entries[invCursor];
  lines.push({ text: "" });
  if (sel && sel.item) {
    const it = sel.item;
    lines.push({ text: `${it.rarity.toUpperCase()} ${it.slot}: ${fmtStats(it.stats)}`, color: RARITY_COLORS[it.rarity] });
    if (!sel.equipped) {
      const cur = profile.equipment[it.slot];
      const keys = new Set([...Object.keys(it.stats), ...Object.keys(cur ? cur.stats : {})]);
      const diff = [...keys]
        .map((k) => [k, Math.round(((it.stats[k] || 0) - ((cur && cur.stats[k]) || 0)) * 100) / 100])
        .filter(([, v]) => v !== 0);
      const txt = diff.length ? diff.map(([k, v]) => fmtStat(k, v)).join(", ") : "same";
      const better = diff.reduce((t, [k, v]) => t + v * (PCT.has(k) ? 50 : k === "maxHp" ? 0.4 : 2), 0) > 0;
      lines.push({ text: `vs equipped: ${txt}`, color: better ? COLORS.GREEN : COLORS.RED });
    }
    lines.push({ text: `Sell value: ${it.value} gold`, color: COLORS.YELLOW });
  }
  if (note) lines.push(note);
  overlay = {
    type: "inventory",
    title: "INVENTORY",
    lines,
    footer: "W/S select · E equip/unequip · X sell · D drop · Esc close",
  };
  dirty = true;
};

const showJournal = () => {
  if (!profile) return;
  const lines = [{ text: "BOUNTIES - always 3 active, new ones appear when you finish one", color: COLORS.ORANGE }];
  for (const q of profile.quests) {
    lines.push({
      text: `  ${q.have >= q.need ? "✓" : "·"} ${pad(q.desc, 34)} ${pad(`${q.have}/${q.need}`, 9)} ${q.reward.gold}g ${q.reward.xp}xp${q.reward.item ? " +item" : ""}`,
      color: COLORS.WHITE,
    });
  }
  lines.push({ text: "" });
  const unlocked = profile.achievements.filter((a) => a.unlocked).length;
  lines.push({ text: `ACHIEVEMENTS ${unlocked}/${profile.achievements.length}   title: ${profile.title || "(none)"}`, color: COLORS.ORANGE });
  // Two columns so all achievements fit; unlocked ones show their title.
  const cell = (a) => pad(`${a.unlocked ? "★" : "·"} ${a.name}: ${a.unlocked ? a.title : a.desc}`, 37);
  const list = profile.achievements;
  const half = Math.ceil(list.length / 2);
  for (let i = 0; i < half; i++) {
    const left = list[i];
    const right = list[i + half];
    const anyUnlocked = left.unlocked || (right && right.unlocked);
    lines.push({
      text: `${cell(left)} ${right ? cell(right) : ""}`,
      color: anyUnlocked ? [255, 120, 255] : COLORS.GRAY,
    });
  }
  overlay = { type: "journal", title: "JOURNAL", lines, footer: "N change title · any key to close" };
  dirty = true;
};

const showLeaderboard = (rows) => {
  const lines = [
    { text: "#  Name           Class     Lv  Depth Kills Bosses  Title", color: COLORS.GRAY },
    ...rows.map((r, i) => ({
      text: `${pad(i + 1, 2)} ${pad(r.username, 14)} ${pad(r.cls || "-", 8)} ${String(r.level).padStart(3)} ${String(r.maxDepth).padStart(5)} ${String(r.kills).padStart(5)} ${String(r.bossKills).padStart(6)}  ${r.title || ""}`,
      color: gameState && r.username === gameState.player.username ? COLORS.YELLOW : COLORS.WHITE,
    })),
  ];
  if (!rows.length) lines.push({ text: "No heroes yet." });
  overlay = { type: "leaderboard", title: "HALL OF HEROES", lines, footer: "any key to close" };
  dirty = true;
};

// --------------------------------------------------------------------- run
const start = (account, ws) => {
  const socket = ws.socket;
  let renderTimer = null;
  let exiting = false;

  const exit = (code = 0, reason) => {
    if (exiting) return;
    exiting = true;
    clearInterval(renderTimer);
    leaveScreen();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    if (reason) console.log(reason);
    socket.disconnect();
    process.exit(code);
  };

  enterScreen();
  log(`Connected to ${account.server} as ${account.username}`);

  socket.on("gameState", setState);
  const onProfile = (p) => {
    if (!p) return;
    profile = p;
    if (!p.cls) showClassSelect();
    else if (overlay && overlay.type === "class") overlay = null;
    if (overlay && overlay.type === "inventory") showInventory();
    if (overlay && overlay.type === "journal") showJournal();
    dirty = true;
  };
  socket.on("profile", onProfile);
  socket.on("message", (msg) => msg && log(msg.text, msg.color));
  socket.on("fx", (type) => {
    flash = type === "hurt" ? COLORS.RED : type === "legendary" ? RARITY_COLORS.legendary : COLORS.YELLOW;
    flashUntil = Date.now() + (type === "hurt" ? 180 : 800);
    dirty = true;
  });
  socket.on("shop", (shop) => showShop(shop));
  socket.on("kicked", (reason) => exit(1, `Disconnected: ${reason}`));
  socket.on("disconnect", (reason) => {
    if (!exiting) log(`Disconnected (${reason}), reconnecting...`, COLORS.RED);
  });
  socket.io.on("reconnect", () => log("Reconnected.", COLORS.GREEN));
  socket.on("connect_error", (err) => log(`Connection error: ${err.message}`, COLORS.RED));

  showHelp();
  socket.emit("getGameState", setState);
  socket.emit("getProfile", onProfile);

  const invAction = (action, arg) =>
    socket.emit("inventory", action, arg, (res) => {
      if (res && !res.ok) {
        if (overlay && overlay.type === "inventory") showInventory({ text: res.message, color: COLORS.RED });
        else log(res.message, COLORS.RED);
      }
    });

  const handleChatKey = (key) => {
    if (key === "\r" || key === "\n") {
      const text = chatInput.trim();
      if (text) socket.emit("chat", text);
      chatInput = null;
    } else if (key === "\u001b") {
      chatInput = null;
    } else if (key === "\u007f" || key === "\b") {
      chatInput = chatInput.slice(0, -1);
    } else if (!key.startsWith("\u001b")) {
      chatInput = (chatInput + key.replace(/[\x00-\x1f\x7f]/g, "")).slice(0, 120);
    }
    dirty = true;
  };

  const handleOverlayKey = (key) => {
    const k = key.toLowerCase();
    switch (overlay.type) {
      case "class": {
        if (key === "q" || key === "Q") return exit(0, "Bye!");
        const c = profile && profile.classes && profile.classes[Number(key) - 1];
        if (c) {
          socket.emit("chooseClass", c.id, (res) => {
            if (res && res.ok) {
              overlay = null;
              showHelp();
            }
          });
        }
        return;
      }
      case "shop": {
        if (/^[1-9]$/.test(key)) {
          const item = overlay.shop.items.find((i) => i.key === key);
          if (!item) return;
          socket.emit("buy", item.id, (res) => {
            if (!res) return;
            if (res.ok) showShop(res.shop, { text: `Bought ${item.name}!`, color: COLORS.GREEN });
            else showShop(lastShop, { text: res.message, color: COLORS.RED });
          });
          return;
        }
        if (k === "x") return invAction("selljunk");
        if (k === "i") {
          invCursor = 3;
          return showInventory();
        }
        break;
      }
      case "inventory": {
        const entries = inventoryEntries();
        const sel = entries[invCursor];
        if (UP_KEYS.has(key)) {
          invCursor = Math.max(0, invCursor - 1);
          return showInventory();
        }
        if (DOWN_KEYS.has(key)) {
          invCursor = Math.min(entries.length - 1, invCursor + 1);
          return showInventory();
        }
        if (k === "e" || key === "\r") {
          if (sel && sel.item) invAction(sel.equipped ? "unequip" : "equip", sel.equipped ? sel.slot : sel.item.uid);
          return;
        }
        if (k === "x") {
          if (sel && sel.item && !sel.equipped) invAction("sell", sel.item.uid);
          return;
        }
        if (k === "d") {
          if (sel && sel.item && !sel.equipped) invAction("drop", sel.item.uid);
          return;
        }
        if (k === "i" || key === "\u001b" || k === "q") break;
        return;
      }
      case "journal":
        if (k === "n") return invAction("title");
        break;
    }
    overlay = null;
    dirty = true;
  };

  const handleGameKey = (key) => {
    const k = key.toLowerCase();
    if (key === "\u001b" || k === "q") return exit(0, "Bye!");
    if (key === "?" || key === "/") return showHelp();
    if (k === "l") return socket.emit("leaderboard", (rows) => showLeaderboard(rows || []));
    if (k === "i") {
      invCursor = profile && profile.inventory.length ? 3 : 0;
      return showInventory();
    }
    if (k === "j") return showJournal();
    if (k === "t" || key === "\r") {
      chatInput = "";
      dirty = true;
      return;
    }
    if (k === "h") return socket.emit("potion");
    if (/^[1-4]$/.test(key)) return socket.emit("skill", Number(key) - 1);

    const direction = MOVE_KEYS[key] || MOVE_KEYS[k];
    if (!direction || !gameState) return;
    if (!socket.connected) return log("Not connected - cannot move.", COLORS.RED);
    socket.emit("move", direction);
  };

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (key) => {
    if (key === "\u0003") return exit(0, "Bye!"); // Ctrl+C always quits
    if (chatInput !== null) handleChatKey(key);
    else if (overlay) handleOverlayKey(key);
    else handleGameKey(key);
  });

  process.stdout.on("resize", () => {
    dirty = true;
  });

  const interval = Math.max(10, Math.floor(1000 / (framerate || 20)));
  let lastClockRedraw = 0;
  renderTimer = setInterval(() => {
    const t = Date.now();
    if (flash && t > flashUntil) {
      flash = null;
      dirty = true;
    }
    if (t - lastClockRedraw > 250) {
      lastClockRedraw = t;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    drawGame(gameState, memory, {
      messages,
      input: chatInput,
      overlay,
      flash,
      now: t + clockOffset,
    });
  }, interval);

  process.on("exit", () => {
    if (!exiting) leaveScreen();
  });
};

module.exports = { start };
