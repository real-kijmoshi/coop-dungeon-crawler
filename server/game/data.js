// Static game data: monsters, bosses, items, shop, skills and progression.

// ranged: attack range in tiles (needs line of sight), verb: how it attacks
const MONSTERS = [
  { type: "rat", name: "Rat", char: "r", color: [170, 140, 110], hp: 6, atk: 3, def: 0, xp: 3, gold: [0, 2], tier: 0, speed: 2, aggro: 5, verb: "bites" },
  { type: "bat", name: "Bat", char: "b", color: [170, 110, 210], hp: 5, atk: 3, def: 0, xp: 4, gold: [0, 1], tier: 0, speed: 1, aggro: 7, verb: "bites" },
  { type: "goblin", name: "Goblin", char: "g", color: [90, 200, 90], hp: 14, atk: 5, def: 1, xp: 9, gold: [2, 6], tier: 1, speed: 2, aggro: 7, verb: "stabs" },
  { type: "skeleton", name: "Skeleton", char: "s", color: [230, 230, 210], hp: 20, atk: 7, def: 2, xp: 15, gold: [3, 8], tier: 2, speed: 2, aggro: 8, ranged: 4, verb: "shoots an arrow at" },
  { type: "orc", name: "Orc", char: "o", color: [210, 120, 50], hp: 32, atk: 9, def: 3, xp: 25, gold: [5, 12], tier: 3, speed: 2, aggro: 8, verb: "smashes" },
  { type: "wraith", name: "Wraith", char: "w", color: [120, 200, 255], hp: 30, atk: 12, def: 2, xp: 35, gold: [6, 15], tier: 4, speed: 1, aggro: 10, ranged: 5, verb: "hurls a shadow bolt at" },
  { type: "troll", name: "Troll", char: "t", color: [60, 170, 120], hp: 55, atk: 13, def: 5, xp: 50, gold: [10, 25], tier: 5, speed: 3, aggro: 8, verb: "pummels" },
  { type: "drake", name: "Drake", char: "d", color: [255, 100, 40], hp: 80, atk: 16, def: 6, xp: 90, gold: [25, 50], tier: 7, speed: 2, aggro: 10, ranged: 4, verb: "breathes fire at" },
];

// One lair boss per depth band. Bosses guard a treasure chest.
const BOSSES = [
  { type: "goblin_king", name: "Goblin King", char: "G", color: [140, 255, 80], hp: 70, atk: 8, def: 3, xp: 90, gold: [40, 70], tier: 2, speed: 2, aggro: 9, verb: "cleaves" },
  { type: "bone_lord", name: "Bone Lord", char: "S", color: [255, 255, 230], hp: 100, atk: 10, def: 4, xp: 150, gold: [60, 100], tier: 3, speed: 2, aggro: 9, ranged: 5, verb: "fires a bone spear at" },
  { type: "orc_warlord", name: "Orc Warlord", char: "O", color: [255, 140, 40], hp: 160, atk: 14, def: 6, xp: 240, gold: [90, 150], tier: 4, speed: 2, aggro: 9, verb: "crushes" },
  { type: "wraith_queen", name: "Wraith Queen", char: "W", color: [160, 220, 255], hp: 150, atk: 17, def: 5, xp: 340, gold: [120, 200], tier: 5, speed: 1, aggro: 11, ranged: 6, verb: "drains the life of" },
  { type: "troll_chief", name: "Troll Chieftain", char: "T", color: [80, 230, 160], hp: 260, atk: 19, def: 8, xp: 480, gold: [160, 260], tier: 6, speed: 3, aggro: 9, verb: "flattens" },
  { type: "ancient_dragon", name: "Ancient Dragon", char: "D", color: [255, 50, 20], hp: 500, atk: 24, def: 10, xp: 1200, gold: [500, 900], tier: 8, speed: 2, aggro: 12, ranged: 5, verb: "engulfs in flames" },
];

const ITEMS = {
  gold: { name: "gold", char: "$", color: [255, 215, 0] },
  potion: { name: "healing potion", char: "!", color: [255, 80, 160] },
  sword: { name: "sharper blade", char: "/", color: [180, 220, 255] },
  armor: { name: "armor plate", char: "]", color: [160, 160, 220] },
  heart: { name: "heart crystal", char: "♥", color: [255, 40, 60] },
  chest: { name: "treasure chest", char: "=", color: [230, 170, 60] },
};

// Prices scale with your current stats so upgrades stay meaningful.
const SHOP = [
  { id: "potion", name: "Healing potion", price: () => 15 },
  { id: "atk", name: "Whetstone (+1 ATK)", price: (s) => 12 * s.atk },
  { id: "def", name: "Reinforced armor (+1 DEF)", price: (s) => 25 * (s.def + 1) },
  { id: "hp", name: "Vitality tonic (+10 max HP)", price: (s) => 3 * s.maxHp },
];

const SKILLS = [
  { id: "whirlwind", key: "1", name: "Whirlwind", level: 2, cooldown: 6000, desc: "hit every enemy around you" },
  { id: "rally", key: "2", name: "Rally", level: 4, cooldown: 30000, desc: "heal & revive allies nearby" },
  { id: "fireball", key: "3", name: "Fireball", level: 6, cooldown: 9000, desc: "blast the nearest enemy you can see" },
];

const PLAYER_BASE = { maxHp: 30, atk: 5, def: 1, potions: 2 };
const MAX_POTIONS = 9;

// Tiles from spawn per depth level.
const TIER_DISTANCE = 13;

const xpToNext = (level) => 20 * level + 12 * level * level;

module.exports = {
  MONSTERS,
  BOSSES,
  ITEMS,
  SHOP,
  SKILLS,
  PLAYER_BASE,
  MAX_POTIONS,
  TIER_DISTANCE,
  xpToNext,
};
