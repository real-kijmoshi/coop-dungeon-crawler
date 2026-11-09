const { framerate } = require("../settings.json");
const { drawGame, enterScreen, leaveScreen } = require("./utils/console");

const KEYS = {
  w: "north",
  W: "north",
  "\u001b[A": "north",
  s: "south",
  S: "south",
  "\u001b[B": "south",
  d: "east",
  D: "east",
  "\u001b[C": "east",
  a: "west",
  A: "west",
  "\u001b[D": "west",
};

const QUIT_KEYS = new Set(["\u001b", "\u0003", "q", "Q"]);

let gameState = null;
const messages = [];
let dirty = true;

const log = (msg) => {
  const time = new Date().toLocaleTimeString();
  messages.push(`[${time}] ${msg}`);
  if (messages.length > 50) messages.shift();
  dirty = true;
};

const setState = (state) => {
  if (!state || !state.player) return;
  gameState = state;
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

  socket.on("kicked", (reason) => exit(1, `Disconnected: ${reason}`));

  socket.on("disconnect", (reason) => {
    if (!exiting) log(`Disconnected (${reason}), reconnecting...`);
  });

  socket.io.on("reconnect", () => log("Reconnected."));

  socket.on("connect_error", (err) => log(`Connection error: ${err.message}`));

  // Ask for the state explicitly too, in case the initial push was missed.
  socket.emit("getGameState", setState);

  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (key) => {
    if (QUIT_KEYS.has(key)) return exit(0, "Bye!");

    const direction = KEYS[key];
    if (!direction || !gameState) return;
    if (!socket.connected) return log("Not connected - cannot move.");

    socket.emit("move", direction, (state) => {
      if (!state) return;
      if (!state.moved) log("You bump into a wall.");
      setState(state);
    });
  });

  process.stdout.on("resize", () => {
    dirty = true;
  });

  const interval = Math.max(10, Math.floor(1000 / (framerate || 20)));
  renderTimer = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    drawGame(gameState, messages);
  }, interval);

  process.on("exit", () => {
    if (!exiting) leaveScreen();
  });
};

module.exports = { start };
