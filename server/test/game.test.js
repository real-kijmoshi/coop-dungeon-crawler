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
  assert(boss.windup > w.tickCount, "winds up the slam");
  assert(w.stateFor(a).danger.length >= 9, "the slam zone is shown");
  const hpA = a.stats.hp;
  w.tickCount += 3;
  w.resolveTelegraphs();
  assert(a.stats.hp < hpA, "slam hit");
  assert.equal(w.stateFor(a).danger.length, 0);

  // Doom mark: alone it hits one hero, together the blow is shared.
  [a, b, c].forEach((p) => (p.stats.hp = p.stats.maxHp));
  boss.nextMark = 0;
  boss.target = null;
  w.bossMark(boss, Date.now());
  assert(boss.mark, "someone is marked");
  const marked = w.players.get(boss.mark.target);
  const friend = [a, b, c].find((p) => p !== marked);
  friend.x = marked.x;
  friend.y = marked.y + 1;
  w.tickCount += 20;
  w.bossMark(boss, Date.now());
  assert(marked.stats.hp < marked.stats.maxHp && friend.stats.hp < friend.stats.maxHp, "the blow is shared");
  assert.equal(boss.mark, null);

  // At 60% health it calls for help, once.
  const before = w.monsters.size;
  boss.hp = Math.round(boss.maxHp * 0.5);
  boss.nextSlam = Date.now() + 1e6;
  boss.nextMark = Date.now() + 1e6;
  w.bossMechanics(boss, Date.now());
  assert(w.monsters.size > before, "adds arrive");
  const withAdds = w.monsters.size;
  w.bossMechanics(boss, Date.now());
  assert.equal(w.monsters.size, withAdds);
  for (const m of Array.from(w.monsters.values())) if (m !== boss) w.monsters.delete(m.id);
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
console.log("combat and exploration");
const camp = { x: a.x, y: a.y };
const arena = () => {
  w.monsters.clear();
  w.telegraphs = [];
  const room = map.rooms.find((r) => r.width >= 6 && r.height >= 5 && r.id !== w.safeRoomId && w.levelAt(r.x, r.y) >= 5);
  for (let x = room.x; x < room.x + room.width; x++) for (let y = room.y; y < room.y + room.height; y++) w.items.delete(`${x},${y}`);
  [a, b, c].forEach((p, i) => {
    setLevel(p, 20);
    p.x = room.x + i * 2;
    p.y = room.y;
    p.downed = null;
    p.buffs = {};
    p.cooldowns = {};
  });
  return room;
};
check("telegraphed monster attacks can be dodged", () => {
  const room = arena();
  const orc = w.spawnMonster(a.x, a.y + 1, 20, room.id, MONSTERS.find((m) => m.type === "orc"));
  orc.cooldown = 0;
  orc.nextAbility = 0;
  orc.target = a.id;
  assert(w.updateMonster(orc, Date.now()), "starts the smash");
  assert(orc.windup > w.tickCount);
  const danger = w.stateFor(a).danger;
  assert(danger.some(([x, y]) => x === a.x && y === a.y), "the hero's tile is marked");
  assert.equal(w.updateMonster(orc, Date.now()), false, "holds still while winding up");
  // Step out of the marked tiles: the smash misses.
  const home = { x: a.x, y: a.y };
  a.x = room.x + 5;
  a.y = room.y + 4;
  const hp = a.stats.hp;
  w.tickCount += 2;
  w.resolveTelegraphs();
  assert.equal(a.stats.hp, hp, "dodged");
  // Stay put: it lands. A frozen monster is interrupted instead.
  Object.assign(a, home);
  orc.nextAbility = 0;
  orc.cooldown = 0;
  assert(w.updateMonster(orc, Date.now()));
  w.tickCount += 2;
  w.resolveTelegraphs();
  assert(a.stats.hp < hp, "hit");
  const hp2 = a.stats.hp;
  orc.nextAbility = 0;
  orc.cooldown = 0;
  assert(w.updateMonster(orc, Date.now()));
  orc.frozenUntil = Date.now() + 5000;
  w.tickCount += 2;
  w.resolveTelegraphs();
  assert.equal(a.stats.hp, hp2, "interrupted by a freeze");
});
check("dodge escapes danger, and a missed attack gives one opening", () => {
  const room = arena();
  const orc = w.spawnMonster(room.x, room.y + 1, 20, room.id, MONSTERS.find((m) => m.type === "orc"));
  const x = a.x;
  const y = a.y;
  const hp = a.stats.hp;
  a.dodgeReadyAt = 0;
  assert(w.telegraph([{ x, y }], 2, { by: orc, what: "smash" }));
  assert.equal(w.stateFor(a).threat.attack, "smash");
  assert.equal(w.dodgePlayer(a, "south").reason, "blocked");
  assert.equal(a.dodgeReadyAt, 0, "blocked dodge keeps its charge");
  assert.equal(w.dodgePlayer(a, "constructor").reason, "invalid");
  assert(w.dodgePlayer(a, "east").ok);
  assert.equal(a.x, x + 2);
  assert.equal(w.dodgePlayer(a, "west").reason, "cooldown");
  assert.equal(w.stateFor(a).threat, null);
  w.tickCount += 2;
  w.resolveTelegraphs();
  assert.equal(a.stats.hp, hp);
  assert(w.stateFor(a).monsters.find((m) => m.id === orc.id).exposed);
  orc.hp = orc.maxHp = 10000;
  const previousRandom = Math.random;
  try {
    Math.random = () => 0.5;
    const opening = w.hitMonster(a, orc, 1, { noCombo: true }).dmg;
    const normal = w.hitMonster(a, orc, 1, { noCombo: true }).dmg;
    assert.equal(opening, Math.round(normal * 1.25));
  } finally {
    Math.random = previousRandom;
  }
  assert.equal(orc.exposedUntil, 0);
});

check("early attacks give more reaction time and interrupts clear their warning", () => {
  const room = arena();
  const goblin = w.spawnMonster(a.x, a.y + 1, 4, room.id, MONSTERS.find((m) => m.type === "goblin"));
  const attack = w.telegraph([{ x: a.x, y: a.y }], 2, { by: goblin });
  assert.equal(attack.at - w.tickCount, 4);
  w.interruptTelegraph(goblin);
  assert.equal(w.stateFor(a).threat, null);
  assert.equal(goblin.windup, 0);
});

check("lore records unlock from saved depth without changing collected scrolls", () => {
  const originalDepth = a.stats.maxDepth;
  const originalLore = a.lore.slice();
  a.stats.maxDepth = 6;
  const profile = w.profileFor(a);
  assert.deepEqual(profile.chronicles.map((entry) => entry.depth), [0, 3, 6]);
  assert.deepEqual(a.lore, originalLore);
  a.stats.maxDepth = originalDepth;
});

check("merchant rejects stale quotes and still accepts legacy purchases", () => {
  const customer = mk(300, "customer", "cleric");
  Object.assign(customer, { x: w.merchant.x, y: w.merchant.y });
  customer.stats.gold = 200;
  customer.stats.potions = 0;
  const stock = w.shopFor(customer);
  const offer = stock.items.find((item) => item.id === "potion");
  assert.match(offer.description, /40% max HP/);
  const stale = w.buy(customer, "potion", offer.price + 1);
  assert.equal(stale.ok, false);
  assert.equal(customer.stats.gold, 200);
  assert.equal(customer.stats.potions, 0);
  assert(w.buy(customer, "potion", offer.price).ok);
  assert(w.buy(customer, "potion").ok);
  assert.equal(customer.stats.potions, 2);
  assert.equal(customer.stats.gold, 200 - 2 * offer.price);
  w.removePlayer(customer.id);
});

check("team combos: one hero primes, another detonates", () => {
  const room = arena();
  const m = w.spawnMonster(c.x, c.y + 1, 20, room.id, MONSTERS.find((x) => x.type === "golem"));
  m.maxHp = m.hp = 1e6;
  w.useSkill(c, "frostnova");
  assert.equal(m.primed && m.primed.type, "frost");
  assert.equal(w.stateFor(c).monsters[0].primed, "frost");
  // The mage's own basic attack does not detonate her own mark...
  w.hitMonster(c, m, 1);
  assert(m.primed, "still primed");
  // ...but an ally's does.
  const combos = a.counters.teamCombos || 0;
  a.stats.crit = 0;
  const r = w.hitMonster(a, m, 1);
  assert.equal(m.primed, null);
  assert.equal(a.counters.teamCombos, combos + 1);
  assert.equal(c.counters.teamCombos >= 1, true);
  assert(msgs.some((t) => t.includes("TEAM COMBO") && t.includes("SHATTER")));
  // flanked (the mage hit it a moment ago) and shattered: far more than a plain hit
  m.hitBy = {};
  const plain = Math.max(...Array.from({ length: 20 }, () => (m.hitBy = {}, w.hitMonster(a, m, 1, { noCombo: true, prime: null }).dmg)));
  assert(r.dmg > plain * 1.5, `combo ${r.dmg} vs plain ${plain}`);
  w.recalc(a);
  // Solo: a different kind of skill on your own mark gives a smaller bonus and consumes it.
  m.primed = { type: "frost", by: c.id, until: Date.now() + 5000 };
  c.cooldowns = {};
  w.useSkill(c, "fireball");
  assert.equal(m.primed, null);
});
check("fighting side by side: formation and a shared kill combo", () => {
  const room = arena();
  b.x = a.x + 1;
  b.y = a.y;
  assert(w.inFormation(a) && w.inFormation(b) && !w.inFormation(c));
  assert(w.stateFor(a).player.buffs.some((x) => x.id === "formation"));
  a.combo = { count: 0, until: 0 };
  b.combo = { count: 0, until: 0 };
  for (let i = 0; i < 3; i++) w.killMonster(w.spawnMonster(room.x + 3, room.y + 3, 20, room.id, MONSTERS[0]), i % 2 ? a : b);
  assert.equal(a.combo.count, 3);
  assert.equal(b.combo.count, 3);
});
check("elite affixes, slimes and mimics", () => {
  const room = arena();
  const slime = w.spawnMonster(room.x + 3, room.y + 3, 20, room.id, MONSTERS.find((x) => x.type === "slime"));
  w.killMonster(slime, a);
  const lings = Array.from(w.monsters.values());
  assert.equal(lings.length, 2);
  assert(lings.every((s) => s.small && s.name === "Slimeling"));
  lings.forEach((s) => w.killMonster(s, a));
  assert.equal(w.monsters.size, 0, "slimelings do not split again");

  const boomer = w.spawnMonster(a.x, a.y + 1, 20, room.id, MONSTERS.find((x) => x.type === "orc"));
  boomer.affix = "volatile";
  const hp = a.stats.hp;
  w.killMonster(boomer, a);
  assert.equal(w.telegraphs.length, 1);
  w.tickCount += 3;
  w.resolveTelegraphs();
  assert(a.stats.hp < hp, "the blast hits heroes who stay close");

  const warder = w.spawnMonster(room.x + 3, room.y + 3, 20, room.id, MONSTERS.find((x) => x.type === "orc"));
  warder.affix = "warding";
  const other = w.spawnMonster(room.x + 4, room.y + 3, 20, room.id, MONSTERS.find((x) => x.type === "orc"));
  assert.equal(w.wardedBy(other), warder);
  assert.equal(w.wardedBy(warder), null);
  w.monsters.clear();

  w.dropItem(room.x + 3, room.y + 2, { kind: "chest", level: 20, mimic: true });
  const chests = a.counters.chests || 0;
  a.x = room.x + 3;
  a.y = room.y + 2;
  w.pickUp(a);
  const mimic = Array.from(w.monsters.values())[0];
  assert(mimic && mimic.mimic, "the chest was a mimic");
  assert.equal(a.counters.chests || 0, chests);
  w.killMonster(mimic, a);
  assert(w.items.get(`${mimic.x},${mimic.y}`).some((i) => i.kind === "chest" && !i.mimic), "it drops the real chest");
});
check("urns, fountains and discovering rooms", () => {
  const room = arena();
  const gold = a.stats.gold;
  const potions = a.stats.potions;
  for (let i = 0; i < 30; i++) {
    w.dropItem(room.x + 3, room.y + 3, { kind: "urn", level: 20 });
    a.x = room.x + 3;
    a.y = room.y + 3;
    w.pickUp(a);
  }
  assert(a.stats.gold > gold || a.stats.potions > potions);
  assert(!w.items.has(`${a.x},${a.y}`), "urns break");
  w.monsters.clear();

  w.dropItem(a.x, a.y, { kind: "fountain" });
  a.stats.hp = 1;
  a.lastFountain = 0;
  w.pickUp(a);
  assert.equal(a.stats.hp, a.stats.maxHp);
  a.stats.hp = 1;
  w.pickUp(a);
  assert.equal(a.stats.hp, 1, "the fountain needs time to recover");
  assert(w.items.has(`${a.x},${a.y}`), "the fountain stays");
  w.items.delete(`${a.x},${a.y}`);
  a.stats.hp = a.stats.maxHp;

  a.seenRooms = new Set();
  a.quests = [{ id: 9001, kind: "explore", need: 1, have: 0, desc: "Discover 1 new chambers", reward: { gold: 1, xp: 1, item: false } }];
  const rooms = a.counters.rooms || 0;
  const xp = a.stats.xp + a.stats.level * 1e6;
  w.discoverRoom(a);
  w.discoverRoom(a);
  assert.equal(a.counters.rooms, rooms + 1, "counted once");
  assert(a.stats.xp + a.stats.level * 1e6 > xp, "worth some XP");
  assert(!a.quests.some((q) => q.id === 9001), "explore bounty completed");
});
check("sealed vaults want two heroes", () => {
  const room = arena();
  const spot = { x: room.x + 3, y: room.y + 3 };
  w.dropItem(spot.x, spot.y, { kind: "vault", level: 20 });
  Object.assign(a, spot);
  const goldA = a.stats.gold;
  const goldB = b.stats.gold;
  w.pickUp(a);
  assert(w.items.has(`${spot.x},${spot.y}`), "stays shut for a lone hero");
  assert.equal(w.monsters.size, 0);
  b.x = spot.x + 1;
  b.y = spot.y;
  w.pickUp(a);
  assert(!w.items.has(`${spot.x},${spot.y}`));
  assert(a.stats.gold > goldA);
  assert(b.stats.gold > goldB, "the ally gets their own reward");
  const had = a.stats.gold;
  assert.equal(w.monsters.size, 0, "no guardians when opened together");
  // Forced alone: second step opens it, guardians appear.
  b.x = room.x;
  b.y = room.y;
  w.dropItem(spot.x, spot.y, { kind: "vault", level: 20 });
  w.pickUp(a);
  w.pickUp(a);
  assert(!w.items.has(`${spot.x},${spot.y}`));
  assert(w.monsters.size >= 1, "guardians");
  assert(a.stats.gold > had);
});
check("cursed chests: waves, then a reward for everyone who stayed", () => {
  const room = arena();
  const spot = { x: room.x + 3, y: room.y + 3 };
  w.dropItem(spot.x, spot.y, { kind: "cursed", level: 20 });
  Object.assign(a, spot);
  const goldA = a.stats.gold;
  const goldB = b.stats.gold;
  const cursed = a.counters.cursed || 0;
  w.pickUp(a);
  assert.equal(w.encounters.size, 1);
  const enc = Array.from(w.encounters.values())[0];
  for (let wave = 1; wave <= 3; wave++) {
    w.tickCount += 6;
    w.updateEncounters();
    assert.equal(enc.wave, wave);
    assert(enc.alive.size >= 3, `wave ${wave} spawned ${enc.alive.size}`);
    while (enc.alive.size) {
      const id = enc.alive.values().next().value;
      w.killMonster(w.monsters.get(id), a);
    }
  }
  assert.equal(w.encounters.size, 1, "the reward comes a moment later");
  w.tickCount += 6;
  w.updateEncounters();
  assert.equal(w.encounters.size, 0);
  assert.equal(a.counters.cursed, cursed + 1);
  assert(a.stats.gold > goldA && b.stats.gold > goldB, "everyone gets their own reward");
  assert(toasts.some((t) => t.includes("CURSE BROKEN")));
});
check("sound cues reach the client", () => {
  const room = arena();
  const heard = [];
  const listen = (s) => heard.push(s.name);
  w.on("sound", listen);
  const m = w.spawnMonster(a.x, a.y + 1, 20, room.id, MONSTERS[0]);
  m.hp = 1;
  w.hitMonster(a, m, 1);
  w.off("sound", listen);
  assert(heard.includes("hit") || heard.includes("crit"));
  assert(heard.includes("kill"));
  Object.assign(a, camp);
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
console.log("team combat");
const golem = () => MONSTERS.find((x) => x.type === "golem");
check("threat: the warrior holds a monster that the mage keeps hitting", () => {
  const room = arena();
  const m = w.spawnMonster(c.x, c.y + 1, 20, room.id, golem());
  m.maxHp = m.hp = 1e6;
  w.hitMonster(a, m, 2, { noCombo: true, prime: null });
  assert.equal(m.target, a.id);
  w.hitMonster(c, m, 1, { noCombo: true, prime: null });
  assert.equal(m.target, a.id, "a single mage hit doesn't pull it off the warrior");
  for (let i = 0; i < 12; i++) w.hitMonster(c, m, 1, { noCombo: true, prime: null });
  assert.equal(m.target, c.id, "enough damage does");
});
check("class auras: the warrior guards, the mage speeds skills, the cleric keeps the downed alive", () => {
  const room = arena();
  b.x = a.x + 1;
  b.y = a.y;
  assert.equal(w.guardFor(b), a);
  const st = w.stateFor(b).player.buffs.map((x) => x.id);
  assert(st.includes("guarded") && st.includes("blessed") === false, st.join(","));
  const hpA = a.stats.hp;
  const hpB = b.stats.hp;
  w.hurtPlayer(b, 400, 20, { by: "test" });
  assert(a.stats.hp < hpA, "the warrior took part of the blow");
  assert(b.stats.hp < hpB);
  // Mage nearby: shorter cooldowns for allies.
  c.x = a.x + 2;
  c.y = a.y;
  a.cooldowns = {};
  const m = w.spawnMonster(a.x, a.y + 1, 20, room.id, golem());
  m.maxHp = m.hp = 1e6;
  const before = Date.now();
  w.useSkill(a, "cleave");
  const cd = a.cooldowns.cleave - before;
  assert(cd <= 5000 * 0.85 + 50 && cd >= 5000 * 0.85 - 50, `cooldown ${cd}`);
  // Cleric nearby: a downed ally lasts longer.
  b.x = c.x;
  b.y = c.y + 1;
  w.downOrKill(c, "test");
  assert(c.downed && c.downed.until - Date.now() > 25000);
  w.revive(c, a);
  assert(w.hasBuff(c, "secondwind") && w.hasBuff(a, "secondwind"), "second wind for both");
});
check("poise: focused hits stagger an elite, which then takes more damage and holds still", () => {
  const room = arena();
  const m = w.spawnMonster(a.x, a.y + 1, 20, room.id, golem());
  m.elite = true;
  w.initPoise(m);
  m.maxHp = m.hp = 1e7;
  let n = 0;
  while (!(m.staggerUntil > Date.now()) && n++ < 40) w.hitMonster(a, m, 1, { noCombo: true, prime: null });
  assert(m.staggerUntil > Date.now(), "staggered");
  assert(w.stateFor(a).monsters.find((x) => x.id === m.id).staggered);
  m.cooldown = 0;
  assert.equal(w.updateMonster(m, Date.now()), false, "a staggered monster can't act");
  assert(w.teamDamageMult(a, m, Date.now()) >= 1.5);
  m.staggerUntil = Date.now() - 1;
  w.updatePoise(Date.now());
  assert.equal(m.poise, m.maxPoise, "recovers with full poise");
});
check("combo chains: a team combo by a skill marks the monster for the next hero", () => {
  const room = arena();
  const m = w.spawnMonster(c.x, c.y + 1, 20, room.id, golem());
  m.maxHp = m.hp = 1e7;
  a.x = m.x - 1;
  a.y = m.y;
  w.useSkill(c, "frostnova"); // the mage primes frost
  w.useSkill(a, "cleave"); // the warrior detonates it and leaves sunder
  assert.equal(m.chain.count, 1);
  assert.equal(m.primed.type, "sunder");
  assert.equal(m.primed.by, a.id);
  c.cooldowns = {};
  w.useSkill(c, "fireball"); // the mage detonates the sunder: chain x2
  assert.equal(m.chain.count, 2);
  assert(msgs.some((t) => t.includes("CHAIN ×2")));
});
check("unity fills while fighting together and RALLY links every nearby hero's ultimate", () => {
  const room = arena();
  for (let i = 0; i < 5; i++) w.spawnMonster(room.x + 3, room.y + 2 + (i % 2), 20, room.id, golem());
  const party = w.partyOf(a);
  party.unity = 0;
  assert(!w.rally(a).ok, "not ready yet");
  const m = w.spawnMonster(a.x, a.y + 1, 20, room.id, golem());
  m.maxHp = m.hp = 1e7;
  for (let i = 0; i < 200 && w.unityOf(a) < 100; i++) w.hitMonster(a, m, 1, { noCombo: true, prime: null });
  assert.equal(w.unityOf(b), 100, "the meter is shared by the party");
  assert(w.stateFor(c).player.unity.value === 100);
  c.downed = { until: Date.now() + 5000, by: "test" };
  const hp = m.hp;
  assert(w.rally(a).ok);
  assert.equal(c.downed, null, "rally brings back the downed");
  assert([a, b, c].every((p) => w.hasBuff(p, "rally")));
  assert(m.hp < hp, "ultimates hit");
  assert.equal(w.unityOf(a), 0);
  assert(toasts.some((t) => t.includes("LINKED RALLY ×3")));
  assert(a.achievements.length > 0);
});
check("boss seals: at half health the boss shields itself until every rune is held", () => {
  w.ensureChunksAround(w.spawn.x + 35, w.spawn.y);
  const room = map.rooms.find((r) => r.width >= 6 && r.height >= 5 && r.id !== w.safeRoomId && w.levelAt(r.x, r.y) >= 5);
  arena();
  w.monsters.clear();
  const boss = w.spawnMonster(room.x + 2, room.y + 2, 20, room.id, BOSSES[0]);
  [a, b].forEach((p, i) => Object.assign(p, { x: room.x + i, y: room.y }));
  c.x = room.x;
  c.y = room.y + room.height - 1;
  boss.introduced = true;
  boss.calledAdds = true;
  boss.nextMark = boss.nextSlam = Date.now() + 1e6;
  boss.hp = Math.round(boss.maxHp * 0.45);
  w.bossMechanics(boss, Date.now());
  assert(boss.seal && boss.seal.runes.length === 3, "one rune per hero");
  assert.equal(w.stateFor(a).runes.length >= 1, true);
  assert(w.teamDamageMult(a, boss, Date.now()) <= 0.1 * 1.5);
  const [r1, r2, r3] = boss.seal.runes;
  Object.assign(a, { x: r1.x, y: r1.y });
  Object.assign(b, { x: r2.x, y: r2.y });
  w.updateSeals(Date.now());
  assert(boss.seal, "two of three runes is not enough");
  Object.assign(c, { x: r3.x, y: r3.y });
  w.updateSeals(Date.now());
  assert.equal(boss.seal, null, "shattered");
  assert(boss.staggerUntil > Date.now() + 5000, "and the boss reels");
  assert(a.achievements.includes("seal"));
  w.monsters.clear();
});
check("party leave", () => {
  assert(w.partyAction(c, "leave").ok);
  assert(w.partyAction(a, "leave").ok);
  assert.equal(b.partyId, null);
});

console.log(`\n${passed} checks passed`);
