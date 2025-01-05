const { drawUI, setPixel, drawRoom } = require("./utils/console");

const width = process.stdout.columns;
const height = process.stdout.rows - 2;
const camera = { x: 0, y: 0 };
let gameState = {
  player: null,
  room: {
    width: 0,
    height: 0,
    grid: [],
    objects: [],
  },
};

const loadCurrRoom = (account, ws) => {
  console.log("Authenticating and requesting initial game state...");

  ws.socket.auth = {
    username: account.username,
    password: account.password,
  };

  ws.socket.disconnect().connect();

  ws.socket.on("connect", () => {
    console.log("Socket authenticated, requesting game state...");
    ws.socket.emit("getGameState", (state) => {
      if (!state) {
        console.error("Received empty game state");
        return;
      }

      console.log("Initial state received:", {
        playerExists: !!state.player,
        roomWidth: state.room?.width,
        playerPosition: state.player
          ? `${state.player.x},${state.player.y}`
          : "none",
      });

      gameState = state;
      gameState.room.objects = gameState.room.objects || [];
      gameState.room.objects[0] = gameState.player;

      updateCamera(
        gameState.player,
        gameState.room.width,
        gameState.room.height,
      );
      drawRoom(gameState.room, width, height, camera, gameState.player);
    });
  });

  ws.socket.on("connect_error", (error) => {
    console.error("Connection error:", error.message);
  });
};

const updateCamera = (player, roomWidth, roomHeight) => {
  if (!player) {
    console.error("No player data for camera update");
    return;
  }

  const screenWidth = width - 4;
  const screenHeight = height - 4;
  const halfScreenWidth = Math.floor(screenWidth / 2);
  const halfScreenHeight = Math.floor(screenHeight / 2);

  let targetX = Math.max(0, player.x - halfScreenWidth);
  let targetY = Math.max(0, player.y - halfScreenHeight);

  targetX = Math.min(targetX, roomWidth - screenWidth);
  targetY = Math.min(targetY, roomHeight - screenHeight);

  camera.x = Math.max(0, targetX);
  camera.y = Math.max(0, targetY);
};

const handleMove = (direction, ws) => {
  if (!ws.socket.connected) {
    console.error("Socket disconnected - cannot move");
    return;
  }

  ws.socket.emit("move", direction, (newState) => {
    if (!newState) {
      console.error("Move failed - no new state received");
      return;
    }

    console.log("Move successful:", {
      direction,
      newPosition: `${newState.player.x},${newState.player.y}`,
    });

    gameState = newState;
    gameState.room.objects[0] = gameState.player;
    updateCamera(gameState.player, gameState.room.width, gameState.room.height);
    drawRoom(gameState.room, width, height, camera, gameState.player);
  });
};

const start = (account, ws) => {
  if (!ws || !ws.socket) {
    console.error("WebSocket connection not initialized!");
    return;
  }

  if (!account || !account.username || !account.password) {
    console.error("Account credentials required!");
    return;
  }

  console.log("Starting game client for user:", account.username);

  loadCurrRoom(account, ws);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (key) => {
    if (!gameState.player) {
      console.log("Waiting for player initialization... Press ESC to exit.");
      if (key === "\u001B") {
        process.exit(0);
      }
      return;
    }

    let direction = null;
    switch (key) {
      case "\u001B":
        console.log("Exiting game...");
        process.exit(0);
        break;
      case "w":
        direction = "north";
        break;
      case "s":
        direction = "south";
        break;
      case "a":
        direction = "west";
        break;
      case "d":
        direction = "east";
        break;
    }

    if (direction) {
      handleMove(direction, ws);
    }
  });

  ws.socket.on("gameState", (newState) => {
    if (!newState) return;

    gameState = newState;
    gameState.room.objects[0] = gameState.player;
    drawRoom(gameState.room, width, height, camera, gameState.player);
  });

  ws.socket.on("playerMoved", (playerData) => {
    if (gameState.room && gameState.room.objects) {
      const playerIndex = gameState.room.objects.findIndex(
        (obj) => obj.id === playerData.id,
      );
      if (playerIndex > 0) {
        gameState.room.objects[playerIndex] = playerData;
        drawRoom(gameState.room, width, height, camera, gameState.player);
      }
    }
  });
};

module.exports = {
  start,
  loadCurrRoom,
};
