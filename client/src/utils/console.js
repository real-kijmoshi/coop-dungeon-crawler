const { bottomMargin, topMargin, leftMargin, rightMargin } = require("../../const.json");

// Pre-calculate ANSI color sequences
const colorCache = new Map();
const getColorCode = (color) => {
    const key = color.join(',');
    if (!colorCache.has(key)) {
        colorCache.set(key, `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`);
    }
    return colorCache.get(key);
};

let buffer = [];

const drawRoom = (room, width, height, camera, player) => {
    if (buffer.length !== height) {
        buffer = Array(height);
        for (let i = 0; i < height; i++) {
            buffer[i] = new Array(width).fill(' ');
        }
    } else {
        for (let y = 0; y < height; y++) {
            buffer[y].fill(' ');
        }
    }

    // Calculate visible area
    const visibleWidth = width - leftMargin - rightMargin;
    const visibleHeight = height - topMargin - bottomMargin;

    // Calculate screen center
    const screenCenterX = Math.floor(visibleWidth / 2);
    const screenCenterY = Math.floor(visibleHeight / 2);

    // Update camera position based on player position
    const targetCameraX = Math.max(0, Math.min(player.x - screenCenterX, room.width - visibleWidth));
    const targetCameraY = Math.max(0, Math.min(player.y - screenCenterY, room.height - visibleHeight));

    // Smooth camera movement
    camera.x = targetCameraX;
    camera.y = targetCameraY;

    // Draw borders
    const whiteColor = getColorCode([255, 255, 255]);
    for (let x = 0; x < visibleWidth; x++) {
        buffer[topMargin][x + leftMargin] = whiteColor + '█';
        buffer[height - bottomMargin - 1][x + leftMargin] = whiteColor + '█';
    }
    for (let y = topMargin; y < height - bottomMargin; y++) {
        buffer[y][leftMargin] = whiteColor + '█';
        buffer[y][width - rightMargin - 1] = whiteColor + '█';
    }

    // Fill interior
    const dotColor = getColorCode([0, 0, 0]);
    for (let y = topMargin + 1; y < height - bottomMargin - 1; y++) {
        for (let x = leftMargin + 1; x < width - rightMargin - 1; x++) {
            buffer[y][x] = dotColor + '·';
        }
    }

    // Draw objects with camera offset
    for (const obj of room.objects) {
        const screenX = obj.x - camera.x + leftMargin;
        const screenY = obj.y - camera.y + topMargin;
        
        if (screenX >= leftMargin && screenX < width - rightMargin &&
            screenY >= topMargin && screenY < height - bottomMargin) {
            buffer[screenY][screenX] = getColorCode(obj.color) + obj.char;
        }
    }

    // Draw connections with camera offset
    const connectionColor = getColorCode([0, 255, 0]);
    for (const conn of room.connections) {
        const screenX = conn.x - camera.x + leftMargin;
        const screenY = conn.y - camera.y + topMargin;
        
        if (screenX >= leftMargin && screenX < width - rightMargin &&
            screenY >= topMargin && screenY < height - bottomMargin) {
            buffer[screenY][screenX] = connectionColor + '█';
        }
    }

    // Output the buffer
    process.stdout.write('\x1b[0f');
    process.stdout.write(buffer.map(row => row.join('') + '\x1b[0m').join('\n'));
};

module.exports = { drawRoom };