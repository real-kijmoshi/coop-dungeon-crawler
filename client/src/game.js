const { framerate } = require("../settings.json");
const {
  drawGame,
  enterScreen,
  leaveScreen,
  MapMemory,
  COLORS,
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
const SKILL_KEYS = { 1: "whirlwind", 2: "rally", 3: "fireball" };

const HELP = [
  { text: "Explore an endless dungeon with your friends.", color: COLORS.WHITE },
  { text: "The further from the safe room, the deeper and deadlier it gets.", color: COLORS.WHITE },
  { text: "" },
  { text: "WASD / arrows   move - walk into a monster to attack it", color: COLORS.CYAN },
  { text: "1 2 3           skills (Whirlwind Lv2, Rally Lv4, Fireball Lv6)", color: COLORS.CYAN },
  { text: "H               drink a healing potion", color: COLORS.CYAN },
  { text: "T / Enter       chat           L  leaderboard", color: COLORS.CYAN },
  { text: "?               this help      Q  quit", color: COLORS.CYAN },
  { text: "" },
  { text: "M  Merchant (safe room): spend gold on potions & upgrades", color: COLORS.ORANGE },
  { text: "$ gold  ! potion  / blade  ] armor  ♥ heart  = treasure chest", color: COLORS.YELLOW },
  { text: "Capital letters are BOSSES guarding treasure. Elites are bold.", color: COLORS.ORANGE },
  { text: "" },
  { text: "Co-op: fall in battle near an ally and you go DOWN (%) instead", color: COLORS.GREEN },
  { text: "of dying - they have 20s to walk into you and revive you.", color: COLORS.GREEN },
  { text: "Allies near a kill share its XP. Monsters can't enter the safe room.", color: COLORS.GREEN },
  { text: "Dying drops half your gold where you fell. Go get it back!", color: COLORS.RED },
];

let gameState = null;
const memory = new MapMemory();
const messages = [];
let chatInput = null; // null = not typing
let overlay = null; // { type, title, lines, footer, ... }
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

const showHelp = () => {
  overlay = { type: "help", title: "HOW TO PLAY", lines: HELP, footer: "any key to close" };
  dirty = true;
};

const showShop = (shop, note) => {
  const lines = [
    { text: "\"Welcome, traveller! Gold for steel, steel for glory.\"", color: COLORS.ORANGE },
    { text: "" },
    ...shop.items.map((i) => ({
      text: `[${i.key}] ${i.name.padEnd(30)} ${String(i.price).padStart(5)} g`,
      color: shop.gold >= i.price ? COLORS.WHITE : COLORS.DARK,
    })),
    { text: "" },
    { text: `Your gold: ${shop.gold}`, color: COLORS.YELLOW },
  ];
  if (note) lines.push(note);
  overlay = { type: "shop", title: "MERCHANT", lines, footer: "1-4 buy · Esc close", shop };
  dirty = true;
};

const showLeaderboard = (rows) => {
  const lines = [
    { text: "#  Name             Lv  Depth  Kills  Bosses  Deaths", color: COLORS.GRAY },
    ...rows.map((r, i) => ({
      text: `${String(i + 1).padEnd(2)} ${r.username.padEnd(16)} ${String(r.level).padStart(2)}  ${String(r.maxDepth).padStart(5)}  ${String(r.kills).padStart(5)}  ${String(r.bossKills).padStart(6)}  ${String(r.deaths).padStart(6)}`,
      color: gameState && r.username === gameState.player.username ? COLORS.YELLOW : COLORS.WHITE,
    })),
  ];
  if (!rows.length) lines.push({ text: "No heroes yet." });
  overlay = { type: "leaderboard", title: "HALL OF HEROES", lines, footer: "any key to close" };
  dirty = true;
};

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
  socket.on("message", (msg) => msg && log(msg.text, msg.color));
  socket.on("fx", (type) => {
    flash = type === "levelup" ? COLORS.YELLOW : COLORS.RED;
    flashUntil = Date.now() + (type === "levelup" ? 800 : 180);
    dirty = true;
  });
  socket.on("shop", (shop) => showShop(shop));
  socket.on("kicked", (reason) => exit(1, `Disconnected: ${reason}`));
  socket.on("disconnect", (reason) => {
    if (!exiting) log(`Disconnected (${reason}), reconnecting...`, COLORS.RED);
  });
  socket.io.on("reconnect", () => log("Reconnected.", COLORS.GREEN));
  socket.on("connect_error", (err) => log(`Connection error: ${err.message}`, COLORS.RED));

  socket.emit("getGameState", setState);
  showHelp();

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
    if (overlay.type === "shop" && /^[1-9]$/.test(key)) {
      const item = overlay.shop.items.find((i) => i.key === key);
      if (!item) return;
      socket.emit("buy", item.id, (res) => {
        if (!res) return;
        if (res.ok) showShop(res.shop, { text: `Bought ${item.name}!`, color: COLORS.GREEN });
        else showShop(overlay && overlay.shop ? overlay.shop : { gold: 0, items: [] }, { text: res.message, color: COLORS.RED });
      });
      return;
    }
    overlay = null;
    dirty = true;
  };

  const handleGameKey = (key) => {
    if (key === "\u001b" || key === "q" || key === "Q") return exit(0, "Bye!");
    if (key === "?" || key === "/") return showHelp();
    if (key === "l" || key === "L") {
      socket.emit("leaderboard", (rows) => showLeaderboard(rows || []));
      return;
    }
    if (key === "t" || key === "T" || key === "\r") {
      chatInput = "";
      dirty = true;
      return;
    }
    if (key === "h" || key === "H") return socket.emit("potion");
    if (SKILL_KEYS[key]) return socket.emit("skill", SKILL_KEYS[key]);

    const direction = MOVE_KEYS[key] || MOVE_KEYS[key.toLowerCase()];
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
    // Redraw a few times a second so cooldown / downed timers count down.
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
