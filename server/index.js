require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { createHub } = require("./net/hub");
const { initMap } = require("./utils/map");
const { World } = require("./game/World");

const PORT = process.env.PORT || 3143;

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const db = new Database(path.join(__dirname, "users.db"));

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    gold INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    hp INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    max_depth INTEGER DEFAULT 0,
    boss_kills INTEGER DEFAULT 0,
    prestige INTEGER DEFAULT 0,
    position_x INTEGER DEFAULT -1,
    position_y INTEGER DEFAULT -1,
    cls TEXT,
    title TEXT,
    data TEXT DEFAULT '{}'
  )
`,
).run();

const findUser = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password) VALUES (?, ?)",
);
const savePlayerStmt = db.prepare(`
  UPDATE users SET
    position_x = @x, position_y = @y,
    hp = @hp, level = @level, xp = @xp, gold = @gold,
    kills = @kills, deaths = @deaths,
    max_depth = @maxDepth, boss_kills = @bossKills, prestige = @prestige,
    cls = @cls, title = @title, data = @data
  WHERE id = @id
`);
const savePlayers = db.transaction((players) => {
  for (const p of players) {
    const s = p.stats;
    savePlayerStmt.run({
      id: p.id, x: p.x, y: p.y,
      hp: s.hp, level: s.level, xp: s.xp, gold: s.gold,
      kills: s.kills, deaths: s.deaths, maxDepth: s.maxDepth, bossKills: s.bossKills,
      cls: p.cls, title: p.title, prestige: p.prestige || 0, data: JSON.stringify(world.saveData(p)),
    });
  }
});

const leaderboardStmt = db.prepare(`
  SELECT username, cls, title, prestige, level, max_depth AS maxDepth, kills, boss_kills AS bossKills, deaths
  FROM users WHERE cls IS NOT NULL ORDER BY prestige DESC, level DESC, xp DESC, max_depth DESC LIMIT 10
`);

const checkCredentials = (username, password) => {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const user = findUser.get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) return null;
  return user;
};

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const gameMap = initMap();
const world = new World(gameMap, {
  eventInterval: process.env.EVENT_INTERVAL_MS
    ? [Number(process.env.EVENT_INTERVAL_MS), Number(process.env.EVENT_INTERVAL_MS)]
    : undefined,
});
const sockets = new Map(); // playerId -> socket

let broadcastQueued = false;
const broadcastStates = () => {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    for (const p of world.takeDirtyProfiles()) sockets.get(p.id)?.emit("profile", world.profileFor(p));
    for (const [id, socket] of sockets) {
      const player = world.players.get(id);
      if (player) socket.emit("gameState", world.stateFor(player));
    }
  });
};

world.on("changed", broadcastStates);
world.on("fx", (id, fx) => sockets.get(id)?.emit("fx", fx));
world.on("floater", (f) => {
  for (const [id, socket] of sockets) {
    const p = world.players.get(id);
    if (p && Math.abs(p.x - f.x) <= 20 && Math.abs(p.y - f.y) <= 14) socket.emit("floater", f);
  }
});
world.on("shop", (id, shop) => sockets.get(id)?.emit("shop", shop));
world.on("story", (id) => sockets.get(id)?.emit("story", world.worldInfo().story));
world.on("message", ({ to, text, color }) => {
  const msg = { text, color };
  if (to === null) hub.broadcast("message", msg);
  else sockets.get(to)?.emit("message", msg);
});

const flushPlayers = () => {
  const dirty = world.takeDirtyPlayers();
  if (dirty.length) savePlayers(dirty);
};
setInterval(flushPlayers, 2000);

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

require("./web/routes").register(app, {
  world,
  leaderboard: () => {
    flushPlayers();
    return leaderboardStmt.all();
  },
});

app.post("/register", (req, res) => {
  let { username, password } = req.body || {};
  username = typeof username === "string" ? username.trim() : "";
  if (!username || typeof password !== "string" || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }
  if (!/^[\w-]{1,16}$/.test(username)) {
    return res.status(400).json({
      message: "Username must be 1-16 letters, digits, _ or -.",
    });
  }
  if (findUser.get(username)) {
    return res.status(409).json({ message: "Username already taken." });
  }

  try {
    insertUser.run(username, bcrypt.hashSync(password, 10));
    res.status(201).json({ message: "Registration successful." });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ message: "Error registering user." });
  }
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }
  if (!checkCredentials(username, password)) {
    return res.status(401).json({ message: "Invalid credentials." });
  }
  res.status(200).json({ message: "Login successful." });
});

// ---------------------------------------------------------------------------
// WebSocket connections (see net/hub.js for the protocol)
// ---------------------------------------------------------------------------
const httpServer = http.createServer(app);

const onConnection = (socket) => {
  // Only one session per account: kick the older one.
  const old = sockets.get(socket.user.id);
  if (old) {
    old.emit("kicked", "Logged in from another client.");
    old.disconnect(true);
    const oldPlayer = world.players.get(socket.user.id);
    if (oldPlayer) savePlayers([oldPlayer]);
    world.players.delete(socket.user.id);
  }

  // Re-read the user so stats saved by a previous session are up to date.
  const user = findUser.get(socket.user.username);
  console.log(`User connected: ${user.username}`);

  sockets.set(user.id, socket);
  let data = {};
  try {
    data = JSON.parse(user.data || "{}");
  } catch {
    data = {};
  }
  const player = world.addPlayer(user, data);
  socket.emit("profile", world.profileFor(player));
  socket.emit("message", {
    text: "Welcome! Press ? for help. Visit the Merchant (M) in the safe room to spend gold.",
    color: [255, 255, 120],
  });

  socket.on("getProfile", (callback) => {
    if (typeof callback === "function") callback(world.profileFor(player));
  });

  socket.on("getGameState", (callback) => {
    if (typeof callback === "function") callback(world.stateFor(player));
  });

  socket.on("move", (direction, callback) => {
    const result = world.movePlayer(player, direction);
    if (typeof callback === "function") callback(result);
  });

  socket.on("potion", () => world.drinkPotion(player));

  socket.on("skill", (index) => {
    if (Number.isInteger(index)) world.useSkill(player, index);
  });

  socket.on("party", (action, arg, callback) => {
    const result = world.partyAction(player, action, arg);
    if (typeof callback === "function") callback(result);
  });

  socket.on("ping", () => world.ping(player));

  socket.on("travelOptions", (callback) => {
    if (typeof callback === "function") callback(world.travelOptions(player));
  });

  socket.on("travel", (dest, callback) => {
    const result = world.travel(player, dest);
    if (typeof callback === "function") callback(result);
  });

  socket.on("smith", (action, uid, callback) => {
    const result = world.smith(player, action, uid);
    if (typeof callback === "function") callback(result);
  });

  socket.on("chooseClass", (id, callback) => {
    const result = world.chooseClass(player, id);
    if (typeof callback === "function") callback(result);
  });

  socket.on("inventory", (action, arg, callback) => {
    const result = world.inventoryAction(player, action, arg);
    if (typeof callback === "function") callback(result);
  });

  socket.on("buy", (id, callback) => {
    const result = world.buy(player, id);
    if (typeof callback === "function") callback(result);
  });

  socket.on("leaderboard", (callback) => {
    if (typeof callback !== "function") return;
    flushPlayers();
    callback(leaderboardStmt.all());
  });

  socket.on("chat", (text) => {
    if (typeof text !== "string") return;
    text = text.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 120);
    if (!text) return;
    if (text.startsWith("/p ")) {
      const msg = text.slice(3).trim();
      if (msg) world.partyChat(player, msg);
      return;
    }
    hub.broadcast("message", { text: `<${player.username}> ${text}`, color: [140, 200, 255] });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${user.username}`);
    if (sockets.get(user.id) !== socket) return; // replaced by a newer session
    sockets.delete(user.id);
    const p = world.removePlayer(user.id);
    if (p) savePlayers([p]);
  });
};

const hub = createHub(httpServer, {
  authenticate: ({ username, password }) => checkCredentials(username, password),
  onConnection,
});

const shutdown = () => {
  savePlayers(Array.from(world.players.values()));
  gameMap.saveNow();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
