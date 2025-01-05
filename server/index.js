const express = require("express");
const app = express();
const bcrypt = require("bcryptjs");
const db = require("better-sqlite3")("users.db");
const { Grid, initMap } = require("./utils/map");
require("dotenv").config();

const gameMap = initMap();

const activeGames = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const userTable = db.prepare(`
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
`);
userTable.run();

app.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  try {
    const insert = db.prepare(
      "INSERT INTO users (username, password) VALUES (?, ?)",
    );
    insert.run(username, hashedPassword);
    res.status(201).json({ message: "User registered successfully." });
  } catch (error) {
    res.status(500).json({ message: "Error registering user." });
  }
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ message: "Invalid credentials." });
  }

  res.status(200).json({ message: "Login successful." });
});

const httpServer = require("http").createServer(app);
const { Server } = require("socket.io");
const io = new Server(httpServer);

io.use((socket, next) => {
  const { username, password } = socket.handshake.auth;

  if (!username || !password) {
    return next(new Error("Authentication required"));
  }

  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return next(new Error("Invalid credentials"));
  }

  socket.user = user;
  next();
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.user.username}`);

  const playerState = {
    id: socket.user.id,
    username: socket.user.username,
    x: socket.user.position_x,
    y: socket.user.position_y,
    stats: {
      hp: socket.user.hp,
      level: socket.user.level,
      xp: socket.user.xp,
      gold: socket.user.gold,
    },
  };

  activeGames.set(socket.user.id, playerState);

  socket.on("getGameState", (callback) => {
    const player = activeGames.get(socket.user.id);
    if (!player) return;

    const visibleArea = getVisibleArea(player);
    const roomState = {
      width: gameMap.size,
      height: gameMap.size,
      grid: visibleArea,
      objects: [player],
    };

    callback({
      player: player,
      room: roomState,
      nearbyPlayers: getNearbyPlayers(player, socket.user.id),
    });
  });

  socket.on("move", (direction, callback) => {
    const player = activeGames.get(socket.user.id);
    if (!player) return;

    const newPosition = calculateNewPosition(player, direction);
    if (isValidMove(newPosition)) {
      player.x = newPosition.x;
      player.y = newPosition.y;
      activeGames.set(socket.user.id, player);

      const updatePos = db.prepare(
        "UPDATE users SET position_x = ?, position_y = ? WHERE id = ?",
      );
      updatePos.run(newPosition.x, newPosition.y, player.id);

      const visibleArea = getVisibleArea(player);
      const roomState = {
        width: gameMap.size,
        height: gameMap.size,
        grid: visibleArea,
        objects: [player],
      };

      const newState = {
        player: player,
        room: roomState,
        nearbyPlayers: getNearbyPlayers(player, player.id),
      };

      callback(newState);

      socket.broadcast.emit("playerMoved", {
        id: player.id,
        username: player.username,
        x: newPosition.x,
        y: newPosition.y,
      });
    }
  });
});

function getVisibleArea(position) {
  const visionRange = 5;
  const { chunkX, chunkY } = gameMap.getChunkCoords(position.x, position.y);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      gameMap.generateChunk(chunkX + dx, chunkY + dy);
    }
  }

  const visibleArea = [];
  for (let y = position.y - visionRange; y <= position.y + visionRange; y++) {
    const row = [];
    for (let x = position.x - visionRange; x <= position.x + visionRange; x++) {
      if (x >= 0 && x < gameMap.size && y >= 0 && y < gameMap.size) {
        row.push(gameMap.grid[x][y]);
      } else {
        row.push(null);
      }
    }
    visibleArea.push(row);
  }

  return visibleArea;
}

function getNearbyPlayers(position, excludeId) {
  const nearbyPlayers = [];
  const range = 10;

  for (const [id, player] of activeGames.entries()) {
    if (id === excludeId) continue;

    const distance = Math.sqrt(
      Math.pow(player.position.x - position.x, 2) +
        Math.pow(player.position.y - position.y, 2),
    );

    if (distance <= range) {
      nearbyPlayers.push({
        id: player.id,
        username: player.username,
        position: player.position,
      });
    }
  }

  return nearbyPlayers;
}

function calculateNewPosition(currentPosition, direction) {
  const newPosition = { ...currentPosition };

  switch (direction) {
    case "north":
      newPosition.y -= 1;
      break;
    case "south":
      newPosition.y += 1;
      break;
    case "east":
      newPosition.x += 1;
      break;
    case "west":
      newPosition.x -= 1;
      break;
  }

  return newPosition;
}

function isValidMove(position) {
  if (
    position.x < 0 ||
    position.x >= gameMap.size ||
    position.y < 0 ||
    position.y >= gameMap.size
  ) {
    return false;
  }

  const cell = gameMap.grid[position.x][position.y];
  return cell !== 0;
}

const PORT = process.env.PORT || 3143;
httpServer.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
