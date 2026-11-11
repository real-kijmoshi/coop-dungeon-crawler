// Level-based balance model. Everything that scales with progression lives here so
// the whole game can be tuned from one place (see BALANCE.md and server/sim/).
//
//  - Areas have a level that grows with distance from the spawn (1 at the safe room,
//    100 near the edges of the map, up to MONSTER_MAX_LEVEL in the far corners).
//  - Monsters, bosses, gold and gear are generated from the level of the area.
//  - Armor is percentage-based: def / (def + 20 + 4 * attackerLevel), so it stays
//    useful from level 1 to 100 without ever making a hero immune.

const MAX_LEVEL = 100;
const MONSTER_MAX_LEVEL = 110;
const TIER_DISTANCE = 10; // tiles per "depth" (used for biomes, waystones, records)
const LEVEL_START_DIST = 8; // monsters near the spawn are level 1
const LEVEL_100_DIST = 190; // ...and level 100 this far out (the map is 400x400, spawn in the middle)
const LEVEL_CURVE = 1.2; // > 1: early levels get more room, later levels come faster per tile

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Area level at a distance from the spawn.
const levelAtDistance = (d) => {
  const t = Math.max(0, d - LEVEL_START_DIST) / (LEVEL_100_DIST - LEVEL_START_DIST);
  return clamp(Math.round(1 + 99 * Math.pow(t, LEVEL_CURVE)), 1, MONSTER_MAX_LEVEL);
};
// Distance where an area level is found (inverse of levelAtDistance), handy for bots and hints.
const distanceForLevel = (L) =>
  LEVEL_START_DIST + (LEVEL_100_DIST - LEVEL_START_DIST) * Math.pow(Math.max(0, L - 1) / 99, 1 / LEVEL_CURVE);

// Reference "attack" of a level: a class-average hero without gear.
const refAtk = (L) => 5 + 2.2 * (L - 1);

// --------------------------------------------------------- the expected hero
// What a typical hero of a level looks like once gear, the merchant and the
// blacksmith are counted (fitted from the simulator, see BALANCE.md). Monsters are
// built against this hero, so the game stays challenging all the way to 100.
const refHp = (L) => 34 + 12.9 * (L - 1);
const heroAtk = (L) => refAtk(L) * (1.4 + 1.9 * Math.pow(L / 100, 0.7));
const heroHp = (L) => refHp(L) * (1.1 + 2.6 * Math.pow(L / 100, 0.6));
const heroMitigation = (L) => 0.22 + 0.22 * Math.min(1, L / 100);

// Targets for a normal (x1.0) monster fighting the expected hero of its level.
const HITS_TO_KILL = 3.4;
const HIT_PCT = 0.05; // share of the hero's max HP a monster hit takes

// ------------------------------------------------------------------ monsters
// Archetypes give multipliers; level gives the base.
const monsterBase = (M) => {
  const def = 0.5 * M;
  return {
    hp: HITS_TO_KILL * heroAtk(M) * (1 - mitigation(def, M)),
    atk: (HIT_PCT * heroHp(M)) / (1 - heroMitigation(M)),
    def,
    xp: 5 + 2 * M,
    gold: [Math.round(0.4 * M), Math.round(1.1 * M) + 2],
  };
};

const ELITE = { hp: 2.4, atk: 1.35, def: 1.3, xp: 3, gold: 2.5 };
const BOSS = { hp: 14, atk: 1.55, def: 1.5, xp: 25, gold: 18 };
const FINAL_BOSS = { hp: 40, atk: 1.9, def: 1.8, xp: 120, gold: 60 };

// ------------------------------------------------------------------- damage
const mitigation = (def, attackerLevel) => {
  const d = Math.max(0, def);
  return d / (d + 20 + 4 * Math.max(1, attackerLevel));
};

// Raw attack value -> damage after armor. variance: +-10%.
const rollDamage = (atk, def, attackerLevel) => {
  const raw = atk * (0.9 + Math.random() * 0.2);
  return Math.max(1, Math.round(raw * (1 - mitigation(def, attackerLevel))));
};

// ----------------------------------------------------------------------- XP
// Kills of same-level monsters needed per level: ~8 at level 1, ~95 at 50, ~210 at 99.
const killsToLevel = (L) => 6 + 1.55 * L + 0.005 * L * L;
const xpToNext = (L) => Math.round((5 + 2 * L) * killsToLevel(L));

// Fighting monsters far below you gives little XP; fighting above you pays more.
const xpLevelMult = (playerLevel, monsterLevel) => {
  const gap = playerLevel - monsterLevel;
  if (gap > 5) return Math.max(0.1, 1 - (gap - 5) * 0.12);
  if (gap < 0) return Math.min(1.5, 1 + 0.05 * -gap);
  return 1;
};

// --------------------------------------------------------------------- gear
// ilvl is the level of the area (or monster) the item came from.
const gearRolls = {
  weaponAtk: (l) => [0.28 * refAtk(l), 0.42 * refAtk(l)],
  armorDef: (l) => [1 + 0.3 * l, 1 + 0.55 * l],
  armorHp: (l) => [4 + 2.5 * l, 8 + 4.5 * l],
  affixAtk: (l) => [0.06 * refAtk(l) + 1, 0.14 * refAtk(l) + 1],
  affixDef: (l) => [1 + 0.15 * l, 1 + 0.3 * l],
  affixHp: (l) => [3 + 1.5 * l, 6 + 3 * l],
  affixRegen: (l) => [1, 1 + 0.25 * l],
};
const itemValue = (ilvl, rarityIndex) => Math.round((5 + ilvl * 3) * (1 + rarityIndex * 1.5));

// ------------------------------------------------------------- the merchant
// Permanent upgrades are percentages so they matter at every level.
const SHOP_PCT = { atk: 0.02, def: 0.03, hp: 0.03, heart: 0.01 };
const SHOP_MAX = { atk: 25, def: 20, hp: 20, hearts: 25 }; // +50% ATK, +60% DEF, +60% HP, +25% HP
const upgradePrice = (base, bought) => Math.round(base * Math.pow(1.16, bought));
const potionPrice = (L) => Math.round(10 + 1.5 * L);
const gamblePrice = (L) => Math.round(60 + 18 * L);

// -------------------------------------------------------------- blacksmith
// Each +1 adds 4% of the item's base stats (non-compounding); up to +10.
const SMITH_PCT = 0.04;
const upgradeCost = (item) => {
  const plus = item.plus || 0;
  return Math.round((25 + (item.ilvl || 1) * 6) * (plus + 1) * (1 + plus * 0.25) * (1 + rarityBonus(item)));
};
const reforgeCost = (item) => Math.round((40 + (item.ilvl || 1) * 8) * (1 + rarityBonus(item)));
const rarityBonus = (item) => ({ common: 0, magic: 0.3, rare: 0.7, epic: 1.2, legendary: 2 })[item.rarity] || 0;

// -------------------------------------------------------------- loot & gold
const roomGold = (L) => Math.round((1 + Math.random() * 2) * L + 2);
const chestGold = (L) => Math.round((2 + Math.random() * 2) * L + 10);

module.exports = {
  MAX_LEVEL,
  MONSTER_MAX_LEVEL,
  TIER_DISTANCE,
  levelAtDistance,
  distanceForLevel,
  refAtk,
  refHp,
  heroAtk,
  heroHp,
  heroMitigation,
  monsterBase,
  ELITE,
  BOSS,
  FINAL_BOSS,
  mitigation,
  rollDamage,
  xpToNext,
  killsToLevel,
  xpLevelMult,
  gearRolls,
  itemValue,
  SHOP_PCT,
  SHOP_MAX,
  upgradePrice,
  potionPrice,
  gamblePrice,
  SMITH_PCT,
  upgradeCost,
  reforgeCost,
  roomGold,
  chestGold,
  clamp,
};
