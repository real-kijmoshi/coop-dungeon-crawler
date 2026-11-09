const { EventEmitter } = require("events");
const {
  CLASSES,
  MONSTERS,
  TREASURE_GOBLIN,
  BOSSES,
  ITEMS,
  SHOP,
  SHRINES,
  EVENTS,
  EVENT_INTERVAL,
  ACHIEVEMENTS,
  PLAYER_START,
  MAX_POTIONS,
  INVENTORY_SIZE,
  TIER_DISTANCE,
  SLOTS,
  xpToNext,
} = require("./data");
const { generateItem, describeStats, itemLabel, floorLook, rarityById } = require("./loot");
const { generateQuest, progressQuests } = require("./quests");

const TICK_MS = 300;
const SIGHT = 12; // vision radius in tiles
const ACTIVE_RANGE = 25;
const MOVE_COOLDOWN = 110;
const ATTACK_COOLDOWN = 350;
const REGEN_DELAY = 6000;
const RESPAWN_EVERY_TICKS = 100; // ~30s
const DOWNED_MS = 20000;
const REVIVE_RANGE = 25;
const COMBO_WINDOW = 4000;

const C = {
  info: [200, 200, 200],
  good: [120, 255, 120],
  bad: [255, 90, 90],
  gold: [255, 215, 0],
  epic: [255, 170, 40],
  hit: [230, 230, 230],
  crit: [255, 255, 0],
  skill: [150, 200, 255],
  quest: [255, 200, 120],
  achieve: [255, 120, 255],
};

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
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

const NO_CLASS = { name: "Adventurer", base: { maxHp: 30, atk: 5, def: 1 }, growth: { maxHp: 8, atk: 2, def: 0.5 }, crit: 0.08, dodge: 0.03, skills: [] };

class World extends EventEmitter {
  constructor(map, opts = {}) {
    super();
    this.map = map;
    this.players = new Map(); // id -> player
    this.monsters = new Map(); // id -> monster
    this.items = new Map(); // "x,y" -> [item]
    this.nextMonsterId = 1;
    this.tickCount = 0;
    this.dirtyPlayers = new Set();
    this.dirtyProfiles = new Set();
    this.event = null;
    this.eventInterval = opts.eventInterval || EVENT_INTERVAL;
    this.nextEventAt = Date.now() + rand(...this.eventInterval);

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
    return { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) };
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

  monsterCanEnter(x, y) {
    return (
      this.isFloor(x, y) &&
      !this.inSafeRoom(x, y) &&
      !this.isMerchant(x, y) &&
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

  visibleMonsters(player, range) {
    return Array.from(this.monsters.values())
      .filter((m) => this.canSee(player, m, range))
      .sort((a, b) => dist(a, player) - dist(b, player));
  }

  notify(player, text, color = C.info) {
    this.emit("message", { to: player.id, text, color });
  }

  announce(text, color = C.info) {
    this.emit("message", { to: null, text, color });
  }

  // type: hurt | levelup | legendary | toast | death; text shows as a big banner
  fx(player, type, text = null, color = null) {
    this.emit("fx", player.id, { type, text, color });
  }

  // Floating combat text at a world position, seen by players nearby.
  floater(x, y, text, color) {
    this.emit("floater", { x, y, text: String(text), color });
  }

  changed() {
    this.emit("changed");
  }

  markDirty(player) {
    this.dirtyPlayers.add(player.id);
  }

  markProfile(player) {
    this.dirtyProfiles.add(player.id);
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

  takeDirtyProfiles() {
    const list = [];
    for (const id of this.dirtyProfiles) {
      const p = this.players.get(id);
      if (p) list.push(p);
    }
    this.dirtyProfiles.clear();
    return list;
  }

  eventActive(id) {
    return this.event && this.event.id === id;
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

    const place = (item, p = 1) => {
      if (!chance(p)) return;
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, item);
    };
    place({ kind: "gold", amount: rand(2, 6) * (tier + 1) }, 0.35);
    place({ kind: "potion" }, 0.15);
    place({ kind: "chest", tier }, 0.04);
    place({ kind: "shrine" }, 0.05);
    place({ kind: "gear", item: generateItem(tier + 1) }, 0.06);
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
    const boss = !!forcedDef && BOSS_NAMES.has(def.name);
    const elite = !forcedDef && tier >= 2 && chance(0.08 + tier * 0.015);
    const bonus = Math.max(0, tier - def.tier) * 0.25;
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
      atk: Math.round(def.atk * (1 + bonus * 0.7) * (elite ? 1.4 : 1)),
      def: def.def + (elite ? 1 : 0),
      xp: Math.round(def.xp * (1 + bonus) * (elite ? 2.5 : 1)),
      gold: def.gold.map((g) => g * mult),
      speed: def.speed,
      aggro: def.aggro,
      ranged: def.ranged || 0,
      verb: def.verb,
      undead: !!def.undead,
      flees: !!def.flees,
      boss,
      elite,
      roomId,
      cooldown: rand(0, def.speed),
      lastHit: 0,
      frozenUntil: 0,
      tauntUntil: 0,
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
  addPlayer(user, data = {}) {
    const level = user.level || 1;
    const p = {
      id: user.id,
      username: user.username,
      x: user.position_x,
      y: user.position_y,
      cls: CLASSES[user.cls] ? user.cls : null,
      title: user.title || null,
      stats: {
        hp: user.hp,
        level,
        xp: user.xp || 0,
        xpNext: xpToNext(level),
        gold: user.gold || 0,
        potions: data.potions ?? PLAYER_START.potions,
        kills: user.kills || 0,
        deaths: user.deaths || 0,
        maxDepth: user.max_depth || 0,
        bossKills: user.boss_kills || 0,
      },
      bonus: { atk: 0, def: 0, hp: 0, ...(data.bonus || {}) },
      equipment: { weapon: null, armor: null, trinket: null, ...(data.equipment || {}) },
      inventory: Array.isArray(data.inventory) ? data.inventory : [],
      quests: Array.isArray(data.quests) ? data.quests : [],
      achievements: Array.isArray(data.achievements) ? data.achievements : [],
      counters: { kinds: {}, ...(data.counters || {}) },
      cooldowns: {},
      buffs: {},
      combo: { count: 0, until: 0 },
      downed: null,
      lastMove: 0,
      lastAttack: 0,
      lastHurt: 0,
    };
    this.recalc(p);
    if (!(p.stats.hp > 0)) p.stats.hp = p.stats.maxHp;
    p.stats.hp = Math.min(p.stats.hp, p.stats.maxHp);
    while (p.quests.length < 3) p.quests.push(generateQuest(p, p.quests));

    this.ensureChunksAround(p.x, p.y);
    if (!this.isFloor(p.x, p.y) || this.isMerchant(p.x, p.y)) {
      p.x = this.spawn.x;
      p.y = this.spawn.y;
      this.ensureChunksAround(p.x, p.y);
    }
    this.players.set(p.id, p);
    this.markProfile(p);
    this.announce(`${this.displayName(p)} entered the dungeon.`, C.good);
    if (this.event) this.notify(p, `Event in progress: ${this.event.name} - ${this.event.desc}`, this.event.color);
    this.changed();
    return p;
  }

  // Data that is persisted as JSON alongside the user row.
  saveData(p) {
    return {
      potions: p.stats.potions,
      bonus: p.bonus,
      equipment: p.equipment,
      inventory: p.inventory,
      quests: p.quests,
      achievements: p.achievements,
      counters: p.counters,
    };
  }

  displayName(p) {
    return p.title ? `${p.username} ${p.title}` : p.username;
  }

  classOf(p) {
    return CLASSES[p.cls] || NO_CLASS;
  }

  // Recompute derived stats from class, level, permanent bonuses and gear.
  recalc(p) {
    const c = this.classOf(p);
    const s = p.stats;
    const L = s.level - 1;
    const gear = {};
    for (const slot of SLOTS) {
      const item = p.equipment[slot];
      if (!item) continue;
      for (const [k, v] of Object.entries(item.stats)) gear[k] = (gear[k] || 0) + v;
    }
    s.maxHp = Math.round(c.base.maxHp + c.growth.maxHp * L) + p.bonus.hp + (gear.maxHp || 0);
    s.atk = Math.round(c.base.atk + c.growth.atk * L) + p.bonus.atk + (gear.atk || 0);
    s.def = Math.floor(c.base.def + c.growth.def * L) + p.bonus.def + (gear.def || 0);
    s.crit = Math.min(0.75, c.crit + (gear.crit || 0));
    s.dodge = Math.min(0.5, c.dodge + (gear.dodge || 0));
    s.lifesteal = gear.lifesteal || 0;
    s.goldFind = gear.goldFind || 0;
    s.xpBonus = gear.xpBonus || 0;
    s.regen = gear.regen || 0;
    s.xpNext = xpToNext(s.level);
    if (s.hp > s.maxHp) s.hp = s.maxHp;
  }

  chooseClass(p, id) {
    if (p.cls) return { ok: false, message: "You already chose a class." };
    const c = CLASSES[id];
    if (!c) return { ok: false, message: "Unknown class." };
    p.cls = id;
    const starter = generateItem(1, { slot: c.starter.slot, base: c.starter.base, rarity: "common" });
    starter.name = `Trusty ${c.starter.base}`;
    p.equipment[starter.slot] = starter;
    this.recalc(p);
    p.stats.hp = p.stats.maxHp;
    this.announce(`${p.username} takes up the path of the ${c.name}!`, c.color);
    this.notify(p, `You are a ${c.name}. Your first skill, ${c.skills[0].name}, is on key [1].`, C.skill);
    this.markProfile(p);
    this.changed();
    return { ok: true };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return null;
    if (p.downed) this.killPlayer(p, p.downed.by);
    this.players.delete(id);
    this.announce(`${p.username} left the dungeon.`, [180, 180, 180]);
    this.changed();
    return p;
  }

  // ---------------------------------------------------------------- buffs
  hasBuff(p, id) {
    return p.buffs[id] && p.buffs[id].until > Date.now();
  }

  addBuff(p, id, name, ms) {
    p.buffs[id] = { name, until: Date.now() + ms };
  }

  effAtk(p) {
    let m = 1;
    if (this.hasBuff(p, "power")) m *= 1.4;
    if (this.hasBuff(p, "berserk")) m *= 1.6;
    return Math.round(p.stats.atk * m);
  }

  effDef(p) {
    let m = 1;
    if (this.hasBuff(p, "protection")) m *= 1.5;
    if (this.hasBuff(p, "warcry")) m *= 1.5;
    return Math.round(p.stats.def * m) + (this.hasBuff(p, "sanctuary") ? 3 : 0);
  }

  effLifesteal(p) {
    return p.stats.lifesteal + (this.hasBuff(p, "berserk") ? 0.2 : 0) + (this.hasBuff(p, "vampire") ? 0.15 : 0);
  }

  // ---------------------------------------------------------------- moving
  movePlayer(player, direction) {
    const d = DIRS[direction];
    if (!d) return { ok: false, reason: "invalid" };
    if (!player.cls) return { ok: false, reason: "noclass" };
    if (player.downed) return { ok: false, reason: "downed" };
    const now = Date.now();
    const cd = this.hasBuff(player, "haste") ? MOVE_COOLDOWN / 2 : MOVE_COOLDOWN;
    if (now - player.lastMove < cd) return { ok: false, reason: "cooldown" };

    const nx = player.x + d[0];
    const ny = player.y + d[1];

    const monster = this.monsterAt(nx, ny);
    if (monster) {
      const acd = this.hasBuff(player, "haste") ? ATTACK_COOLDOWN * 0.7 : ATTACK_COOLDOWN;
      if (now - player.lastAttack < acd) return { ok: false, reason: "cooldown" };
      player.lastAttack = now;
      player.lastMove = now;
      this.hitMonster(player, monster, 1, { label: "You hit" });
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
    this.questEvent(player, "depth", { depth });
    this.checkAchievements(player);
  }

  // ------------------------------------------------------------ inventory
  giveItem(player, item, { announceRare = true } = {}) {
    const r = rarityById(item.rarity);
    if (!player.equipment[item.slot]) {
      player.equipment[item.slot] = item;
      this.recalc(player);
      this.notify(player, `You equip ${itemLabel(item)} (${describeStats(item.stats)})`, r.color);
    } else if (player.inventory.length < INVENTORY_SIZE) {
      player.inventory.push(item);
      const cur = player.equipment[item.slot];
      const better = this.itemScore(item) > this.itemScore(cur) ? " ▲ upgrade! (I to equip)" : "";
      this.notify(player, `You find ${itemLabel(item)} (${describeStats(item.stats)})${better}`, r.color);
    } else {
      return false;
    }
    if (item.rarity === "legendary") {
      player.counters.legendaries = (player.counters.legendaries || 0) + 1;
      this.fx(player, "legendary", `LEGENDARY: ${item.name}`, r.color);
      if (announceRare) this.announce(`${player.username} found a LEGENDARY item: ${item.name}!`, r.color);
    } else if (item.rarity === "epic" && announceRare) {
      this.announce(`${player.username} found an epic ${item.name}.`, r.color);
    }
    this.checkAchievements(player);
    this.markProfile(player);
    return true;
  }

  // rough "how good is it" number used for upgrade hints
  itemScore(item) {
    if (!item) return 0;
    const s = item.stats;
    return (
      (s.atk || 0) * 2 + (s.def || 0) * 2.5 + (s.maxHp || 0) * 0.4 +
      (s.crit || 0) * 60 + (s.dodge || 0) * 60 + (s.lifesteal || 0) * 80 +
      (s.goldFind || 0) * 15 + (s.xpBonus || 0) * 25 + (s.regen || 0) * 2
    );
  }

  inventoryAction(player, action, arg) {
    const idx = player.inventory.findIndex((i) => i.uid === arg);
    const item = idx >= 0 ? player.inventory[idx] : null;
    switch (action) {
      case "equip": {
        if (!item) return { ok: false, message: "No such item." };
        const old = player.equipment[item.slot];
        player.inventory.splice(idx, 1);
        if (old) player.inventory.push(old);
        player.equipment[item.slot] = item;
        this.recalc(player);
        this.notify(player, `You equip ${itemLabel(item)}.`, rarityById(item.rarity).color);
        break;
      }
      case "unequip": {
        const slotItem = player.equipment[arg];
        if (!slotItem) return { ok: false, message: "Nothing equipped there." };
        if (player.inventory.length >= INVENTORY_SIZE) return { ok: false, message: "Inventory full." };
        player.equipment[arg] = null;
        player.inventory.push(slotItem);
        this.recalc(player);
        break;
      }
      case "sell": {
        if (!item) return { ok: false, message: "No such item." };
        if (!this.nearMerchant(player)) return { ok: false, message: "Sell at the Merchant (M) in the safe room." };
        player.inventory.splice(idx, 1);
        player.stats.gold += item.value;
        this.notify(player, `Sold ${item.name} for ${item.value} gold.`, C.gold);
        break;
      }
      case "selljunk": {
        if (!this.nearMerchant(player)) return { ok: false, message: "Sell at the Merchant (M) in the safe room." };
        let total = 0;
        let n = 0;
        player.inventory = player.inventory.filter((i) => {
          if (i.rarity !== "common" && i.rarity !== "magic") return true;
          total += i.value;
          n++;
          return false;
        });
        player.stats.gold += total;
        this.notify(player, n ? `Sold ${n} common/magic items for ${total} gold.` : "Nothing to sell.", C.gold);
        break;
      }
      case "drop": {
        if (!item) return { ok: false, message: "No such item." };
        player.inventory.splice(idx, 1);
        this.dropItem(player.x, player.y, { kind: "gear", item, droppedBy: player.id, droppedAt: Date.now() });
        this.notify(player, `You drop ${item.name}.`);
        break;
      }
      case "title": {
        const titles = this.titlesOf(player);
        if (!titles.length) return { ok: false, message: "Earn achievements to unlock titles." };
        const i = titles.indexOf(player.title);
        player.title = titles[(i + 1) % (titles.length + 1)] || null;
        this.notify(player, player.title ? `Your title is now "${player.title}".` : "Title hidden.", C.achieve);
        break;
      }
      default:
        return { ok: false, message: "Unknown action." };
    }
    this.markProfile(player);
    this.changed();
    return { ok: true };
  }

  titlesOf(player) {
    return ACHIEVEMENTS.filter((a) => player.achievements.includes(a.id)).map((a) => a.title);
  }

  pickUp(player) {
    const k = key(player.x, player.y);
    const list = this.items.get(k);
    if (!list) return;
    const s = player.stats;
    const left = [];
    for (const item of list) {
      switch (item.kind) {
        case "gold": {
          const amount = Math.round(item.amount * (1 + s.goldFind) * (this.hasBuff(player, "fortune") ? 2 : 1));
          this.addGold(player, amount);
          this.floater(player.x, player.y, `+${amount}g`, ITEMS.gold.color);
          this.notify(player, `You pick up ${amount} gold.`, ITEMS.gold.color);
          break;
        }
        case "potion":
          if (s.potions >= MAX_POTIONS) {
            left.push(item);
            this.notify(player, "Your potion bag is full.");
          } else {
            s.potions++;
            this.notify(player, "You pick up a healing potion. (H to drink)", ITEMS.potion.color);
          }
          break;
        case "heart":
          player.bonus.hp += 5;
          this.recalc(player);
          s.hp += 5;
          this.notify(player, "A heart crystal! Max HP +5 permanently.", ITEMS.heart.color);
          break;
        case "shrine": {
          const shrine = pick(SHRINES);
          this.addBuff(player, shrine.id, shrine.name.replace(/^Shrine of /, ""), shrine.duration);
          this.notify(player, `${shrine.name}: ${shrine.desc} for ${shrine.duration / 1000}s!`, ITEMS.shrine.color);
          this.fx(player, "toast", `${shrine.name}: ${shrine.desc}`, ITEMS.shrine.color);
          break;
        }
        case "gear":
          // Don't instantly re-pick an item you just dropped.
          if (item.droppedBy === player.id && Date.now() - item.droppedAt < 5000) {
            left.push(item);
          } else if (!this.giveItem(player, item.item)) {
            left.push(item);
            this.notify(player, "Your inventory is full! Sell or drop something (I).", C.bad);
          }
          break;
        case "chest": {
          const tier = item.tier || 0;
          const gold = rand(15, 30) * (tier + 1);
          this.addGold(player, gold);
          s.potions = Math.min(MAX_POTIONS, s.potions + 1);
          this.notify(player, `You open a treasure chest: ${gold} gold and a potion!`, ITEMS.chest.color);
          const n = tier >= 3 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const loot = generateItem(tier + 1, { boost: 3 });
            if (!this.giveItem(player, loot)) this.dropItem(player.x, player.y, { kind: "gear", item: loot });
          }
          player.counters.chests = (player.counters.chests || 0) + 1;
          this.questEvent(player, "chest");
          break;
        }
      }
    }
    // Items that couldn't be taken stay; gear that stays shouldn't be re-tried endlessly.
    if (left.length) this.items.set(k, left);
    else this.items.delete(k);
    this.markProfile(player);
  }

  addGold(player, amount) {
    player.stats.gold += amount;
    player.counters.goldEarned = (player.counters.goldEarned || 0) + amount;
    this.questEvent(player, "gold", { amount });
  }

  drinkPotion(player) {
    if (player.downed || !player.cls) return false;
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
    const healed = this.healPlayer(player, Math.max(15, Math.round(s.maxHp * 0.4)));
    this.notify(player, `You drink a potion and heal ${healed} HP.`, ITEMS.potion.color);
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
        price: Math.round(i.price(player.bonus, player.stats.level)),
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
    const price = Math.round(entry.price(player.bonus, s.level));
    if (s.gold < price) return { ok: false, message: `Not enough gold (need ${price}).` };
    if (id === "potion" && s.potions >= MAX_POTIONS) return { ok: false, message: "Your potion bag is full." };
    if (id === "gamble" && player.inventory.length >= INVENTORY_SIZE) {
      return { ok: false, message: "Your inventory is full." };
    }
    s.gold -= price;
    switch (id) {
      case "potion":
        s.potions++;
        break;
      case "atk":
        player.bonus.atk++;
        break;
      case "def":
        player.bonus.def++;
        break;
      case "hp":
        player.bonus.hp += 10;
        s.hp += 10;
        break;
      case "gamble": {
        const item = generateItem(Math.max(1, s.maxDepth + 1), { boost: 2.5 });
        this.notify(player, "The merchant hands you a wrapped bundle...", C.gold);
        this.giveItem(player, item);
        break;
      }
    }
    this.recalc(player);
    if (id !== "gamble") this.notify(player, `You buy: ${entry.name} for ${price} gold.`, C.gold);
    this.markProfile(player);
    this.changed();
    return { ok: true, shop: this.shopFor(player) };
  }

  // ---------------------------------------------------------------- skills
  skillsOf(player) {
    return this.classOf(player).skills;
  }

  useSkill(player, index) {
    const skills = this.skillsOf(player);
    const skill = typeof index === "number" ? skills[index] : skills.find((s) => s.id === index);
    if (!skill || player.downed) return;
    const s = player.stats;
    if (s.level < skill.level) {
      return this.notify(player, `${skill.name} unlocks at level ${skill.level}.`);
    }
    const now = Date.now();
    const readyAt = player.cooldowns[skill.id] || 0;
    if (now < readyAt) {
      return this.notify(player, `${skill.name} is ready in ${Math.ceil((readyAt - now) / 1000)}s.`);
    }
    const used = this.castSkill(player, skill.id);
    if (used) {
      player.cooldowns[skill.id] = now + skill.cooldown;
      this.changed();
    }
  }

  aoe(player, targets, mult, label, opts = {}) {
    let total = 0;
    let kills = 0;
    for (const m of targets) {
      const r = this.hitMonster(player, m, mult, { ...opts, quiet: true });
      total += r.dmg;
      if (r.killed) kills++;
    }
    this.notify(
      player,
      `${label} hits ${targets.length} enem${targets.length === 1 ? "y" : "ies"} for ${total} damage${kills ? ` (${kills} slain)` : ""}!`,
      C.skill,
    );
  }

  castSkill(player, id) {
    const near = (r) => Array.from(this.monsters.values()).filter((m) => chebyshev(m, player) <= r && this.los(player.x, player.y, m.x, m.y));
    const allies = (r) => Array.from(this.players.values()).filter((a) => dist(a, player) <= r);
    const now = Date.now();
    switch (id) {
      // ---- warrior
      case "cleave": {
        const t = near(1);
        if (!t.length) return this.notify(player, "No enemies next to you."), false;
        this.aoe(player, t, 1, "Cleave");
        return true;
      }
      case "warcry": {
        const t = near(6);
        for (const m of t) {
          m.target = player.id;
          m.tauntUntil = now + 6000;
        }
        this.addBuff(player, "warcry", "War Cry", 6000);
        this.notify(player, `You roar! ${t.length} enemies turn on you. DEF +50%.`, C.skill);
        return true;
      }
      case "ironskin":
        this.addBuff(player, "ironskin", "Iron Skin", 6000);
        this.notify(player, "Your skin hardens to iron!", C.skill);
        return true;
      case "berserk":
        this.addBuff(player, "berserk", "Berserk", 8000);
        this.notify(player, "You fly into a BERSERK rage!", C.skill);
        this.fx(player, "toast", "BERSERK!", [255, 80, 60]);
        return true;
      // ---- rogue
      case "backstab": {
        const t = near(1).sort((a, b) => manhattan(a, player) - manhattan(b, player))[0];
        if (!t) return this.notify(player, "No enemy next to you."), false;
        const unaware = t.target !== player.id;
        this.hitMonster(player, t, 2.5, { label: "You backstab", forceCrit: unaware });
        return true;
      }
      case "smoke":
        this.addBuff(player, "hidden", "Hidden", 4000);
        for (const m of this.monsters.values()) {
          if (m.target === player.id) m.target = null;
        }
        this.notify(player, "You vanish in a cloud of smoke!", C.skill);
        return true;
      case "fan": {
        const t = near(3);
        if (!t.length) return this.notify(player, "No enemies within 3 tiles."), false;
        this.aoe(player, t, 1.2, "Fan of Knives");
        return true;
      }
      case "shadowstrike": {
        const t = this.visibleMonsters(player, 8)[0];
        if (!t) return this.notify(player, "No enemy in sight."), false;
        const spot = STEPS.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).find(
          (o) => this.isFloor(o.x, o.y) && !this.monsterAt(o.x, o.y) && !this.isMerchant(o.x, o.y),
        );
        if (spot) {
          player.x = spot.x;
          player.y = spot.y;
          this.ensureChunksAround(spot.x, spot.y);
        }
        this.hitMonster(player, t, 4, { label: "Shadow Strike! You hit", forceCrit: false });
        return true;
      }
      // ---- mage
      case "fireball": {
        const t = this.visibleMonsters(player, 8)[0];
        if (!t) return this.notify(player, "No enemy in sight to target."), false;
        this.hitMonster(player, t, 2, { label: "Your Fireball scorches", halfDef: true });
        return true;
      }
      case "frostnova": {
        const t = near(3);
        if (!t.length) return this.notify(player, "No enemies within 3 tiles."), false;
        for (const m of t) m.frozenUntil = now + 4000;
        this.aoe(player, t, 1, "Frost Nova freezes and", { halfDef: true });
        return true;
      }
      case "chain": {
        const t = this.visibleMonsters(player, 8).slice(0, 4);
        if (!t.length) return this.notify(player, "No enemy in sight."), false;
        this.aoe(player, t, 1.4, "Chain Lightning", { halfDef: true });
        return true;
      }
      case "meteor": {
        const t = this.visibleMonsters(player, 6);
        if (!t.length) return this.notify(player, "No enemy in sight."), false;
        this.aoe(player, t, 3, "METEOR", { halfDef: true });
        this.fx(player, "toast", "☄ METEOR ☄", [255, 120, 40]);
        return true;
      }
      // ---- cleric
      case "heal": {
        const candidates = allies(8);
        const downed = candidates.find((a) => a.downed);
        if (downed) {
          this.revive(downed, player);
          return true;
        }
        const target = candidates.sort((a, b) => a.stats.hp / a.stats.maxHp - b.stats.hp / b.stats.maxHp)[0];
        if (!target || target.stats.hp >= target.stats.maxHp) return this.notify(player, "Everyone is at full health."), false;
        const amount = this.healPlayer(target, Math.round(target.stats.maxHp * 0.35));
        this.notify(player, `You heal ${target === player ? "yourself" : target.username} for ${amount}.`, C.good);
        if (target !== player) this.notify(target, `${player.username} heals you for ${amount}.`, C.good);
        return true;
      }
      case "smite": {
        const t = this.visibleMonsters(player, 7)[0];
        if (!t) return this.notify(player, "No enemy in sight."), false;
        this.hitMonster(player, t, t.undead ? 3 : 1.8, { label: t.undead ? "HOLY SMITE! You blast" : "You smite", halfDef: true });
        return true;
      }
      case "sanctuary": {
        for (const a of allies(6)) {
          if (a.downed) this.revive(a, player);
          else this.healPlayer(a, Math.round(a.stats.maxHp * 0.4));
          this.addBuff(a, "sanctuary", "Sanctuary", 8000);
          if (a !== player) this.notify(a, `${player.username}'s Sanctuary protects you.`, C.good);
        }
        this.notify(player, "A holy Sanctuary surrounds your party!", C.skill);
        return true;
      }
      case "holynova": {
        const t = near(4);
        for (const a of allies(6)) if (!a.downed) this.healPlayer(a, Math.round(a.stats.maxHp * 0.2));
        if (t.length) this.aoe(player, t, 2, "Holy Nova", { halfDef: true });
        else this.notify(player, "Holy Nova heals your party.", C.skill);
        return true;
      }
    }
    return false;
  }

  healPlayer(p, amount, show = true) {
    const before = p.stats.hp;
    p.stats.hp = Math.min(p.stats.maxHp, p.stats.hp + amount);
    this.markDirty(p);
    const healed = p.stats.hp - before;
    if (show && healed >= 3) this.floater(p.x, p.y, `+${healed}`, [110, 255, 130]);
    return healed;
  }

  // ---------------------------------------------------------------- combat
  // opts: label, forceCrit, halfDef, quiet. Returns { dmg, killed }.
  hitMonster(player, monster, mult, opts = {}) {
    const def = opts.halfDef ? Math.floor(monster.def / 2) : monster.def;
    let dmg = Math.round(this.effAtk(player) * mult) + rand(-1, 2) - def;
    const crit = opts.forceCrit || chance(player.stats.crit);
    if (crit) dmg *= 2;
    dmg = Math.max(1, dmg);
    monster.hp -= dmg;
    monster.lastHit = Date.now();
    this.floater(monster.x, monster.y, crit ? `${dmg}!` : dmg, crit ? [255, 230, 60] : [255, 255, 255]);
    if (!monster.flees && !(monster.tauntUntil > Date.now())) monster.target = player.id;

    const ls = this.effLifesteal(player);
    if (ls > 0) this.healPlayer(player, Math.max(1, Math.round(dmg * ls)), false);

    if (!opts.quiet) {
      this.notify(
        player,
        `${crit ? "CRIT! " : ""}${opts.label || "You hit"} the ${monster.name} for ${dmg}.`,
        crit ? C.crit : C.hit,
      );
    }
    const killed = monster.hp <= 0;
    if (killed) this.killMonster(monster, player);
    return { dmg, killed };
  }

  killMonster(monster, killer) {
    if (!this.monsters.has(monster.id)) return;
    this.monsters.delete(monster.id);
    const now = Date.now();
    const k = killer.stats;
    k.kills++;
    const kinds = killer.counters.kinds;
    kinds[monster.type] = (kinds[monster.type] || 0) + 1;
    if (monster.undead) killer.counters.undead = (killer.counters.undead || 0) + 1;
    if (monster.elite) killer.counters.elites = (killer.counters.elites || 0) + 1;

    // Kill combo
    const combo = killer.combo;
    combo.count = now < combo.until ? combo.count + 1 : 1;
    combo.until = now + COMBO_WINDOW;
    killer.counters.bestCombo = Math.max(killer.counters.bestCombo || 0, combo.count);
    const comboMult = 1 + Math.min(1, 0.1 * (combo.count - 1));

    const xpMult =
      (1 + k.xpBonus) * (this.hasBuff(killer, "wisdom") ? 1.5 : 1) * (this.eventActive("bloodmoon") ? 1.75 : 1);
    const xp = Math.round(monster.xp * xpMult * comboMult);
    const comboText = combo.count >= 3 ? `  COMBO x${combo.count}! (+${Math.round((comboMult - 1) * 100)}% XP)` : "";
    this.notify(killer, `You slay the ${monster.name}! +${xp} XP${comboText}`, combo.count >= 3 ? C.crit : C.good);
    this.gainXp(killer, xp);

    // Co-op: allies nearby share half the XP.
    const shared = Math.max(1, Math.floor((monster.xp * xpMult) / 2));
    for (const ally of this.players.values()) {
      if (ally === killer || ally.downed) continue;
      if (dist(ally, monster) <= 12) {
        this.notify(ally, `${killer.username} slays the ${monster.name}. +${shared} XP`, [120, 220, 120]);
        this.gainXp(ally, shared);
      }
    }

    const tier = this.tierAt(monster.x, monster.y);
    const goldMult = this.eventActive("goldrush") ? 2 : 1;
    const gold = rand(monster.gold[0], monster.gold[1]) * goldMult;
    if (gold > 0) this.dropItem(monster.x, monster.y, { kind: "gold", amount: gold });

    const dropMult = (this.eventActive("frenzy") ? 3 : 1) * (this.eventActive("bloodmoon") ? 1.5 : 1);
    const dropGear = (boost) => this.dropItem(monster.x, monster.y, { kind: "gear", item: generateItem(tier + 1, { boost }) });

    if (monster.boss) {
      k.bossKills++;
      this.dropItem(monster.x, monster.y, { kind: "chest", tier: tier + 1 });
      this.dropItem(monster.x, monster.y, { kind: "potion" });
      dropGear(5);
      dropGear(5);
      this.announce(`*** ${killer.username} has defeated the ${monster.name}! ***`, C.epic);
      this.fx(killer, "toast", `${monster.name.toUpperCase()} DEFEATED!`, C.epic);
      if (monster.type === "ancient_dragon") this.announce(`${killer.username} is a DRAGONSLAYER!`, C.epic);
    } else if (monster.flees) {
      dropGear(3);
      dropGear(3);
      this.announce(`${killer.username} caught a Treasure Goblin!`, [255, 230, 60]);
    } else if (monster.elite) {
      dropGear(2);
      if (chance(0.5)) this.dropItem(monster.x, monster.y, { kind: "potion" });
    } else {
      if (chance(0.17)) this.dropItem(monster.x, monster.y, { kind: "potion" });
      if (chance(0.09 * dropMult)) dropGear(1);
      if (chance(0.015)) this.dropItem(monster.x, monster.y, { kind: "heart" });
    }

    this.questEvent(killer, "kill", { type: monster.type, elite: monster.elite, depth: tier });
    if (combo.count >= 3) this.questEvent(killer, "combo", { combo: combo.count });
    this.checkAchievements(killer);
    this.markProfile(killer);
  }

  gainXp(player, amount) {
    const s = player.stats;
    s.xp += amount;
    while (s.xp >= xpToNext(s.level)) {
      s.xp -= xpToNext(s.level);
      s.level++;
      this.recalc(player);
      s.hp = s.maxHp;
      this.notify(player, `*** LEVEL UP! You are now level ${s.level}. ***`, C.crit);
      const unlocked = this.skillsOf(player).find((k) => k.level === s.level);
      if (unlocked) {
        const idx = this.skillsOf(player).indexOf(unlocked) + 1;
        this.notify(player, `New skill: ${unlocked.name} [${idx}] - ${unlocked.desc}!`, C.skill);
      }
      this.fx(player, "levelup", `★ LEVEL ${s.level} ★`, [255, 220, 80]);
      this.floater(player.x, player.y, "LEVEL UP!", [255, 230, 80]);
      this.announce(`${player.username} reached level ${s.level}!`, [255, 230, 120]);
      this.checkAchievements(player);
    }
    s.xpNext = xpToNext(s.level);
    this.markDirty(player);
  }

  // --------------------------------------------------------- quests/achievs
  questEvent(player, event, data) {
    const done = progressQuests(player.quests, event, data);
    for (const q of done) {
      this.notify(player, `BOUNTY COMPLETE: ${q.desc}! +${q.reward.gold} gold, +${q.reward.xp} XP${q.reward.item ? ", and an item" : ""}`, C.quest);
      this.fx(player, "toast", `BOUNTY COMPLETE: ${q.desc}`, C.quest);
      this.addGold(player, q.reward.gold);
      player.counters.quests = (player.counters.quests || 0) + 1;
      if (q.reward.item) {
        const item = generateItem(Math.max(1, player.stats.maxDepth + 1), { boost: 3 });
        if (!this.giveItem(player, item)) this.dropItem(player.x, player.y, { kind: "gear", item });
      }
      this.gainXp(player, q.reward.xp);
      player.quests = player.quests.filter((x) => x !== q);
      const next = generateQuest(player, player.quests);
      player.quests.push(next);
      this.notify(player, `New bounty: ${next.desc}`, C.quest);
    }
    if (done.length) this.checkAchievements(player);
    this.markProfile(player);
  }

  checkAchievements(player) {
    for (const a of ACHIEVEMENTS) {
      if (player.achievements.includes(a.id) || !a.check(player)) continue;
      player.achievements.push(a.id);
      player.title = a.title;
      this.notify(player, `ACHIEVEMENT UNLOCKED: ${a.name} - ${a.desc}. New title: "${a.title}" (J to change)`, C.achieve);
      this.announce(`${player.username} earned the achievement [${a.name}]!`, C.achieve);
      this.fx(player, "toast", `ACHIEVEMENT: ${a.name}`, C.achieve);
      this.markProfile(player);
    }
  }

  // ------------------------------------------------------- taking damage
  monsterAttacks(monster, player, ranged) {
    if (chance(player.stats.dodge)) {
      this.notify(player, `You dodge the ${monster.name}'s attack!`, [160, 255, 200]);
      this.floater(player.x, player.y, "dodge", [160, 255, 220]);
      return;
    }
    let atk = ranged ? Math.round(monster.atk * 0.75) : monster.atk;
    if (this.eventActive("bloodmoon")) atk = Math.round(atk * 1.3);
    let dmg = atk + rand(-1, 2) - this.effDef(player);
    const crit = chance(0.08);
    if (crit) dmg *= 2;
    if (this.hasBuff(player, "ironskin")) dmg = Math.round(dmg * 0.3);
    dmg = Math.max(1, dmg);
    player.stats.hp -= dmg;
    player.lastHurt = Date.now();
    this.floater(player.x, player.y, `-${dmg}`, [255, 90, 90]);
    const verb = ranged || !monster.verb.includes(" at") ? monster.verb : "hits";
    this.notify(player, `The ${monster.name} ${crit ? "critically " : ""}${verb} you for ${dmg}.`, C.bad);
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
    this.announce(`${player.username} is DOWN! Walk into them within ${DOWNED_MS / 1000}s to revive!`, C.bad);
    this.notify(player, "You are down! Hold on - an ally can revive you.", C.bad);
    this.fx(player, "death", "✚ YOU ARE DOWN ✚", [255, 90, 90]);
  }

  revive(player, saviour) {
    player.downed = null;
    player.stats.hp = Math.max(1, Math.round(player.stats.maxHp * 0.4));
    player.lastHurt = Date.now();
    this.announce(`${saviour.username} revived ${player.username}!`, C.good);
    this.fx(player, "toast", `Revived by ${saviour.username}!`, C.good);
    if (saviour !== player) {
      saviour.counters.revives = (saviour.counters.revives || 0) + 1;
      this.gainXp(saviour, 5 * saviour.stats.level);
      this.checkAchievements(saviour);
    }
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
    this.fx(player, "death", "☠ YOU DIED ☠", [255, 70, 70]);
    player.downed = null;
    player.buffs = {};
    player.combo = { count: 0, until: 0 };
    s.hp = s.maxHp;
    player.x = this.spawn.x;
    player.y = this.spawn.y;
    this.ensureChunksAround(player.x, player.y);
    for (const m of this.monsters.values()) if (m.target === player.id) m.target = null;
    this.markProfile(player);
  }

  // -------------------------------------------------------------- monster AI
  isPrey(p) {
    return !!p.cls && !p.downed && !this.inSafeRoom(p.x, p.y) && !this.hasBuff(p, "hidden");
  }

  stepMonster(monster, tx, ty, away = false) {
    const current = Math.abs(tx - monster.x) + Math.abs(ty - monster.y);
    const options = STEPS.map(([dx, dy]) => ({ x: monster.x + dx, y: monster.y + dy }))
      .filter((o) => this.monsterCanEnter(o.x, o.y))
      .filter((o) => !monster.boss || this.cell(o.x, o.y) === monster.roomId) // bosses never leave their lair
      .map((o) => ({ ...o, d: Math.abs(tx - o.x) + Math.abs(ty - o.y) }))
      .filter((o) => (away ? o.d >= current : o.d <= current))
      .sort((a, b) => (away ? b.d - a.d : a.d - b.d) || Math.random() - 0.5);
    if (!options.length) return false;
    monster.x = options[0].x;
    monster.y = options[0].y;
    return true;
  }

  updateMonster(monster, now) {
    let nearestDist = Infinity;
    for (const p of this.players.values()) nearestDist = Math.min(nearestDist, dist(p, monster));
    if (nearestDist > ACTIVE_RANGE) return false;
    if (monster.frozenUntil > now) return false;

    if (monster.cooldown > 0) {
      monster.cooldown--;
      return false;
    }
    monster.cooldown = monster.speed - 1;

    // Treasure goblins run from the nearest player they can see.
    if (monster.flees) {
      let threat = null;
      for (const p of this.players.values()) {
        if (p.cls && this.canSee(monster, p, monster.aggro) && (!threat || dist(p, monster) < dist(threat, monster))) threat = p;
      }
      if (threat) return this.stepMonster(monster, threat.x, threat.y, true);
      return this.wander(monster);
    }

    let target = monster.target ? this.players.get(monster.target) : null;
    const taunted = monster.tauntUntil > now;
    if (target && (!this.isPrey(target) || (!taunted && dist(target, monster) > monster.aggro * 1.5))) {
      target = null;
    }
    if (!target) {
      let best = null;
      for (const p of this.players.values()) {
        if (!this.isPrey(p) || !this.canSee(monster, p, monster.aggro)) continue;
        if (!best || dist(p, monster) < dist(best, monster)) best = p;
      }
      target = best;
    }
    monster.target = target ? target.id : null;

    if (target) {
      const adjacent = taunted
        ? manhattan(target, monster) === 1 && target
        : [target, ...this.players.values()].find((p) => this.isPrey(p) && manhattan(p, monster) === 1);
      if (adjacent) {
        this.monsterAttacks(monster, adjacent, false);
        return true;
      }
      const d = dist(target, monster);
      if (monster.ranged && d <= monster.ranged && this.los(monster.x, monster.y, target.x, target.y) && chance(0.7)) {
        this.monsterAttacks(monster, target, true);
        return true;
      }
      return this.stepMonster(monster, target.x, target.y);
    }
    return this.wander(monster);
  }

  wander(monster) {
    if (!chance(0.25)) return false;
    const [dx, dy] = STEPS[rand(0, 3)];
    const wx = monster.x + dx;
    const wy = monster.y + dy;
    if (this.monsterCanEnter(wx, wy) && (!monster.boss || this.cell(wx, wy) === monster.roomId)) {
      monster.x = wx;
      monster.y = wy;
      return true;
    }
    return false;
  }

  respawnMonsters() {
    const cap = Math.floor(this.map.rooms.length * (this.eventActive("bloodmoon") ? 2 : 1.5));
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

  // ---------------------------------------------------------------- events
  startEvent(id) {
    const def = EVENTS.find((e) => e.id === id) || pick(EVENTS);
    this.event = { ...def, until: Date.now() + def.duration };
    this.announce(`>>> WORLD EVENT: ${def.name}! ${def.desc} (${def.duration / 60000} min) <<<`, def.color);
    if (def.id === "goblins") {
      for (const p of this.players.values()) {
        for (let i = 0; i < 2; i++) this.spawnNear(p, 8, 22, TREASURE_GOBLIN);
      }
    }
    this.changed();
  }

  endEvent() {
    if (!this.event) return;
    if (this.event.id === "goblins") {
      let escaped = 0;
      for (const m of Array.from(this.monsters.values())) {
        if (m.flees) {
          this.monsters.delete(m.id);
          escaped++;
        }
      }
      if (escaped) this.announce(`${escaped} treasure goblin${escaped > 1 ? "s" : ""} escaped with their loot!`, C.info);
    }
    this.announce(`The ${this.event.name} has ended.`, C.info);
    this.event = null;
    this.nextEventAt = Date.now() + rand(...this.eventInterval);
    this.changed();
  }

  // Spawn a monster in a room some distance from a player.
  spawnNear(player, minD, maxD, def) {
    const rooms = this.map.rooms.filter((r) => {
      if (r.id === this.safeRoomId) return false;
      const d = dist(this.roomCenter(r), player);
      return d >= minD && d <= maxD;
    });
    for (let i = 0; i < 6 && rooms.length; i++) {
      const room = pick(rooms);
      const pos = this.randomFreeTileInRoom(room);
      if (pos) return this.spawnMonster(pos.x, pos.y, this.tierAt(pos.x, pos.y), room.id, def);
    }
    return null;
  }

  tick() {
    this.tickCount++;
    let changed = false;
    const now = Date.now();

    for (const monster of Array.from(this.monsters.values())) {
      if (this.updateMonster(monster, now)) changed = true;
    }

    for (const p of this.players.values()) {
      if (p.downed && now >= p.downed.until) {
        this.killPlayer(p, p.downed.by);
        changed = true;
      }
      for (const [id, b] of Object.entries(p.buffs)) {
        if (b.until <= now) {
          delete p.buffs[id];
          changed = true;
        }
      }
    }

    // Regeneration every ~3s: gear regen always, natural regen out of combat.
    if (this.tickCount % 10 === 0) {
      for (const p of this.players.values()) {
        const s = p.stats;
        if (p.downed || s.hp >= s.maxHp) continue;
        let amount = s.regen;
        if (now - p.lastHurt >= REGEN_DELAY) {
          amount += Math.max(1, Math.floor(s.maxHp / (this.inSafeRoom(p.x, p.y) ? 8 : 30)));
        }
        if (amount > 0) {
          this.healPlayer(p, Math.round(amount), false);
          changed = true;
        }
      }
    }

    if (this.tickCount % RESPAWN_EVERY_TICKS === 0) this.respawnMonsters();

    if (this.event && now >= this.event.until) this.endEvent();
    else if (!this.event && now >= this.nextEventAt && this.players.size > 0) this.startEvent();

    if (changed) this.changed();
  }

  // ------------------------------------------------------------------ state
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

  // Heavier data the client needs only when it changes.
  profileFor(p) {
    return {
      cls: p.cls,
      equipment: p.equipment,
      inventory: p.inventory,
      inventorySize: INVENTORY_SIZE,
      quests: p.quests,
      title: p.title,
      bonus: p.bonus,
      achievements: ACHIEVEMENTS.map((a) => ({
        id: a.id,
        name: a.name,
        desc: a.desc,
        title: a.title,
        unlocked: p.achievements.includes(a.id),
      })),
      classes: p.cls
        ? null
        : Object.entries(CLASSES).map(([id, c]) => ({
            id,
            name: c.name,
            desc: c.desc,
            color: c.color,
            hp: c.base.maxHp,
            atk: c.base.atk,
            def: c.base.def,
            crit: c.crit,
            dodge: c.dodge,
            skills: c.skills.map((s) => `${s.name} (Lv${s.level})`),
          })),
    };
  }

  stateFor(player) {
    const now = Date.now();
    const view = this.visibleGrid(player);
    const isVisible = (o) => {
      const row = view.grid[o.y - view.originY];
      const v = row ? row[o.x - view.originX] : undefined;
      return v !== undefined && v !== null;
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
        frozen: m.frozenUntil > now,
        hit: now - m.lastHit < 250,
        hunting: m.target === player.id,
      });
    }

    const items = [];
    for (const [k, list] of this.items) {
      if (!list.length) continue;
      const [x, y] = k.split(",").map(Number);
      if (!isVisible({ x, y })) continue;
      const top = list.find((i) => i.kind === "chest") || list.find((i) => i.kind === "gear") || list[list.length - 1];
      const look = top.kind === "gear" ? floorLook(top.item) : ITEMS[top.kind];
      items.push({ x, y, kind: top.kind, char: look.char, color: look.color });
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
          color: this.classOf(p).color || [120, 220, 255],
        });
      }
    }

    const c = this.classOf(player);
    return {
      now,
      player: {
        id: player.id,
        username: player.username,
        title: player.title,
        cls: player.cls,
        className: c.name,
        classColor: c.color || [255, 255, 255],
        x: player.x,
        y: player.y,
        stats: player.stats,
        effAtk: this.effAtk(player),
        effDef: this.effDef(player),
        downedUntil: player.downed ? player.downed.until : null,
        safe: this.inSafeRoom(player.x, player.y),
        combo: player.combo.until > now ? player.combo : null,
        buffs: Object.entries(player.buffs)
          .filter(([, b]) => b.until > now)
          .map(([id, b]) => ({ id, name: b.name, until: b.until })),
        skills: c.skills.map((s, i) => ({
          id: s.id,
          key: String(i + 1),
          name: s.name,
          level: s.level,
          cooldown: s.cooldown,
          readyAt: player.cooldowns[s.id] || 0,
        })),
        quests: player.quests.map((q) => ({ desc: q.desc, have: q.have, need: q.need })),
      },
      event: this.event ? { name: this.event.name, desc: this.event.desc, until: this.event.until, color: this.event.color } : null,
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
        cls: this.classOf(p).name,
        color: this.classOf(p).color || [200, 200, 200],
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
