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

let gameState = null;
const memory = new MapMemory();
const messages = [];
let chatInput = null; // null = not typing
let dirty = true;

const log = (text, color = COLORS.GRAY) => {
  messages.push({ text, color });
  if (messages.length > 100) messages.shift();
  dirty = true;
};

const setState = (state) => {
  if (!state || !state.player) return;
  gameState = state;
  memory.remember(state.view);
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
  socket.on("kicked", (reason) => exit(1, `Disconnected: ${reason}`));
  socket.on("disconnect", (reason) => {
    if (!exiting) log(`Disconnected (${reason}), reconnecting...`, COLORS.RED);
  });
  socket.io.on("reconnect", () => log("Reconnected.", COLORS.GREEN));
  socket.on("connect_error", (err) => log(`Connection error: ${err.message}`, COLORS.RED));

  socket.emit("getGameState", setState);

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
      // Strip control characters, keep printable text (also handles paste).
      chatInput = (chatInput + key.replace(/[\x00-\x1f\x7f]/g, "")).slice(0, 120);
    }
    dirty = true;
  };

  const handleGameKey = (key) => {
    if (key === "\u001b" || key === "q" || key === "Q") return exit(0, "Bye!");

    if (key === "t" || key === "T" || key === "\r") {
      chatInput = "";
      dirty = true;
      return;
    }

    if (key === "h" || key === "H") {
      socket.emit("potion");
      return;
    }

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
    else handleGameKey(key);
  });

  process.stdout.on("resize", () => {
    dirty = true;
  });

  const interval = Math.max(10, Math.floor(1000 / (framerate || 20)));
  renderTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    drawGame(gameState, memory, messages, chatInput);
  }, interval);

  process.on("exit", () => {
    if (!exiting) leaveScreen();
  });
};

module.exports = { start };
