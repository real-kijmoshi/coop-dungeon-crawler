require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");
const { initMap } = require("./utils/map");
const { World } = require("./game/World");
const { PLAYER_BASE } = require("./game/data");

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
    hp INTEGER DEFAULT ${PLAYER_BASE.maxHp},
    position_x INTEGER DEFAULT -1,
    position_y INTEGER DEFAULT -1
  )
`,
).run();

// Migrate older databases: add any missing stat columns.
const MIGRATIONS = {
  max_hp: `INTEGER DEFAULT ${PLAYER_BASE.maxHp}`,
  atk: `INTEGER DEFAULT ${PLAYER_BASE.atk}`,
  def: `INTEGER DEFAULT ${PLAYER_BASE.def}`,
  potions: `INTEGER DEFAULT ${PLAYER_BASE.potions}`,
  kills: "INTEGER DEFAULT 0",
  deaths: "INTEGER DEFAULT 0",
};
const existingColumns = new Set(
  db.prepare("PRAGMA table_info(users)").all().map((c) => c.name),
);
for (const [col, type] of Object.entries(MIGRATIONS)) {
  if (!existingColumns.has(col)) {
    db.prepare(`ALTER TABLE users ADD COLUMN ${col} ${type}`).run();
  }
}

const findUser = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password) VALUES (?, ?)",
);
const savePlayerStmt = db.prepare(`
  UPDATE users SET
    position_x = @x, position_y = @y,
    hp = @hp, max_hp = @maxHp, atk = @atk, def = @def,
    level = @level, xp = @xp, gold = @gold, potions = @potions,
    kills = @kills, deaths = @deaths
  WHERE id = @id
`);
const savePlayers = db.transaction((players) => {
  for (const p of players) {
    savePlayerStmt.run({ id: p.id, x: p.x, y: p.y, ...p.stats });
  }
});

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
const world = new World(gameMap);
const sockets = new Map(); // playerId -> socket

let broadcastQueued = false;
const broadcastStates = () => {
  if (broadcastQueued) return;
  broadcastQueued = true;
  setImmediate(() => {
    broadcastQueued = false;
    for (const [id, socket] of sockets) {
      const player = world.players.get(id);
      if (player) socket.emit("gameState", world.stateFor(player));
    }
  });
};

world.on("changed", broadcastStates);
world.on("message", ({ to, text, color }) => {
  const msg = { text, color };
  if (to === null) io.emit("message", msg);
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

app.get("/", (req, res) => {
  res.json({ name: "coop-dungeon-crawler", players: world.players.size });
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
// Socket.io
// ---------------------------------------------------------------------------
const httpServer = http.createServer(app);
const io = new Server(httpServer);

io.use((socket, next) => {
  const { username, password } = socket.handshake.auth || {};
  if (!username || !password) {
    return next(new Error("Authentication required"));
  }
  const user = checkCredentials(username, password);
  if (!user) return next(new Error("Invalid credentials"));
  socket.user = user;
  next();
});

io.on("connection", (socket) => {
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
  const player = world.addPlayer(user);
  socket.emit("message", {
    text: "Welcome! Walk into monsters to attack. H drinks a potion, T to chat.",
    color: [255, 255, 120],
  });

  socket.on("getGameState", (callback) => {
    if (typeof callback === "function") callback(world.stateFor(player));
  });

  socket.on("move", (direction, callback) => {
    const result = world.movePlayer(player, direction);
    if (typeof callback === "function") callback(result);
  });

  socket.on("potion", () => world.drinkPotion(player));

  socket.on("chat", (text) => {
    if (typeof text !== "string") return;
    text = text.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 120);
    if (!text) return;
    io.emit("message", { text: `<${player.username}> ${text}`, color: [140, 200, 255] });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${user.username}`);
    if (sockets.get(user.id) !== socket) return; // replaced by a newer session
    sockets.delete(user.id);
    const p = world.removePlayer(user.id);
    if (p) savePlayers([p]);
  });
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
