require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");
const { initMap } = require("./utils/map");

const PORT = process.env.PORT || 3143;
const VISION_RADIUS = 8;
const NEARBY_RANGE = 20;

const db = new Database(path.join(__dirname, "users.db"));
const gameMap = initMap();

// userId -> { socket, player }
const activeGames = new Map();

db.prepare(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    gold INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    hp INTEGER DEFAULT 100,
    position_x INTEGER DEFAULT 50,
    position_y INTEGER DEFAULT 50
  )
`,
).run();

const findUser = db.prepare("SELECT * FROM users WHERE username = ?");
const insertUser = db.prepare(
  "INSERT INTO users (username, password) VALUES (?, ?)",
);
const updatePos = db.prepare(
  "UPDATE users SET position_x = ?, position_y = ? WHERE id = ?",
);

const checkCredentials = (username, password) => {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const user = findUser.get(username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) return null;
  return user;
};

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({ name: "coop-dungeon-crawler", players: activeGames.size });
});

app.post("/register", (req, res) => {
  let { username, password } = req.body || {};
  username = typeof username === "string" ? username.trim() : "";
  if (!username || typeof password !== "string" || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }
  if (username.length > 16) {
    return res
      .status(400)
      .json({ message: "Username must be at most 16 characters." });
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
// Game helpers
// ---------------------------------------------------------------------------
const isWalkable = (x, y) =>
  x >= 0 &&
  y >= 0 &&
  x < gameMap.size &&
  y < gameMap.size &&
  gameMap.grid[x][y] !== 0;

const ensureChunksAround = (x, y) => {
  const { chunkX, chunkY } = gameMap.getChunkCoords(x, y);
  let generated = false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (gameMap.generateChunk(chunkX + dx, chunkY + dy)) generated = true;
    }
  }
  if (generated) gameMap.scheduleSave();
};

// Returns the area around the player. grid[row][col], row = y, col = x.
// Cells are: null (outside map), 0 (wall), -1 (corridor), >0 (room id).
const getVisibleArea = (player) => {
  ensureChunksAround(player.x, player.y);

  const originX = player.x - VISION_RADIUS;
  const originY = player.y - VISION_RADIUS;
  const grid = [];
  for (let y = originY; y <= player.y + VISION_RADIUS; y++) {
    const row = [];
    for (let x = originX; x <= player.x + VISION_RADIUS; x++) {
      if (x >= 0 && x < gameMap.size && y >= 0 && y < gameMap.size) {
        row.push(gameMap.grid[x][y]);
      } else {
        row.push(null);
      }
    }
    grid.push(row);
  }
  return { originX, originY, grid };
};

const publicPlayer = (p) => ({
  id: p.id,
  username: p.username,
  x: p.x,
  y: p.y,
});

const getNearbyPlayers = (me) => {
  const nearby = [];
  for (const [id, { player }] of activeGames) {
    if (id === me.id) continue;
    const distance = Math.hypot(player.x - me.x, player.y - me.y);
    if (distance <= NEARBY_RANGE) nearby.push(publicPlayer(player));
  }
  return nearby;
};

const buildState = (player) => ({
  player,
  map: { width: gameMap.size, height: gameMap.size },
  view: getVisibleArea(player),
  nearbyPlayers: getNearbyPlayers(player),
  online: Array.from(activeGames.values()).map(({ player: p }) => p.username),
});

const broadcastStates = (exceptId) => {
  for (const [id, { socket, player }] of activeGames) {
    if (id === exceptId) continue;
    socket.emit("gameState", buildState(player));
  }
};

const DIRECTIONS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};

const findSpawn = () => {
  const room = gameMap.rooms[0];
  if (room) {
    return {
      x: room.x + Math.floor(room.width / 2),
      y: room.y + Math.floor(room.height / 2),
    };
  }
  const c = Math.floor(gameMap.size / 2);
  return { x: c, y: c };
};

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
  const user = socket.user;
  console.log(`User connected: ${user.username}`);

  // Only one session per account: kick the older one.
  const existing = activeGames.get(user.id);
  if (existing) {
    existing.socket.emit("kicked", "Logged in from another client.");
    existing.socket.disconnect(true);
  }

  let x = user.position_x;
  let y = user.position_y;
  ensureChunksAround(x, y);
  if (!isWalkable(x, y)) {
    ({ x, y } = findSpawn());
    updatePos.run(x, y, user.id);
  }

  const player = {
    id: user.id,
    username: user.username,
    x,
    y,
    stats: {
      hp: user.hp,
      level: user.level,
      xp: user.xp,
      gold: user.gold,
    },
  };

  activeGames.set(user.id, { socket, player });
  socket.emit("gameState", buildState(player));
  broadcastStates(user.id);

  socket.on("getGameState", (callback) => {
    if (typeof callback === "function") callback(buildState(player));
  });

  socket.on("move", (direction, callback) => {
    const delta = DIRECTIONS[direction];
    let moved = false;
    if (delta) {
      const nx = player.x + delta[0];
      const ny = player.y + delta[1];
      if (isWalkable(nx, ny)) {
        player.x = nx;
        player.y = ny;
        updatePos.run(nx, ny, player.id);
        moved = true;
      }
    }

    if (typeof callback === "function") {
      callback({ moved, ...buildState(player) });
    }
    if (moved) broadcastStates(player.id);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${user.username}`);
    const entry = activeGames.get(user.id);
    if (entry && entry.socket === socket) {
      activeGames.delete(user.id);
      broadcastStates();
    }
  });
});

const shutdown = () => {
  gameMap.saveNow();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

httpServer.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
