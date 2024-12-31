const settings = require("../settings.json");
const { drawUI, setPixel, drawRoom } = require("./utils/console");
const width = process.stdout.columns;
const height = process.stdout.rows-2;

// Add camera object
const camera = { x: 0, y: 0 };

let room = {
  roomId: 0,
  width: 300,
  height: 60,
  connections: [
    {
      x: 0,
      y: 10,
      roomId: 1,
    },
    {
      x: 20,
      y: 0,
      roomId: 2,
    },
    {
      x: 299,
      y: 30,
      roomId: 3,
    }
  ],
  objects: [
    {
      id: 10,      
      x: 2,
      y: 2,
      color: [255, 0, 0],
      char: "X",
      interactable: false,
    },
    {
      id: 11,
      x: 5,
      y: 5,
      color: [0, 255, 0],
      char: "O",
      interactable: true,
    },
    {
      id: 12,
      x: 230,
      y: 10,
      color: [0, 0, 255],
      char: "P",
      interactable: false,
    },
    {
      id: 13,
      x: 299,
      y: 50,
      color: [255, 255, 0],
      char: "Q",
      interactable: false,
    }
  ]
};

const updateCamera = (player, roomWidth, roomHeight) => {
  const screenWidth = width - 4;  // Accounting for margins
  const screenHeight = height - 4;
  
  // Only start moving camera when player is past half screen
  const halfScreenWidth = Math.floor(screenWidth / 2);
  const halfScreenHeight = Math.floor(screenHeight / 2);
  
  // Calculate target camera position
  let targetX = Math.max(0, player.x - halfScreenWidth);
  let targetY = Math.max(0, player.y - halfScreenHeight);
  
  // Clamp camera to room boundaries
  targetX = Math.min(targetX, roomWidth - screenWidth);
  targetY = Math.min(targetY, roomHeight - screenHeight);
  
  // Update camera position
  camera.x = Math.max(0, targetX);
  camera.y = Math.max(0, targetY);
};

const start = () => {
  // Initial draw
  drawRoom(room, width, height, camera, room.objects[0]);  // Pass player object
  
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (key) => {
    const player = room.objects[0];
    let moved = false;
    
    switch(key) {
      case "\u001B":
        process.exit(0);
      case "w":
        if (player.y > 0) {
          player.y--;
          moved = true;
        }
        break;
      case "s":
        if (player.y < room.height - 1) {
          player.y++;
          moved = true;
        }
        break;
      case "a":
        if (player.x > 0) {
          player.x--;
          moved = true;
        }
        break;
      case "d":
        if (player.x < room.width - 1) {
          player.x++;
          moved = true;
        }
        break;
    }
    
    if (moved) {
      updateCamera(player, room.width, room.height);
      drawRoom(room, width, height, camera, player);
    }
  });
};

module.exports = start;