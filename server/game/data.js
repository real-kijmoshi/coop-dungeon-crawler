const { MAX_LEVEL, TIER_DISTANCE, xpToNext, upgradePrice, potionPrice, gamblePrice, gearRolls } = require("./balance");

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
    growth: { maxHp: 15.5, atk: 2.5, def: 1.4 },
    crit: 0.08,
    dodge: 0.03,
    starter: { slot: "weapon", base: "Sword" },
    skills: [
      { id: "cleave", name: "Cleave", level: 1, cooldown: 5000, desc: "1.4x hit on every enemy around you" },
      { id: "warcry", name: "War Cry", level: 6, cooldown: 20000, desc: "taunt enemies nearby, +50% DEF 6s" },
      { id: "ironskin", name: "Iron Skin", level: 15, cooldown: 25000, desc: "take 70% less damage for 6s" },
      { id: "berserk", name: "Berserk", level: 30, cooldown: 40000, desc: "+60% ATK and 20% lifesteal for 8s" },
    ],
  },
  rogue: {
    name: "Rogue",
    color: [180, 255, 120],
    desc: "Deadly and slippery. High crit and dodge, burst damage.",
    base: { maxHp: 32, atk: 6, def: 1 },
    growth: { maxHp: 12, atk: 2.5, def: 0.9 },
    crit: 0.2,
    dodge: 0.12,
    starter: { slot: "weapon", base: "Dagger" },
    skills: [
      { id: "backstab", name: "Backstab", level: 1, cooldown: 4000, desc: "2.5x hit, always crits unaware foes" },
      { id: "smoke", name: "Smoke Bomb", level: 6, cooldown: 20000, desc: "vanish: monsters lose you for 4s" },
      { id: "fan", name: "Fan of Knives", level: 15, cooldown: 10000, desc: "hit all enemies within 3 tiles" },
      { id: "shadowstrike", name: "Shadow Strike", level: 30, cooldown: 30000, desc: "teleport to a foe and hit for 4x" },
    ],
  },
  mage: {
    name: "Mage",
    color: [140, 170, 255],
    desc: "Glass cannon. Weak in melee, devastating spells from range.",
    base: { maxHp: 32, atk: 6, def: 0 },
    growth: { maxHp: 10.5, atk: 2.5, def: 0.6 },
    crit: 0.1,
    dodge: 0.05,
    starter: { slot: "weapon", base: "Staff" },
    skills: [
      { id: "fireball", name: "Fireball", level: 1, cooldown: 3000, desc: "2x damage to the nearest foe in sight" },
      { id: "frostnova", name: "Frost Nova", level: 6, cooldown: 15000, desc: "freeze and hurt foes within 3 tiles" },
      { id: "chain", name: "Chain Lightning", level: 15, cooldown: 8000, desc: "1.4x to up to 4 foes in sight" },
      { id: "meteor", name: "Meteor", level: 30, cooldown: 35000, desc: "3x to every foe within 6 tiles" },
    ],
  },
  cleric: {
    name: "Cleric",
    color: [255, 240, 150],
    desc: "Healer and undead-slayer. Keeps the whole party alive.",
    base: { maxHp: 36, atk: 5, def: 1 },
    growth: { maxHp: 13.5, atk: 2.15, def: 1.1 },
    crit: 0.07,
    dodge: 0.05,
    starter: { slot: "weapon", base: "Mace" },
    skills: [
      { id: "heal", name: "Heal", level: 1, cooldown: 5000, desc: "heal the most hurt ally (or you), revives" },
      { id: "smite", name: "Smite", level: 6, cooldown: 5000, desc: "holy strike, 3x vs undead" },
      { id: "sanctuary", name: "Sanctuary", level: 15, cooldown: 30000, desc: "heal & revive party nearby, +DEF" },
      { id: "holynova", name: "Holy Nova", level: 30, cooldown: 20000, desc: "2x to foes within 4, heals allies" },
    ],
  },
};

// ----------------------------------------------------------------- monsters
// Archetypes: stats are multipliers on the level formulas in balance.js.
// minLevel: the lowest area level they appear in. ranged: attack range in tiles.
const MONSTERS = [
  { type: "rat", name: "Rat", char: "r", color: [170, 140, 110], hp: 0.75, atk: 0.9, def: 0.6, xp: 0.85, minLevel: 1, speed: 2, aggro: 5, verb: "bites", pack: true },
  { type: "bat", name: "Bat", char: "b", color: [170, 110, 210], hp: 0.6, atk: 0.85, def: 0.5, xp: 0.8, minLevel: 1, speed: 1, aggro: 7, verb: "bites" },
  { type: "slime", name: "Slime", char: "j", color: [120, 230, 200], hp: 1.25, atk: 0.8, def: 1.2, xp: 1, minLevel: 2, speed: 3, aggro: 4, verb: "splashes" },
  { type: "goblin", name: "Goblin", char: "g", color: [90, 200, 90], hp: 1, atk: 1, def: 1, xp: 1, minLevel: 4, speed: 2, aggro: 7, verb: "stabs", pack: true, ability: "bomb" },
  { type: "spider", name: "Giant Spider", char: "x", color: [200, 80, 80], hp: 0.85, atk: 1.15, def: 0.7, xp: 1.05, minLevel: 7, speed: 1, aggro: 6, verb: "bites", ability: "leap" },
  { type: "skeleton", name: "Skeleton", char: "s", color: [230, 230, 210], hp: 0.9, atk: 0.95, def: 1.1, xp: 1.1, minLevel: 11, speed: 2, aggro: 8, ranged: 4, verb: "shoots an arrow at", undead: true },
  { type: "zombie", name: "Zombie", char: "z", color: [130, 170, 90], hp: 1.55, atk: 0.95, def: 0.8, xp: 1.15, minLevel: 15, speed: 3, aggro: 6, verb: "claws", undead: true, ability: "smash" },
  { type: "orc", name: "Orc", char: "o", color: [210, 120, 50], hp: 1.3, atk: 1.1, def: 1.2, xp: 1.2, minLevel: 20, speed: 2, aggro: 8, verb: "smashes", ability: "smash" },
  { type: "cultist", name: "Cultist", char: "c", color: [200, 60, 160], hp: 0.85, atk: 1.2, def: 0.9, xp: 1.15, minLevel: 26, speed: 2, aggro: 9, ranged: 5, verb: "casts a hex on", ability: "hex" },
  { type: "wraith", name: "Wraith", char: "w", color: [120, 200, 255], hp: 0.9, atk: 1.15, def: 0.9, xp: 1.2, minLevel: 32, speed: 1, aggro: 10, ranged: 5, verb: "hurls a shadow bolt at", undead: true, ability: "blink" },
  { type: "golem", name: "Stone Golem", char: "m", color: [170, 160, 150], hp: 2.0, atk: 1.0, def: 2.2, xp: 1.4, minLevel: 40, speed: 3, aggro: 6, verb: "pounds", ability: "smash" },
  { type: "troll", name: "Troll", char: "t", color: [60, 170, 120], hp: 1.7, atk: 1.1, def: 1.3, xp: 1.35, minLevel: 48, speed: 3, aggro: 8, verb: "pummels", ability: "smash" },
  { type: "demon", name: "Imp Demon", char: "i", color: [255, 70, 70], hp: 1.05, atk: 1.25, def: 1.1, xp: 1.3, minLevel: 57, speed: 1, aggro: 10, ranged: 4, verb: "spits fire at", ability: "line" },
  { type: "drake", name: "Drake", char: "d", color: [255, 100, 40], hp: 1.5, atk: 1.2, def: 1.4, xp: 1.45, minLevel: 67, speed: 2, aggro: 10, ranged: 4, verb: "breathes fire at", ability: "breath" },
  { type: "lich", name: "Lich", char: "l", color: [190, 120, 255], hp: 1.25, atk: 1.3, def: 1.3, xp: 1.5, minLevel: 78, speed: 2, aggro: 11, ranged: 6, verb: "blasts", undead: true, ability: "hex" },
];

// Spawned only during the Treasure Goblin event: runs away, drops riches.
const TREASURE_GOBLIN = {
  type: "treasure_goblin", name: "Treasure Goblin", char: "$", color: [255, 230, 60],
  hp: 3, atk: 0, def: 1, xp: 3, gold: 10, minLevel: 1, speed: 1, aggro: 8, verb: "taunts", flees: true,
};

// One lair boss per level band. Bosses guard a treasure chest.
// Stats are archetype multipliers on top of the BOSS multipliers in balance.js.
const BOSSES = [
  { type: "goblin_king", name: "Goblin King", char: "G", color: [140, 255, 80], hp: 1, atk: 1, def: 1, xp: 1, minLevel: 8, speed: 2, aggro: 9, verb: "cleaves" },
  { type: "bone_lord", name: "Bone Lord", char: "S", color: [255, 255, 230], hp: 0.9, atk: 1, def: 1.1, xp: 1, minLevel: 18, speed: 2, aggro: 9, ranged: 5, verb: "fires a bone spear at", undead: true },
  { type: "orc_warlord", name: "Orc Warlord", char: "O", color: [255, 140, 40], hp: 1.15, atk: 1.05, def: 1.2, xp: 1.1, minLevel: 30, speed: 2, aggro: 9, verb: "crushes" },
  { type: "wraith_queen", name: "Wraith Queen", char: "W", color: [160, 220, 255], hp: 0.95, atk: 1.1, def: 1, xp: 1.1, minLevel: 42, speed: 1, aggro: 11, ranged: 6, verb: "drains the life of", undead: true },
  { type: "troll_chief", name: "Troll Chieftain", char: "T", color: [80, 230, 160], hp: 1.3, atk: 1.05, def: 1.3, xp: 1.15, minLevel: 54, speed: 3, aggro: 9, verb: "flattens" },
  { type: "demon_prince", name: "Demon Prince", char: "P", color: [255, 40, 90], hp: 1.1, atk: 1.15, def: 1.2, xp: 1.2, minLevel: 66, speed: 1, aggro: 11, ranged: 5, verb: "rains hellfire on" },
  { type: "ancient_dragon", name: "Ancient Dragon", char: "D", color: [255, 50, 20], hp: 1.4, atk: 1.15, def: 1.4, xp: 1.4, minLevel: 78, speed: 2, aggro: 12, ranged: 5, verb: "engulfs in flames" },
  // The final boss, on the Throne of the Abyss.
  { type: "abyss_lord", name: "Abyss Lord", char: "A", color: [255, 215, 80], hp: 1, atk: 1, def: 1, xp: 1, minLevel: 95, speed: 2, aggro: 13, ranged: 6, verb: "unmakes", final: true },
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
  urn: { name: "urn", char: "&", color: [190, 150, 110] },
  fountain: { name: "healing fountain", char: "≈", color: [110, 200, 255] },
  vault: { name: "sealed vault", char: "≡", color: [255, 215, 110] },
  cursed: { name: "cursed chest", char: "¤", color: [210, 110, 255] },
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

// stat ranges per item level (ilvl = area level). pct stats are fractions.
const AFFIXES = [
  { stat: "atk", prefix: "Sharp", suffix: "of Might", roll: gearRolls.affixAtk },
  { stat: "def", prefix: "Sturdy", suffix: "of the Turtle", roll: gearRolls.affixDef },
  { stat: "maxHp", prefix: "Hale", suffix: "of the Bear", roll: gearRolls.affixHp },
  { stat: "crit", prefix: "Vicious", suffix: "of Precision", roll: () => [0.02, 0.07] },
  { stat: "dodge", prefix: "Nimble", suffix: "of the Fox", roll: () => [0.02, 0.06] },
  { stat: "lifesteal", prefix: "Vampiric", suffix: "of Leeching", roll: () => [0.03, 0.08] },
  { stat: "goldFind", prefix: "Gilded", suffix: "of Greed", roll: () => [0.1, 0.35] },
  { stat: "xpBonus", prefix: "Wise", suffix: "of Wisdom", roll: () => [0.03, 0.12] },
  { stat: "regen", prefix: "Mending", suffix: "of the Troll", roll: gearRolls.affixRegen },
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
// Permanent upgrades are percentages (see balance.js); prices grow 16% per purchase.
const SHOP = [
  { id: "potion", description: "Adds one potion. Drinking it restores 40% max HP, at least 15.", name: "Healing potion", price: (b, lvl) => potionPrice(lvl) },
  { id: "atk", description: "Permanent attack upgrade. Increases your damage.", name: "Whetstone (+2% ATK)", price: (b) => upgradePrice(60, b.atk) },
  { id: "def", description: "Permanent defense upgrade. Reduces incoming damage.", name: "Reinforced plating (+3% DEF)", price: (b) => upgradePrice(70, b.def) },
  { id: "hp", description: "Permanent max HP upgrade. Also heals the amount gained.", name: "Vitality tonic (+3% max HP)", price: (b) => upgradePrice(65, b.hp) },
  { id: "gamble", description: "One random item at your current level. Slot and rarity vary.", name: "Mystery item (gamble!)", price: (b, lvl) => gamblePrice(lvl) },
  { id: "rebirth", description: "Return to level 1 and keep gear and gold. Gain +5% ATK/HP and +10% XP per rebirth.", name: `REBIRTH (Lv ${MAX_LEVEL}): restart stronger`, price: () => 0 },
];
const REBIRTH_LEVEL = MAX_LEVEL;

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
  { id: "depth3", name: "Spelunker", desc: "Reach depth 5", title: "the Spelunker", check: (p) => p.stats.maxDepth >= 5 },
  { id: "depth6", name: "Deep Delver", desc: "Reach depth 10", title: "the Deep Delver", check: (p) => p.stats.maxDepth >= 18 },
  { id: "depth10", name: "Abyss Walker", desc: "Reach the Throne of the Abyss (depth 18)", title: "the Abyss Walker", check: (p) => p.stats.maxDepth >= 18 },
  { id: "level5", name: "Adventurer", desc: "Reach level 5", title: "the Adventurer", check: (p) => p.stats.level >= 5 },
  { id: "level10", name: "Veteran", desc: "Reach level 10", title: "the Veteran", check: (p) => p.stats.level >= 10 },
  { id: "level20", name: "Hero", desc: "Reach level 25", title: "the Hero", check: (p) => p.stats.level >= 25 },
  { id: "level50", name: "Legend", desc: "Reach level 50", title: "the Legend", check: (p) => p.stats.level >= 50 },
  { id: "level75", name: "Mythic", desc: "Reach level 75", title: "the Mythic", check: (p) => p.stats.level >= 75 },
  { id: "level100", name: "Ascendant", desc: "Reach level 100", title: "the Ascendant", check: (p) => p.stats.level >= 100 },
  { id: "savior", name: "Guardian Angel", desc: "Revive allies 5 times", title: "the Guardian", check: (p) => (p.counters.revives || 0) >= 5 },
  { id: "rich", name: "Moneybags", desc: "Earn 5000 gold total", title: "the Wealthy", check: (p) => (p.counters.goldEarned || 0) >= 5000 },
  { id: "legendary", name: "Legendary!", desc: "Find a legendary item", title: "the Fortunate", check: (p) => (p.counters.legendaries || 0) >= 1 },
  { id: "combo10", name: "Unstoppable", desc: "Reach a x10 kill combo", title: "the Unstoppable", check: (p) => (p.counters.bestCombo || 0) >= 10 },
  { id: "elites", name: "Elite Hunter", desc: "Kill 20 elites", title: "the Elite Hunter", check: (p) => (p.counters.elites || 0) >= 20 },
  { id: "quests10", name: "Bounty Hunter", desc: "Complete 10 bounties", title: "the Bounty Hunter", check: (p) => (p.counters.quests || 0) >= 10 },
  { id: "goblin", name: "Goblin Mugger", desc: "Catch a treasure goblin", title: "the Mugger", check: (p) => (p.counters.kinds.treasure_goblin || 0) >= 1 },
  { id: "deathless", name: "Survivor", desc: "Reach level 20 without dying", title: "the Undying", check: (p) => p.stats.level >= 20 && p.stats.deaths === 0 },
  { id: "loremaster", name: "Loremaster", desc: "Find every lore scroll", title: "the Loremaster", check: (p) => (p.lore || []).length >= 12 },
  { id: "fellowship", name: "Fellowship", desc: "Defeat a boss in a party of 3+", title: "of the Fellowship", check: (p) => (p.counters.partyBosses || 0) >= 1 },
  { id: "savior10", name: "Lifeline", desc: "Revive allies 25 times", title: "the Lifeline", check: (p) => (p.counters.revives || 0) >= 25 },
  { id: "traveler", name: "Wayfinder", desc: "Discover 6 waystones", title: "the Wayfinder", check: (p) => (p.waystones || []).length >= 6 },
  { id: "smith", name: "Master Smith", desc: "Upgrade an item to +10", title: "the Smith", check: (p) => (p.counters.bestPlus || 0) >= 10 },
  { id: "reborn", name: "Reborn", desc: "Complete a rebirth", title: "the Reborn", check: (p) => (p.prestige || 0) >= 1 },
  { id: "combo25", name: "Better Together", desc: "Land 25 team combos", title: "the Dependable", check: (p) => (p.counters.teamCombos || 0) >= 25 },
  { id: "cursed5", name: "Curse Breaker", desc: "Break 5 cursed chests", title: "the Curse Breaker", check: (p) => (p.counters.cursed || 0) >= 5 },
  { id: "vault3", name: "Two Keys", desc: "Open 3 sealed vaults with an ally", title: "the Keyholder", check: (p) => (p.counters.vaults || 0) >= 3 },
  { id: "rooms150", name: "Cartographer", desc: "Discover 150 chambers", title: "the Cartographer", check: (p) => (p.counters.rooms || 0) >= 150 },
  { id: "abyss", name: "Abyss Conqueror", desc: "Defeat the Abyss Lord", title: "the Conqueror", check: (p) => (p.counters.kinds.abyss_lord || 0) >= 1 },
];

// ------------------------------------------------------------- progression
const PLAYER_START = { potions: 3 };
const MAX_POTIONS = 9;
const INVENTORY_SIZE = 15;

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
  MAX_LEVEL,
  xpToNext,
};
