const { EventEmitter } = require("events");
const {
  MONSTERS,
  BOSSES,
  ITEMS,
  SHOP,
  SKILLS,
  PLAYER_BASE,
  MAX_POTIONS,
  TIER_DISTANCE,
  xpToNext,
} = require("./data");

const TICK_MS = 300;
const SIGHT = 9; // vision radius in tiles
const ACTIVE_RANGE = 25;
const MOVE_COOLDOWN = 110;
const ATTACK_COOLDOWN = 350;
const REGEN_DELAY = 6000;
const RESPAWN_EVERY_TICKS = 100; // ~30s
const DOWNED_MS = 20000;
const REVIVE_RANGE = 25; // an ally must be this close for you to go "down" instead of dying

const C = {
  info: [200, 200, 200],
  good: [120, 255, 120],
  bad: [255, 90, 90],
  gold: [255, 215, 0],
  epic: [255, 170, 40],
  hit: [230, 230, 230],
  crit: [255, 255, 0],
  skill: [150, 200, 255],
};

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
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const BOSS_NAMES = new Set(BOSSES.map((b) => b.name));
const withArticle = (name) =>
  BOSS_NAMES.has(name) ? `the ${name}` : /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;

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

    const safeRoom = this.map.rooms[0];
    this.safeRoomId = safeRoom ? safeRoom.id : null;
    this.spawn = this.findSpawn();
    this.merchant = safeRoom
      ? { x: safeRoom.x, y: safeRoom.y, name: "Merchant", char: "M", color: [255, 200, 120] }
      : null;

    for (const room of this.map.rooms) this.populateRoom(room);

    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- helpers
  findSpawn() {
    const room = this.map.rooms[0];
    if (room) return this.roomCenter(room);
    const c = Math.floor(this.map.size / 2);
    return { x: c, y: c };
  }

  roomCenter(room) {
    return {
      x: room.x + Math.floor(room.width / 2),
      y: room.y + Math.floor(room.height / 2),
    };
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.map.size && y < this.map.size;
  }

  cell(x, y) {
    return this.inBounds(x, y) ? this.map.grid[x][y] : 0;
  }

  isFloor(x, y) {
    return this.cell(x, y) !== 0;
  }

  inSafeRoom(x, y) {
    return this.safeRoomId !== null && this.cell(x, y) === this.safeRoomId;
  }

  isMerchant(x, y) {
    return this.merchant && this.merchant.x === x && this.merchant.y === y;
  }

  tierAt(x, y) {
    return Math.floor(dist({ x, y }, this.spawn) / TIER_DISTANCE);
  }

  monsterAt(x, y) {
    for (const m of this.monsters.values()) if (m.x === x && m.y === y) return m;
    return null;
  }

  playerAt(x, y, filter = () => true) {
    for (const p of this.players.values()) if (p.x === x && p.y === y && filter(p)) return p;
    return null;
  }

  // Can a monster step here? Monsters never enter the safe room.
  monsterCanEnter(x, y) {
    return (
      this.isFloor(x, y) &&
      !this.inSafeRoom(x, y) &&
      !this.monsterAt(x, y) &&
      !this.playerAt(x, y)
    );
  }

  // Bresenham line of sight: every tile between a and b must be floor.
  los(ax, ay, bx, by) {
    let x = ax;
    let y = ay;
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    while (true) {
      if (x === bx && y === by) return true;
      if ((x !== ax || y !== ay) && !this.isFloor(x, y)) return false;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  canSee(a, b, range) {
    return dist(a, b) <= range && this.los(a.x, a.y, b.x, b.y);
  }

  notify(player, text, color = C.info) {
    this.emit("message", { to: player.id, text, color });
  }

  announce(text, color = C.info) {
    this.emit("message", { to: null, text, color });
  }

  fx(player, type) {
    this.emit("fx", player.id, type);
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
    for (let i = 0; i < 25; i++) {
      const x = rand(room.x, room.x + room.width - 1);
      const y = rand(room.y, room.y + room.height - 1);
      if (this.monsterCanEnter(x, y) && !this.items.has(key(x, y))) return { x, y };
    }
    return null;
  }

  bossForTier(tier) {
    const options = BOSSES.filter((b) => b.tier <= tier && b.tier >= tier - 1);
    if (!options.length) return tier >= 8 ? BOSSES[BOSSES.length - 1] : null;
    return options[options.length - 1];
  }

  bossAlive(type) {
    for (const m of this.monsters.values()) if (m.type === type) return true;
    return false;
  }

  tryMakeLair(room, tier) {
    const boss = this.bossForTier(tier);
    if (!boss || this.bossAlive(boss.type)) return false;
    const pos = this.randomFreeTileInRoom(room);
    if (!pos) return false;
    this.spawnMonster(pos.x, pos.y, tier, room.id, boss);
    const chestPos = this.randomFreeTileInRoom(room);
    if (chestPos) this.dropItem(chestPos.x, chestPos.y, { kind: "chest", tier });
    for (let i = 0; i < 2; i++) {
      const p = this.randomFreeTileInRoom(room);
      if (p) this.spawnMonster(p.x, p.y, tier, room.id);
    }
    return true;
  }

  populateRoom(room) {
    if (room.id === this.safeRoomId) return;
    const c = this.roomCenter(room);
    if (dist(c, this.spawn) < 10) return;
    const tier = this.tierAt(c.x, c.y);

    if (tier >= 2 && chance(0.1) && this.tryMakeLair(room, tier)) return;

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
    if (chance(0.04)) {
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, { kind: "chest", tier });
    }
  }

  pickMonsterType(tier) {
    let candidates = MONSTERS.filter((m) => m.tier <= tier && m.tier >= tier - 2);
    if (!candidates.length) candidates = MONSTERS.slice(-3);
    const weights = candidates.map((m) => 1 + m.tier);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  spawnMonster(x, y, tier, roomId, forcedDef = null) {
    const def = forcedDef || this.pickMonsterType(tier);
    const boss = !!forcedDef;
    const elite = !boss && tier >= 2 && chance(0.1);
    const bonus = Math.max(0, tier - def.tier) * 0.15;
    const mult = elite ? 2 : 1;
    const maxHp = Math.round(def.hp * (1 + bonus) * mult);
    const monster = {
      id: this.nextMonsterId++,
      type: def.type,
      name: elite ? `Elite ${def.name}` : def.name,
      char: def.char,
      color: elite ? def.color.map((v) => Math.min(255, v + 60)) : def.color,
      x,
      y,
      hp: maxHp,
      maxHp,
      atk: Math.round(def.atk * (1 + bonus / 2) * (elite ? 1.4 : 1)),
      def: def.def + (elite ? 1 : 0),
      xp: Math.round(def.xp * (1 + bonus) * (elite ? 2.5 : 1)),
      gold: def.gold.map((g) => g * mult),
      speed: def.speed,
      aggro: def.aggro,
      ranged: def.ranged || 0,
      verb: def.verb,
      boss,
      elite,
      roomId,
      cooldown: rand(0, def.speed),
      lastHit: 0,
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
        return;
      }
    }
    list.push(item);
    this.items.set(k, list);
  }

  // --------------------------------------------------------------- players
  addPlayer(user) {
    const level = user.level || 1;
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
        level,
        xp: user.xp || 0,
        xpNext: xpToNext(level),
        gold: user.gold || 0,
        potions: user.potions ?? PLAYER_BASE.potions,
        kills: user.kills || 0,
        deaths: user.deaths || 0,
        maxDepth: user.max_depth || 0,
        bossKills: user.boss_kills || 0,
      },
      cooldowns: {},
      downed: null,
      lastMove: 0,
      lastAttack: 0,
      lastHurt: 0,
    };
    if (!(p.stats.hp > 0)) p.stats.hp = p.stats.maxHp;
    p.stats.hp = Math.min(p.stats.hp, p.stats.maxHp);

    this.ensureChunksAround(p.x, p.y);
    if (!this.isFloor(p.x, p.y) || this.isMerchant(p.x, p.y)) {
      p.x = this.spawn.x;
      p.y = this.spawn.y;
      this.ensureChunksAround(p.x, p.y);
    }
    this.players.set(p.id, p);
    this.markDirty(p);
    this.announce(`${p.username} entered the dungeon.`, C.good);
    this.changed();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return null;
    // Leaving while downed counts as dying.
    if (p.downed) this.killPlayer(p, p.downed.by);
    this.players.delete(id);
    this.announce(`${p.username} left the dungeon.`, [180, 180, 180]);
    this.changed();
    return p;
  }

  movePlayer(player, direction) {
    const d = DIRS[direction];
    if (!d) return { ok: false, reason: "invalid" };
    if (player.downed) return { ok: false, reason: "downed" };
    const now = Date.now();
    if (now - player.lastMove < MOVE_COOLDOWN) return { ok: false, reason: "cooldown" };

    const nx = player.x + d[0];
    const ny = player.y + d[1];

    const monster = this.monsterAt(nx, ny);
    if (monster) {
      if (now - player.lastAttack < ATTACK_COOLDOWN) return { ok: false, reason: "cooldown" };
      player.lastAttack = now;
      player.lastMove = now;
      const { dmg, crit } = this.rollDamage(player.stats.atk, monster.def);
      this.damageMonster(player, monster, dmg, crit ? "Critical! You hit" : "You hit");
      this.changed();
      return { ok: true, reason: "attack" };
    }

    const downedAlly = this.playerAt(nx, ny, (p) => p.downed);
    if (downedAlly) {
      player.lastMove = now;
      this.revive(downedAlly, player);
      this.changed();
      return { ok: true, reason: "revive" };
    }

    if (this.isMerchant(nx, ny)) {
      player.lastMove = now;
      this.emit("shop", player.id, this.shopFor(player));
      return { ok: true, reason: "shop" };
    }

    if (!this.isFloor(nx, ny)) return { ok: false, reason: "wall" };

    player.lastMove = now;
    player.x = nx;
    player.y = ny;
    this.ensureChunksAround(nx, ny);
    this.pickUp(player);
    this.checkDepthRecord(player);
    this.markDirty(player);
    this.changed();
    return { ok: true, reason: "move" };
  }

  checkDepthRecord(player) {
    const depth = this.tierAt(player.x, player.y);
    const s = player.stats;
    if (depth <= s.maxDepth) return;
    s.maxDepth = depth;
    const bonus = 10 * depth;
    s.gold += bonus;
    this.notify(player, `New depth record: ${depth}! Explorer's bonus +${bonus} gold.`, C.gold);
    if (depth >= 3) this.announce(`${player.username} has delved to depth ${depth}!`, C.epic);
  }

  giveGear(player) {
    const s = player.stats;
    const roll = Math.random();
    if (roll < 0.4) {
      s.atk += 1;
      this.notify(player, "You find a sharper blade! ATK +1", ITEMS.sword.color);
    } else if (roll < 0.8) {
      s.def += 1;
      this.notify(player, "You strap on an armor plate! DEF +1", ITEMS.armor.color);
    } else {
      s.maxHp += 5;
      s.hp += 5;
      this.notify(player, "A heart crystal! Max HP +5", ITEMS.heart.color);
    }
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
            this.notify(player, "Your potion bag is full.");
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
        case "chest": {
          const tier = item.tier || 0;
          const gold = rand(15, 30) * (tier + 1);
          s.gold += gold;
          s.potions = Math.min(MAX_POTIONS, s.potions + 1);
          this.notify(player, `You open a treasure chest: ${gold} gold and a potion!`, ITEMS.chest.color);
          this.giveGear(player);
          if (tier >= 3) this.giveGear(player);
          break;
        }
      }
    }
    if (left.length) this.items.set(k, left);
    else this.items.delete(k);
    this.markDirty(player);
  }

  drinkPotion(player) {
    if (player.downed) return false;
    const s = player.stats;
    if (s.potions <= 0) {
      this.notify(player, "You have no potions. The merchant sells them.");
      return false;
    }
    if (s.hp >= s.maxHp) {
      this.notify(player, "You are already at full health.");
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

  // ------------------------------------------------------------------ shop
  nearMerchant(player) {
    return this.merchant && chebyshev(player, this.merchant) <= 2;
  }

  shopFor(player) {
    return {
      gold: player.stats.gold,
      items: SHOP.map((i, idx) => ({
        key: String(idx + 1),
        id: i.id,
        name: i.name,
        price: i.price(player.stats),
      })),
    };
  }

  buy(player, id) {
    if (!this.nearMerchant(player) || player.downed) {
      return { ok: false, message: "You need to be next to the merchant." };
    }
    const entry = SHOP.find((i) => i.id === id);
    if (!entry) return { ok: false, message: "Unknown item." };
    const s = player.stats;
    const price = entry.price(s);
    if (s.gold < price) return { ok: false, message: `Not enough gold (need ${price}).` };
    if (id === "potion" && s.potions >= MAX_POTIONS) {
      return { ok: false, message: "Your potion bag is full." };
    }
    s.gold -= price;
    switch (id) {
      case "potion":
        s.potions++;
        break;
      case "atk":
        s.atk++;
        break;
      case "def":
        s.def++;
        break;
      case "hp":
        s.maxHp += 10;
        s.hp += 10;
        break;
    }
    this.notify(player, `You buy: ${entry.name} for ${price} gold.`, C.gold);
    this.markDirty(player);
    this.changed();
    return { ok: true, shop: this.shopFor(player) };
  }

  // ---------------------------------------------------------------- skills
  useSkill(player, id) {
    const skill = SKILLS.find((s) => s.id === id);
    if (!skill || player.downed) return;
    const s = player.stats;
    if (s.level < skill.level) {
      return this.notify(player, `${skill.name} unlocks at level ${skill.level}.`);
    }
    const now = Date.now();
    const readyAt = player.cooldowns[id] || 0;
    if (now < readyAt) {
      return this.notify(player, `${skill.name} is ready in ${Math.ceil((readyAt - now) / 1000)}s.`);
    }

    let used = false;
    if (id === "whirlwind") {
      const targets = Array.from(this.monsters.values()).filter((m) => chebyshev(m, player) === 1);
      if (!targets.length) return this.notify(player, "No enemies next to you.");
      this.notify(player, "You spin in a deadly Whirlwind!", C.skill);
      for (const m of targets) {
        const { dmg } = this.rollDamage(Math.round(s.atk * 0.9), m.def);
        this.damageMonster(player, m, dmg, "Whirlwind hits");
      }
      used = true;
    } else if (id === "rally") {
      this.notify(player, "You sound a Rally!", C.skill);
      for (const ally of this.players.values()) {
        if (dist(ally, player) > 6) continue;
        if (ally.downed) {
          this.revive(ally, player);
          continue;
        }
        const heal = Math.round(ally.stats.maxHp * 0.3);
        ally.stats.hp = Math.min(ally.stats.maxHp, ally.stats.hp + heal);
        this.markDirty(ally);
        if (ally !== player) this.notify(ally, `${player.username}'s Rally heals you.`, C.good);
      }
      used = true;
    } else if (id === "fireball") {
      let target = null;
      for (const m of this.monsters.values()) {
        if (!this.canSee(player, m, 8)) continue;
        if (!target || dist(m, player) < dist(target, player)) target = m;
      }
      if (!target) return this.notify(player, "No enemy in sight to target.");
      const { dmg } = this.rollDamage(s.atk * 2, Math.floor(target.def / 2));
      this.damageMonster(player, target, dmg, "Your Fireball scorches");
      used = true;
    }

    if (used) {
      player.cooldowns[id] = now + skill.cooldown;
      this.changed();
    }
  }

  // ---------------------------------------------------------------- combat
  rollDamage(atk, def) {
    let dmg = atk + rand(-1, 2) - def;
    const crit = chance(0.1);
    if (crit) dmg *= 2;
    return { dmg: Math.max(1, dmg), crit };
  }

  damageMonster(player, monster, dmg, prefix) {
    monster.hp -= dmg;
    monster.lastHit = Date.now();
    monster.target = player.id;
    this.notify(player, `${prefix} the ${monster.name} for ${dmg}.`, prefix.startsWith("Critical") ? C.crit : C.hit);
    if (monster.hp <= 0) this.killMonster(monster, player);
  }

  killMonster(monster, killer) {
    if (!this.monsters.has(monster.id)) return;
    this.monsters.delete(monster.id);
    killer.stats.kills++;
    this.notify(killer, `You slay the ${monster.name}! +${monster.xp} XP`, C.good);
    this.gainXp(killer, monster.xp);

    // Co-op: allies nearby share half the XP.
    const shared = Math.max(1, Math.floor(monster.xp / 2));
    for (const ally of this.players.values()) {
      if (ally === killer || ally.downed) continue;
      if (dist(ally, monster) <= 12) {
        this.notify(ally, `${killer.username} slays the ${monster.name}. +${shared} XP`, [120, 220, 120]);
        this.gainXp(ally, shared);
      }
    }

    const tier = this.tierAt(monster.x, monster.y);
    const gold = rand(monster.gold[0], monster.gold[1]);
    if (gold > 0) this.dropItem(monster.x, monster.y, { kind: "gold", amount: gold });

    if (monster.boss) {
      killer.stats.bossKills++;
      this.dropItem(monster.x, monster.y, { kind: "chest", tier: tier + 1 });
      this.dropItem(monster.x, monster.y, { kind: "potion" });
      this.announce(`*** ${killer.username} has defeated the ${monster.name}! ***`, C.epic);
      if (monster.type === "ancient_dragon") {
        this.announce(`${killer.username} is a DRAGONSLAYER!`, C.epic);
      }
    } else if (monster.elite) {
      this.dropItem(monster.x, monster.y, { kind: chance(0.5) ? "potion" : chance(0.5) ? "sword" : "armor" });
    } else {
      if (chance(0.18)) this.dropItem(monster.x, monster.y, { kind: "potion" });
      if (chance(0.04 + tier * 0.01)) this.dropItem(monster.x, monster.y, { kind: chance(0.5) ? "sword" : "armor" });
      if (chance(0.02)) this.dropItem(monster.x, monster.y, { kind: "heart" });
    }
    this.markDirty(killer);
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
      this.notify(player, `*** LEVEL UP! You are now level ${s.level}. ***`, C.crit);
      const unlocked = SKILLS.find((k) => k.level === s.level);
      if (unlocked) {
        this.notify(player, `New skill: ${unlocked.name} [${unlocked.key}] - ${unlocked.desc}!`, C.skill);
      }
      this.fx(player, "levelup");
      this.announce(`${player.username} reached level ${s.level}!`, [255, 230, 120]);
    }
    s.xpNext = xpToNext(s.level);
    this.markDirty(player);
  }

  monsterAttacks(monster, player, ranged) {
    const atk = ranged ? Math.round(monster.atk * 0.75) : monster.atk;
    const { dmg, crit } = this.rollDamage(atk, player.stats.def);
    player.stats.hp -= dmg;
    player.lastHurt = Date.now();
    const verb = ranged || !monster.verb.includes(" at") ? monster.verb : "hits";
    this.notify(
      player,
      `The ${monster.name} ${crit ? "critically " : ""}${verb} you for ${dmg}.`,
      C.bad,
    );
    this.fx(player, "hurt");
    this.markDirty(player);
    if (player.stats.hp <= 0) this.downOrKill(player, monster.name);
  }

  downOrKill(player, by) {
    player.stats.hp = 0;
    const allyNearby = Array.from(this.players.values()).some(
      (p) => p !== player && !p.downed && dist(p, player) <= REVIVE_RANGE,
    );
    if (!allyNearby) return this.killPlayer(player, by);
    player.downed = { until: Date.now() + DOWNED_MS, by };
    for (const m of this.monsters.values()) if (m.target === player.id) m.target = null;
    this.announce(
      `${player.username} is DOWN! Walk into them within ${DOWNED_MS / 1000}s to revive!`,
      C.bad,
    );
    this.notify(player, "You are down! Hold on - an ally can revive you.", C.bad);
  }

  revive(player, saviour) {
    player.downed = null;
    player.stats.hp = Math.max(1, Math.round(player.stats.maxHp * 0.4));
    player.lastHurt = Date.now();
    this.announce(`${saviour.username} revived ${player.username}!`, C.good);
    if (saviour !== player) this.gainXp(saviour, 5 * saviour.stats.level);
    this.markDirty(player);
  }

  killPlayer(player, by) {
    const s = player.stats;
    const lost = Math.floor(s.gold / 2);
    s.gold -= lost;
    s.deaths++;
    if (lost > 0) this.dropItem(player.x, player.y, { kind: "gold", amount: lost });
    this.announce(`${player.username} was slain by ${withArticle(by)}!`, C.bad);
    this.notify(player, `You died! You dropped ${lost} gold where you fell. Respawning...`, C.bad);
    player.downed = null;
    s.hp = s.maxHp;
    player.x = this.spawn.x;
    player.y = this.spawn.y;
    this.ensureChunksAround(player.x, player.y);
    for (const m of this.monsters.values()) if (m.target === player.id) m.target = null;
    this.markDirty(player);
  }

  // -------------------------------------------------------------- monster AI
  // A player a monster may go after: alive and outside the safe room.
  isPrey(p) {
    return !p.downed && !this.inSafeRoom(p.x, p.y);
  }

  stepMonsterTowards(monster, tx, ty) {
    const current = Math.abs(tx - monster.x) + Math.abs(ty - monster.y);
    const options = STEPS.map(([dx, dy]) => ({ x: monster.x + dx, y: monster.y + dy }))
      .filter((o) => this.monsterCanEnter(o.x, o.y))
      // Bosses never leave their lair.
      .filter((o) => !monster.boss || this.cell(o.x, o.y) === monster.roomId)
      .map((o) => ({ ...o, d: Math.abs(tx - o.x) + Math.abs(ty - o.y) }))
      .filter((o) => o.d <= current)
      .sort((a, b) => a.d - b.d || Math.random() - 0.5);
    if (!options.length) return false;
    monster.x = options[0].x;
    monster.y = options[0].y;
    return true;
  }

  updateMonster(monster) {
    let nearestDist = Infinity;
    for (const p of this.players.values()) nearestDist = Math.min(nearestDist, dist(p, monster));
    if (nearestDist > ACTIVE_RANGE) return false;

    if (monster.cooldown > 0) {
      monster.cooldown--;
      return false;
    }
    monster.cooldown = monster.speed - 1;

    let target = monster.target ? this.players.get(monster.target) : null;
    if (target && (!this.isPrey(target) || dist(target, monster) > monster.aggro * 1.5)) {
      target = null;
    }
    if (!target) {
      // Notice the closest player it can actually see.
      let best = null;
      for (const p of this.players.values()) {
        if (!this.isPrey(p) || !this.canSee(monster, p, monster.aggro)) continue;
        if (!best || dist(p, monster) < dist(best, monster)) best = p;
      }
      target = best;
    }
    monster.target = target ? target.id : null;

    if (target) {
      const adjacent = [target, ...this.players.values()].find(
        (p) => this.isPrey(p) && manhattan(p, monster) === 1,
      );
      if (adjacent) {
        this.monsterAttacks(monster, adjacent, false);
        return true;
      }
      const d = dist(target, monster);
      if (monster.ranged && d <= monster.ranged && this.los(monster.x, monster.y, target.x, target.y)) {
        // Ranged monsters keep shooting, but sometimes close in.
        if (chance(0.7)) {
          this.monsterAttacks(monster, target, true);
          return true;
        }
      }
      return this.stepMonsterTowards(monster, target.x, target.y);
    }

    if (chance(0.25)) {
      const [dx, dy] = STEPS[rand(0, 3)];
      const wx = monster.x + dx;
      const wy = monster.y + dy;
      if (this.monsterCanEnter(wx, wy) && (!monster.boss || this.cell(wx, wy) === monster.roomId)) {
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
      if (!room || room.id === this.safeRoomId) continue;
      const c = this.roomCenter(room);
      if (dist(c, this.spawn) < 10) continue;
      let nearest = Infinity;
      for (const p of this.players.values()) nearest = Math.min(nearest, dist(p, c));
      if (nearest < 15) continue;
      const tier = this.tierAt(c.x, c.y);
      if (tier >= 2 && chance(0.15) && this.tryMakeLair(room, tier)) return;
      const pos = this.randomFreeTileInRoom(room);
      if (pos) {
        this.spawnMonster(pos.x, pos.y, tier, room.id);
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

    const now = Date.now();
    for (const p of this.players.values()) {
      if (p.downed && now >= p.downed.until) {
        this.killPlayer(p, p.downed.by);
        changed = true;
      }
    }

    // Out-of-combat regeneration (faster in the safe room), every ~3s.
    if (this.tickCount % 10 === 0) {
      for (const p of this.players.values()) {
        const s = p.stats;
        if (p.downed || s.hp >= s.maxHp || now - p.lastHurt < REGEN_DELAY) continue;
        const amount = Math.max(1, Math.floor(s.maxHp / (this.inSafeRoom(p.x, p.y) ? 8 : 30)));
        s.hp = Math.min(s.maxHp, s.hp + amount);
        this.markDirty(p);
        changed = true;
      }
    }

    if (this.tickCount % RESPAWN_EVERY_TICKS === 0) this.respawnMonsters();

    if (changed) this.changed();
  }

  // ------------------------------------------------------------------ state
  // Tiles the player can currently see: line of sight within SIGHT, plus the
  // whole room they are standing in (rooms are lit).
  visibleGrid(player) {
    const originX = player.x - SIGHT;
    const originY = player.y - SIGHT;
    const size = SIGHT * 2 + 1;
    const grid = [];
    const here = this.cell(player.x, player.y);
    for (let gy = 0; gy < size; gy++) {
      const row = new Array(size).fill(null);
      for (let gx = 0; gx < size; gx++) {
        const x = originX + gx;
        const y = originY + gy;
        if (!this.inBounds(x, y)) continue;
        const inRadius = Math.hypot(x - player.x, y - player.y) <= SIGHT;
        let visible = inRadius && this.los(player.x, player.y, x, y);
        if (!visible && here > 0) {
          // lit room: room tiles and the walls around them
          for (let dy = -1; dy <= 1 && !visible; dy++) {
            for (let dx = -1; dx <= 1 && !visible; dx++) {
              if (this.cell(x + dx, y + dy) === here) visible = true;
            }
          }
        }
        if (visible) row[gx] = this.map.grid[x][y];
      }
      grid.push(row);
    }
    return { originX, originY, grid };
  }

  stateFor(player) {
    const now = Date.now();
    const view = this.visibleGrid(player);
    const isVisible = (o) => {
      const row = view.grid[o.y - view.originY];
      return row !== undefined && row[o.x - view.originX] !== undefined && row[o.x - view.originX] !== null;
    };

    const monsters = [];
    for (const m of this.monsters.values()) {
      if (!isVisible(m)) continue;
      monsters.push({
        id: m.id,
        name: m.name,
        char: m.char,
        color: m.color,
        x: m.x,
        y: m.y,
        hp: m.hp,
        maxHp: m.maxHp,
        boss: m.boss,
        elite: m.elite,
        hit: now - m.lastHit < 250,
        hunting: m.target === player.id,
      });
    }

    const items = [];
    for (const [k, list] of this.items) {
      if (!list.length) continue;
      const [x, y] = k.split(",").map(Number);
      if (!isVisible({ x, y })) continue;
      const top = list.find((i) => i.kind === "chest") || list[list.length - 1];
      const info = ITEMS[top.kind];
      items.push({ x, y, kind: top.kind, char: info.char, color: info.color });
    }

    const npcs = [];
    if (this.merchant && isVisible(this.merchant)) npcs.push(this.merchant);

    const nearbyPlayers = [];
    for (const p of this.players.values()) {
      if (p !== player && dist(p, player) <= SIGHT + 6) {
        nearbyPlayers.push({
          id: p.id,
          username: p.username,
          x: p.x,
          y: p.y,
          hp: p.stats.hp,
          maxHp: p.stats.maxHp,
          downed: !!p.downed,
        });
      }
    }

    return {
      now,
      player: {
        id: player.id,
        username: player.username,
        x: player.x,
        y: player.y,
        stats: player.stats,
        downedUntil: player.downed ? player.downed.until : null,
        safe: this.inSafeRoom(player.x, player.y),
        skills: SKILLS.map((s) => ({
          id: s.id,
          key: s.key,
          name: s.name,
          level: s.level,
          readyAt: player.cooldowns[s.id] || 0,
        })),
      },
      depth: this.tierAt(player.x, player.y),
      home: this.spawn,
      safeRoomId: this.safeRoomId,
      view,
      monsters,
      items,
      npcs,
      nearbyPlayers,
      online: Array.from(this.players.values()).map((p) => ({
        username: p.username,
        level: p.stats.level,
        hp: p.stats.hp,
        maxHp: p.stats.maxHp,
        downed: !!p.downed,
        depth: this.tierAt(p.x, p.y),
      })),
    };
  }
}

module.exports = { World, TICK_MS };
