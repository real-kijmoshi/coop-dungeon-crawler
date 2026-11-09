// Static game data: monsters, items and progression rules.

const MONSTERS = [
  { type: "rat", name: "Rat", char: "r", color: [170, 140, 110], hp: 6, atk: 3, def: 0, xp: 3, gold: [0, 2], tier: 0, speed: 2, aggro: 5 },
  { type: "bat", name: "Bat", char: "b", color: [170, 110, 210], hp: 5, atk: 3, def: 0, xp: 4, gold: [0, 1], tier: 0, speed: 1, aggro: 7 },
  { type: "goblin", name: "Goblin", char: "g", color: [90, 200, 90], hp: 14, atk: 5, def: 1, xp: 9, gold: [2, 6], tier: 1, speed: 2, aggro: 7 },
  { type: "skeleton", name: "Skeleton", char: "s", color: [230, 230, 210], hp: 20, atk: 7, def: 2, xp: 15, gold: [3, 8], tier: 2, speed: 2, aggro: 8 },
  { type: "orc", name: "Orc", char: "o", color: [210, 120, 50], hp: 32, atk: 9, def: 3, xp: 25, gold: [5, 12], tier: 3, speed: 2, aggro: 8 },
  { type: "wraith", name: "Wraith", char: "W", color: [120, 200, 255], hp: 30, atk: 12, def: 2, xp: 35, gold: [6, 15], tier: 4, speed: 1, aggro: 10 },
  { type: "troll", name: "Troll", char: "T", color: [60, 170, 120], hp: 55, atk: 13, def: 5, xp: 50, gold: [10, 25], tier: 5, speed: 3, aggro: 8 },
  { type: "dragon", name: "Dragon", char: "D", color: [255, 60, 30], hp: 120, atk: 18, def: 7, xp: 150, gold: [40, 90], tier: 7, speed: 2, aggro: 10 },
];

const ITEMS = {
  gold: { name: "gold", char: "$", color: [255, 215, 0] },
  potion: { name: "healing potion", char: "!", color: [255, 80, 160] },
  sword: { name: "sharper blade", char: "/", color: [180, 220, 255] },
  armor: { name: "armor plate", char: "]", color: [160, 160, 200] },
  heart: { name: "heart crystal", char: "♥", color: [255, 40, 60] },
};

const PLAYER_BASE = { maxHp: 30, atk: 5, def: 1, potions: 2 };
const MAX_POTIONS = 9;

// Tiles from spawn per difficulty tier.
const TIER_DISTANCE = 12;

const xpToNext = (level) => 12 * level + 8 * level * level;

module.exports = {
  MONSTERS,
  ITEMS,
  PLAYER_BASE,
  MAX_POTIONS,
  TIER_DISTANCE,
  xpToNext,
};
