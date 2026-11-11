// Random equipment generation.
const {
  RARITIES,
  SLOTS,
  SLOT_CHARS,
  ITEM_BASES,
  AFFIXES,
  STAT_LABELS,
  PCT_STATS,
  LEGENDARY_NAMES,
} = require("./data");
const { gearRolls, itemValue } = require("./balance");

const randf = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let uidCounter = 0;
const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const rarityById = (id) => RARITIES.find((r) => r.id === id) || RARITIES[0];

// boost > 1 makes better rarities more likely (elites, bosses, chests, events).
const rollRarity = (boost = 1) => {
  for (let i = RARITIES.length - 1; i > 0; i--) {
    if (Math.random() < RARITIES[i].chance * boost) return RARITIES[i];
  }
  return RARITIES[0];
};

const roundStat = (stat, v) => (PCT_STATS.has(stat) ? Math.round(v * 100) / 100 : Math.max(1, Math.round(v)));

/**
 * Create an item.
 * @param {number} ilvl item level (the level of the area or monster it came from)
 * @param {object} opts { boost, slot, base, rarity }
 */
const generateItem = (ilvl, opts = {}) => {
  ilvl = Math.max(1, Math.round(ilvl));
  const slot = opts.slot || pick(SLOTS);
  const rarity = opts.rarity ? rarityById(opts.rarity) : rollRarity(opts.boost || 1);
  const base = opts.base || pick(ITEM_BASES[slot]);
  const stats = {};
  const add = (stat, v) => {
    stats[stat] = roundStat(stat, (stats[stat] || 0) + v);
  };

  // Base stats by slot
  if (slot === "weapon") add("atk", randf(...gearRolls.weaponAtk(ilvl)) * rarity.mult);
  if (slot === "armor") {
    add("def", randf(...gearRolls.armorDef(ilvl)) * rarity.mult);
    add("maxHp", randf(...gearRolls.armorHp(ilvl)) * rarity.mult);
  }

  // Affixes (trinkets always get at least one)
  const count = rarity.affixes + (slot === "trinket" && rarity.affixes === 0 ? 1 : 0);
  const pool = [...AFFIXES];
  const chosen = [];
  for (let i = 0; i < count && pool.length; i++) {
    const affix = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const [min, max] = affix.roll(ilvl);
    add(affix.stat, randf(min, max) * rarity.mult);
    chosen.push(affix);
  }

  let name;
  if (rarity.id === "legendary") {
    name = `${pick(LEGENDARY_NAMES[slot])}, ${base}`;
  } else {
    const prefix = chosen[0] ? chosen[0].prefix + " " : "";
    const suffix = chosen[1] ? " " + chosen[1].suffix : "";
    name = `${prefix}${base}${suffix}`;
  }

  const value = itemValue(ilvl, RARITIES.indexOf(rarity));
  // base: the stats before blacksmith upgrades (each +1 adds a % of these).
  return { uid: newUid(), slot, name, base, rarity: rarity.id, ilvl, stats, baseStats: { ...stats }, value };
};

const describeStats = (stats) =>
  Object.entries(stats)
    .map(([k, v]) => (PCT_STATS.has(k) ? `+${Math.round(v * 100)}% ${STAT_LABELS[k]}` : `+${v} ${STAT_LABELS[k]}`))
    .join(", ");

const itemLabel = (item) => `[${rarityById(item.rarity).name}] ${item.name}`;

const floorLook = (item) => ({ char: SLOT_CHARS[item.slot], color: rarityById(item.rarity).color });

module.exports = { generateItem, describeStats, itemLabel, floorLook, rarityById };
