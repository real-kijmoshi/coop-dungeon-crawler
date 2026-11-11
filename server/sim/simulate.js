#!/usr/bin/env node
// Fast-forward balance simulator.
//
// Runs the real game engine (World) on a fake clock with AI heroes that play like a
// sensible human: hunt monsters near their level, drink potions, use skills, go back to
// town to sell, shop and smith, take waystones and retreat when things look grim.
// Prints how long each level takes, deaths, time-to-kill and time-to-die per level band.
//
//   node sim/simulate.js --hours 20                      # one solo hero of each class
//   node sim/simulate.js --hours 10 --party              # the four classes in one party
//   node sim/simulate.js --hours 5 --classes mage,mage   # pick the heroes
//   options: --seed N  --json out.json  --quiet
//   env: SIM_DEBUG=1 prints every bot's state every 30 simulated seconds,
//        SIM_DEBUG2=<hours> prints detailed state every second after that time,
//        SIM_DEATHS=1 lists every death with where it happened
//
// Simulated time runs ~1000x faster than real time, depending on the machine.

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const HOURS = Number(opt("hours", 20));
const SEED = Number(opt("seed", 1));
const PARTY = !!opt("party", false);
const QUIET = !!opt("quiet", false);
const JSON_OUT = opt("json", null);
const CLASS_LIST = String(opt("classes", "warrior,rogue,mage,cleric")).split(",");

// ---------------------------------------------------------------- fake clock + rng
let NOW = 1_700_000_000_000;
Date.now = () => NOW;
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Math.random = mulberry32(SEED);

const { Grid } = require("../utils/map");
const { World, TICK_MS } = require("../game/World");
const B = require("../game/balance");
const { MAX_POTIONS, INVENTORY_SIZE, CLASSES, BOSSES } = require("../game/data");

const map = new Grid(20, 20, 400, 1000 + SEED);
map.generateInitialRoom();
map.scheduleSave = () => {};
const world = new World(map);
world.stop();
for (const k of ["notify", "announce", "fx", "floater", "changed"]) world[k] = () => {};
world.emit = () => true;

const STEP_MS = 100; // bots think every 100ms; the world ticks every 300ms
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const DIRS = [["north", 0, -1], ["south", 0, 1], ["east", 1, 0], ["west", -1, 0]];
const dirTo = (from, to) => DIRS.find(([, dx, dy]) => from.x + dx === to.x && from.y + dy === to.y)?.[0];

// ---------------------------------------------------------------- spatial index of monsters
let buckets = new Map();
const BK = 8;
const bkey = (x, y) => ((x / BK) | 0) * 1000 + ((y / BK) | 0);
const rebuildIndex = () => {
  buckets = new Map();
  for (const m of world.monsters.values()) {
    const k = bkey(m.x, m.y);
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(m);
  }
};
const monstersNear = (p, r) => {
  const out = [];
  for (let bx = ((p.x - r) / BK) | 0; bx <= ((p.x + r) / BK) | 0; bx++) {
    for (let by = ((p.y - r) / BK) | 0; by <= ((p.y + r) / BK) | 0; by++) {
      const list = buckets.get(bx * 1000 + by);
      if (!list) continue;
      for (const m of list) if (world.monsters.has(m.id) && dist(m, p) <= r) out.push(m);
    }
  }
  return out.sort((a, b) => dist(a, p) - dist(b, p));
};

// ---------------------------------------------------------------- pathfinding
const N = map.size;
const seen = new Int32Array(N * N);
const prev = new Int32Array(N * N);
let stamp = 0;
// BFS from `from`. goalFn(x,y) -> true stops; scoreFn picks the best tile when no goal is hit.
const bfs = (from, { goal, score, limit = 20000, blockMonsters = false }) => {
  stamp++;
  const q = new Int32Array(limit + 4);
  let head = 0;
  let tail = 0;
  const start = from.x * N + from.y;
  q[tail++] = start;
  seen[start] = stamp;
  prev[start] = -1;
  let best = start;
  let bestScore = score ? score(from.x, from.y) : Infinity;
  let found = -1;
  while (head < tail) {
    const cur = q[head++];
    const x = (cur / N) | 0;
    const y = cur % N;
    if (goal && cur !== start && goal(x, y)) {
      found = cur;
      break;
    }
    if (score) {
      const s = score(x, y);
      if (s < bestScore) {
        bestScore = s;
        best = cur;
      }
    }
    for (const [, dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const n = nx * N + ny;
      if (seen[n] === stamp || map.grid[nx][ny] === 0) continue;
      if (world.isMerchant(nx, ny)) continue;
      if (blockMonsters && world.monsterAt(nx, ny) && !(goal && goal(nx, ny))) continue;
      seen[n] = stamp;
      prev[n] = cur;
      if (tail < limit) q[tail++] = n;
    }
  }
  const end = found >= 0 ? found : score ? best : -1;
  if (end < 0) return null;
  if (end === start) return [];
  const path = [];
  for (let c = end; c !== start; c = prev[c]) path.push({ x: (c / N) | 0, y: c % N });
  return path.reverse();
};

// ---------------------------------------------------------------- metrics
const metrics = new Map(); // bot name -> per level data
const band = (L) => Math.min(9, Math.floor((L - 1) / 10)); // 0: 1-10 ... 9: 91-100

const newBandStats = () => ({ ms: 0, deaths: 0, kills: 0, hitsToKill: [], dmgTakenPct: [], bossKills: 0, potions: 0, townTrips: 0 });

// Wrap engine calls to measure combat.
const origHit = world.hitMonster.bind(world);
world.hitMonster = (player, monster, mult, o = {}) => {
  monster._hits = (monster._hits || 0) + 1;
  const r = origHit(player, monster, mult, o);
  if (r.killed && player._bot) {
    const st = player._bot.bandStats();
    st.kills++;
    if (monster.boss) st.bossKills++;
    else if (!monster.elite && !monster.flees && monster.level >= player.stats.level - 3) st.hitsToKill.push(monster._hits);
  }
  return r;
};
const origAttack = world.monsterAttacks.bind(world);
world.monsterAttacks = (monster, player, ranged) => {
  const before = player.stats.hp;
  origAttack(monster, player, ranged);
  if (player._bot && !monster.boss && !monster.elite && monster.level >= player.stats.level - 3) {
    const taken = before - Math.max(0, player.stats.hp);
    if (taken > 0) player._bot.bandStats().dmgTakenPct.push(taken / player.stats.maxHp);
  }
};
const origKill = world.killPlayer.bind(world);
world.killPlayer = (player, by) => {
  if (player._bot) {
    player._bot.bandStats().deaths++;
    player._bot.deathLog.push({ level: player.stats.level, by, at: NOW, area: world.levelAt(player.x, player.y), x: player.x, y: player.y });
    player._bot.reset();
  }
  origKill(player, by);
};

// ---------------------------------------------------------------- the bot
class Bot {
  constructor(name, cls, id) {
    this.name = name;
    this.p = world.addPlayer({ id, username: name, position_x: -1, position_y: -1, level: 1 });
    world.chooseClass(this.p, cls);
    this.p._bot = this;
    this.cls = cls;
    this.levelAt = { 1: 0 };
    this.statsAt = {};
    this.bands = Array.from({ length: 10 }, newBandStats);
    this.deathLog = [];
    this.angle = Math.random() * Math.PI * 2;
    this.reset();
    this.nextTown = NOW + 10 * 60000;
    this.lastLevel = 1;
    this.leader = null;
    metrics.set(name, this);
  }

  reset() {
    this.townDest = null;
    this.stuckTicks = 0;
    this.path = null;
    this.goal = null;
    this.mode = "hunt";
    this.stuck = 0;
    this.target = null;
  }

  bandStats() {
    return this.bands[band(this.p.stats.level)];
  }

  get hpFrac() {
    return this.p.stats.hp / this.p.stats.maxHp;
  }

  // Level of monsters this hero wants to fight.
  desiredLevel() {
    const L = this.p.stats.level;
    const party = this.leader ? world.partyMembers(this.p) : [this.p];
    const minL = Math.min(...party.map((m) => m.stats.level));
    return Math.max(1, Math.min(B.MAX_LEVEL + 2, minL + (this.recentDeath() ? -2 : 0)));
  }

  recentDeath() {
    const d = this.deathLog[this.deathLog.length - 1];
    return d && NOW - d.at < 10 * 60000;
  }

  step(dt) {
    const p = this.p;
    this.bandStats().ms += dt;
    if (p.stats.level !== this.lastLevel) {
      for (let l = this.lastLevel + 1; l <= p.stats.level; l++) {
        this.levelAt[l] = NOW - START;
        this.statsAt[l] = { atk: p.stats.atk, def: p.stats.def, hp: p.stats.maxHp };
      }
      this.lastLevel = p.stats.level;
    }
    if (p.downed) return;
    if (NOW - p.lastMove < 200) return; // human-ish pace: ~5 actions per second

    // Healing.
    const inCombat = NOW - p.lastHurt < 3000;
    if (this.hpFrac < 0.4 && p.stats.potions > 0 && inCombat) {
      if (world.drinkPotion(p)) this.bandStats().potions++;
    }
    this.useSkills(inCombat);

    if (this.mode === "hunt" && (this.wantsTown() || (this.hpFrac < 0.25 && p.stats.potions === 0))) {
      this.mode = "town";
      this.path = null;
    }
    if (this.mode === "town") return this.goTown();
    return this.hunt();
  }

  wantsTown() {
    const p = this.p;
    return (
      p.inventory.length >= INVENTORY_SIZE - 1 ||
      (p.stats.potions === 0 && p.stats.gold >= B.potionPrice(p.stats.level) * 3) ||
      NOW >= this.nextTown
    );
  }

  useSkills(inCombat) {
    const p = this.p;
    const skills = world.skillsOf(p);
    const close = monstersNear(p, 3).filter((m) => world.los(p.x, p.y, m.x, m.y));
    const adjacent = close.filter((m) => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
    const sight = monstersNear(p, 7);
    for (let i = 0; i < skills.length; i++) {
      const s = skills[i];
      if (p.stats.level < s.level || (p.cooldowns[s.id] || 0) > NOW) continue;
      let want = false;
      switch (s.id) {
        case "heal":
          want = world.partyMembers(p).some((m) => !m.downed && dist(m, p) <= 8 && m.stats.hp / m.stats.maxHp < 0.6) || this.hpFrac < 0.6;
          break;
        case "ironskin":
        case "smoke":
        case "sanctuary":
          want = inCombat && this.hpFrac < 0.5;
          break;
        case "cleave":
        case "backstab":
          want = adjacent.length > 0;
          break;
        case "warcry":
        case "berserk":
        case "frostnova":
        case "fan":
        case "holynova":
          want = close.length >= (s.id === "berserk" || s.id === "warcry" ? 1 : 2) || (close.length && close[0].boss);
          break;
        case "fireball":
        case "smite":
        case "chain":
        case "meteor":
        case "shadowstrike":
          want = sight.length > 0 && sight.some((m) => world.los(p.x, p.y, m.x, m.y)) && !(this.avoid(sight[0]));
          break;
      }
      if (want) {
        world.useSkill(p, i);
        return;
      }
    }
  }

  // Monsters this hero should not pick a fight with.
  avoid(m) {
    const L = this.p.stats.level;
    if (m.flees) return false;
    if (m.boss) {
      const party = this.leader ? world.partyMembers(this.p).length : 1;
      return L + (party - 1) * 2 < m.level - 1 || this.hpFrac < 0.85;
    }
    return m.level > L + 5;
  }

  hunt() {
    const p = this.p;
    // Fight: closest visible monster worth fighting.
    const near = monstersNear(p, 7).filter((m) => !this.avoid(m) && world.los(p.x, p.y, m.x, m.y));
    const attackers = monstersNear(p, 2).filter((m) => m.target === p.id);
    if (attackers.some((m) => this.avoid(m) && !m.boss)) {
      this.mode = "town";
      this.path = null;
      return this.goTown();
    }
    const target = attackers[0] || near[0];
    if (target) return this.engage(target);

    // Party followers stay with the leader.
    if (this.leader && this.leader !== this && !this.leader.p.downed) {
      const lp = this.leader.p;
      if (dist(lp, p) > 5) return this.walkTo(lp, true);
    }

    // Explore around the ring of the right level.
    const area = world.levelAt(p.x, p.y);
    const want = this.desiredLevel();
    if (!this.goal || dist(p, this.goal) < 3 || this.stuck > 6) {
      if (this.stuck > 6) this.angle += Math.PI / 2 + Math.random();
      else this.angle += (Math.random() - 0.5) * 0.9;
      const r = B.distanceForLevel(want) + Math.random() * 5;
      // Stay away from places where we died recently.
      for (let tries = 0; tries < 8; tries++) {
        this.goal = {
          x: Math.round(world.spawn.x + Math.cos(this.angle) * r),
          y: Math.round(world.spawn.y + Math.sin(this.angle) * r),
        };
        const danger = this.deathLog.some((d) => NOW - d.at < 15 * 60000 && dist(d, this.goal) < 15);
        if (!danger) break;
        this.angle += 0.8;
      }
      this.path = null;
      this.stuck = 0;
      // Use a waystone to skip the long walk.
      if (area < want - 8) this.tryWaystone(want);
    }
    return this.walkTo(this.goal, false);
  }

  engage(m) {
    const p = this.p;
    if (manhattan(m, p) === 1) {
      world.movePlayer(p, dirTo(p, m));
      return;
    }
    // Ranged classes still need to walk into melee for basic attacks.
    const path = bfs(p, { goal: (x, y) => x === m.x && y === m.y, limit: 1500 });
    if (path && path.length) {
      const next = path[0];
      const d = dirTo(p, next);
      if (d) world.movePlayer(p, d);
    } else {
      this.goal = null;
    }
  }

  // Walk toward a point (or the closest reachable floor tile to it).
  walkTo(to, exact) {
    const p = this.p;
    if (!this.path || !this.path.length || this.pathFor !== to) {
      this.pathFor = to;
      this.path = bfs(p, {
        goal: exact ? (x, y) => Math.abs(x - to.x) + Math.abs(y - to.y) <= 1 : null,
        score: exact ? null : (x, y) => Math.hypot(x - to.x, y - to.y),
        limit: 30000,
      });
      if (!this.path || !this.path.length) {
        this.stuck += 3;
        this.path = null;
        return;
      }
      this.path = this.path.slice(0, 40); // re-plan regularly as chunks appear
    }
    const next = this.path[0];
    const d = dirTo(p, next);
    if (!d) {
      this.path = null;
      this.stuck++;
      return;
    }
    const before = { x: p.x, y: p.y };
    const r = world.movePlayer(p, d);
    if (r.ok && r.reason === "move") this.path.shift();
    else if (!r.ok && r.reason !== "cooldown") {
      this.path = null;
      this.stuck++;
    }
    if (before.x === p.x && before.y === p.y && r.reason !== "attack") this.stuck += 0.2;
  }

  tryWaystone(want) {
    const p = this.p;
    const travel = world.travelOptions(p);
    if (!travel.can) return false;
    let best = null;
    for (const t of p.waystones) {
      const w = world.waystones.get(t);
      if (!w) continue;
      const lvl = world.levelAt(w.x, w.y);
      if (lvl <= want + 2 && (!best || lvl > best.lvl)) best = { t, lvl };
    }
    if (!best || best.lvl <= world.levelAt(p.x, p.y) + 4) return false;
    const r = world.travel(p, `ws:${best.t}`);
    if (r.ok) this.path = null;
    return r.ok;
  }

  goTown() {
    const p = this.p;
    if (world.nearMerchant(p)) return this.shop();
    // Travel home if standing on the safe room or a waystone.
    if (world.travelOptions(p).can && !world.inSafeRoom(p.x, p.y) && world.travel(p, "home").ok) return;
    // Otherwise head for the closer of home and a known waystone (chosen once per trip).
    if (!this.townDest) {
      let dest = world.merchant;
      let best = dist(p, world.merchant);
      for (const t of p.waystones) {
        const w = world.waystones.get(t);
        if (w && dist(w, p) + 15 < best) {
          best = dist(w, p);
          dest = w;
        }
      }
      this.townDest = dest;
    }
    const dest = this.townDest;
    if (dest !== world.merchant && Math.max(Math.abs(dest.x - p.x), Math.abs(dest.y - p.y)) <= 1 && world.canTravel(p)) {
      // At the waystone but can't travel yet (combat lock / cooldown): wait.
      this.stuck = 0;
      if (this.stuckTicks++ > 300) this.townDest = world.merchant;
      return;
    }
    // Monsters in the way get fought.
    const attackers = monstersNear(p, 1).filter((m) => m.target === p.id);
    if (attackers.length) return this.engage(attackers[0]);
    return this.walkTo(dest, true);
  }

  shop() {
    const p = this.p;
    const s = p.stats;
    this.bandStats().townTrips++;
    this.equipBest();
    // Sell everything that isn't equipped.
    for (const item of p.inventory.slice()) world.inventoryAction(p, "sell", item.uid);
    // Potions first.
    while (s.potions < MAX_POTIONS && world.buy(p, "potion").ok);
    // Then blacksmith on weapon/armor and permanent upgrades, cheapest first.
    const reserve = B.potionPrice(s.level) * 4;
    for (let guard = 0; guard < 60; guard++) {
      const options = [];
      for (const slot of ["weapon", "armor", "trinket"]) {
        const item = p.equipment[slot];
        if (item && (item.plus || 0) < world.MAX_PLUS) options.push({ kind: "smith", uid: item.uid, cost: world.upgradeCostOf(item) * (slot === "trinket" ? 1.5 : 1) });
      }
      const shop = world.shopFor(p);
      for (const id of ["atk", "def", "hp"]) {
        const it = shop.items.find((i) => i.id === id);
        if (!it.maxed) options.push({ kind: "buy", id, cost: it.price });
      }
      options.sort((a, b) => a.cost - b.cost);
      const o = options[0];
      if (!o || s.gold - o.cost < reserve) break;
      const r = o.kind === "smith" ? world.smith(p, "upgrade", o.uid) : world.buy(p, o.id);
      if (!r.ok) break;
    }
    this.nextTown = NOW + (12 + Math.random() * 8) * 60000;
    this.mode = "hunt";
    this.townDest = null;
    this.goal = null;
    this.path = null;
    p.lastHurt = 0;
    this.tryWaystone(this.desiredLevel());
  }

  // Equip anything that scores better than what is worn.
  equipBest() {
    const p = this.p;
    for (const item of p.inventory.slice()) {
      const cur = p.equipment[item.slot];
      if (world.itemScore(item) > world.itemScore(cur)) world.inventoryAction(p, "equip", item.uid);
    }
  }
}

// ---------------------------------------------------------------- run
const START = NOW;
const bots = CLASS_LIST.map((cls, i) => new Bot(`${cls}${i + 1}`, cls, i + 1));
if (PARTY && bots.length > 1) {
  const lead = bots[0];
  for (const b of bots.slice(1)) {
    world.partyAction(lead.p, "invite", b.p.username);
    world.partyAction(b.p, "accept");
  }
  for (const b of bots) b.leader = lead;
}

const END = START + HOURS * 3600000;
let nextReport = START + 3600000;
let stepCount = 0;
const realStart = process.hrtime.bigint();
const hours = (ms) => (ms / 3600000).toFixed(2);

rebuildIndex();
while (NOW < END) {
  NOW += STEP_MS;
  stepCount++;
  if (stepCount % (TICK_MS / STEP_MS) === 0) {
    world.tick();
    rebuildIndex();
  }
  for (const b of bots) {
    b.step(STEP_MS);
    // Equip upgrades as they drop (a real player would, too).
    if (b.p.inventory.length && stepCount % 20 === 0) b.equipBest();
    if (process.env.SIM_DEBUG2 && NOW - START > Number(process.env.SIM_DEBUG2) * 3600000 && stepCount % 10 === 0) {
      const p = b.p;
      const near = monstersNear(p, 3).map((m) => `${m.name}@${m.x},${m.y} t${m.target} r${!!m.returning} hp${m.hp}`);
      console.error(`DBG ${b.name} pos ${p.x},${p.y} mode ${b.mode} path ${JSON.stringify((b.path || []).slice(0, 3))} lastMove ${NOW - p.lastMove} near ${near.join("; ")} travel ${JSON.stringify(world.canTravel(p))}`);
    }
    if (process.env.SIM_DEBUG && stepCount % 300 === 0) {
      const p = b.p;
      console.error(`${hours(NOW - START)}h ${b.name} L${p.stats.level} hp${p.stats.hp}/${p.stats.maxHp} pos ${p.x},${p.y} area${world.levelAt(p.x, p.y)} mode ${b.mode} goal ${b.goal ? b.goal.x + "," + b.goal.y : "-"} stuck ${b.stuck.toFixed(1)} path ${b.path ? b.path.length : "-"} kills ${p.stats.kills} pots ${p.stats.potions}`);
    }
  }
  if (NOW >= nextReport) {
    nextReport += 3600000;
    if (!QUIET) {
      const line = bots
        .map((b) => `${b.name} L${b.p.stats.level} d${b.p.stats.deaths} g${b.p.stats.gold} @${world.levelAt(b.p.x, b.p.y)}`)
        .join(" | ");
      const real = Number(process.hrtime.bigint() - realStart) / 1e9;
      console.error(`[${hours(NOW - START)}h sim, ${real.toFixed(0)}s real, ${world.monsters.size} monsters] ${line}`);
    }
    if (bots.every((b) => b.p.stats.level >= B.MAX_LEVEL)) break;
  }
}

// ---------------------------------------------------------------- report
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const report = {};
console.log(`\nSimulated ${hours(NOW - START)}h · seed ${SEED} · ${PARTY ? "party" : "solo"} · ${bots.length} heroes\n`);
for (const b of bots) {
  const p = b.p;
  const s = p.stats;
  console.log(`${b.name} (${CLASSES[b.cls].name}): level ${s.level}, ${s.kills} kills, ${s.deaths} deaths, ${s.bossKills} bosses, gold ${s.gold}`);
  console.log(`  ATK ${s.atk}  DEF ${s.def}  HP ${s.maxHp}  crit ${fmt(s.crit * 100, 0)}%  dodge ${fmt(s.dodge * 100, 0)}%  lifesteal ${fmt(s.lifesteal * 100, 0)}%`);
  console.log(`  shop: +${p.bonus.atk} atk, +${p.bonus.def} def, +${p.bonus.hp} hp · gear: ${Object.values(p.equipment).filter(Boolean).map((i) => `${i.rarity} ${i.slot} i${i.ilvl}+${i.plus || 0}`).join(", ")}`);
  const bossKinds = Object.entries(p.counters.kinds).filter(([k]) => BOSSES.some((x) => x.type === k));
  console.log(`  bosses defeated: ${bossKinds.map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`);
  const marks = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].filter((l) => b.levelAt[l] !== undefined).map((l) => `L${l} ${hours(b.levelAt[l])}h`);
  console.log(`  reached: ${marks.join(" · ")}`);
  console.log("  levels   hours  deaths  kills  kills/min  hits-to-kill  dmg-taken/hit  potions  town");
  b.bands.forEach((st, i) => {
    if (!st.ms) return;
    console.log(
      `  ${String(i * 10 + 1).padStart(3)}-${String(i * 10 + 10).padEnd(3)}  ${hours(st.ms).padStart(5)}  ${String(st.deaths).padStart(6)}  ${String(st.kills).padStart(5)}  ${fmt(st.kills / (st.ms / 60000)).padStart(9)}  ${fmt(avg(st.hitsToKill)).padStart(12)}  ${(fmt(avg(st.dmgTakenPct) * 100) + "%").padStart(13)}  ${String(st.potions).padStart(7)}  ${String(st.townTrips).padStart(4)}`,
    );
  });
  console.log("  level  ATK   DEF   HP     | goblin@L: HP    ATK   DEF  -> hits-to-kill  dmg%/hit");
  for (const l of [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    const st = b.statsAt[l];
    if (!st) continue;
    const mb = B.monsterBase(l);
    const hit = st.atk * (1 - B.mitigation(mb.def, l));
    const taken = mb.atk * (1 - B.mitigation(st.def, l));
    console.log(`  ${String(l).padStart(5)}  ${String(st.atk).padStart(4)}  ${String(st.def).padStart(4)}  ${String(st.hp).padStart(5)}  |  ${String(Math.round(mb.hp)).padStart(6)}  ${mb.atk.toFixed(0).padStart(4)}  ${mb.def.toFixed(0).padStart(4)} -> ${(mb.hp / hit).toFixed(1).padStart(5)}  ${((taken / st.hp) * 100).toFixed(1).padStart(8)}%`);
  }
  if (process.env.SIM_DEATHS) console.log(b.deathLog.map((d) => `L${d.level} ${d.by} @${d.area} ${d.x},${d.y} ${hours(d.at - START)}h`).join("\n"));
  if (b.deathLog.length) console.log(`  deaths: ${b.deathLog.slice(-8).map((d) => `L${d.level} ${d.by}`).join(", ")}`);
  console.log("");
  report[b.name] = {
    cls: b.cls,
    level: s.level,
    deaths: s.deaths,
    levelAt: b.levelAt,
    bands: b.bands.map((st) => ({ ...st, hitsToKill: avg(st.hitsToKill), dmgTakenPct: avg(st.dmgTakenPct) })),
  };
}
if (JSON_OUT) require("fs").writeFileSync(JSON_OUT, JSON.stringify({ hours: HOURS, seed: SEED, party: PARTY, report }, null, 1));
