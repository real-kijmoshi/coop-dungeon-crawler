const { EventEmitter } = require("events");
const {
  MONSTERS,
  ITEMS,
  PLAYER_BASE,
  MAX_POTIONS,
  TIER_DISTANCE,
  xpToNext,
} = require("./data");

const TICK_MS = 300;
const VIEW_RX = 18;
const VIEW_RY = 12;
const ACTIVE_RANGE = 25;
const SAFE_RADIUS = 10;
const MOVE_COOLDOWN = 110;
const ATTACK_COOLDOWN = 350;
const REGEN_DELAY = 6000;
const RESPAWN_EVERY_TICKS = 100; // ~30s

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;
const key = (x, y) => `${x},${y}`;
const DIRS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0],
};
const STEPS = Object.values(DIRS);

class World extends EventEmitter {
  constructor(map) {
    super();
    this.map = map;
    this.players = new Map(); // id -> player
    this.monsters = new Map(); // id -> monster
    this.items = new Map(); // "x,y" -> [item]
    this.nextMonsterId = 1;
    this.tickCount = 0;
    this.dirtyPlayers = new Set();
    this.spawn = this.findSpawn();

    // Populate rooms that already exist (loaded map).
    for (const room of this.map.rooms) this.populateRoom(room);

    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- helpers
  findSpawn() {
    const room = this.map.rooms[0];
    if (room) {
      return {
        x: room.x + Math.floor(room.width / 2),
        y: room.y + Math.floor(room.height / 2),
      };
    }
    const c = Math.floor(this.map.size / 2);
    return { x: c, y: c };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.map.size && y < this.map.size;
  }

  isFloor(x, y) {
    return this.inBounds(x, y) && this.map.grid[x][y] !== 0;
  }

  distFromSpawn(x, y) {
    return Math.hypot(x - this.spawn.x, y - this.spawn.y);
  }

  tierAt(x, y) {
    return Math.floor(this.distFromSpawn(x, y) / TIER_DISTANCE);
  }

  monsterAt(x, y) {
    for (const m of this.monsters.values()) if (m.x === x && m.y === y) return m;
    return null;
  }

  playerAt(x, y) {
    for (const p of this.players.values()) if (p.x === x && p.y === y) return p;
    return null;
  }

  isFree(x, y) {
    return this.isFloor(x, y) && !this.monsterAt(x, y) && !this.playerAt(x, y);
  }

  notify(player, text, color) {
    this.emit("message", { to: player.id, text, color });
  }

  announce(text, color) {
    this.emit("message", { to: null, text, color });
  }

  changed() {
    this.emit("changed");
  }

  markDirty(player) {
    this.dirtyPlayers.add(player.id);
  }

  takeDirtyPlayers() {
    const list = [];
    for (const id of this.dirtyPlayers) {
      const p = this.players.get(id);
      if (p) list.push(p);
    }
    this.dirtyPlayers.clear();
    return list;
  }

  // ------------------------------------------------------------ generation
  ensureChunksAround(x, y) {
    const { chunkX, chunkY } = this.map.getChunkCoords(x, y);
    let generated = false;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const before = this.map.rooms.length;
        if (this.map.generateChunk(chunkX + dx, chunkY + dy)) {
          generated = true;
          for (const room of this.map.rooms.slice(before)) this.populateRoom(room);
        }
      }
    }
    if (generated) this.map.scheduleSave();
  }

  randomFreeTileInRoom(room) {
    for (let i = 0; i < 20; i++) {
      const x = rand(room.x, room.x + room.width - 1);
      const y = rand(room.y, room.y + room.height - 1);
      if (this.isFree(x, y) && !this.items.has(key(x, y))) return { x, y };
    }
    return null;
  }

  roomCenter(room) {
    return {
      x: room.x + Math.floor(room.width / 2),
      y: room.y + Math.floor(room.height / 2),
    };
  }

  populateRoom(room) {
    const c = this.roomCenter(room);
    if (this.distFromSpawn(c.x, c.y) < SAFE_RADIUS) return;
    const tier = this.tierAt(c.x, c.y);

    const count = rand(0, 2) + (tier >= 3 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.spawnMonster(pos.x, pos.y, tier, room.id);
    }

    if (chance(0.35)) {
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, { kind: "gold", amount: rand(2, 6) * (tier + 1) });
    }
    if (chance(0.15)) {
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, { kind: "potion" });
    }
  }

  pickMonsterType(tier) {
    let candidates = MONSTERS.filter((m) => m.tier <= tier && m.tier >= tier - 2);
    if (!candidates.length) candidates = MONSTERS.slice(-3);
    // Weight towards the strongest allowed monster.
    const weights = candidates.map((m) => 1 + m.tier);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  spawnMonster(x, y, tier, roomId) {
    const def = this.pickMonsterType(tier);
    const bonus = Math.max(0, tier - def.tier) * 0.15;
    const maxHp = Math.round(def.hp * (1 + bonus));
    const monster = {
      id: this.nextMonsterId++,
      type: def.type,
      name: def.name,
      char: def.char,
      color: def.color,
      x,
      y,
      hp: maxHp,
      maxHp,
      atk: Math.round(def.atk * (1 + bonus / 2)),
      def: def.def,
      xp: Math.round(def.xp * (1 + bonus)),
      gold: def.gold,
      speed: def.speed,
      aggro: def.aggro,
      roomId,
      cooldown: rand(0, def.speed),
    };
    this.monsters.set(monster.id, monster);
    return monster;
  }

  dropItem(x, y, item) {
    const k = key(x, y);
    const list = this.items.get(k) || [];
    if (item.kind === "gold") {
      const pile = list.find((i) => i.kind === "gold");
      if (pile) {
        pile.amount += item.amount;
        this.items.set(k, list);
        return;
      }
    }
    list.push(item);
    this.items.set(k, list);
  }

  // --------------------------------------------------------------- players
  addPlayer(user) {
    const p = {
      id: user.id,
      username: user.username,
      x: user.position_x,
      y: user.position_y,
      stats: {
        hp: user.hp,
        maxHp: user.max_hp || PLAYER_BASE.maxHp,
        atk: user.atk || PLAYER_BASE.atk,
        def: user.def ?? PLAYER_BASE.def,
        level: user.level || 1,
        xp: user.xp || 0,
        xpNext: xpToNext(user.level || 1),
        gold: user.gold || 0,
        potions: user.potions ?? PLAYER_BASE.potions,
        kills: user.kills || 0,
        deaths: user.deaths || 0,
      },
      lastMove: 0,
      lastAttack: 0,
      lastHurt: 0,
    };
    if (!(p.stats.hp > 0)) p.stats.hp = p.stats.maxHp;
    p.stats.hp = Math.min(p.stats.hp, p.stats.maxHp);

    this.ensureChunksAround(p.x, p.y);
    if (!this.isFloor(p.x, p.y)) {
      p.x = this.spawn.x;
      p.y = this.spawn.y;
      this.ensureChunksAround(p.x, p.y);
    }
    this.players.set(p.id, p);
    this.markDirty(p);
    this.announce(`${p.username} entered the dungeon.`, [120, 255, 120]);
    this.changed();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return null;
    this.players.delete(id);
    this.announce(`${p.username} left the dungeon.`, [180, 180, 180]);
    this.changed();
    return p;
  }

  movePlayer(player, direction) {
    const d = DIRS[direction];
    if (!d) return { ok: false, reason: "invalid" };
    const now = Date.now();
    if (now - player.lastMove < MOVE_COOLDOWN) return { ok: false, reason: "cooldown" };

    const nx = player.x + d[0];
    const ny = player.y + d[1];

    const monster = this.monsterAt(nx, ny);
    if (monster) {
      if (now - player.lastAttack < ATTACK_COOLDOWN) return { ok: false, reason: "cooldown" };
      player.lastAttack = now;
      player.lastMove = now;
      this.playerAttacks(player, monster);
      this.changed();
      return { ok: true, reason: "attack" };
    }

    if (!this.isFloor(nx, ny)) return { ok: false, reason: "wall" };

    player.lastMove = now;
    player.x = nx;
    player.y = ny;
    this.ensureChunksAround(nx, ny);
    this.pickUp(player);
    this.markDirty(player);
    this.changed();
    return { ok: true, reason: "move" };
  }

  pickUp(player) {
    const k = key(player.x, player.y);
    const list = this.items.get(k);
    if (!list) return;
    const s = player.stats;
    const left = [];
    for (const item of list) {
      switch (item.kind) {
        case "gold":
          s.gold += item.amount;
          this.notify(player, `You pick up ${item.amount} gold.`, ITEMS.gold.color);
          break;
        case "potion":
          if (s.potions >= MAX_POTIONS) {
            left.push(item);
            this.notify(player, "Your potion bag is full.", [200, 200, 200]);
          } else {
            s.potions++;
            this.notify(player, "You pick up a healing potion. (H to drink)", ITEMS.potion.color);
          }
          break;
        case "sword":
          s.atk += 1;
          this.notify(player, "You find a sharper blade! ATK +1", ITEMS.sword.color);
          break;
        case "armor":
          s.def += 1;
          this.notify(player, "You strap on an armor plate! DEF +1", ITEMS.armor.color);
          break;
        case "heart":
          s.maxHp += 5;
          s.hp += 5;
          this.notify(player, "A heart crystal! Max HP +5", ITEMS.heart.color);
          break;
      }
    }
    if (left.length) this.items.set(k, left);
    else this.items.delete(k);
    this.markDirty(player);
  }

  drinkPotion(player) {
    const s = player.stats;
    if (s.potions <= 0) {
      this.notify(player, "You have no potions.", [200, 200, 200]);
      return false;
    }
    if (s.hp >= s.maxHp) {
      this.notify(player, "You are already at full health.", [200, 200, 200]);
      return false;
    }
    s.potions--;
    const heal = Math.max(15, Math.round(s.maxHp * 0.4));
    const before = s.hp;
    s.hp = Math.min(s.maxHp, s.hp + heal);
    this.notify(player, `You drink a potion and heal ${s.hp - before} HP.`, ITEMS.potion.color);
    this.markDirty(player);
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- combat
  rollDamage(atk, def) {
    let dmg = atk + rand(-1, 2) - def;
    const crit = chance(0.1);
    if (crit) dmg *= 2;
    return { dmg: Math.max(1, dmg), crit };
  }

  playerAttacks(player, monster) {
    const { dmg, crit } = this.rollDamage(player.stats.atk, monster.def);
    monster.hp -= dmg;
    monster.target = player.id;
    this.notify(
      player,
      `${crit ? "Critical! " : ""}You hit the ${monster.name} for ${dmg}.`,
      crit ? [255, 255, 0] : [230, 230, 230],
    );
    if (monster.hp <= 0) this.killMonster(monster, player);
  }

  killMonster(monster, killer) {
    this.monsters.delete(monster.id);
    killer.stats.kills++;
    this.notify(killer, `You slay the ${monster.name}! +${monster.xp} XP`, [120, 255, 120]);
    this.gainXp(killer, monster.xp);

    // Co-op: allies nearby share half the XP.
    const shared = Math.max(1, Math.floor(monster.xp / 2));
    for (const ally of this.players.values()) {
      if (ally === killer) continue;
      if (Math.hypot(ally.x - monster.x, ally.y - monster.y) <= 10) {
        this.notify(ally, `${killer.username} slays a ${monster.name}. +${shared} XP`, [120, 220, 120]);
        this.gainXp(ally, shared);
      }
    }

    const tier = this.tierAt(monster.x, monster.y);
    const gold = rand(monster.gold[0], monster.gold[1]);
    if (gold > 0) this.dropItem(monster.x, monster.y, { kind: "gold", amount: gold });
    if (chance(0.2)) this.dropItem(monster.x, monster.y, { kind: "potion" });
    if (chance(0.05 + tier * 0.01)) this.dropItem(monster.x, monster.y, { kind: chance(0.5) ? "sword" : "armor" });
    if (chance(0.03)) this.dropItem(monster.x, monster.y, { kind: "heart" });

    if (monster.type === "dragon") {
      this.announce(`${killer.username} has slain a DRAGON!`, [255, 120, 0]);
    }
  }

  gainXp(player, amount) {
    const s = player.stats;
    s.xp += amount;
    while (s.xp >= xpToNext(s.level)) {
      s.xp -= xpToNext(s.level);
      s.level++;
      s.maxHp += 8;
      s.atk += 2;
      if (s.level % 2 === 0) s.def += 1;
      s.hp = s.maxHp;
      this.notify(player, `*** LEVEL UP! You are now level ${s.level}. ***`, [255, 255, 0]);
      this.announce(`${player.username} reached level ${s.level}!`, [255, 230, 120]);
    }
    s.xpNext = xpToNext(s.level);
    this.markDirty(player);
  }

  monsterAttacks(monster, player) {
    const { dmg, crit } = this.rollDamage(monster.atk, player.stats.def);
    player.stats.hp -= dmg;
    player.lastHurt = Date.now();
    this.notify(
      player,
      `The ${monster.name} ${crit ? "critically " : ""}hits you for ${dmg}.`,
      [255, 90, 90],
    );
    this.markDirty(player);
    if (player.stats.hp <= 0) this.killPlayer(player, monster);
  }

  killPlayer(player, monster) {
    const s = player.stats;
    const lost = Math.floor(s.gold / 2);
    s.gold -= lost;
    s.deaths++;
    if (lost > 0) this.dropItem(player.x, player.y, { kind: "gold", amount: lost });
    this.announce(`${player.username} was slain by a ${monster.name}!`, [255, 80, 80]);
    this.notify(
      player,
      `You died! You dropped ${lost} gold where you fell. Respawning...`,
      [255, 80, 80],
    );
    s.hp = s.maxHp;
    player.x = this.spawn.x;
    player.y = this.spawn.y;
    this.ensureChunksAround(player.x, player.y);
    for (const m of this.monsters.values()) if (m.target === player.id) m.target = null;
    this.markDirty(player);
  }

  // -------------------------------------------------------------- monster AI
  nearestPlayer(monster) {
    let best = null;
    let bestDist = Infinity;
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - monster.x, p.y - monster.y);
      if (d < bestDist) {
        best = p;
        bestDist = d;
      }
    }
    return { player: best, dist: bestDist };
  }

  stepMonsterTowards(monster, tx, ty) {
    const current = Math.abs(tx - monster.x) + Math.abs(ty - monster.y);
    const options = STEPS.map(([dx, dy]) => ({
      x: monster.x + dx,
      y: monster.y + dy,
    }))
      .filter((o) => this.isFree(o.x, o.y))
      .map((o) => ({ ...o, d: Math.abs(tx - o.x) + Math.abs(ty - o.y) }))
      .filter((o) => o.d <= current)
      .sort((a, b) => a.d - b.d || Math.random() - 0.5);
    if (options.length) {
      monster.x = options[0].x;
      monster.y = options[0].y;
      return true;
    }
    return false;
  }

  updateMonster(monster) {
    const { player: nearest, dist } = this.nearestPlayer(monster);
    if (!nearest || dist > ACTIVE_RANGE) return false;

    if (monster.cooldown > 0) {
      monster.cooldown--;
      return false;
    }
    monster.cooldown = monster.speed - 1;

    let target = monster.target ? this.players.get(monster.target) : null;
    if (target && Math.hypot(target.x - monster.x, target.y - monster.y) > monster.aggro * 1.5) {
      target = null;
    }
    if (!target && dist <= monster.aggro) target = nearest;
    monster.target = target ? target.id : null;

    if (target) {
      // Attack any adjacent player, preferring the target.
      const adjacent = [target, ...this.players.values()].find(
        (p) => Math.abs(p.x - monster.x) + Math.abs(p.y - monster.y) === 1,
      );
      if (adjacent) {
        this.monsterAttacks(monster, adjacent);
        return true;
      }
      return this.stepMonsterTowards(monster, target.x, target.y);
    }

    if (chance(0.25)) {
      const [dx, dy] = STEPS[rand(0, 3)];
      if (this.isFree(monster.x + dx, monster.y + dy)) {
        monster.x += dx;
        monster.y += dy;
        return true;
      }
    }
    return false;
  }

  respawnMonsters() {
    const cap = Math.floor(this.map.rooms.length * 1.5);
    if (this.monsters.size >= cap) return;
    for (let i = 0; i < 5; i++) {
      const room = this.map.rooms[rand(0, this.map.rooms.length - 1)];
      if (!room) return;
      const c = this.roomCenter(room);
      if (this.distFromSpawn(c.x, c.y) < SAFE_RADIUS) continue;
      const { dist } = this.nearestPlayer({ x: c.x, y: c.y });
      if (dist < 15) continue;
      const pos = this.randomFreeTileInRoom(room);
      if (pos) {
        this.spawnMonster(pos.x, pos.y, this.tierAt(pos.x, pos.y), room.id);
        return;
      }
    }
  }

  tick() {
    this.tickCount++;
    let changed = false;

    for (const monster of Array.from(this.monsters.values())) {
      if (this.updateMonster(monster)) changed = true;
    }

    // Out-of-combat regeneration, roughly every 3 seconds.
    if (this.tickCount % 10 === 0) {
      const now = Date.now();
      for (const p of this.players.values()) {
        const s = p.stats;
        if (s.hp < s.maxHp && now - p.lastHurt > REGEN_DELAY) {
          s.hp = Math.min(s.maxHp, s.hp + Math.max(1, Math.floor(s.maxHp / 30)));
          this.markDirty(p);
          changed = true;
        }
      }
    }

    if (this.tickCount % RESPAWN_EVERY_TICKS === 0) this.respawnMonsters();

    if (changed) this.changed();
  }

  // ------------------------------------------------------------------ state
  stateFor(player) {
    const originX = player.x - VIEW_RX;
    const originY = player.y - VIEW_RY;
    const maxX = player.x + VIEW_RX;
    const maxY = player.y + VIEW_RY;
    const grid = [];
    for (let y = originY; y <= maxY; y++) {
      const row = [];
      for (let x = originX; x <= maxX; x++) {
        row.push(this.inBounds(x, y) ? this.map.grid[x][y] : null);
      }
      grid.push(row);
    }
    const inView = (o) => o.x >= originX && o.x <= maxX && o.y >= originY && o.y <= maxY;

    const monsters = [];
    for (const m of this.monsters.values()) {
      if (inView(m)) {
        monsters.push({
          id: m.id,
          name: m.name,
          char: m.char,
          color: m.color,
          x: m.x,
          y: m.y,
          hp: m.hp,
          maxHp: m.maxHp,
          hunting: m.target === player.id,
        });
      }
    }

    const items = [];
    for (const [k, list] of this.items) {
      const [x, y] = k.split(",").map(Number);
      if (!inView({ x, y }) || !list.length) continue;
      const top = list[list.length - 1];
      const info = ITEMS[top.kind];
      items.push({ x, y, kind: top.kind, char: info.char, color: info.color });
    }

    const nearbyPlayers = [];
    for (const p of this.players.values()) {
      if (p !== player && inView(p)) {
        nearbyPlayers.push({
          id: p.id,
          username: p.username,
          x: p.x,
          y: p.y,
          hp: p.stats.hp,
          maxHp: p.stats.maxHp,
        });
      }
    }

    return {
      player: {
        id: player.id,
        username: player.username,
        x: player.x,
        y: player.y,
        stats: player.stats,
      },
      depth: this.tierAt(player.x, player.y),
      map: { width: this.map.size, height: this.map.size },
      view: { originX, originY, grid },
      monsters,
      items,
      nearbyPlayers,
      online: Array.from(this.players.values()).map((p) => ({
        username: p.username,
        level: p.stats.level,
        hp: p.stats.hp,
        maxHp: p.stats.maxHp,
      })),
    };
  }
}

module.exports = { World, TICK_MS };
