const fs = require('fs');
const path = require('path');

class Grid {
    constructor(cellWidth, cellHeight, size, seed = Date.now()) {
        this.cellWidth = cellWidth;
        this.cellHeight = cellHeight;
        this.size = size;
        this.seed = seed;
        this.rng = this.mulberry32(seed);
        this.rooms = [];
        this.exploredCells = new Set();
        this.playerPosition = { x: 0, y: 0 };
        this.chunkSize = 10;
        this.loadedChunks = new Set();
        this.grid = this.initializeGrid();
    }

    
    initializeGrid() {
        const grid = [];
        for (let i = 0; i < this.size; i++) {
            const row = [];
            for (let j = 0; j < this.size; j++) {
                row.push(0);
            }
            grid.push(row);
        }
        return grid;
    }

    
    mulberry32(seed) {
        return () => {
            seed = seed + 0x6D2B79F5;
            let t = seed;
            t = Math.imul(t ^ t >>> 15, t | 1);
            t ^= t + Math.imul(t ^ t >>> 7, t | 61);
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    
    randomInt(min, max) {
        return Math.floor(this.rng() * (max - min + 1)) + min;
    }

    canPlaceRoom(x, y, width, height) {
        
        const padding = 1;
        if (x - padding < 0 || y - padding < 0 || 
            x + width + padding > this.size || 
            y + height + padding > this.size) {
            return false;
        }

        
        for (let i = x - padding; i < x + width + padding; i++) {
            for (let j = y - padding; j < y + height + padding; j++) {
                if (this.grid[i][j] !== 0) {
                    return false;
                }
            }
        }
        return true;
    }

    placeRoom(x, y, width, height, roomId = this.rooms.length + 1) {
        if (!this.canPlaceRoom(x, y, width, height)) {
            throw new Error("Cannot place room at specified position");
        }

        
        for (let i = x; i < x + width; i++) {
            for (let j = y; j < y + height; j++) {
                this.grid[i][j] = roomId;
            }
        }

        
        this.rooms.push({
            id: roomId,
            x: x,
            y: y,
            width: width,
            height: height
        });

        return roomId;
    }

    connectToNearestRoom(room) {
        let nearestRoom = null;
        let shortestDistance = Infinity;

        
        for (const otherRoom of this.rooms) {
            if (otherRoom.id === room.id) continue;

            const distance = Math.sqrt(
                Math.pow((room.x + room.width/2) - (otherRoom.x + otherRoom.width/2), 2) +
                Math.pow((room.y + room.height/2) - (otherRoom.y + otherRoom.height/2), 2)
            );

            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestRoom = otherRoom;
            }
        }

        if (nearestRoom) {
            this.createCorridor(room, nearestRoom);
        }
    }

    createCorridor(roomA, roomB) {
        
        const startX = Math.floor(roomA.x + roomA.width/2);
        const startY = Math.floor(roomA.y + roomA.height/2);
        const endX = Math.floor(roomB.x + roomB.width/2);
        const endY = Math.floor(roomB.y + roomB.height/2);

        
        const corridorId = -1; 
        
        
        const x1 = Math.min(startX, endX);
        const x2 = Math.max(startX, endX);
        for (let x = x1; x <= x2; x++) {
            if (this.grid[x][startY] === 0) {
                this.grid[x][startY] = corridorId;
            }
        }

        
        const y1 = Math.min(startY, endY);
        const y2 = Math.max(startY, endY);
        for (let y = y1; y <= y2; y++) {
            if (this.grid[endX][y] === 0) {
                this.grid[endX][y] = corridorId;
            }
        }
    }

    
    getChunkCoords(x, y) {
        return {
            chunkX: Math.floor(x / this.chunkSize),
            chunkY: Math.floor(y / this.chunkSize)
        };
    }

    
    getChunkId(chunkX, chunkY) {
        return `${chunkX},${chunkY}`;
    }

    
    generateChunk(chunkX, chunkY) {
        const chunkId = this.getChunkId(chunkX, chunkY);
        if (this.loadedChunks.has(chunkId)) return;

        
        const chunkSeed = this.seed + chunkX * 10000 + chunkY;
        const chunkRng = this.mulberry32(chunkSeed);

        const startX = chunkX * this.chunkSize;
        const startY = chunkY * this.chunkSize;

        
        const numRooms = Math.floor(chunkRng() * 3) + 1;
        
        for (let i = 0; i < numRooms; i++) {
            const width = Math.floor(chunkRng() * 4) + 3;
            const height = Math.floor(chunkRng() * 4) + 3;
            const x = startX + Math.floor(chunkRng() * (this.chunkSize - width));
            const y = startY + Math.floor(chunkRng() * (this.chunkSize - height));

            try {
                this.placeRoom(x, y, width, height);
                if (this.rooms.length > 1) {
                    this.connectToNearestRoom(this.rooms[this.rooms.length - 1]);
                }
            } catch (error) {
                continue;
            }
        }

        this.loadedChunks.add(chunkId);
    }

    movePlayer(newX, newY) {
        
        if (newX < 0 || newY < 0 || newX >= this.size || newY >= this.size) {
            return false;
        }

        
        const { chunkX, chunkY } = this.getChunkCoords(newX, newY);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                this.generateChunk(chunkX + dx, chunkY + dy);
            }
        }

        
        this.playerPosition = { x: newX, y: newY };

        
        const visionRange = 3;
        for (let dx = -visionRange; dx <= visionRange; dx++) {
            for (let dy = -visionRange; dy <= visionRange; dy++) {
                const exploreX = newX + dx;
                const exploreY = newY + dy;
                if (exploreX >= 0 && exploreY >= 0 && exploreX < this.size && exploreY < this.size) {
                    this.exploredCells.add(`${exploreX},${exploreY}`);
                }
            }
        }

        return true;
    }

    saveToFile(filepath) {
        const gameState = {
            cellWidth: this.cellWidth,
            cellHeight: this.cellHeight,
            size: this.size,
            seed: this.seed,
            grid: this.grid,
            rooms: this.rooms,
            playerPosition: this.playerPosition,
            exploredCells: Array.from(this.exploredCells),
            loadedChunks: Array.from(this.loadedChunks)
        };

        try {
            fs.writeFileSync(filepath, JSON.stringify(gameState, null, 2));
            return true;
        } catch (error) {
            console.error('Failed to save game:', error);
            return false;
        }
    }

    loadFromFile(filepath) {
        try {
            const data = fs.readFileSync(filepath, 'utf8');
            const gameState = JSON.parse(data);
            
            
            this.cellWidth = gameState.cellWidth;
            this.cellHeight = gameState.cellHeight;
            this.size = gameState.size;
            this.seed = gameState.seed;
            this.grid = gameState.grid;
            this.rooms = gameState.rooms;
            this.playerPosition = gameState.playerPosition;
            this.exploredCells = new Set(gameState.exploredCells);
            this.loadedChunks = new Set(gameState.loadedChunks);
            this.rng = this.mulberry32(this.seed);
            
            return true;
        } catch (error) {
            console.error('Failed to load game:', error);
            return false;
        }
    }

    
    generateInitialRoom() {
        const centerX = Math.floor(this.size / 2);
        const centerY = Math.floor(this.size / 2);
        const roomWidth = 4;
        const roomHeight = 4;
        
        try {
            this.placeRoom(
                centerX - Math.floor(roomWidth / 2),
                centerY - Math.floor(roomHeight / 2),
                roomWidth,
                roomHeight
            );
            
            
            this.playerPosition = {
                x: centerX,
                y: centerY
            };
            
            
            for (let dx = -2; dx <= 2; dx++) {
                for (let dy = -2; dy <= 2; dy++) {
                    const exploreX = centerX + dx;
                    const exploreY = centerY + dy;
                    if (exploreX >= 0 && exploreY >= 0 && exploreX < this.size && exploreY < this.size) {
                        this.exploredCells.add(`${exploreX},${exploreY}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to generate initial room:', error);
            return false;
        }
        
        return true;
    }
}

const MAP_FILE = path.join(__dirname, 'map.json');

const loadMap = () => {
    try {
        const mapClass = new Grid(20, 20, 100);
        const loaded = mapClass.loadFromFile(MAP_FILE);
        if (!loaded) {
            throw new Error('Failed to load map data');
        }
        console.log('Map loaded successfully');
        return mapClass;
    } catch (error) {
        console.error('Error loading map:', error);
        return createMap(); 
    }
};

const createMap = () => {
    try {
        const mapClass = new Grid(20, 20, 100, Date.now());
        mapClass.generateInitialRoom();
        mapClass.saveToFile(MAP_FILE);
        console.log('New map created successfully');
        return mapClass;
    } catch (error) {
        console.error('Error creating map:', error);
        throw error;
    }
};

const initMap = () => {
    if (fs.existsSync(MAP_FILE)) {
        return loadMap();
    } else {
        return createMap();
    }
};


module.exports = {
    Grid,
    initMap,
    loadMap,
    createMap
};