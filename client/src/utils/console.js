const {
  bottomMargin,
  topMargin,
  leftMargin,
  rightMargin,
} = require("../../const.json");

const COLORS = {
  WHITE: [255, 255, 255],
  BLACK: [0, 0, 0],
  GREEN: [0, 255, 0],
  RED: [255, 0, 0],
  BLUE: [0, 0, 255],
  YELLOW: [255, 255, 0],
};

const colorCache = new Map();

const getColorCode = (color) => {
  if (!color || !Array.isArray(color) || color.length !== 3) {
    color = COLORS.WHITE;
  }

  color = color.map((c) => Number(c) || 0);

  const key = color.join(",");
  if (!colorCache.has(key)) {
    colorCache.set(key, `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`);
  }
  return colorCache.get(key);
};

let buffer = [];

const drawRoom = (room, width, height, camera, player) => {
  if (!room || !Array.isArray(room.objects)) {
    console.error("Invalid room data");
    return;
  }

  if (buffer.length !== height) {
    buffer = Array(height);
    for (let i = 0; i < height; i++) {
      buffer[i] = new Array(width).fill(" ");
    }
  } else {
    for (let y = 0; y < height; y++) {
      buffer[y].fill(" ");
    }
  }

  const visibleWidth = width - leftMargin - rightMargin;
  const visibleHeight = height - topMargin - bottomMargin;

  const screenCenterX = Math.floor(visibleWidth / 2);
  const screenCenterY = Math.floor(visibleHeight / 2);

  const targetCameraX = Math.max(
    0,
    Math.min(player.x - screenCenterX, room.width - visibleWidth),
  );
  const targetCameraY = Math.max(
    0,
    Math.min(player.y - screenCenterY, room.height - visibleHeight),
  );

  camera.x = targetCameraX;
  camera.y = targetCameraY;

  const whiteColor = getColorCode(COLORS.WHITE);
  for (let x = 0; x < visibleWidth; x++) {
    buffer[topMargin][x + leftMargin] = whiteColor + "█";
    buffer[height - bottomMargin - 1][x + leftMargin] = whiteColor + "█";
  }
  for (let y = topMargin; y < height - bottomMargin; y++) {
    buffer[y][leftMargin] = whiteColor + "█";
    buffer[y][width - rightMargin - 1] = whiteColor + "█";
  }

  const dotColor = getColorCode(COLORS.BLACK);
  for (let y = topMargin + 1; y < height - bottomMargin - 1; y++) {
    for (let x = leftMargin + 1; x < width - rightMargin - 1; x++) {
      buffer[y][x] = dotColor + "·";
    }
  }

  for (const obj of room.objects) {
    if (!obj || typeof obj.x !== "number" || typeof obj.y !== "number") {
      continue;
    }

    const screenX = obj.x - camera.x + leftMargin;
    const screenY = obj.y - camera.y + topMargin;

    const objColor = obj.color || (obj === player ? COLORS.RED : COLORS.BLUE);
    const objChar = obj.char || "@";

    if (
      screenX >= leftMargin &&
      screenX < width - rightMargin &&
      screenY >= topMargin &&
      screenY < height - bottomMargin
    ) {
      buffer[screenY][screenX] = getColorCode(objColor) + objChar;
    }
  }

  if (Array.isArray(room.connections)) {
    const connectionColor = getColorCode(COLORS.GREEN);
    for (const conn of room.connections) {
      if (!conn || typeof conn.x !== "number" || typeof conn.y !== "number") {
        continue;
      }

      const screenX = conn.x - camera.x + leftMargin;
      const screenY = conn.y - camera.y + topMargin;

      if (
        screenX >= leftMargin &&
        screenX < width - rightMargin &&
        screenY >= topMargin &&
        screenY < height - bottomMargin
      ) {
        buffer[screenY][screenX] = connectionColor + "█";
      }
    }
  }

  process.stdout.write("\x1b[0f");
  process.stdout.write(
    buffer.map((row) => row.join("") + "\x1b[0m").join("\n"),
  );
};

module.exports = { drawRoom };
