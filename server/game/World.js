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
} = require("./data");
const B = require("./balance");
const { xpToNext, MAX_LEVEL } = B;
const { generateItem, describeStats, itemLabel, floorLook, rarityById } = require("./loot");
const { generateQuest, progressQuests } = require("./quests");
const { MERCHANT_LINES } = require("./lore");
const coop = require("./coop");
const endgame = require("./endgame");
const encounters = require("./encounters");
const { Cities } = require("./cities");

const TICK_MS = 300;
const SIGHT = 12; // vision radius in tiles
const ACTIVE_RANGE = 25;
const MOVE_COOLDOWN = 110;
const DODGE_COOLDOWN = 2400;
const ATTACK_COOLDOWN = 350;
const REGEN_DELAY = 6000;
const RESPAWN_EVERY_TICKS = 33; // ~10s
const NEARBY_RADIUS = 32; // respawns keep this area around each hero populated...
const NEARBY_MONSTERS = 14; // ...with about this many monsters
const DOWNED_MS = 20000;
const REVIVE_RANGE = 25;
const COMBO_WINDOW = 4000;
const LEASH = 10;
const PARTY_XP_SHARE = 1; // party members within 30 tiles get the full XP of every kill (no splitting)

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

const NO_CLASS = { name: "Adventurer", base: { maxHp: 30, atk: 5, def: 1 }, growth: { maxHp: 12, atk: 2.2, def: 1 }, crit: 0.08, dodge: 0.03, skills: [] };

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
    this.parties = new Map(); // partyId -> { id, leader, members:Set<playerId> }
    this.nextPartyId = 1;
    this.pings = [];
    this.waystones = new Map(); // depth -> { tier, x, y }
    this.tickAt = Date.now();
    this.telegraphs = []; // attacks about to land, see encounters.js
    this.encounters = new Map(); // cursed chest fights in progress
    this.nextEncounterId = 1;
    this.eventInterval = opts.eventInterval || EVENT_INTERVAL;
    this.nextEventAt = Date.now() + rand(...this.eventInterval);

    const safeRoom = this.map.rooms[0];
    this.safeRoomId = safeRoom ? safeRoom.id : null;
    this.spawn = this.findSpawn();
    this.merchant = safeRoom
      ? { x: safeRoom.x, y: safeRoom.y, name: "Merchant", char: "M", color: [255, 200, 120] }
      : null;

    this.cities = opts.cities ? new Cities(this) : null;
    this.home = this.cities?.home || this.spawn;
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
    return Number.isInteger(x) && Number.isInteger(y) &&
      (this.inDungeonBounds(x, y) || !!this.cities?.areaAt(x, y));
  }

  inDungeonBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.map.size && y < this.map.size;
  }

  cell(x, y) {
    if (!this.inBounds(x, y)) return 0;
    const area = this.cities?.areaAt(x, y);
    if (area) return area.floor.has(key(x, y)) ? area.roomId : 0;
    return this.map.grid[x][y];
  }

  isFloor(x, y) {
    return this.cell(x, y) !== 0;
  }

  inSafeRoom(x, y) {
    const area = this.cities?.areaAt(x, y);
    if (area) return !!area.safe && this.isFloor(x, y);
    return this.safeRoomId !== null && this.cell(x, y) === this.safeRoomId;
  }

  isMerchant(x, y) {
    return (this.merchant?.x === x && this.merchant?.y === y) ||
      this.cities?.featureAt(x, y)?.kind === "merchant";
  }

  tierAt(x, y) {
    if (this.cities?.areaAt(x, y)) return 0;
    return Math.floor(dist({ x, y }, this.spawn) / TIER_DISTANCE);
  }

  // Monster level of the area (1 near the spawn, 100 near the map edge).
  levelAt(x, y) {
    return this.cities?.areaAt(x, y)?.level ?? B.levelAtDistance(dist({ x, y }, this.spawn));
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
      !this.cities?.featureAt(x, y) &&
      !this.monsterAt(x, y) &&
      !this.playerAt(x, y)
    );
  }

  // Bresenham line of sight: floor and open water are transparent.
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
      if ((x !== ax || y !== ay) && !this.isFloor(x, y) &&
          !this.cities?.areaAt(x, y)?.water.has(key(x, y))) return false;
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
    if (!this.inDungeonBounds(x, y)) return;
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
      if (this.monsterCanEnter(x, y) && !this.items.has(key(x, y)) && !this.isWaystone(x, y)) return { x, y };
    }
    return null;
  }

  bossForLevel(level) {
    const final = BOSSES.find((b) => b.final);
    if (level >= final.minLevel) return final;
    const options = BOSSES.filter((b) => !b.final && b.minLevel <= level && b.minLevel >= level - 12);
    if (!options.length) return level >= 78 ? BOSSES.find((b) => b.type === "ancient_dragon") : null;
    return options[options.length - 1];
  }

  bossAlive(type) {
    for (const m of this.monsters.values()) if (m.type === type) return true;
    return false;
  }

  tryMakeLair(room, level) {
    const boss = this.bossForLevel(level);
    if (!boss || this.bossAlive(boss.type)) return false;
    const pos = this.randomFreeTileInRoom(room);
    if (!pos) return false;
    this.spawnMonster(pos.x, pos.y, level, room.id, boss);
    const chestPos = this.randomFreeTileInRoom(room);
    if (chestPos) this.dropItem(chestPos.x, chestPos.y, { kind: "chest", level });
    for (let i = 0; i < 2; i++) {
      const p = this.randomFreeTileInRoom(room);
      if (p) this.spawnMonster(p.x, p.y, level, room.id);
    }
    return true;
  }

  populateRoom(room) {
    if (room.id === this.safeRoomId) return;
    const c = this.roomCenter(room);
    if (dist(c, this.spawn) < 10) return;
    const tier = this.tierAt(c.x, c.y);
    const level = this.levelAt(c.x, c.y);
    this.maybePlaceWaystone(room, tier);

    // The final boss always waits in the first room deep enough for it.
    const finalLevel = BOSSES.find((b) => b.final).minLevel;
    if (level >= finalLevel && !this.finalLairPlaced && this.tryMakeLair(room, level)) {
      this.finalLairPlaced = true;
      return;
    }
    if (level >= 8 && chance(0.1) && this.tryMakeLair(room, level)) return;

    const count = rand(0, 2) + (level >= 12 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.spawnMonster(pos.x, pos.y, level, room.id);
    }

    const place = (item, p = 1) => {
      if (!chance(p)) return;
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, item);
    };
    place({ kind: "gold", amount: B.roomGold(level) }, 0.35);
    place({ kind: "potion" }, 0.15);
    place({ kind: "chest", level, mimic: level >= 10 && chance(0.2) }, 0.04);
    place({ kind: "shrine" }, 0.05);
    place({ kind: "gear", item: generateItem(level) }, 0.06);
    place({ kind: "lore" }, 0.03 + Math.min(0.05, tier * 0.003));
    this.decorateRoom(room, level);
  }

  // Monsters that fit an area level; newer (stronger) kinds are more common.
  pickMonsterType(level) {
    let candidates = MONSTERS.filter((m) => m.minLevel <= level && m.minLevel >= level - 30);
    if (!candidates.length) candidates = MONSTERS.filter((m) => m.minLevel <= level).slice(-3);
    const weights = candidates.map((m) => 1 + Math.max(0, 30 - (level - m.minLevel)) / 6);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // level: the level of the area. Stats = level formula x archetype x elite/boss.
  spawnMonster(x, y, level, roomId, forcedDef = null) {
    const def = forcedDef || this.pickMonsterType(level);
    const boss = !!forcedDef && (BOSS_NAMES.has(def.name) || def.boss === true);
    const elite = !forcedDef && level >= 8 && chance(0.07 + Math.min(0.08, level * 0.001));
    const lvl = B.clamp(Math.round(level + (elite ? 1 : 0) + (boss ? 2 : 0)), 1, B.MONSTER_MAX_LEVEL);
    const base = B.monsterBase(lvl);
    const mods = boss ? (def.final ? B.FINAL_BOSS : B.BOSS) : elite ? B.ELITE : { hp: 1, atk: 1, def: 1, xp: 1, gold: 1 };
    const goldMult = (def.gold || 1) * mods.gold;
    const maxHp = Math.round(base.hp * def.hp * mods.hp);
    const monster = {
      id: this.nextMonsterId++,
      type: def.type,
      name: elite ? `Elite ${def.name}` : def.name,
      char: def.char,
      color: elite ? def.color.map((v) => Math.min(255, v + 60)) : def.color,
      x,
      y,
      homeX: x,
      homeY: y,
      hp: maxHp,
      maxHp,
      level: lvl,
      atk: Math.round(base.atk * def.atk * mods.atk * 10) / 10,
      def: Math.round(base.def * def.def * mods.def),
      xp: Math.round(base.xp * def.xp * mods.xp),
      gold: base.gold.map((g) => Math.round(g * goldMult)),
      speed: def.speed,
      aggro: def.aggro,
      ranged: def.ranged || 0,
      verb: def.verb,
      undead: !!def.undead,
      flees: !!def.flees,
      ability: def.ability || null,
      pack: !!def.pack,
      small: !!def.small,
      mimic: !!def.mimic,
      affix: null,
      windup: 0,
      boss,
      elite,
      roomId,
      cooldown: rand(0, def.speed),
      lastHit: 0,
      frozenUntil: 0,
      tauntUntil: 0,
    };
    if (elite) this.rollAffix(monster, def);
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
    const level = Math.min(MAX_LEVEL, user.level || 1);
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
      bonus: this.migrateBonus(data),
      equipment: { weapon: null, armor: null, trinket: null, ...(data.equipment || {}) },
      inventory: Array.isArray(data.inventory) ? data.inventory : [],
      quests: Array.isArray(data.quests) ? data.quests : [],
      achievements: Array.isArray(data.achievements) ? data.achievements : [],
      counters: { kinds: {}, ...(data.counters || {}) },
      lore: Array.isArray(data.lore) ? data.lore : [],
      waystones: Array.isArray(data.waystones) ? data.waystones : [],
      exploration: this.cities?.readProgress(data.exploration),
      prestige: user.prestige || 0,
      partyId: null,
      pendingInvite: null,
      cooldowns: {},
      buffs: {},
      combo: { count: 0, until: 0 },
      downed: null,
      lastMove: 0,
      dodgeReadyAt: 0,
      lastAttack: 0,
      lastHurt: 0,
    };
    this.recalc(p);
    if (!(p.stats.hp > 0)) p.stats.hp = p.stats.maxHp;
    p.stats.hp = Math.min(p.stats.hp, p.stats.maxHp);
    while (p.quests.length < 3) p.quests.push(generateQuest(p, p.quests));

    // New heroes (no saved position) start at the spawn; don't generate the map corner.
    if (!this.inBounds(p.x, p.y)) {
      p.x = this.home.x;
      p.y = this.home.y;
    }
    this.ensureChunksAround(p.x, p.y);
    if (!this.isFloor(p.x, p.y) || this.isMerchant(p.x, p.y)) {
      p.x = this.home.x;
      p.y = this.home.y;
      this.ensureChunksAround(p.x, p.y);
    }
    this.players.set(p.id, p);
    this.checkBiome(p);
    this.cities?.arrive(p);
    this.markProfile(p);
    this.announce(`${this.displayName(p)} entered the dungeon.`, C.good);
    if (this.event) this.notify(p, `Event in progress: ${this.event.name} - ${this.event.desc}`, this.event.color);
    this.changed();
    return p;
  }

  // Merchant upgrades used to be flat (+1 ATK, +10 HP); now each purchase is a percentage.
  migrateBonus(data) {
    const b = { atk: 0, def: 0, hp: 0, hearts: 0, ...(data.bonus || {}) };
    if (data.balance !== 2) b.hp = Math.floor(b.hp / 10);
    return b;
  }

  // Data that is persisted as JSON alongside the user row.
  saveData(p) {
    return {
      balance: 2,
      potions: p.stats.potions,
      bonus: p.bonus,
      equipment: p.equipment,
      inventory: p.inventory,
      quests: p.quests,
      achievements: p.achievements,
      counters: p.counters,
      lore: p.lore,
      waystones: p.waystones,
      exploration: this.cities?.saveProgress(p),
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
    const prestige = 1 + 0.05 * (p.prestige || 0); // rebirth bonus
    const b = p.bonus;
    const hpMult = (1 + B.SHOP_PCT.hp * (b.hp || 0) + B.SHOP_PCT.heart * (b.hearts || 0)) * prestige;
    s.maxHp = Math.round((c.base.maxHp + c.growth.maxHp * L + (gear.maxHp || 0)) * hpMult);
    s.atk = Math.round((c.base.atk + c.growth.atk * L + (gear.atk || 0)) * (1 + B.SHOP_PCT.atk * (b.atk || 0)) * prestige);
    s.def = Math.round((c.base.def + c.growth.def * L + (gear.def || 0)) * (1 + B.SHOP_PCT.def * (b.def || 0)));
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
    this.emit("story", p.id);
    this.markProfile(p);
    this.changed();
    return { ok: true };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return null;
    if (p.downed) this.killPlayer(p, p.downed.by);
    if (p.partyId) this.leaveParty(p, true);
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
    if (this.hasBuff(p, "sanctuary")) m *= 1.3;
    return Math.round(p.stats.def * m);
  }

  effLifesteal(p) {
    return p.stats.lifesteal + (this.hasBuff(p, "berserk") ? 0.2 : 0) + (this.hasBuff(p, "vampire") ? 0.15 : 0);
  }

  // ---------------------------------------------------------------- moving
  movePlayer(player, direction) {
    if (typeof direction !== "string" || !Object.hasOwn(DIRS, direction)) return { ok: false, reason: "invalid" };
    const d = DIRS[direction];
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

    const feature = this.cities?.featureAt(nx, ny);
    if (feature) {
      player.lastMove = now;
      return this.interactCity(player, feature);
    }

    if (this.isMerchant(nx, ny)) {
      player.lastMove = now;
      this.emit("shop", player.id, this.shopFor(player));
      return { ok: true, reason: "shop" };
    }

    if (!this.isFloor(nx, ny)) return { ok: false, reason: "wall" };

    return this.arrive(player, nx, ny, now);
  }

  dodgePlayer(player, direction) {
    if (typeof direction !== "string" || !Object.hasOwn(DIRS, direction)) return { ok: false, reason: "invalid" };
    if (!player.cls || player.downed) return { ok: false, reason: "unavailable" };
    const now = Date.now();
    if (now < player.dodgeReadyAt) return { ok: false, reason: "cooldown" };

    const [dx, dy] = DIRS[direction];
    const open = (x, y) => this.isFloor(x, y) && !this.monsterAt(x, y) &&
      !this.isMerchant(x, y) && !this.cities?.featureAt(x, y) && !this.playerAt(x, y, (p) => p.downed);
    let x = player.x + dx;
    let y = player.y + dy;
    if (!open(x, y)) return { ok: false, reason: "blocked" };
    if (open(x + dx, y + dy)) {
      x += dx;
      y += dy;
    }
    player.dodgeReadyAt = now + DODGE_COOLDOWN;
    return this.arrive(player, x, y, now);
  }

  arrive(player, nx, ny, now) {
    player.lastMove = now;
    player.x = nx;
    player.y = ny;
    this.ensureChunksAround(nx, ny);
    this.pickUp(player);
    this.checkDepthRecord(player);
    this.checkBiome(player);
    if (this.cities?.areaAt(nx, ny)) {
      this.cities.arrive(player);
    } else {
      this.discoverWaystones(player);
      this.discoverRoom(player);
    }
    this.markDirty(player);
    this.changed();
    return { ok: true, reason: "move" };
  }

  interactCity(player, feature) {
    if (!this.cities) return { ok: false, message: "City interactions are unavailable here." };
    const result = this.cities.interact(player, feature);
    if (result.dialogue) {
      const { name, text } = result.dialogue;
      this.notify(player, `${name}: ${text}`, C.quest);
      this.emit("dialogue", player.id, result.dialogue);
    }
    return { ok: result.ok, message: result.message, reason: result.reason || "interact" };
  }

  checkDepthRecord(player) {
    const depth = this.tierAt(player.x, player.y);
    const s = player.stats;
    if (depth <= s.maxDepth) return;
    const newRecords = this.chroniclesFor(depth).filter((entry) => entry.depth > s.maxDepth);
    s.maxDepth = depth;
    if (newRecords.length) {
      this.notify(player, `Journal unlocked: ${newRecords.at(-1).title}`, [240, 220, 170]);
      this.markProfile(player);
    }
    const bonus = 10 * depth + 3 * this.levelAt(player.x, player.y);
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
          this.soundFor(player, "gold");
          break;
        }
        case "potion":
          if (s.potions >= MAX_POTIONS) {
            left.push(item);
            this.notify(player, "Your potion bag is full.");
          } else {
            s.potions++;
            this.notify(player, "You pick up a healing potion. (H to drink)", ITEMS.potion.color);
            this.soundFor(player, "item");
          }
          break;
        case "heart": {
          const before = s.maxHp;
          player.bonus.hearts = Math.min(B.SHOP_MAX.hearts, (player.bonus.hearts || 0) + 1);
          this.recalc(player);
          s.hp += s.maxHp - before;
          this.notify(player, `A heart crystal! Max HP +${Math.round(B.SHOP_PCT.heart * 100)}% permanently.`, ITEMS.heart.color);
          this.soundFor(player, "shrine");
          break;
        }
        case "shrine": {
          const shrine = pick(SHRINES);
          this.addBuff(player, shrine.id, shrine.name.replace(/^Shrine of /, ""), shrine.duration);
          this.notify(player, `${shrine.name}: ${shrine.desc} for ${shrine.duration / 1000}s!`, ITEMS.shrine.color);
          this.fx(player, "toast", `${shrine.name}: ${shrine.desc}`, ITEMS.shrine.color);
          this.sound(player.x, player.y, "shrine");
          break;
        }
        case "gear":
          // Don't instantly re-pick an item you just dropped.
          if (item.droppedBy === player.id && Date.now() - item.droppedAt < 5000) {
            left.push(item);
          } else if (!this.giveItem(player, item.item)) {
            left.push(item);
            this.notify(player, "Your inventory is full! Sell or drop something (I).", C.bad);
          } else {
            this.soundFor(player, "item");
          }
          break;
        case "lore":
          this.readLore(player);
          this.soundFor(player, "discover");
          break;
        case "urn":
          this.smashUrn(player, item);
          break;
        case "fountain":
          if (this.drinkFountain(player)) left.push(item);
          break;
        case "vault":
          if (this.openVault(player, item)) left.push(item);
          break;
        case "cursed":
          this.startCursedChest(player, item);
          break;
        case "chest": {
          if (item.mimic && this.wakeMimic(player, item)) break;
          const level = item.level || (item.tier || 0) * 5 + 1;
          this.sound(player.x, player.y, "chest");
          const gold = B.chestGold(level);
          this.addGold(player, gold);
          s.potions = Math.min(MAX_POTIONS, s.potions + 1);
          this.notify(player, `You open a treasure chest: ${gold} gold and a potion!`, ITEMS.chest.color);
          const n = level >= 15 ? 2 : 1;
          for (let i = 0; i < n; i++) {
            const loot = generateItem(level + 1, { boost: 3 });
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
    this.sound(player.x, player.y, "drink");
    this.markDirty(player);
    this.changed();
    return true;
  }

  // ------------------------------------------------------------------ shop
  nearMerchant(player) {
    return (this.merchant && chebyshev(player, this.merchant) <= 2) ||
      !!this.cities?.merchantNear(player);
  }

  shopFor(player) {
    return {
      gold: player.stats.gold,
      greeting: pick(MERCHANT_LINES),
      potions: player.stats.potions,
      potionLimit: MAX_POTIONS,
      priceQuotes: true,
      prestige: player.prestige || 0,
      items: SHOP.map((i, idx) => ({
        key: String(idx + 1),
        id: i.id,
        name: i.name,
        description: i.description,
        price: Math.round(i.price(player.bonus, player.stats.level)),
        maxed: B.SHOP_MAX[i.id] !== undefined && (player.bonus[i.id] || 0) >= B.SHOP_MAX[i.id],
      })),
    };
  }

  buy(player, id, quotedPrice) {
    if (!this.nearMerchant(player) || player.downed) {
      return { ok: false, message: "You need to be next to the merchant." };
    }
    const entry = SHOP.find((i) => i.id === id);
    if (!entry) return { ok: false, message: "Unknown item." };
    const price = Math.round(entry.price(player.bonus, player.stats.level));
    if (quotedPrice !== undefined && quotedPrice !== price) {
      return { ok: false, message: "The price changed. Review the new quote before buying.", shop: this.shopFor(player) };
    }
    if (id === "rebirth") {
      const r = this.rebirth(player);
      if (!r.ok) return r;
      this.markProfile(player);
      this.changed();
      return { ok: true, shop: this.shopFor(player) };
    }
    const s = player.stats;
    if (s.gold < price) return { ok: false, message: `Not enough gold (need ${price}).` };
    if (id === "potion" && s.potions >= MAX_POTIONS) return { ok: false, message: "Your potion bag is full." };
    if (B.SHOP_MAX[id] !== undefined && (player.bonus[id] || 0) >= B.SHOP_MAX[id]) {
      return { ok: false, message: "The merchant has nothing stronger to sell you. Look for gear and the blacksmith." };
    }
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
      case "hp": {
        const before = s.maxHp;
        player.bonus.hp++;
        this.recalc(player);
        s.hp += s.maxHp - before;
        break;
      }
      case "gamble": {
        const item = generateItem(s.level, { boost: 2.5 });
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
    // Hits made by this skill leave its mark on monsters (see team combos).
    this.castPrime = encounters.SKILL_PRIME[skill.id] || null;
    let used = false;
    try {
      used = this.castSkill(player, skill.id);
    } finally {
      this.castPrime = null;
    }
    if (used) {
      this.sound(player.x, player.y, encounters.SKILL_SOUND[skill.id] || "buff");
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
        this.aoe(player, t, 1.4, "Cleave");
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
        for (const m of t) {
          m.frozenUntil = now + 4000;
          this.interruptTelegraph(m);
        }
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
      // ---- ranger
      case "aimedshot": {
        const t = this.visibleMonsters(player, 9).sort((a, b) => dist(b, player) - dist(a, player))[0];
        if (!t) return this.notify(player, "No enemy in sight to aim at."), false;
        const far = dist(t, player) >= 4;
        this.hitMonster(player, t, far ? 2.4 : 2.2, { label: far ? "Your long Aimed Shot strikes" : "Your Aimed Shot strikes" });
        return true;
      }
      case "snare": {
        const t = near(2);
        if (!t.length) return this.notify(player, "No enemies within 2 tiles."), false;
        for (const m of t) {
          m.frozenUntil = Math.max(m.frozenUntil || 0, now + 3000);
          this.interruptTelegraph(m);
        }
        this.aoe(player, t, 0.9, "Snare Trap roots and");
        return true;
      }
      case "volley": {
        const t = this.visibleMonsters(player, 7);
        if (!t.length) return this.notify(player, "No enemy in sight."), false;
        this.aoe(player, t, 1.1, "Volley");
        return true;
      }
      case "huntersmark": {
        const t = this.visibleMonsters(player, 9);
        for (const m of t) m.exposedUntil = now + 8000;
        for (const a of allies(8)) {
          if (a.downed) continue;
          this.addBuff(a, "huntersmark", "Hunter's Mark", 8000);
          if (a !== player) this.notify(a, `${player.username} marks the hunt. Your crit chance rises!`, C.good);
        }
        this.notify(player, `Hunter's Mark: ${t.length} foe${t.length === 1 ? "" : "s"} exposed, party crit +25%.`, C.skill);
        this.fx(player, "toast", "HUNTER'S MARK", [120, 230, 150]);
        return true;
      }
      // ---- necromancer
      case "drain": {
        const t = this.visibleMonsters(player, 6)[0];
        if (!t) return this.notify(player, "No enemy in sight to drain."), false;
        const r = this.hitMonster(player, t, 1.8, { label: "You drain the life of", halfDef: true });
        this.healPlayer(player, Math.max(1, Math.round(r.dmg * 0.5)));
        return true;
      }
      case "frailty": {
        const t = this.visibleMonsters(player, 7);
        if (!t.length) return this.notify(player, "No enemy in sight to curse."), false;
        for (const m of t) {
          m.exposedUntil = now + 10000;
          this.floater(m.x, m.y, "frail", [190, 130, 255]);
        }
        this.notify(player, `Curse of Frailty withers ${t.length} foe${t.length === 1 ? "" : "s"}.`, C.skill);
        return true;
      }
      case "boneprison": {
        const t = near(2);
        if (!t.length) return this.notify(player, "No enemies within 2 tiles."), false;
        for (const m of t) {
          m.frozenUntil = Math.max(m.frozenUntil || 0, now + 3000);
          this.interruptTelegraph(m);
        }
        this.aoe(player, t, 1.2, "Bone Prison traps and", { halfDef: true });
        return true;
      }
      case "harvest": {
        const t = near(6);
        if (!t.length) return this.notify(player, "No souls within reach."), false;
        this.aoe(player, t, 2.5, "SOUL HARVEST", { halfDef: true });
        for (const a of allies(6)) {
          if (!a.downed) this.healPlayer(a, Math.round(a.stats.maxHp * Math.min(0.3, 0.06 * t.length)));
        }
        this.fx(player, "toast", "SOUL HARVEST", [190, 130, 255]);
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
    const def = opts.halfDef ? monster.def / 2 : monster.def;
    const now = Date.now();
    const prime = "prime" in opts ? opts.prime : this.castPrime;
    const combo = opts.noCombo ? null : this.comboFor(player, monster, prime, now);
    const flank = this.flankers(player, monster, now);
    let dmg = B.rollDamage(this.effAtk(player) * mult, def, player.stats.level);
    const crit = opts.forceCrit || chance(player.stats.crit + (this.hasBuff(player, "huntersmark") ? 0.25 : 0));
    if (crit) dmg *= 2;
    if (flank) dmg *= 1 + 0.15 * flank;
    if (combo) dmg *= combo.mult;
    const exposed = monster.exposedUntil > now;
    if (exposed) {
      dmg *= 1.25;
      monster.exposedUntil = 0;
    }
    const ward = this.wardedBy(monster);
    if (ward) dmg *= 0.6;
    dmg = Math.max(1, Math.round(dmg));
    monster.hp -= dmg;
    monster.lastHit = now;
    (monster.hitBy || (monster.hitBy = {}))[player.id] = now;
    this.floater(monster.x, monster.y, crit ? `${dmg}!` : dmg, crit ? [255, 230, 60] : [255, 255, 255]);
    if (ward && chance(0.4)) this.floater(ward.x, ward.y, "wards", [150, 200, 255]);
    this.sound(monster.x, monster.y, crit ? "crit" : "hit");
    if (monster.pack && !monster.target) this.callPack(monster, player);
    if (!monster.flees && !(monster.tauntUntil > now)) monster.target = player.id;
    if (combo) monster.primed = null;
    else if (prime) monster.primed = { type: prime, by: player.id, until: now + 6000 };

    const ls = this.effLifesteal(player);
    if (ls > 0) this.healPlayer(player, Math.max(1, Math.round(dmg * ls)), false);

    if (!opts.quiet) {
      this.notify(
        player,
        `${crit ? "CRIT! " : ""}${opts.label || "You hit"} the ${monster.name} for ${dmg}${exposed ? " (opening)" : ""}${flank ? " (flanked)" : ""}${ward ? " (warded)" : ""}.`,
        crit ? C.crit : C.hit,
      );
    }
    const killed = monster.hp <= 0;
    if (killed) this.killMonster(monster, player);
    if (combo) this.detonate(player, monster, combo, dmg);
    return { dmg, killed };
  }

  killMonster(monster, killer) {
    if (!this.monsters.has(monster.id)) return;
    this.monsters.delete(monster.id);
    this.interruptTelegraph(monster);
    this.sound(monster.x, monster.y, monster.boss ? "bosskill" : "kill");
    this.deathEffects(monster);
    this.cities?.onKill(monster);
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
    // Party bonus: +10% XP for each party member fighting nearby.
    const partyNear = this.partyMembers(killer).filter((m) => m !== killer && !m.downed && dist(m, monster) <= 30);
    const partyMult = 1 + 0.1 * partyNear.length;
    // A party builds one kill combo together.
    for (const m of partyNear) {
      m.combo = { count: combo.count, until: combo.until };
      m.counters.bestCombo = Math.max(m.counters.bestCombo || 0, combo.count);
      this.markDirty(m);
    }
    const xp = Math.max(1, Math.round(monster.xp * xpMult * comboMult * partyMult * B.xpLevelMult(k.level, monster.level)));
    const comboText = combo.count >= 3 ? `  COMBO x${combo.count}! (+${Math.round((comboMult - 1) * 100)}% XP)` : "";
    this.notify(killer, `You slay the ${monster.name}! +${xp} XP${comboText}`, combo.count >= 3 ? C.crit : C.good);
    this.gainXp(killer, xp);

    // Co-op XP: party members within 30 tiles get the full XP, other heroes within 12 get 35%.
    for (const ally of this.players.values()) {
      if (ally === killer || ally.downed || !ally.cls) continue;
      const inParty = this.sameParty(ally, killer);
      const range = inParty ? 30 : 12;
      if (dist(ally, monster) > range) continue;
      let share = Math.max(1, Math.floor(monster.xp * xpMult * (inParty ? PARTY_XP_SHARE * partyMult : 0.35) * B.xpLevelMult(ally.stats.level, monster.level)));
      // Being carried by stronger friends is great, but not instant: at most 20% of a level per kill.
      share = Math.min(share, Math.ceil(xpToNext(ally.stats.level) * 0.2));
      this.notify(ally, `${killer.username} slays the ${monster.name}. +${share} XP`, [120, 220, 120]);
      this.gainXp(ally, share);
      if (inParty) this.questEvent(ally, "kill", { type: monster.type, elite: monster.elite, level: monster.level });
    }

    const level = monster.level;
    const goldMult = this.eventActive("goldrush") ? 2 : 1;
    const gold = rand(monster.gold[0], monster.gold[1]) * goldMult;
    if (gold > 0) this.dropItem(monster.x, monster.y, { kind: "gold", amount: gold });

    const dropMult = (this.eventActive("frenzy") ? 3 : 1) * (this.eventActive("bloodmoon") ? 1.5 : 1);
    const dropGear = (boost) => this.dropItem(monster.x, monster.y, { kind: "gear", item: generateItem(level, { boost }) });

    if (monster.boss) {
      this.dropItem(monster.x, monster.y, { kind: "chest", level: level + 1 });
      this.dropItem(monster.x, monster.y, { kind: "potion" });
      this.dropItem(monster.x, monster.y, { kind: "lore" });
      dropGear(5);
      // Personal loot: everyone who fought gets their own reward, no loot stealing.
      const fighters = Array.from(this.players.values()).filter((p) => p.cls && !p.downed && dist(p, monster) <= 15);
      if (!fighters.includes(killer)) fighters.push(killer);
      const party3 = fighters.filter((p) => this.sameParty(p, killer)).length >= 3;
      for (const f of fighters) {
        f.stats.bossKills++;
        if (f !== killer) {
          f.counters.kinds[monster.type] = (f.counters.kinds[monster.type] || 0) + 1;
          this.questEvent(f, "kill", { type: monster.type, elite: false, level });
        }
        if (party3 && this.sameParty(f, killer)) f.counters.partyBosses = (f.counters.partyBosses || 0) + 1;
        const loot = generateItem(level + 1, { boost: monster.final ? 12 : 5 });
        if (!this.giveItem(f, loot)) this.dropItem(f.x, f.y, { kind: "gear", item: loot });
        this.fx(f, "toast", `${monster.name.toUpperCase()} DEFEATED!`, C.epic);
        this.checkAchievements(f);
        this.markProfile(f);
      }
      const names = fighters.map((f) => f.username).join(", ");
      this.announce(`*** ${monster.name} has been defeated by ${names}! ***`, C.epic);
      if (monster.type === "ancient_dragon") this.announce(`${names}: DRAGONSLAYER${fighters.length > 1 ? "S" : ""}!`, C.epic);
      if (monster.final) {
        this.announce(`*** THE ABYSS LORD HAS FALLEN. The darkness sleeps again. Glory to ${names}! ***`, [255, 215, 80]);
        for (const p of this.players.values()) this.fx(p, "toast", "★ THE ABYSS LORD HAS FALLEN ★", [255, 215, 80]);
      }
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

    this.questEvent(killer, "kill", { type: monster.type, elite: monster.elite, level });
    if (combo.count >= 3) this.questEvent(killer, "combo", { combo: combo.count });
    this.checkAchievements(killer);
    this.markProfile(killer);
  }

  gainXp(player, amount) {
    const s = player.stats;
    if (s.level >= MAX_LEVEL) {
      s.xp = 0;
      s.xpNext = xpToNext(s.level);
      return;
    }
    const rested = this.hasBuff(player, "rested") ? 0.15 : 0;
    s.xp += Math.round(amount * (1 + 0.1 * (player.prestige || 0) + rested));
    while (s.level < MAX_LEVEL && s.xp >= xpToNext(s.level)) {
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
      if (s.level % 5 === 0 || s.level <= 5) this.announce(`${player.username} reached level ${s.level}!`, [255, 230, 120]);
      if (s.level >= MAX_LEVEL) {
        s.xp = 0;
        this.notify(player, `You reached the MAX LEVEL (${MAX_LEVEL})! Rebirth at the merchant to start again stronger.`, C.epic);
        this.announce(`*** ${player.username} has reached level ${MAX_LEVEL}! ***`, C.epic);
      }
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
        const item = generateItem(player.stats.level, { boost: 3 });
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
      this.sound(player.x, player.y, "dodge");
      return;
    }
    let atk = ranged ? Math.round(monster.atk * 0.75) : monster.atk;
    if (this.eventActive("bloodmoon")) atk = Math.round(atk * 1.3);
    const crit = chance(0.08);
    const verb = ranged || !monster.verb.includes(" at") ? monster.verb : "hits";
    if (ranged) this.sound(monster.x, monster.y, "shoot");
    this.hurtPlayer(player, atk, monster.level, {
      crit,
      by: monster.name,
      text: (dmg) => `The ${monster.name} ${crit ? "critically " : ""}${verb} you for ${dmg}.`,
    });
    if (monster.affix === "vampiric" && monster.hp < monster.maxHp) {
      monster.hp = Math.min(monster.maxHp, monster.hp + Math.ceil(monster.maxHp * 0.08));
      this.floater(monster.x, monster.y, "drains", [200, 80, 120]);
    }
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
    this.sound(player.x, player.y, "down");
  }

  revive(player, saviour) {
    player.downed = null;
    player.stats.hp = Math.max(1, Math.round(player.stats.maxHp * 0.4));
    player.lastHurt = Date.now();
    this.announce(`${saviour.username} revived ${player.username}!`, C.good);
    this.fx(player, "toast", `Revived by ${saviour.username}!`, C.good);
    this.sound(player.x, player.y, "revive");
    if (saviour !== player) {
      saviour.counters.revives = (saviour.counters.revives || 0) + 1;
      this.gainXp(saviour, Math.round(xpToNext(saviour.stats.level) * 0.03));
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
    const respawn = this.cities?.areaAt(player.x, player.y) ? this.home : this.spawn;
    player.x = respawn.x;
    player.y = respawn.y;
    this.ensureChunksAround(player.x, player.y);
    this.checkBiome(player);
    this.cities?.arrive(player);
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
    if (monster.windup > this.tickCount) return false; // winding up a telegraphed attack
    if (monster.boss && this.bossMechanics(monster, now)) return true;

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

    // Leash: monsters don't follow heroes across the map. Past LEASH tiles from home
    // they give up and walk back, healing on the way.
    const taunted = monster.tauntUntil > now;
    if (!monster.boss) {
      const away = Math.hypot(monster.x - monster.homeX, monster.y - monster.homeY);
      if (!monster.returning && away > LEASH && !taunted) monster.returning = true;
      if (monster.returning) {
        if (away <= 2) {
          monster.returning = false;
        } else {
          monster.target = null;
          monster.hp = Math.min(monster.maxHp, monster.hp + Math.ceil(monster.maxHp * 0.05));
          if (this.stepMonster(monster, monster.homeX, monster.homeY)) return true;
          monster.returning = false; // stuck: settle here
          monster.homeX = monster.x;
          monster.homeY = monster.y;
          return false;
        }
      }
    }

    let target = monster.target ? this.players.get(monster.target) : null;
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
      if (this.monsterAbility(monster, target, now)) return true;
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
    if (monster.homeX !== undefined && Math.hypot(monster.x - monster.homeX, monster.y - monster.homeY) > 5) {
      return this.stepMonster(monster, monster.homeX, monster.homeY);
    }
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

  // Keep the dungeon around every hero populated, plus a trickle everywhere else.
  respawnMonsters() {
    const cap = Math.floor(this.map.rooms.length * (this.eventActive("bloodmoon") ? 2 : 1.5));
    if (this.monsters.size >= cap) return;
    const heroes = Array.from(this.players.values()).filter((p) => p.cls);
    const farFromHeroes = (c) => heroes.every((h) => dist(h, c) >= 13);
    const spawnIn = (room) => {
      const c = this.roomCenter(room);
      const level = this.levelAt(c.x, c.y);
      if (level >= 8 && chance(0.06) && this.tryMakeLair(room, level)) return true;
      const pos = this.randomFreeTileInRoom(room);
      if (!pos) return false;
      this.spawnMonster(pos.x, pos.y, level, room.id);
      return true;
    };
    const usable = (room) => room && room.id !== this.safeRoomId && dist(this.roomCenter(room), this.spawn) >= 10;

    for (const h of heroes) {
      let near = 0;
      for (const m of this.monsters.values()) if (dist(m, h) <= NEARBY_RADIUS) near++;
      // Groups of heroes get proportionally more monsters to share.
      const company = heroes.filter((o) => dist(o, h) <= NEARBY_RADIUS).length;
      const want = Math.round(NEARBY_MONSTERS * (1 + 0.75 * (company - 1)));
      if (near >= want) continue;
      const rooms = this.map.rooms.filter((r) => {
        if (!usable(r)) return false;
        const c = this.roomCenter(r);
        const d = dist(c, h);
        return d >= 13 && d <= NEARBY_RADIUS && farFromHeroes(c);
      });
      for (let i = 0; i < Math.min(3, want - near) && rooms.length; i++) spawnIn(pick(rooms));
    }
    for (let i = 0; i < 5; i++) {
      const room = this.map.rooms[rand(0, this.map.rooms.length - 1)];
      if (usable(room) && farFromHeroes(this.roomCenter(room)) && spawnIn(room)) return;
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
      if (pos) return this.spawnMonster(pos.x, pos.y, this.levelAt(pos.x, pos.y), room.id, def);
    }
    return null;
  }

  tick() {
    this.tickCount++;
    let changed = false;
    const now = Date.now();
    this.tickAt = now;

    if (this.resolveTelegraphs(now)) changed = true;
    for (const monster of Array.from(this.monsters.values())) {
      if (this.updateMonster(monster, now)) changed = true;
    }
    if (this.encounters.size) this.updateEncounters(now);

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
    const district = this.cities?.areaAt(player.x, player.y);
    for (let gy = 0; gy < size; gy++) {
      const row = new Array(size).fill(null);
      for (let gx = 0; gx < size; gx++) {
        const x = originX + gx;
        const y = originY + gy;
        if (!this.inBounds(x, y)) continue;
        const inRadius = Math.hypot(x - player.x, y - player.y) <= SIGHT;
        let visible = inRadius && this.los(player.x, player.y, x, y);
        if (!visible && here > 0 && !district) {
          for (let dy = -1; dy <= 1 && !visible; dy++) {
            for (let dx = -1; dx <= 1 && !visible; dx++) {
              if (this.cell(x + dx, y + dy) === here) visible = true;
            }
          }
        }
        if (visible) row[gx] = this.cell(x, y);
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
      prestige: p.prestige || 0,
      lore: this.loreFor(p),
      chronicles: this.chroniclesFor(p.stats.maxDepth),
      waystones: p.waystones.length,
      world: this.worldInfo(),
      smith: Object.fromEntries(
        [...Object.values(p.equipment).filter(Boolean), ...p.inventory].map((i) => [
          i.uid,
          { upgrade: (i.plus || 0) >= this.MAX_PLUS ? null : this.upgradeCostOf(i), reforge: this.reforgeCostOf(i) },
        ]),
      ),
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
            skillDetails: c.skills.map(({ name, desc, level }) => ({ name, desc, level })),
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
        level: m.level,
        boss: m.boss,
        elite: m.elite,
        frozen: m.frozenUntil > now,
        charging: m.boss && m.windup > this.tickCount, // older clients draw the slam zone from this
        windup: m.windup > this.tickCount,
        exposed: m.exposedUntil > now,
        primed: m.primed && m.primed.until > now ? m.primed.type : null,
        enraged: !!m.enraged,
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

    const area = this.cities?.areaAt(player.x, player.y);
    const npcs = [];
    if (this.cities) {
      for (const feature of this.cities.features.values()) {
        if (!isVisible(feature)) continue;
        const { x, y, name, char, kind } = feature;
        npcs.push({ x, y, name, char, color: this.cities.lookFor(player, feature), kind });
      }
    }
    if (this.merchant && isVisible(this.merchant)) npcs.push(this.merchant);
    for (const w of this.waystones.values()) {
      if (isVisible(w)) npcs.push({ x: w.x, y: w.y, ...this.WAYSTONE_LOOK, known: player.waystones.includes(w.tier) });
    }

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
          party: this.sameParty(p, player),
          color: this.classOf(p).color || [120, 220, 255],
        });
      }
    }

    const c = this.classOf(player);
    const party = this.partyOf(player);
    const biome = this.biomeAt(player.x, player.y);
    return {
      now,
      biome: { id: biome.id, name: biome.name },
      district: area ? this.cities.describe(area, isVisible, player) : undefined,
      party: party
        ? {
            leader: this.players.get(party.leader)?.username || "",
            members: this.partyMembers(player).map((m) => ({
              username: m.username,
              cls: this.classOf(m).name,
              color: this.classOf(m).color || [200, 200, 200],
              level: m.stats.level,
              hp: m.stats.hp,
              maxHp: m.stats.maxHp,
              downed: !!m.downed,
              x: m.x,
              y: m.y,
              depth: this.tierAt(m.x, m.y),
              district: this.cities?.areaAt(m.x, m.y)?.name,
            })),
          }
        : null,
      invite: player.pendingInvite && player.pendingInvite.until > now ? { from: player.pendingInvite.from, until: player.pendingInvite.until } : null,
      pings: this.pingsFor(player),
      player: {
        id: player.id,
        username: player.username,
        title: player.title,
        prestige: player.prestige || 0,
        cls: player.cls,
        className: c.name,
        classColor: c.color || [255, 255, 255],
        x: player.x,
        y: player.y,
        stats: player.stats,
        effAtk: this.effAtk(player),
        effDef: this.effDef(player),
        downedUntil: player.downed ? player.downed.until : null,
        dodgeReadyAt: player.dodgeReadyAt,
        safe: this.inSafeRoom(player.x, player.y),
        combo: player.combo.until > now ? player.combo : null,
        buffs: Object.entries(player.buffs)
          .filter(([, b]) => b.until > now)
          .map(([id, b]) => ({ id, name: b.name, until: b.until }))
          .concat(!player.downed && this.inFormation(player) ? [{ id: "formation", name: "Formation", until: now + 1000 }] : []),
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
      areaLevel: this.levelAt(player.x, player.y),
      maxLevel: MAX_LEVEL,
      home: area ? this.home : this.spawn,
      safeRoomId: this.safeRoomId,
      view,
      danger: this.dangerFor(isVisible),
      threat: this.threatFor(player, now, TICK_MS),
      monsters,
      items,
      npcs,
      nearbyPlayers,
      online: Array.from(this.players.values()).map((p) => ({
        username: p.username,
        prestige: p.prestige || 0,
        party: this.sameParty(p, player),
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

// Mix in co-op (parties, pings, travel, boss mechanics) and endgame/setting systems.
Object.assign(World.prototype, coop, endgame, encounters);
World.prototype.upgradeCostOf = endgame.upgradeCost;
World.prototype.reforgeCostOf = endgame.reforgeCost;

module.exports = { World, TICK_MS };
