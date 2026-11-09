// Static game data: classes, monsters, bosses, loot tables, quests,
// achievements, shrines, world events and progression.

// ------------------------------------------------------------------ classes
// Skill ids are implemented in World.useSkill.
const CLASSES = {
  warrior: {
    name: "Warrior",
    color: [255, 120, 80],
    desc: "Tough front-liner. Lots of HP and armor, holds monsters' attention.",
    base: { maxHp: 42, atk: 5, def: 2 },
    growth: { maxHp: 10, atk: 2, def: 0.7 },
    crit: 0.08,
    dodge: 0.03,
    starter: { slot: "weapon", base: "Sword" },
    skills: [
      { id: "cleave", name: "Cleave", level: 1, cooldown: 5000, desc: "hit every enemy around you" },
      { id: "warcry", name: "War Cry", level: 3, cooldown: 20000, desc: "taunt enemies nearby, +50% DEF 6s" },
      { id: "ironskin", name: "Iron Skin", level: 5, cooldown: 25000, desc: "take 70% less damage for 6s" },
      { id: "berserk", name: "Berserk", level: 8, cooldown: 40000, desc: "+60% ATK and 20% lifesteal for 8s" },
    ],
  },
  rogue: {
    name: "Rogue",
    color: [180, 255, 120],
    desc: "Deadly and slippery. High crit and dodge, burst damage.",
    base: { maxHp: 32, atk: 6, def: 1 },
    growth: { maxHp: 7, atk: 2.5, def: 0.4 },
    crit: 0.2,
    dodge: 0.12,
    starter: { slot: "weapon", base: "Dagger" },
    skills: [
      { id: "backstab", name: "Backstab", level: 1, cooldown: 4000, desc: "2.5x hit, always crits unaware foes" },
      { id: "smoke", name: "Smoke Bomb", level: 3, cooldown: 20000, desc: "vanish: monsters lose you for 4s" },
      { id: "fan", name: "Fan of Knives", level: 5, cooldown: 10000, desc: "hit all enemies within 3 tiles" },
      { id: "shadowstrike", name: "Shadow Strike", level: 8, cooldown: 30000, desc: "teleport to a foe and hit for 4x" },
    ],
  },
  mage: {
    name: "Mage",
    color: [140, 170, 255],
    desc: "Glass cannon. Weak in melee, devastating spells from range.",
    base: { maxHp: 26, atk: 5, def: 0 },
    growth: { maxHp: 6, atk: 2, def: 0.3 },
    crit: 0.1,
    dodge: 0.05,
    starter: { slot: "weapon", base: "Staff" },
    skills: [
      { id: "fireball", name: "Fireball", level: 1, cooldown: 3000, desc: "2x damage to the nearest foe in sight" },
      { id: "frostnova", name: "Frost Nova", level: 3, cooldown: 15000, desc: "freeze and hurt foes within 3 tiles" },
      { id: "chain", name: "Chain Lightning", level: 5, cooldown: 8000, desc: "1.4x to up to 4 foes in sight" },
      { id: "meteor", name: "Meteor", level: 8, cooldown: 35000, desc: "3x to every foe within 6 tiles" },
    ],
  },
  cleric: {
    name: "Cleric",
    color: [255, 240, 150],
    desc: "Healer and undead-slayer. Keeps the whole party alive.",
    base: { maxHp: 34, atk: 4, def: 1 },
    growth: { maxHp: 8, atk: 1.7, def: 0.5 },
    crit: 0.07,
    dodge: 0.05,
    starter: { slot: "weapon", base: "Mace" },
    skills: [
      { id: "heal", name: "Heal", level: 1, cooldown: 5000, desc: "heal the most hurt ally (or you), revives" },
      { id: "smite", name: "Smite", level: 3, cooldown: 5000, desc: "holy strike, 3x vs undead" },
      { id: "sanctuary", name: "Sanctuary", level: 5, cooldown: 30000, desc: "heal & revive party nearby, +DEF" },
      { id: "holynova", name: "Holy Nova", level: 8, cooldown: 20000, desc: "2x to foes within 4, heals allies" },
    ],
  },
};

// ----------------------------------------------------------------- monsters
// ranged: attack range in tiles (needs line of sight), verb: how it attacks
const MONSTERS = [
  { type: "rat", name: "Rat", char: "r", color: [170, 140, 110], hp: 6, atk: 3, def: 0, xp: 3, gold: [0, 2], tier: 0, speed: 2, aggro: 5, verb: "bites" },
  { type: "bat", name: "Bat", char: "b", color: [170, 110, 210], hp: 5, atk: 3, def: 0, xp: 4, gold: [0, 1], tier: 0, speed: 1, aggro: 7, verb: "bites" },
  { type: "slime", name: "Slime", char: "j", color: [120, 230, 200], hp: 10, atk: 3, def: 1, xp: 5, gold: [1, 3], tier: 0, speed: 3, aggro: 4, verb: "splashes" },
  { type: "goblin", name: "Goblin", char: "g", color: [90, 200, 90], hp: 14, atk: 5, def: 1, xp: 9, gold: [2, 6], tier: 1, speed: 2, aggro: 7, verb: "stabs" },
  { type: "spider", name: "Giant Spider", char: "x", color: [200, 80, 80], hp: 12, atk: 6, def: 0, xp: 10, gold: [1, 5], tier: 1, speed: 1, aggro: 6, verb: "bites" },
  { type: "skeleton", name: "Skeleton", char: "s", color: [230, 230, 210], hp: 20, atk: 7, def: 2, xp: 15, gold: [3, 8], tier: 2, speed: 2, aggro: 8, ranged: 4, verb: "shoots an arrow at", undead: true },
  { type: "zombie", name: "Zombie", char: "z", color: [130, 170, 90], hp: 30, atk: 7, def: 1, xp: 16, gold: [2, 7], tier: 2, speed: 3, aggro: 6, verb: "claws", undead: true },
  { type: "orc", name: "Orc", char: "o", color: [210, 120, 50], hp: 32, atk: 9, def: 3, xp: 25, gold: [5, 12], tier: 3, speed: 2, aggro: 8, verb: "smashes" },
  { type: "cultist", name: "Cultist", char: "c", color: [200, 60, 160], hp: 24, atk: 11, def: 2, xp: 28, gold: [6, 14], tier: 3, speed: 2, aggro: 9, ranged: 5, verb: "casts a hex on" },
  { type: "wraith", name: "Wraith", char: "w", color: [120, 200, 255], hp: 30, atk: 12, def: 2, xp: 35, gold: [6, 15], tier: 4, speed: 1, aggro: 10, ranged: 5, verb: "hurls a shadow bolt at", undead: true },
  { type: "golem", name: "Stone Golem", char: "m", color: [170, 160, 150], hp: 70, atk: 12, def: 8, xp: 45, gold: [8, 20], tier: 4, speed: 3, aggro: 6, verb: "pounds" },
  { type: "troll", name: "Troll", char: "t", color: [60, 170, 120], hp: 55, atk: 13, def: 5, xp: 50, gold: [10, 25], tier: 5, speed: 3, aggro: 8, verb: "pummels" },
  { type: "demon", name: "Imp Demon", char: "i", color: [255, 70, 70], hp: 45, atk: 15, def: 4, xp: 60, gold: [12, 28], tier: 6, speed: 1, aggro: 10, ranged: 4, verb: "spits fire at" },
  { type: "drake", name: "Drake", char: "d", color: [255, 100, 40], hp: 80, atk: 16, def: 6, xp: 90, gold: [25, 50], tier: 7, speed: 2, aggro: 10, ranged: 4, verb: "breathes fire at" },
  { type: "lich", name: "Lich", char: "l", color: [190, 120, 255], hp: 90, atk: 20, def: 6, xp: 130, gold: [30, 60], tier: 8, speed: 2, aggro: 11, ranged: 6, verb: "blasts", undead: true },
];

// Spawned only during the Treasure Goblin event: runs away, drops riches.
const TREASURE_GOBLIN = {
  type: "treasure_goblin", name: "Treasure Goblin", char: "$", color: [255, 230, 60],
  hp: 40, atk: 0, def: 2, xp: 40, gold: [80, 160], tier: 0, speed: 1, aggro: 8, verb: "taunts", flees: true,
};

// One lair boss per depth band. Bosses guard a treasure chest.
const BOSSES = [
  { type: "goblin_king", name: "Goblin King", char: "G", color: [140, 255, 80], hp: 70, atk: 8, def: 3, xp: 90, gold: [40, 70], tier: 2, speed: 2, aggro: 9, verb: "cleaves" },
  { type: "bone_lord", name: "Bone Lord", char: "S", color: [255, 255, 230], hp: 100, atk: 10, def: 4, xp: 150, gold: [60, 100], tier: 3, speed: 2, aggro: 9, ranged: 5, verb: "fires a bone spear at", undead: true },
  { type: "orc_warlord", name: "Orc Warlord", char: "O", color: [255, 140, 40], hp: 160, atk: 14, def: 6, xp: 240, gold: [90, 150], tier: 4, speed: 2, aggro: 9, verb: "crushes" },
  { type: "wraith_queen", name: "Wraith Queen", char: "W", color: [160, 220, 255], hp: 150, atk: 17, def: 5, xp: 340, gold: [120, 200], tier: 5, speed: 1, aggro: 11, ranged: 6, verb: "drains the life of", undead: true },
  { type: "troll_chief", name: "Troll Chieftain", char: "T", color: [80, 230, 160], hp: 260, atk: 19, def: 8, xp: 480, gold: [160, 260], tier: 6, speed: 3, aggro: 9, verb: "flattens" },
  { type: "demon_prince", name: "Demon Prince", char: "P", color: [255, 40, 90], hp: 320, atk: 22, def: 9, xp: 700, gold: [250, 400], tier: 7, speed: 1, aggro: 11, ranged: 5, verb: "rains hellfire on" },
  { type: "ancient_dragon", name: "Ancient Dragon", char: "D", color: [255, 50, 20], hp: 550, atk: 26, def: 11, xp: 1500, gold: [600, 1000], tier: 8, speed: 2, aggro: 12, ranged: 5, verb: "engulfs in flames" },
  // The final boss, on the Throne of the Abyss.
  { type: "abyss_lord", name: "Abyss Lord", char: "A", color: [255, 215, 80], hp: 1600, atk: 34, def: 14, xp: 6000, gold: [2000, 3000], tier: 12, speed: 2, aggro: 13, ranged: 6, verb: "unmakes", final: true },
];

// --------------------------------------------------------------- floor items
const ITEMS = {
  gold: { name: "gold", char: "$", color: [255, 215, 0] },
  potion: { name: "healing potion", char: "!", color: [255, 80, 160] },
  heart: { name: "heart crystal", char: "♥", color: [255, 40, 60] },
  chest: { name: "treasure chest", char: "=", color: [230, 170, 60] },
  shrine: { name: "shrine", char: "^", color: [120, 255, 255] },
  gear: { name: "gear", char: "?", color: [255, 255, 255] }, // char/color depend on the item
  lore: { name: "lore scroll", char: "§", color: [240, 220, 170] },
};

// ---------------------------------------------------------------- equipment
const RARITIES = [
  { id: "common", name: "Common", color: [210, 210, 210], affixes: 0, mult: 1, chance: 1 },
  { id: "magic", name: "Magic", color: [100, 150, 255], affixes: 1, mult: 1.15, chance: 0.35 },
  { id: "rare", name: "Rare", color: [255, 230, 70], affixes: 2, mult: 1.3, chance: 0.12 },
  { id: "epic", name: "Epic", color: [200, 100, 255], affixes: 3, mult: 1.5, chance: 0.035 },
  { id: "legendary", name: "Legendary", color: [255, 140, 0], affixes: 4, mult: 1.8, chance: 0.008 },
];

const SLOTS = ["weapon", "armor", "trinket"];
const SLOT_CHARS = { weapon: "/", armor: "]", trinket: '"' };

const ITEM_BASES = {
  weapon: ["Dagger", "Sword", "Axe", "Mace", "Staff", "Spear", "Hammer", "Scythe", "Wand", "Claymore"],
  armor: ["Leather Vest", "Chainmail", "Plate Armor", "Robe", "Brigandine", "Scale Mail", "Cloak"],
  trinket: ["Ring", "Amulet", "Charm", "Talisman", "Idol", "Pendant"],
};

// stat ranges per item level (ilvl = depth + 1). pct stats are fractions.
const AFFIXES = [
  { stat: "atk", prefix: "Sharp", suffix: "of Might", roll: (l) => [1 + l * 0.4, 1 + l * 0.8] },
  { stat: "def", prefix: "Sturdy", suffix: "of the Turtle", roll: (l) => [1 + l * 0.2, 1 + l * 0.4] },
  { stat: "maxHp", prefix: "Hale", suffix: "of the Bear", roll: (l) => [3 + l * 1.5, 6 + l * 3] },
  { stat: "crit", prefix: "Vicious", suffix: "of Precision", roll: () => [0.02, 0.07] },
  { stat: "dodge", prefix: "Nimble", suffix: "of the Fox", roll: () => [0.02, 0.06] },
  { stat: "lifesteal", prefix: "Vampiric", suffix: "of Leeching", roll: () => [0.03, 0.08] },
  { stat: "goldFind", prefix: "Gilded", suffix: "of Greed", roll: () => [0.1, 0.35] },
  { stat: "xpBonus", prefix: "Wise", suffix: "of Wisdom", roll: () => [0.05, 0.2] },
  { stat: "regen", prefix: "Mending", suffix: "of the Troll", roll: (l) => [1, 1 + l * 0.4] },
];

const STAT_LABELS = {
  atk: "ATK",
  def: "DEF",
  maxHp: "HP",
  crit: "crit",
  dodge: "dodge",
  lifesteal: "lifesteal",
  goldFind: "gold find",
  xpBonus: "XP",
  regen: "regen",
};
const PCT_STATS = new Set(["crit", "dodge", "lifesteal", "goldFind", "xpBonus"]);

const LEGENDARY_NAMES = {
  weapon: ["Doombringer", "Whisper of Night", "Dawnbreaker", "The Last Word", "Gutripper", "Starfall", "Widowmaker"],
  armor: ["Aegis of Ages", "Dragonhide Mantle", "Shroud of the Lich", "Bulwark Eternal", "Skin of the Abyss"],
  trinket: ["Eye of the Storm", "Heart of the Mountain", "Ouroboros", "Tear of the Goddess", "Midas' Seal"],
};

// --------------------------------------------------------------------- shop
// Prices scale with how many times you have bought each upgrade.
const SHOP = [
  { id: "potion", name: "Healing potion", price: () => 15 },
  { id: "atk", name: "Whetstone (+1 ATK)", price: (b) => 40 + 25 * b.atk },
  { id: "def", name: "Reinforced plating (+1 DEF)", price: (b) => 60 + 35 * b.def },
  { id: "hp", name: "Vitality tonic (+10 max HP)", price: (b) => 50 + 30 * (b.hp / 10) },
  { id: "gamble", name: "Mystery item (gamble!)", price: (b, lvl) => 60 + 20 * lvl },
  { id: "rebirth", name: "REBIRTH (Lv 15+): restart stronger", price: () => 0 },
];
const REBIRTH_LEVEL = 15;

// ------------------------------------------------------------------ shrines
const SHRINES = [
  { id: "power", name: "Shrine of Power", desc: "+40% ATK", duration: 60000 },
  { id: "fortune", name: "Shrine of Fortune", desc: "double gold", duration: 90000 },
  { id: "wisdom", name: "Shrine of Wisdom", desc: "+50% XP", duration: 90000 },
  { id: "haste", name: "Shrine of Haste", desc: "move twice as fast", duration: 60000 },
  { id: "protection", name: "Shrine of Protection", desc: "+50% DEF", duration: 60000 },
  { id: "vampire", name: "Blood Shrine", desc: "15% lifesteal", duration: 60000 },
];

// ------------------------------------------------------------- world events
const EVENTS = [
  { id: "goldrush", name: "GOLD RUSH", desc: "All gold drops are doubled!", duration: 120000, color: [255, 215, 0] },
  { id: "bloodmoon", name: "BLOOD MOON", desc: "Monsters hit harder, but give +75% XP and drop more loot!", duration: 120000, color: [255, 50, 50] },
  { id: "goblins", name: "TREASURE GOBLINS", desc: "Treasure goblins have appeared! Catch them before they escape!", duration: 90000, color: [255, 230, 60] },
  { id: "frenzy", name: "LOOT FRENZY", desc: "Item drop rate tripled!", duration: 120000, color: [200, 100, 255] },
];
const EVENT_INTERVAL = [6 * 60000, 9 * 60000];

// ------------------------------------------------------------- achievements
// check(player) is evaluated whenever counters change. title: unlocked title.
const ACHIEVEMENTS = [
  { id: "first_blood", name: "First Blood", desc: "Kill a monster", title: "the Novice", check: (p) => p.stats.kills >= 1 },
  { id: "exterminator", name: "Exterminator", desc: "Kill 100 monsters", title: "the Exterminator", check: (p) => p.stats.kills >= 100 },
  { id: "slaughter", name: "Slaughterer", desc: "Kill 1000 monsters", title: "the Butcher", check: (p) => p.stats.kills >= 1000 },
  { id: "rat_catcher", name: "Rat Catcher", desc: "Kill 25 rats", title: "the Rat Catcher", check: (p) => (p.counters.kinds.rat || 0) >= 25 },
  { id: "undead_bane", name: "Undead Bane", desc: "Kill 50 undead", title: "the Gravewarden", check: (p) => (p.counters.undead || 0) >= 50 },
  { id: "boss1", name: "Kingslayer", desc: "Defeat a boss", title: "the Kingslayer", check: (p) => p.stats.bossKills >= 1 },
  { id: "boss10", name: "Champion", desc: "Defeat 10 bosses", title: "the Champion", check: (p) => p.stats.bossKills >= 10 },
  { id: "dragonslayer", name: "Dragonslayer", desc: "Defeat the Ancient Dragon", title: "the Dragonslayer", check: (p) => (p.counters.kinds.ancient_dragon || 0) >= 1 },
  { id: "depth3", name: "Spelunker", desc: "Reach depth 3", title: "the Spelunker", check: (p) => p.stats.maxDepth >= 3 },
  { id: "depth6", name: "Deep Delver", desc: "Reach depth 6", title: "the Deep Delver", check: (p) => p.stats.maxDepth >= 6 },
  { id: "depth10", name: "Abyss Walker", desc: "Reach depth 10", title: "the Abyss Walker", check: (p) => p.stats.maxDepth >= 10 },
  { id: "level5", name: "Adventurer", desc: "Reach level 5", title: "the Adventurer", check: (p) => p.stats.level >= 5 },
  { id: "level10", name: "Veteran", desc: "Reach level 10", title: "the Veteran", check: (p) => p.stats.level >= 10 },
  { id: "level20", name: "Legend", desc: "Reach level 20", title: "the Legend", check: (p) => p.stats.level >= 20 },
  { id: "savior", name: "Guardian Angel", desc: "Revive allies 5 times", title: "the Guardian", check: (p) => (p.counters.revives || 0) >= 5 },
  { id: "rich", name: "Moneybags", desc: "Earn 5000 gold total", title: "the Wealthy", check: (p) => (p.counters.goldEarned || 0) >= 5000 },
  { id: "legendary", name: "Legendary!", desc: "Find a legendary item", title: "the Fortunate", check: (p) => (p.counters.legendaries || 0) >= 1 },
  { id: "combo10", name: "Unstoppable", desc: "Reach a x10 kill combo", title: "the Unstoppable", check: (p) => (p.counters.bestCombo || 0) >= 10 },
  { id: "elites", name: "Elite Hunter", desc: "Kill 20 elites", title: "the Elite Hunter", check: (p) => (p.counters.elites || 0) >= 20 },
  { id: "quests10", name: "Bounty Hunter", desc: "Complete 10 bounties", title: "the Bounty Hunter", check: (p) => (p.counters.quests || 0) >= 10 },
  { id: "goblin", name: "Goblin Mugger", desc: "Catch a treasure goblin", title: "the Mugger", check: (p) => (p.counters.kinds.treasure_goblin || 0) >= 1 },
  { id: "deathless", name: "Survivor", desc: "Reach level 8 without dying", title: "the Undying", check: (p) => p.stats.level >= 8 && p.stats.deaths === 0 },
  { id: "loremaster", name: "Loremaster", desc: "Find every lore scroll", title: "the Loremaster", check: (p) => (p.lore || []).length >= 12 },
  { id: "fellowship", name: "Fellowship", desc: "Defeat a boss in a party of 3+", title: "of the Fellowship", check: (p) => (p.counters.partyBosses || 0) >= 1 },
  { id: "savior10", name: "Lifeline", desc: "Revive allies 25 times", title: "the Lifeline", check: (p) => (p.counters.revives || 0) >= 25 },
  { id: "traveler", name: "Wayfinder", desc: "Discover 6 waystones", title: "the Wayfinder", check: (p) => (p.waystones || []).length >= 6 },
  { id: "smith", name: "Master Smith", desc: "Upgrade an item to +10", title: "the Smith", check: (p) => (p.counters.bestPlus || 0) >= 10 },
  { id: "reborn", name: "Reborn", desc: "Complete a rebirth", title: "the Reborn", check: (p) => (p.prestige || 0) >= 1 },
  { id: "abyss", name: "Abyss Conqueror", desc: "Defeat the Abyss Lord", title: "the Conqueror", check: (p) => (p.counters.kinds.abyss_lord || 0) >= 1 },
];

// ------------------------------------------------------------- progression
const PLAYER_START = { potions: 3 };
const MAX_POTIONS = 9;
const INVENTORY_SIZE = 15;
const TIER_DISTANCE = 13; // tiles from spawn per depth level

const xpToNext = (level) => 20 * level + 12 * level * level;

module.exports = {
  CLASSES,
  MONSTERS,
  TREASURE_GOBLIN,
  BOSSES,
  ITEMS,
  RARITIES,
  SLOTS,
  SLOT_CHARS,
  ITEM_BASES,
  AFFIXES,
  STAT_LABELS,
  PCT_STATS,
  LEGENDARY_NAMES,
  SHOP,
  REBIRTH_LEVEL,
  SHRINES,
  EVENTS,
  EVENT_INTERVAL,
  ACHIEVEMENTS,
  PLAYER_START,
  MAX_POTIONS,
  INVENTORY_SIZE,
  TIER_DISTANCE,
  xpToNext,
};
