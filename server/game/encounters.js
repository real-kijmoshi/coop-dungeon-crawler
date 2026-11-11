// Combat depth and things to find, mixed into World:
//  - sounds: positional cues the client turns into sound effects
//  - telegraphs: attacks that mark the floor first, so they can be dodged
//  - monster abilities and elite affixes
//  - team combos (one hero primes a monster, another detonates it), flanking, formation
//  - room features: urns, fountains, mimics, sealed vaults, cursed chests, room discovery
const B = require("./balance");
const { generateItem } = require("./loot");
const { MAX_POTIONS } = require("./data");

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const key = (x, y) => `${x},${y}`;

const DANGER_COLOR = [255, 170, 60];
const COMBO_COLOR = [255, 215, 90];
const CURSE_COLOR = [210, 110, 255];
const VAULT_COLOR = [255, 215, 110];

const PRIME_MS = 6000;
const FLANK_MS = 3000;
const FLANK_BONUS = 0.15; // per other hero who hit the same monster recently (max 2)
const FORMATION_REDUCTION = 0.15; // damage reduction while next to an ally
const FOUNTAIN_COOLDOWN = 45000;
const VAULT_FORCE_MS = 10000;
const ENCOUNTER_WAVES = 3;
const ENCOUNTER_ABANDON_MS = 30000;
const MARK_TICKS = 8; // ~2.4s to group up
const MARK_EVERY_MS = 14000;

// Which skill leaves which mark on a monster.
const SKILL_PRIME = {
  cleave: "sunder",
  warcry: "sunder",
  backstab: "bleed",
  fan: "bleed",
  shadowstrike: "bleed",
  fireball: "fire",
  meteor: "fire",
  frostnova: "frost",
  chain: "shock",
  smite: "holy",
  holynova: "holy",
};

// What happens when an ally strikes a marked monster.
const COMBOS = {
  sunder: { name: "CRUSH", mult: 1.75, color: [255, 150, 90] },
  bleed: { name: "RUPTURE", mult: 1.75, color: [255, 90, 110] },
  fire: { name: "IGNITE", mult: 1.6, color: [255, 140, 40] },
  frost: { name: "SHATTER", mult: 2, color: [150, 220, 255] },
  shock: { name: "OVERLOAD", mult: 1.6, color: [255, 240, 120] },
  holy: { name: "JUDGEMENT", mult: 1.6, color: [255, 245, 180] },
};
const SELF_COMBO_MULT = 1.35;

const SKILL_SOUND = {
  cleave: "slash",
  warcry: "warcry",
  ironskin: "buff",
  berserk: "warcry",
  backstab: "stab",
  smoke: "smoke",
  fan: "slash",
  shadowstrike: "teleport",
  fireball: "fire",
  frostnova: "frost",
  chain: "shock",
  meteor: "explode",
  heal: "heal",
  smite: "holy",
  sanctuary: "holy",
  holynova: "holy",
};

const ELITE_AFFIXES = [
  { id: "volatile", name: "Volatile" }, // explodes shortly after dying
  { id: "frenzied", name: "Frenzied" }, // acts faster
  { id: "warding", name: "Warding" }, // shields other monsters nearby
  { id: "vampiric", name: "Vampiric" }, // heals when it hits
];

const SLIMELING = { type: "slime", name: "Slimeling", char: "j", color: [150, 240, 215], hp: 0.4, atk: 0.6, def: 0.8, xp: 0.25, gold: 0.3, speed: 2, aggro: 6, verb: "splashes", small: true };
const MIMIC = { type: "mimic", name: "Mimic", char: "=", color: [255, 190, 70], hp: 2.4, atk: 1.2, def: 1.3, xp: 2.5, gold: 3, speed: 2, aggro: 9, verb: "chomps", ability: "smash", mimic: true };

const square = (c, r) => {
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) out.push({ x: c.x + dx, y: c.y + dy });
  return out;
};

module.exports = {
  SKILL_PRIME,
  SKILL_SOUND,
  COMBOS,
  MIMIC,

  // ----------------------------------------------------------------- sounds
  sound(x, y, name) {
    this.emit("sound", { x, y, name });
  },

  soundFor(player, name) {
    this.emit("sound", { to: player.id, name });
  },

  // ----------------------------------------------------------------- damage
  inFormation(p) {
    for (const o of this.players.values()) {
      if (o !== p && o.cls && !o.downed && chebyshev(o, p) <= 1) return true;
    }
    return false;
  },

  // Every hit a hero takes goes through here. opts: crit, by (killer name), text(dmg).
  hurtPlayer(player, atk, level, opts = {}) {
    let dmg = B.rollDamage(atk, this.effDef(player), level);
    if (opts.crit) dmg *= 2;
    if (this.hasBuff(player, "ironskin")) dmg = Math.round(dmg * 0.3);
    if (this.inFormation(player)) dmg = Math.round(dmg * (1 - FORMATION_REDUCTION));
    dmg = Math.max(1, dmg);
    player.stats.hp -= dmg;
    player.lastHurt = Date.now();
    this.floater(player.x, player.y, `-${dmg}`, [255, 90, 90]);
    if (opts.text) this.notify(player, opts.text(dmg), [255, 90, 90]);
    this.fx(player, "hurt");
    this.sound(player.x, player.y, "hurt");
    this.markDirty(player);
    if (player.stats.hp <= 0) this.downOrKill(player, opts.by || "the dungeon");
    return dmg;
  },

  // ------------------------------------------------------------- telegraphs
  // Marks tiles as dangerous for a few ticks, then hits every hero still standing there.
  // opts: by (monster; it holds still and the attack is cancelled if it dies or is frozen),
  // atk, level, mult, name, what, label, sound, after(hits).
  telegraph(tiles, ticks, opts = {}) {
    const seen = new Set();
    const floor = tiles.filter((t) => {
      const k = key(t.x, t.y);
      if (seen.has(k) || !this.isFloor(t.x, t.y) || this.inSafeRoom(t.x, t.y)) return false;
      seen.add(k);
      return true;
    });
    if (!floor.length) return null;
    const by = opts.by || null;
    const t = {
      tiles: floor,
      at: this.tickCount + ticks,
      by: by ? by.id : null,
      atk: opts.atk !== undefined ? opts.atk : by ? by.atk : 1,
      level: opts.level !== undefined ? opts.level : by ? by.level : 1,
      mult: opts.mult || 1,
      name: opts.name || (by ? by.name : "trap"),
      what: opts.what || "attack",
      label: opts.label || "!",
      sound: opts.sound || "slam",
      after: opts.after || null,
      x: opts.x !== undefined ? opts.x : by ? by.x : floor[0].x,
      y: opts.y !== undefined ? opts.y : by ? by.y : floor[0].y,
    };
    if (by) by.windup = t.at;
    this.telegraphs.push(t);
    this.sound(t.x, t.y, "windup");
    this.changed();
    return t;
  },

  resolveTelegraphs(now = Date.now()) {
    if (!this.telegraphs.length) return false;
    const due = this.telegraphs.filter((t) => t.at <= this.tickCount);
    if (!due.length) return false;
    this.telegraphs = this.telegraphs.filter((t) => t.at > this.tickCount);
    for (const t of due) {
      if (t.by !== null) {
        const m = this.monsters.get(t.by);
        if (!m) continue; // killed before it could strike
        m.windup = 0;
        if (m.frozenUntil > now) {
          this.floater(m.x, m.y, "interrupted", [150, 220, 255]);
          continue;
        }
      }
      const spots = new Set(t.tiles.map((o) => key(o.x, o.y)));
      const hits = [];
      for (const p of Array.from(this.players.values())) {
        if (!this.isPrey(p) || !spots.has(key(p.x, p.y))) continue;
        hits.push(p);
        this.hurtPlayer(p, t.atk * t.mult, t.level, {
          by: t.name,
          text: (dmg) => `The ${t.name}'s ${t.what} hits you for ${dmg}!`,
        });
      }
      this.floater(t.x, t.y, hits.length ? t.label : "miss", DANGER_COLOR);
      this.sound(t.x, t.y, t.sound);
      if (t.after) t.after(hits);
    }
    return true;
  },

  dangerFor(isVisible) {
    const out = [];
    for (const t of this.telegraphs) {
      for (const o of t.tiles) if (isVisible(o)) out.push([o.x, o.y]);
    }
    return out;
  },

  // ------------------------------------------------------ monster abilities
  rayFrom(m, target, length) {
    const d = Math.hypot(target.x - m.x, target.y - m.y) || 1;
    const ux = (target.x - m.x) / d;
    const uy = (target.y - m.y) / d;
    const out = [];
    for (let i = 1; i <= length; i++) {
      const o = { x: Math.round(m.x + ux * i), y: Math.round(m.y + uy * i) };
      if (!this.isFloor(o.x, o.y)) break;
      out.push(o);
    }
    return out;
  },

  freeTileBeside(o) {
    const spots = square(o, 1).filter((s) => (s.x !== o.x || s.y !== o.y) && this.monsterCanEnter(s.x, s.y));
    return spots.length ? pick(spots) : null;
  },

  // Returns true when the monster spent its action on a special move.
  monsterAbility(m, target, now) {
    if (!m.ability || m.boss) return false;
    if (m.nextAbility === undefined) {
      m.nextAbility = now + rand(1500, 4000);
      return false;
    }
    if (now < m.nextAbility) return false;
    const d = chebyshev(target, m);
    const sees = () => this.los(m.x, m.y, target.x, target.y);
    let tiles = null;
    let ticks = 2;
    let opts = null;
    switch (m.ability) {
      case "smash": {
        if (manhattan(target, m) !== 1) return false;
        const dx = target.x - m.x;
        const dy = target.y - m.y;
        tiles = [-1, 0, 1].map((s) => ({ x: target.x + dy * s, y: target.y + dx * s }));
        opts = { mult: 1.8, what: "smash", label: "SMASH!" };
        break;
      }
      case "bomb":
        if (d < 2 || d > 5 || !sees()) return false;
        tiles = square(target, 1);
        ticks = 3;
        opts = { mult: 1.5, what: "bomb", label: "BOOM!", sound: "explode", x: target.x, y: target.y };
        break;
      case "hex":
        if (d > 6 || !sees()) return false;
        tiles = square(target, 1);
        ticks = 3;
        opts = { mult: 1.6, what: "hex", label: "HEX!", sound: "shock", x: target.x, y: target.y };
        break;
      case "line":
      case "breath": {
        if (d > 6 || d < 2 || !sees()) return false;
        tiles = this.rayFrom(m, target, 6);
        if (m.ability === "breath") {
          tiles = tiles.flatMap((o, i) => (i === 0 ? [o] : [o, { x: o.x + 1, y: o.y }, { x: o.x - 1, y: o.y }, { x: o.x, y: o.y + 1 }, { x: o.x, y: o.y - 1 }]));
        }
        opts = { mult: 1.6, what: "fire", label: "FWOOSH!", sound: "fire" };
        break;
      }
      case "leap": {
        if (d < 2 || d > 4 || !sees()) return false;
        const aim = { x: target.x, y: target.y };
        tiles = [aim, { x: aim.x + 1, y: aim.y }, { x: aim.x - 1, y: aim.y }, { x: aim.x, y: aim.y + 1 }, { x: aim.x, y: aim.y - 1 }];
        opts = {
          mult: 1.5,
          what: "pounce",
          label: "POUNCE!",
          x: aim.x,
          y: aim.y,
          after: () => {
            const land = this.monsterCanEnter(aim.x, aim.y) ? aim : this.freeTileBeside(aim);
            if (land && this.monsters.has(m.id)) {
              m.x = land.x;
              m.y = land.y;
            }
          },
        };
        break;
      }
      case "blink": {
        if (d < 3 || d > 9) return false;
        const land = this.freeTileBeside(target);
        if (!land) return false;
        this.floater(m.x, m.y, "~", m.color);
        m.x = land.x;
        m.y = land.y;
        this.sound(m.x, m.y, "teleport");
        m.nextAbility = now + rand(7000, 10000);
        return true;
      }
      default:
        return false;
    }
    if (!this.telegraph(tiles, ticks, { by: m, ...opts })) return false;
    m.nextAbility = now + rand(6000, 9000);
    return true;
  },

  // A monster that calls its pack when first attacked.
  callPack(m, player) {
    let called = 0;
    for (const o of this.monsters.values()) {
      if (o === m || o.type !== m.type || o.target || o.returning || dist(o, m) > 6) continue;
      o.target = player.id;
      called++;
    }
    if (called) this.floater(m.x, m.y, "!", m.color);
  },

  rollAffix(monster, def) {
    const affix = pick(ELITE_AFFIXES);
    monster.affix = affix.id;
    monster.name = `${affix.name} ${def.name}`;
    if (affix.id === "frenzied") monster.speed = Math.max(1, monster.speed - 1);
  },

  wardedBy(monster) {
    for (const o of this.monsters.values()) {
      if (o !== monster && o.affix === "warding" && chebyshev(o, monster) <= 4) return o;
    }
    return null;
  },

  // Called when a monster dies, before loot drops.
  deathEffects(monster) {
    if (monster.affix === "volatile") {
      this.telegraph(square(monster, 1), 3, {
        atk: monster.atk,
        level: monster.level,
        mult: 1.8,
        name: monster.name,
        what: "death blast",
        label: "BOOM!",
        sound: "explode",
        x: monster.x,
        y: monster.y,
      });
    }
    if (monster.type === "slime" && !monster.small && !monster.boss) {
      for (let i = 0; i < 2; i++) {
        const spot = this.monsterCanEnter(monster.x, monster.y) ? monster : this.freeTileBeside(monster);
        if (!spot) break;
        const s = this.spawnMonster(spot.x, spot.y, monster.level, monster.roomId, SLIMELING);
        s.target = monster.target;
        if (monster.encounter) this.joinEncounter(s, monster.encounter);
      }
    }
    if (monster.mimic) this.dropItem(monster.x, monster.y, { kind: "chest", level: monster.level });
    if (monster.encounter) this.encounterKill(monster);
  },

  // ------------------------------------------------------------ team combos
  // Works out the bonuses of a hit before damage is applied.
  comboFor(player, monster, prime, now) {
    const pr = monster.primed;
    if (!pr || pr.until <= now) return null;
    const team = pr.by !== player.id;
    if (!team && (!prime || prime === pr.type)) return null;
    return { ...COMBOS[pr.type], type: pr.type, team, by: pr.by, mult: team ? COMBOS[pr.type].mult : SELF_COMBO_MULT };
  },

  flankers(player, monster, now) {
    if (!monster.hitBy) return 0;
    let n = 0;
    for (const [id, at] of Object.entries(monster.hitBy)) {
      if (Number(id) !== player.id && now - at <= FLANK_MS && this.players.has(Number(id))) n++;
    }
    return Math.min(2, n);
  },

  flankBonus(player, monster, now) {
    return 1 + FLANK_BONUS * this.flankers(player, monster, now);
  },

  // The extra effect of a team combo, after the hit landed.
  detonate(player, monster, combo, dmg) {
    const now = Date.now();
    const alive = this.monsters.has(monster.id);
    this.floater(monster.x, monster.y, combo.team ? `${combo.name}!` : combo.name.toLowerCase(), combo.color);
    this.sound(monster.x, monster.y, "combo");
    if (!combo.team) return;
    const partner = this.players.get(combo.by);
    switch (combo.type) {
      case "frost":
        if (alive) monster.frozenUntil = 0;
        break;
      case "shock":
        if (alive) monster.frozenUntil = now + 2000;
        break;
      case "fire":
        for (const o of Array.from(this.monsters.values())) {
          if (o !== monster && chebyshev(o, monster) <= 1) this.hitMonster(player, o, 0.6, { quiet: true, prime: null, noCombo: true });
        }
        break;
      case "holy":
        for (const a of this.players.values()) {
          if (!a.downed && a.cls && dist(a, monster) <= 6) this.healPlayer(a, Math.round(a.stats.maxHp * 0.08));
        }
        break;
    }
    for (const p of [player, partner]) {
      if (!p) continue;
      p.counters.teamCombos = (p.counters.teamCombos || 0) + 1;
      this.questEvent(p, "teamcombo");
    }
    this.notify(player, `TEAM COMBO with ${partner ? partner.username : "an ally"}: ${combo.name}! ${dmg} damage.`, COMBO_COLOR);
    if (partner) this.notify(partner, `TEAM COMBO: ${player.username} hits your marked ${monster.name} - ${combo.name}! ${dmg} damage.`, COMBO_COLOR);
  },

  // ---------------------------------------------------------- boss: the mark
  // The boss marks one hero. The blow is split between everyone standing next to them.
  bossMark(m, now) {
    if (m.mark) {
      const target = this.players.get(m.mark.target);
      if (!target || !this.isPrey(target) || dist(target, m) > 16) {
        m.mark = null;
        return;
      }
      if (this.tickCount < m.mark.at) {
        if ((m.mark.at - this.tickCount) % 2 === 0) this.floater(target.x, target.y, "☠", CURSE_COLOR);
        return;
      }
      m.mark = null;
      const sharers = Array.from(this.players.values()).filter((p) => this.isPrey(p) && chebyshev(p, target) <= 1);
      const fighters = Array.from(this.players.values()).filter((p) => this.isPrey(p) && dist(p, m) <= 20).length;
      const mult = (fighters > 1 ? 2.6 : 1.3) / sharers.length;
      for (const p of sharers) {
        this.hurtPlayer(p, m.atk * mult, m.level, {
          by: m.name,
          text: (dmg) =>
            sharers.length > 1
              ? `The ${m.name}'s doom strikes - shared between ${sharers.length} heroes, you take ${dmg}.`
              : `The ${m.name}'s doom strikes you alone for ${dmg}!`,
        });
      }
      this.floater(target.x, target.y, sharers.length > 1 ? "SHARED!" : "DOOM!", CURSE_COLOR);
      this.sound(target.x, target.y, "explode");
      return;
    }
    if (m.nextMark === undefined) m.nextMark = now + 6000; // not in the first seconds of the fight
    if (now < m.nextMark) return;
    const prey = Array.from(this.players.values()).filter((p) => this.isPrey(p) && dist(p, m) <= 10);
    if (!prey.length) return;
    const target = pick(prey);
    m.nextMark = now + MARK_EVERY_MS;
    m.mark = { target: target.id, at: this.tickCount + MARK_TICKS };
    const company = prey.length > 1;
    for (const p of prey) {
      if (p === target) {
        this.notify(p, `☠ The ${m.name} marks YOU for doom!${company ? " Stand next to your allies to share the blow!" : " Brace yourself!"}`, CURSE_COLOR);
        this.fx(p, "toast", company ? "☠ MARKED - stand with your allies!" : "☠ MARKED for doom!", CURSE_COLOR);
      } else {
        this.notify(p, `☠ ${target.username} is marked for doom - stand next to them to share the blow!`, CURSE_COLOR);
        this.fx(p, "toast", `☠ ${target.username} is MARKED - stand next to them!`, CURSE_COLOR);
      }
    }
    this.floater(target.x, target.y, "☠", CURSE_COLOR);
    this.sound(target.x, target.y, "curse");
  },

  bossCallsAdds(m) {
    const room = this.map.rooms.find((r) => r.id === m.roomId);
    if (!room) return;
    const fighters = Array.from(this.players.values()).filter((p) => this.isPrey(p) && dist(p, m) <= 20);
    let n = 0;
    for (let i = 0; i < 1 + fighters.length; i++) {
      const pos = this.randomFreeTileInRoom(room);
      if (!pos) continue;
      const add = this.spawnMonster(pos.x, pos.y, Math.max(1, m.level - 3), room.id);
      if (fighters.length) add.target = pick(fighters).id;
      n++;
    }
    if (!n) return;
    for (const p of this.players.values()) {
      if (dist(p, m) <= 25) this.notify(p, `The ${m.name} calls for aid - ${n} monster${n > 1 ? "s" : ""} join the fight!`, [255, 150, 80]);
    }
    this.floater(m.x, m.y, "TO ME!", [255, 150, 80]);
    this.sound(m.x, m.y, "ambush");
  },

  // ----------------------------------------------------------- room features
  decorateRoom(room, level) {
    const place = (item, p = 1) => {
      if (!chance(p)) return;
      const pos = this.randomFreeTileInRoom(room);
      if (pos) this.dropItem(pos.x, pos.y, item);
    };
    if (chance(0.5)) for (let i = rand(1, 3); i > 0; i--) place({ kind: "urn", level });
    place({ kind: "fountain" }, 0.05);
    if (level >= 3 && room.width * room.height >= 20) place({ kind: "cursed", level }, 0.06);
    if (level >= 5) place({ kind: "vault", level }, 0.04);
  },

  smashUrn(player, item) {
    const s = player.stats;
    const level = item.level || this.levelAt(player.x, player.y);
    this.sound(player.x, player.y, "urn");
    if (chance(0.08)) {
      const spot = this.freeTileBeside(player);
      if (spot) {
        const m = this.spawnMonster(spot.x, spot.y, level, this.cell(player.x, player.y));
        m.target = player.id;
        this.floater(m.x, m.y, "!", m.color);
        this.notify(player, `Something was hiding in the urn - a ${m.name} leaps out!`, [255, 170, 90]);
        return;
      }
    }
    if (chance(0.1) && s.potions < MAX_POTIONS) {
      s.potions++;
      this.notify(player, "You smash an urn and find a healing potion.", [255, 80, 160]);
      return;
    }
    const amount = Math.max(1, Math.round((1 + B.roomGold(level) * 0.4) * (1 + s.goldFind) * (this.hasBuff(player, "fortune") ? 2 : 1)));
    this.addGold(player, amount);
    this.floater(player.x, player.y, `+${amount}g`, [255, 215, 0]);
  },

  // Returns true: the fountain stays where it is.
  drinkFountain(player) {
    const s = player.stats;
    const now = Date.now();
    if (s.hp >= s.maxHp) return true;
    const wait = FOUNTAIN_COOLDOWN - (now - (player.lastFountain || 0));
    if (wait > 0) {
      this.notify(player, `The fountain's magic needs ${Math.ceil(wait / 1000)}s to settle before it heals you again.`, [120, 200, 255]);
      return true;
    }
    player.lastFountain = now;
    const healed = this.healPlayer(player, s.maxHp);
    this.notify(player, `You drink from the fountain and feel whole again. +${healed} HP`, [120, 200, 255]);
    this.sound(player.x, player.y, "fountain");
    return true;
  },

  // A chest that bites back. Returns true if it was a mimic.
  wakeMimic(player, item) {
    const spot = this.freeTileBeside(player);
    if (!spot) return false;
    const m = this.spawnMonster(spot.x, spot.y, item.level || this.levelAt(player.x, player.y), this.cell(player.x, player.y), MIMIC);
    m.target = player.id;
    this.floater(m.x, m.y, "MIMIC!", MIMIC.color);
    this.notify(player, "The chest has TEETH - it's a Mimic! Kill it to get the real treasure.", MIMIC.color);
    this.sound(m.x, m.y, "ambush");
    return true;
  },

  rewardHero(p, level, boost, goldMult, text) {
    const gold = Math.round(B.chestGold(level) * goldMult);
    this.addGold(p, gold);
    const loot = generateItem(level + 1, { boost });
    if (!this.giveItem(p, loot)) this.dropItem(p.x, p.y, { kind: "gear", item: loot });
    this.notify(p, `${text} +${gold} gold and an item.`, VAULT_COLOR);
    this.soundFor(p, "chest");
    this.markProfile(p);
  },

  // A vault with two locks: easy with an ally at your side, a fight when forced alone.
  // Returns true while the vault stays shut.
  openVault(player, item) {
    const now = Date.now();
    const level = item.level || this.levelAt(player.x, player.y);
    const allies = Array.from(this.players.values()).filter((o) => o !== player && o.cls && !o.downed && chebyshev(o, player) <= 2);
    if (allies.length) {
      const names = [player, ...allies].map((h) => h.username).join(" and ");
      for (const h of [player, ...allies]) {
        this.rewardHero(h, level, 4, 2, "Two keys turn at once and the vault swings open!");
        this.fx(h, "toast", "VAULT OPENED TOGETHER", VAULT_COLOR);
        h.counters.vaults = (h.counters.vaults || 0) + 1;
        h.counters.chests = (h.counters.chests || 0) + 1;
        this.questEvent(h, "chest");
        this.checkAchievements(h);
      }
      this.announce(`${names} opened a sealed vault together!`, VAULT_COLOR);
      return false;
    }
    if (item.forcedBy !== player.id || now - (item.forcedAt || 0) > VAULT_FORCE_MS) {
      item.forcedBy = player.id;
      item.forcedAt = now;
      this.notify(player, "A sealed vault with two locks. Bring an ally to stand beside you and it opens with better loot for both - or step on it again to force it alone and face its guardians.", VAULT_COLOR);
      this.fx(player, "toast", "Sealed vault: needs two heroes (step again to force it)", VAULT_COLOR);
      return true;
    }
    for (let i = 0; i < 2; i++) {
      const spot = this.freeTileBeside(player);
      if (!spot) break;
      const g = this.spawnMonster(spot.x, spot.y, level, this.cell(player.x, player.y));
      g.target = player.id;
      this.floater(g.x, g.y, "!", g.color);
    }
    this.sound(player.x, player.y, "ambush");
    this.rewardHero(player, level, 2, 1, "You force the vault and its guardians wake!");
    player.counters.chests = (player.counters.chests || 0) + 1;
    this.questEvent(player, "chest");
    return false;
  },

  // ----------------------------------------------------------- cursed chests
  // Opening one starts a fight in waves; everyone who stays gets their own reward.
  heroesNear(o, range) {
    return Array.from(this.players.values()).filter((p) => p.cls && !p.downed && dist(p, o) <= range);
  },

  startCursedChest(player, item) {
    const room = this.map.rooms.find((r) => r.id === this.cell(player.x, player.y));
    const level = item.level || this.levelAt(player.x, player.y);
    const enc = {
      id: this.nextEncounterId++,
      x: player.x,
      y: player.y,
      room: room || { id: this.cell(player.x, player.y), x: player.x - 3, y: player.y - 3, width: 7, height: 7 },
      level,
      wave: 0,
      alive: new Set(),
      nextWaveAt: this.tickCount + 5,
      lastSeen: Date.now(),
    };
    this.encounters.set(enc.id, enc);
    for (const h of this.heroesNear(enc, 14)) {
      this.notify(h, `${player.username} opens a CURSED CHEST! Survive ${ENCOUNTER_WAVES} waves to claim what's inside.`, CURSE_COLOR);
      this.fx(h, "toast", `CURSED CHEST - survive ${ENCOUNTER_WAVES} waves!`, CURSE_COLOR);
    }
    this.sound(enc.x, enc.y, "curse");
  },

  joinEncounter(monster, id) {
    const enc = this.encounters.get(id);
    if (!enc) return;
    monster.encounter = id;
    monster.homeX = enc.x;
    monster.homeY = enc.y;
    enc.alive.add(monster.id);
  },

  spawnWave(enc) {
    enc.wave++;
    enc.nextWaveAt = 0;
    const heroes = this.heroesNear(enc, 14);
    const last = enc.wave === ENCOUNTER_WAVES;
    const count = 2 + heroes.length + (last ? 1 : 0);
    for (let i = 0; i < count; i++) {
      let pos = null;
      for (let tries = 0; tries < 8 && !pos; tries++) {
        const c = this.randomFreeTileInRoom(enc.room);
        if (c && heroes.every((h) => chebyshev(h, c) >= 2)) pos = c;
      }
      pos = pos || this.randomFreeTileInRoom(enc.room);
      if (!pos) continue;
      const m = this.spawnMonster(pos.x, pos.y, enc.level, enc.room.id);
      if (last && i === 0 && !m.elite) {
        // the last wave is led by a champion
        m.elite = true;
        m.maxHp = Math.round(m.maxHp * B.ELITE.hp);
        m.hp = m.maxHp;
        m.atk = Math.round(m.atk * B.ELITE.atk * 10) / 10;
        m.xp = Math.round(m.xp * B.ELITE.xp);
        m.color = m.color.map((v) => Math.min(255, v + 60));
        this.rollAffix(m, { name: m.name });
      }
      if (heroes.length) m.target = pick(heroes).id;
      this.joinEncounter(m, enc.id);
      this.floater(m.x, m.y, "!", CURSE_COLOR);
    }
    for (const h of heroes) {
      this.notify(h, last ? "The curse gathers its last strength - FINAL WAVE!" : `Wave ${enc.wave} of ${ENCOUNTER_WAVES} rises from the shadows!`, CURSE_COLOR);
      this.fx(h, "toast", last ? "FINAL WAVE" : `WAVE ${enc.wave} / ${ENCOUNTER_WAVES}`, CURSE_COLOR);
    }
    this.sound(enc.x, enc.y, "ambush");
    if (!enc.alive.size) enc.nextWaveAt = this.tickCount + 3; // nowhere to spawn: move on
  },

  encounterKill(monster) {
    const enc = this.encounters.get(monster.encounter);
    if (!enc) return;
    enc.alive.delete(monster.id);
    if (!enc.alive.size && !enc.nextWaveAt) enc.nextWaveAt = this.tickCount + 5;
  },

  finishEncounter(enc) {
    this.encounters.delete(enc.id);
    const heroes = this.heroesNear(enc, 16);
    for (const h of heroes) {
      this.rewardHero(h, enc.level, 4, 1.5, "The curse breaks!");
      h.stats.potions = Math.min(MAX_POTIONS, h.stats.potions + 1);
      this.gainXp(h, Math.round(B.xpToNext(h.stats.level) * 0.05));
      this.fx(h, "toast", "✦ CURSE BROKEN ✦", CURSE_COLOR);
      h.counters.cursed = (h.counters.cursed || 0) + 1;
      h.counters.chests = (h.counters.chests || 0) + 1;
      this.questEvent(h, "chest");
      this.questEvent(h, "cursed");
      this.checkAchievements(h);
    }
    if (heroes.length) this.announce(`${heroes.map((h) => h.username).join(", ")} broke the curse of a cursed chest!`, CURSE_COLOR);
    this.sound(enc.x, enc.y, "victory");
    this.changed();
  },

  updateEncounters(now = Date.now()) {
    for (const enc of Array.from(this.encounters.values())) {
      for (const id of Array.from(enc.alive)) if (!this.monsters.has(id)) enc.alive.delete(id);
      if (this.heroesNear(enc, 18).length) enc.lastSeen = now;
      else if (now - enc.lastSeen > ENCOUNTER_ABANDON_MS) {
        for (const id of enc.alive) this.monsters.delete(id);
        this.encounters.delete(enc.id);
        this.changed();
        continue;
      }
      if (!enc.alive.size && !enc.nextWaveAt) enc.nextWaveAt = this.tickCount + 5;
      if (enc.nextWaveAt && this.tickCount >= enc.nextWaveAt) {
        if (enc.wave >= ENCOUNTER_WAVES) this.finishEncounter(enc);
        else this.spawnWave(enc);
      }
    }
  },

  // -------------------------------------------------------------- discovery
  // The first visit to a chamber is worth a little XP, so exploring pays.
  discoverRoom(p) {
    const id = this.cell(p.x, p.y);
    if (id <= 0 || id === this.safeRoomId) return;
    if (!p.seenRooms) p.seenRooms = new Set();
    if (p.seenRooms.has(id)) return;
    p.seenRooms.add(id);
    p.counters.rooms = (p.counters.rooms || 0) + 1;
    const level = this.levelAt(p.x, p.y);
    const xp = Math.round(B.monsterBase(level).xp * 0.6 * B.xpLevelMult(p.stats.level, level));
    if (xp >= 1) {
      this.floater(p.x, p.y, `+${xp} xp`, [150, 200, 255]);
      this.gainXp(p, xp);
    }
    this.soundFor(p, "discover");
    this.questEvent(p, "explore");
  },
};
