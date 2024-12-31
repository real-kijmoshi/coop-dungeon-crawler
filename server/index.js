const express = require("express");
const app = express();
const bcrypt = require("bcryptjs");
const db = require("better-sqlite3")("users.db");

require("dotenv").config();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
const userTable = db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )
`);
userTable.run();

// Routes
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
    return res.status(401).json({ message: "Invalid username or password." });
  }

  res.status(200).json({ message: "Login successful." });
});

//----------------------------------------------------
//
//                Main game ws server
//
//----------------------------------------------------
const httpServer = require("http").createServer(app);
const { Server } = require("socket.io");
const io = new Server(httpServer);

io.use((socket, next) => {
  const { username, password } = socket.handshake.auth;

  if (!username || !password) {
    next(new Error("Username and password are required."));
  }
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    next(new Error("invalid useranme or password"));
  }

  next();
});

io.on("connection", (socket) => {
  const user = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(socket.handshake.auth.username);
  console.log(user);

  socket.on("disconnect", () => {
    console.log("User disconnected:");
  });
});

// Start server
httpServer.listen(process.env.PORT||3143, () => {
  console.log(`Server running on port ${process.env.PORT||3143}`);
});