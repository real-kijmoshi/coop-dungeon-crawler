// Engine checks: run with `npm test` (no network, no database).
const assert = require("assert");
const { Grid } = require("../utils/map");
const { World } = require("../game/World");
const B = require("../game/balance");
const { BOSSES, MONSTERS, ACHIEVEMENTS } = require("../game/data");
const { generateItem } = require("../game/loot");

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const map = new Grid(20, 20, 400, 777);
map.generateInitialRoom();
map.scheduleSave = () => {};
const w = new World(map);
w.stop();
const msgs = [];
w.on("message", (m) => msgs.push(m.text));
const toasts = [];
w.on("fx", (id, fx) => fx.text && toasts.push(`${id}:${fx.text}`));
const mk = (id, name, cls) => {
  const p = w.addPlayer({ id, username: name, position_x: -1, position_y: -1, level: 1 });
  w.chooseClass(p, cls);
  return p;
};
const a = mk(1, "alice", "warrior");
const b = mk(2, "bob", "cleric");
const c = mk(3, "cara", "mage");
const setLevel = (p, L) => {
  p.stats.level = L;
  w.recalc(p);
  p.stats.hp = p.stats.maxHp;
};

console.log("balance");
check("area level grows from 1 at the spawn to 100 near the edge", () => {
  assert.equal(B.levelAtDistance(0), 1);
  assert.equal(B.levelAtDistance(B.distanceForLevel(50)), 50);
  assert.equal(B.levelAtDistance(190), 100);
  assert.equal(B.levelAtDistance(400), B.MONSTER_MAX_LEVEL);
  assert.equal(w.levelAt(w.spawn.x, w.spawn.y), 1);
});
check("monster stats rise with level and armor never makes anyone immune", () => {
  let last = B.monsterBase(1);
  for (let L = 2; L <= 110; L++) {
    const m = B.monsterBase(L);
    assert(m.hp > last.hp && m.atk > last.atk && m.xp > last.xp, `level ${L}`);
    last = m;
  }
  assert(B.mitigation(100000, 1) < 1);
  assert.equal(B.rollDamage(1, 1e9, 1), 1);
});
check("XP curve: more kills per level later, capped at level 100", () => {
  assert(B.killsToLevel(99) > B.killsToLevel(50) && B.killsToLevel(50) > B.killsToLevel(1));
  const p = mk(20, "capper", "rogue");
  setLevel(p, 99);
  w.gainXp(p, B.xpToNext(99) * 5);
  assert.equal(p.stats.level, B.MAX_LEVEL);
  w.gainXp(p, 1e9);
  assert.equal(p.stats.level, B.MAX_LEVEL);
  assert(p.achievements.includes("level100"));
  w.removePlayer(p.id);
});
check("XP is reduced for monsters far below you", () => {
  assert.equal(B.xpLevelMult(10, 10), 1);
  assert(B.xpLevelMult(30, 10) < 0.2);
  assert(B.xpLevelMult(10, 14) > 1);
});
check("monster types and bosses fit the area level", () => {
  for (const L of [1, 10, 25, 50, 75, 100]) {
    for (let i = 0; i < 30; i++) {
      const def = w.pickMonsterType(L);
      assert(def.minLevel <= L, `${def.type} at ${L}`);
    }
  }
  assert.equal(w.bossForLevel(5), null);
  assert.equal(w.bossForLevel(10).type, "goblin_king");
  assert.equal(w.bossForLevel(80).type, "ancient_dragon");
  assert.equal(w.bossForLevel(100).type, "abyss_lord");
  assert(MONSTERS.every((m) => m.minLevel >= 1) && BOSSES.every((x) => x.minLevel >= 1));
});
check("gear scales with item level and keeps its base stats", () => {
  const lo = generateItem(5, { slot: "weapon", rarity: "rare" });
  const hi = generateItem(80, { slot: "weapon", rarity: "rare" });
  assert(hi.stats.atk > lo.stats.atk * 5);
  const item = generateItem(50, { slot: "armor", rarity: "common" });
  assert.deepEqual(item.baseStats, item.stats);
});
check("merchant upgrades are percentages with a cap", () => {
  const p = mk(21, "shopper", "warrior");
  setLevel(p, 30);
  p.x = w.merchant.x + 1;
  p.y = w.merchant.y;
  p.stats.gold = 1e9;
  const atk0 = p.stats.atk;
  for (let i = 0; i < 25; i++) assert(w.buy(p, "atk").ok);
  assert(!w.buy(p, "atk").ok, "capped");
  assert(Math.abs(p.stats.atk - atk0 * 1.5) <= 1, `${p.stats.atk} vs ${atk0} * 1.5`);
  assert(w.shopFor(p).items.find((i) => i.id === "atk").maxed);
  w.removePlayer(p.id);
});
check("same-level fights take a few hits and a monster hit takes a few % of HP", () => {
  for (const L of [10, 50, 90]) {
    const m = B.monsterBase(L);
    const hits = m.hp / (B.heroAtk(L) * (1 - B.mitigation(m.def, L)));
    const pct = (m.atk * (1 - B.heroMitigation(L))) / B.heroHp(L);
    assert(hits > 2.5 && hits < 5, `hits ${hits} at ${L}`);
    assert(pct > 0.02 && pct < 0.08, `pct ${pct} at ${L}`);
  }
});

console.log("co-op");
check("parties", () => {
  assert(w.partyAction(a, "invite", "bob").ok);
  assert(w.partyAction(b, "accept").ok);
  assert(w.partyAction(a, "invite", "cara").ok);
  assert(w.partyAction(c, "accept").ok);
  assert.equal(w.partyMembers(a).length, 3);
  assert(!w.partyAction(a, "invite", "alice").ok);
  const st = w.stateFor(b);
  assert.equal(st.party.members.length, 3);
  w.partyChat(c, "hi team");
  assert(msgs.some((m) => m.includes("[party] <cara> hi team")));
});
check("waystones and travel", () => {
  w.ensureChunksAround(w.spawn.x + 40, w.spawn.y);
  w.ensureChunksAround(w.spawn.x - 40, w.spawn.y + 20);
  assert(w.waystones.size >= 1);
  const ws = [...w.waystones.values()][0];
  a.x = ws.x;
  a.y = ws.y;
  w.discoverWaystones(a);
  assert(a.waystones.includes(ws.tier));
  a.x = w.spawn.x;
  a.y = w.spawn.y;
  a.lastHurt = 0;
  a.lastTravel = 0;
  assert(w.travel(a, `ws:${ws.tier}`).ok);
  assert(Math.abs(a.x - ws.x) <= 2);
});
check("monsters are leashed to where they spawned", () => {
  w.monsters.clear();
  const room = map.rooms.find((r) => w.levelAt(r.x, r.y) >= 3 && r.id !== w.safeRoomId);
  // Stand at the east edge of a room, with home 15 tiles to the west.
  const m = w.spawnMonster(room.x + room.width - 1, room.y, 3, room.id);
  m.homeX = m.x - 15;
  m.cooldown = 0;
  c.x = m.x; // a hero close enough to keep it active
  c.y = m.y + 1;
  w.updateMonster(m, Date.now());
  assert(m.returning, "gives up the chase");
});
check("boss intro, party scaling, slam and personal loot", () => {
  w.ensureChunksAround(w.spawn.x + 35, w.spawn.y);
  const room = map.rooms.find((r) => r.width >= 5 && r.height >= 4 && r.id !== w.safeRoomId && w.levelAt(r.x, r.y) >= 5);
  w.monsters.clear();
  for (const p of [a, b, c]) setLevel(p, 20);
  const boss = w.spawnMonster(room.x + 2, room.y + 1, 20, room.id, BOSSES[1]);
  assert.equal(boss.level, 22);
  a.x = room.x + 1;
  a.y = room.y + 1;
  b.x = room.x + 3;
  b.y = room.y + 2;
  c.x = room.x;
  c.y = room.y + 3;
  const hp0 = boss.maxHp;
  boss.target = a.id;
  w.bossMechanics(boss, Date.now());
  assert(boss.introduced && boss.maxHp > hp0);
  assert(toasts.some((t) => t.includes("BONE LORD")));
  assert(boss.charging > 0);
  const hpA = a.stats.hp;
  for (let i = 0; i < 3; i++) w.bossMechanics(boss, Date.now());
  assert(a.stats.hp < hpA, "slam hit");
  w.killMonster(boss, a);
  [a, b, c].forEach((p) => assert.equal(p.stats.bossKills, 1));
  assert(c.achievements.includes("fellowship"));
});
check("lore scrolls", () => {
  a.x = w.spawn.x + 1;
  a.y = w.spawn.y;
  w.items.set(`${a.x},${a.y}`, [{ kind: "lore" }]);
  w.pickUp(a);
  assert.deepEqual(a.lore, [0]);
});

console.log("endgame");
check("blacksmith upgrades (non-compounding) and reforge keeps the +level", () => {
  a.x = w.merchant.x + 1;
  a.y = w.merchant.y;
  a.stats.gold = 1e9;
  const wpn = a.equipment.weapon;
  const base = wpn.baseStats.atk;
  for (let i = 0; i < 10; i++) assert(w.smith(a, "upgrade", wpn.uid).ok);
  assert(!w.smith(a, "upgrade", wpn.uid).ok);
  assert.equal(wpn.plus, 10);
  assert.equal(wpn.stats.atk, Math.max(base + 5, Math.round(base * 1.4)));
  assert(a.achievements.includes("smith"));
  assert(w.smith(a, "reforge", wpn.uid).ok);
  assert.equal(wpn.plus, 10);
});
check("rebirth at level 100", () => {
  setLevel(a, 99);
  assert(!w.buy(a, "rebirth").ok);
  setLevel(a, 100);
  assert(w.buy(a, "rebirth").ok);
  assert.equal(a.prestige, 1);
  assert.equal(a.stats.level, 1);
  assert(a.achievements.includes("reborn"));
});
check("save round trip and old saves", () => {
  const data = JSON.parse(JSON.stringify(w.saveData(a)));
  const a2 = w.addPlayer({ id: 9, username: "a2", cls: "warrior", position_x: -1, position_y: -1, level: 1, prestige: 1 }, data);
  assert.deepEqual(a2.lore, [0]);
  assert.equal(a2.equipment.weapon.plus, 10);
  // An old save stored +10 HP per tonic: it becomes one tonic (+3%) each.
  const old = w.addPlayer({ id: 10, username: "old", cls: "cleric", position_x: -1, position_y: -1, level: 300 }, { bonus: { atk: 3, def: 2, hp: 50 } });
  assert.equal(old.bonus.hp, 5);
  assert.equal(old.stats.level, B.MAX_LEVEL);
});
check("achievement list is consistent", () => {
  const ids = new Set(ACHIEVEMENTS.map((x) => x.id));
  assert.equal(ids.size, ACHIEVEMENTS.length);
});
check("party leave", () => {
  assert(w.partyAction(c, "leave").ok);
  assert(w.partyAction(a, "leave").ok);
  assert.equal(b.partyId, null);
});

console.log(`\n${passed} checks passed`);
