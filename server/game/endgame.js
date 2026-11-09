// Endgame and world-setting systems mixed into World: biomes, lore scrolls,
// waystones, rebirth and the blacksmith.
const { BIOMES, biomeForTier, STORY, LORE } = require("./lore");
const { generateItem } = require("./loot");
const { REBIRTH_LEVEL, TIER_DISTANCE, PCT_STATS } = require("./data");

const MAX_PLUS = 10;
const WAYSTONE_LOOK = { name: "Waystone", char: "Ω", color: [120, 230, 255] };

const upgradeCost = (item) => {
  const plus = item.plus || 0;
  return Math.round(30 + item.value * (plus + 1) * 0.8 + (plus + 1) ** 2 * 15);
};
const reforgeCost = (item) => Math.round(item.value * 2 + 50);

// One upgrade step: flat stats +10% (at least +1), percent stats +1 point.
const applyUpgrade = (item) => {
  for (const [k, v] of Object.entries(item.stats)) {
    if (PCT_STATS.has(k)) item.stats[k] = Math.round((v + Math.max(0.01, v * 0.08)) * 100) / 100;
    else item.stats[k] = v + Math.max(1, Math.round(v * 0.1));
  }
};

module.exports = {
  MAX_PLUS,
  WAYSTONE_LOOK,
  upgradeCost,
  reforgeCost,

  // ----------------------------------------------------------------- biomes
  biomeAt(x, y) {
    return biomeForTier(this.tierAt(x, y));
  },

  checkBiome(p) {
    const b = this.biomeAt(p.x, p.y);
    if (p.biome === b.id) return;
    const first = p.biome === undefined;
    p.biome = b.id;
    if (first) return;
    this.notify(p, `— ${b.name} — ${b.enter}`, b.floor.fg.map((v) => Math.min(255, v + 60)));
    this.fx(p, "toast", b.name, b.floor.fg.map((v) => Math.min(255, v + 80)));
  },

  worldInfo() {
    return {
      tierDistance: TIER_DISTANCE,
      biomes: BIOMES.map((b) => ({ id: b.id, name: b.name, from: b.from, to: b.to, floor: b.floor, corridor: b.corridor, wall: b.wall })),
      story: STORY,
      loreTotal: LORE.length,
      rebirthLevel: REBIRTH_LEVEL,
    };
  },

  // ------------------------------------------------------------------- lore
  readLore(p) {
    p.lore = p.lore || [];
    const next = LORE.findIndex((_, i) => !p.lore.includes(i));
    if (next < 0) {
      this.addGold(p, 100);
      this.notify(p, "An old scroll you already know. You sell the parchment for 100 gold.", [240, 220, 170]);
      return;
    }
    p.lore.push(next);
    const l = LORE[next];
    this.notify(p, `📜 ${l.title}: "${l.text}"`, [240, 220, 170]);
    this.fx(p, "toast", `Lore found: ${l.title} (${p.lore.length}/${LORE.length}) · J to read`, [240, 220, 170]);
    this.checkAchievements(p);
    this.markProfile(p);
  },

  loreFor(p) {
    return (p.lore || []).slice().sort((a, b) => a - b).map((i) => ({ n: i + 1, ...LORE[i] }));
  },

  // -------------------------------------------------------------- waystones
  maybePlaceWaystone(room, tier) {
    if (tier < 1 || this.waystones.has(tier)) return;
    const x = room.x + Math.floor(room.width / 2);
    const y = room.y + Math.floor(room.height / 2);
    if (!this.isFloor(x, y)) return;
    this.waystones.set(tier, { tier, x, y });
  },

  isWaystone(x, y) {
    for (const w of this.waystones.values()) if (w.x === x && w.y === y) return true;
    return false;
  },

  discoverWaystones(p) {
    for (const w of this.waystones.values()) {
      if (Math.max(Math.abs(w.x - p.x), Math.abs(w.y - p.y)) > 1) continue;
      p.waystones = p.waystones || [];
      if (p.waystones.includes(w.tier)) continue;
      p.waystones.push(w.tier);
      this.notify(p, `You attune to the depth ${w.tier} waystone. Travel here with V from the safe room or any waystone.`, WAYSTONE_LOOK.color);
      this.fx(p, "toast", `Ω Waystone discovered · depth ${w.tier}`, WAYSTONE_LOOK.color);
      this.checkAchievements(p);
      this.markProfile(p);
    }
  },

  // ---------------------------------------------------------------- rebirth
  rebirth(p) {
    const s = p.stats;
    if (s.level < REBIRTH_LEVEL) return { ok: false, message: `Rebirth unlocks at level ${REBIRTH_LEVEL}.` };
    p.prestige = (p.prestige || 0) + 1;
    s.level = 1;
    s.xp = 0;
    this.recalc(p);
    s.hp = s.maxHp;
    this.notify(p, `You are reborn! ✦${p.prestige}: permanently +${5 * p.prestige}% ATK and HP, +${10 * p.prestige}% XP. Your gear and gold stay with you.`, [255, 215, 120]);
    this.fx(p, "toast", `✦ REBIRTH ${p.prestige} ✦`, [255, 215, 120]);
    this.announce(`${p.username} has been REBORN (✦${p.prestige})!`, [255, 215, 120]);
    this.checkAchievements(p);
    return { ok: true };
  },

  // -------------------------------------------------------------- blacksmith
  findOwnedItem(p, uid) {
    for (const slot of Object.keys(p.equipment)) {
      if (p.equipment[slot] && p.equipment[slot].uid === uid) return { item: p.equipment[slot], equipped: true };
    }
    const item = p.inventory.find((i) => i.uid === uid);
    return item ? { item, equipped: false } : null;
  },

  smith(p, action, uid) {
    if (!this.nearMerchant(p)) return { ok: false, message: "The blacksmith works at the Merchant (M) in the safe room." };
    const found = this.findOwnedItem(p, uid);
    if (!found) return { ok: false, message: "No such item." };
    const { item, equipped } = found;
    const s = p.stats;
    if (action === "upgrade") {
      const plus = item.plus || 0;
      if (plus >= MAX_PLUS) return { ok: false, message: "That item can't be improved any further." };
      const cost = upgradeCost(item);
      if (s.gold < cost) return { ok: false, message: `Upgrading costs ${cost} gold.` };
      s.gold -= cost;
      applyUpgrade(item);
      item.plus = plus + 1;
      item.value = Math.round(item.value * 1.15);
      p.counters.bestPlus = Math.max(p.counters.bestPlus || 0, item.plus);
      this.notify(p, `The blacksmith hammers your ${item.name} to +${item.plus} (-${cost} gold).`, [255, 200, 120]);
      if (item.plus >= 7) this.announce(`${p.username} forged a +${item.plus} ${item.name}!`, [255, 200, 120]);
    } else if (action === "reforge") {
      const cost = reforgeCost(item);
      if (s.gold < cost) return { ok: false, message: `Reforging costs ${cost} gold.` };
      s.gold -= cost;
      const fresh = generateItem(item.ilvl, { slot: item.slot, base: item.base, rarity: item.rarity });
      item.name = fresh.name;
      item.stats = fresh.stats;
      for (let i = 0; i < (item.plus || 0); i++) applyUpgrade(item);
      this.notify(p, `The blacksmith reforges it into ${item.name} (-${cost} gold).`, [255, 200, 120]);
    } else {
      return { ok: false, message: "Unknown smithing action." };
    }
    if (equipped) this.recalc(p);
    this.checkAchievements(p);
    this.markProfile(p);
    this.changed();
    return { ok: true };
  },
};
