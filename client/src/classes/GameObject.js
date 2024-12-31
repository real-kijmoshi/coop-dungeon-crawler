/**
 * GameObject class
 * @class
 * 
 */

const { setPixel } = require("../utils/console");

class GameObject {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.color = 'black';
        this.characters = ["█"];
    }

    /**
     * Renders the GameObject
        * @param {number} width - The width of the GameObject
        * @param {number} height - The height of the GameObject
        * @param {startX} startX - The starting x position of the GameObject (excluding the margins)
        * @param {startY} startY - The starting y position of the GameObject (excluding the margins)
    */
    render(width, height, startX, startY) {
        let i = 0;
        for (let y = startY; y < startY + height; y++) {
            for (let x = startX; x < startX + width; x++) {
                setPixel(x, y, this.color, this.characters[i % this.characters.length]);
                i++;
            }
        }
    }
}
