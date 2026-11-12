// Team combat, mixed into World. Everything here exists to make fighting together
// stronger than fighting side by side:
//  - threat: monsters fight whoever is most dangerous to them, so a warrior can hold them
//  - class auras: passive help each class gives the allies standing near them
//  - poise: elites and bosses can be staggered by focused, coordinated hits
//  - combo chains: a team combo can re-mark the monster for the next hero
//  - unity and RALLY: a shared meter that unleashes every nearby hero's ultimate at once
//  - boss seals: a shield that only breaks when the party holds every rune together
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const UNITY_MAX = 100;
const RALLY_RANGE = 8;
const RALLY_MS = 10000;
const ALLY_RANGE = 8; // "fighting together" for unity
const AURA_RANGE = 5;
const GUARD_SHARE = 0.3; // part of a hit on an adjacent ally the warrior takes instead
const GUARD_KEEP = 0.6; // ...of which the warrior's guard actually lets through
const WEAK_POINT_MS = 4000;
const WEAK_POINT_BONUS = 0.12;
const ARCANE_COOLDOWN = 0.85;
const BLESSED_REGEN = 0.02;
const DOWNED_BLESSING_MS = 10000;
const POISE_REGEN_DELAY = 4000;
const STAGGER_TAKEN = 1.5;
const CHAIN_STEP = 0.25;
const CHAIN_MAX = 4;
const SEAL_MS = 20000;
const SEAL_TAKEN = 0.1;

// How much threat each class makes per point of damage. Warriors hold attention,
// rogues slip under it.
const THREAT = { warrior: 2.2, cleric: 1, mage: 0.85, rogue: 0.7 };
const THREAT_SWITCH = 1.3; // a challenger needs this much more threat to pull a monster

const UNITY_COLOR = [120, 255, 220];
const STAGGER_COLOR = [255, 220, 90];
const SEAL_COLOR = [190, 140, 255];
const GUARD_COLOR = [255, 170, 110];

const ULTIMATES = {
  warrior: { name: "EARTHSHATTER", color: [255, 140, 80] },
  rogue: { name: "BLADE STORM", color: [180, 255, 120] },
  mage: { name: "CATACLYSM", color: [150, 180, 255] },
  cleric: { name: "DIVINE GRACE", color: [255, 240, 160] },
};

module.exports = {
  UNITY_MAX,
  ULTIMATES,

  // --------------------------------------------------------------- helpers
  // Living heroes who can fight, other than p, within range of o.
  alliesNear(p, o, range) {
    const out = [];
    for (const a of this.players.values()) {
      if (a !== p && a.cls && !a.downed && dist(a, o) <= range) out.push(a);
    }
    return out;
  },

  classAllyNear(p, cls, range) {
    for (const a of this.players.values()) {
      if (a !== p && a.cls === cls && !a.downed && dist(a, p) <= range) return a;
    }
    return null;
  },

  // ----------------------------------------------------------------- threat
  // Replaces "the monster attacks whoever hit it last": a hit adds threat, and the
  // monster only turns on a new hero who is clearly more dangerous than its target.
  addThreat(monster, player, amount, now = Date.now()) {
    if (monster.flees) return;
    const table = monster.threat || (monster.threat = {});
    const mult = this.hasBuff(player, "hidden") ? 0 : THREAT[player.cls] || 1;
    table[player.id] = (table[player.id] || 0) + Math.max(1, amount) * mult;
    if (monster.tauntUntil > now) return;
    const current = monster.target ? this.players.get(monster.target) : null;
    if (!current || current === player || !this.isPrey(current)) {
      if (mult > 0) monster.target = player.id;
      return;
    }
    if (table[player.id] > (table[current.id] || 0) * THREAT_SWITCH) {
      monster.target = player.id;
      if (monster.elite || monster.boss) this.floater(monster.x, monster.y, `→${player.username}`, [255, 200, 160]);
    }
  },

  // ------------------------------------------------------------ class auras
  // A warrior next to an ally takes part of the blows meant for them.
  guardFor(player) {
    if (player.cls === "warrior") return null;
    for (const a of this.players.values()) {
      if (a === player || a.cls !== "warrior" || a.downed || chebyshev(a, player) > 1) continue;
      if (a.stats.hp < a.stats.maxHp * 0.25) continue; // too hurt to step in
      return a;
    }
    return null;
  },

  // Returns the damage left for the protected hero.
  guardBlow(player, dmg, by) {
    const guard = this.guardFor(player);
    if (!guard) return dmg;
    const share = Math.floor(dmg * GUARD_SHARE);
    if (share <= 0) return dmg;
    const keep = this.hasBuff(guard, "ironskin") ? GUARD_KEEP * 0.3 : GUARD_KEEP;
    const taken = Math.max(1, Math.round(share * keep));
    guard.stats.hp -= taken;
    guard.lastHurt = Date.now();
    guard.counters.guarded = (guard.counters.guarded || 0) + share;
    this.floater(guard.x, guard.y, `-${taken}⛨`, GUARD_COLOR);
    this.markDirty(guard);
    this.gainUnity(guard, 1);
    if (guard.stats.hp <= 0) this.downOrKill(guard, by || "the dungeon");
    return dmg - share;
  },

  // Damage multiplier from team effects on a hero's hit.
  teamDamageMult(player, monster, now) {
    let m = 1;
    if (this.hasBuff(player, "rally")) m *= 1 + 0.3 * (player.rallyPower || 1);
    if (this.hasBuff(player, "secondwind")) m *= 1.2;
    if (player.cls !== "rogue" && monster.hitBy) {
      for (const [id, at] of Object.entries(monster.hitBy)) {
        if (now - at > WEAK_POINT_MS || Number(id) === player.id) continue;
        const r = this.players.get(Number(id));
        if (r && r.cls === "rogue") {
          m *= 1 + WEAK_POINT_BONUS;
          break;
        }
      }
    }
    if (monster.staggerUntil > now) m *= STAGGER_TAKEN;
    if (monster.seal) m *= SEAL_TAKEN;
    return m;
  },

  // Damage a hero takes after team protection. Returns null when fully absorbed.
  teamProtection(player, dmg) {
    if (this.hasBuff(player, "aegis")) return null;
    if (this.hasBuff(player, "rally")) dmg = Math.round(dmg * 0.75);
    return dmg;
  },

  skillCooldownMult(player) {
    let m = 1;
    if (this.classAllyNear(player, "mage", AURA_RANGE)) m *= ARCANE_COOLDOWN;
    if (this.hasBuff(player, "rally")) m *= 0.5;
    return m;
  },

  // A cleric nearby keeps a downed hero alive for longer.
  downedBonusMs(player) {
    return this.classAllyNear(player, "cleric", ALLY_RANGE) ? DOWNED_BLESSING_MS : 0;
  },

  // The team effects a hero is enjoying right now, shown with their buffs.
  aurasFor(p, now) {
    if (!p.cls || p.downed) return [];
    const out = [];
    const until = now + 1000;
    const guard = this.guardFor(p);
    if (guard) out.push({ id: "guarded", name: `Guarded by ${guard.username}`, until });
    if (p.cls === "warrior") {
      const ward = this.alliesNear(p, p, 1.5).find((a) => a.cls !== "warrior");
      if (ward && p.stats.hp >= p.stats.maxHp * 0.25) out.push({ id: "guarding", name: `Guarding ${ward.username}`, until });
    }
    if (this.classAllyNear(p, "mage", AURA_RANGE)) out.push({ id: "arcane", name: "Arcane Font", until });
    if (this.classAllyNear(p, "cleric", AURA_RANGE)) out.push({ id: "blessed", name: "Blessed", until });
    if (this.classAllyNear(p, "rogue", ALLY_RANGE) && p.cls !== "rogue") out.push({ id: "weakpoint", name: "Weak Points", until });
    return out;
  },

  // ------------------------------------------------------------------ poise
  initPoise(m) {
    if (!m.elite && !m.boss) return;
    m.maxPoise = m.boss ? (m.final ? 200 : 140) : 60;
    m.poise = m.maxPoise;
    m.staggerUntil = 0;
    m.staggers = 0;
  },

  poiseDamage(player, m, amount, now = Date.now()) {
    if (!m.maxPoise || m.staggerUntil > now || m.seal || !this.monsters.has(m.id)) return;
    m.poise -= amount;
    m.poiseHitAt = now;
    if (m.poise <= 0) this.stagger(m, player, now);
  },

  stagger(m, by, now = Date.now()) {
    const ms = m.boss ? 5000 : 3500;
    m.staggerUntil = now + ms;
    m.poise = 0;
    m.staggers = (m.staggers || 0) + 1;
    this.interruptTelegraph(m);
    if (m.mark) m.mark = null;
    this.floater(m.x, m.y, "STAGGERED!", STAGGER_COLOR);
    this.sound(m.x, m.y, "combo");
    const name = by ? by.username : "The party";
    for (const h of this.alliesNear(null, m, 14)) {
      this.notify(h, `${name} breaks the ${m.name}'s guard - STAGGERED for ${ms / 1000}s! Everyone hits ${Math.round((STAGGER_TAKEN - 1) * 100)}% harder!`, STAGGER_COLOR);
      if (m.boss) this.fx(h, "toast", `✷ ${m.name.toUpperCase()} STAGGERED - ALL IN! ✷`, STAGGER_COLOR);
    }
    if (by) {
      by.counters.staggers = (by.counters.staggers || 0) + 1;
      this.gainUnity(by, m.boss ? 20 : 10);
      this.checkAchievements(by);
    }
  },

  updatePoise(now) {
    for (const m of this.monsters.values()) {
      if (!m.maxPoise) continue;
      if (m.staggerUntil) {
        if (m.staggerUntil > now) continue;
        m.staggerUntil = 0;
        if (m.boss) m.maxPoise = Math.round(m.maxPoise * 1.25); // each break is harder than the last
        m.poise = m.maxPoise;
        this.floater(m.x, m.y, "recovers", [200, 200, 200]);
        continue;
      }
      if (m.poise < m.maxPoise && now - (m.poiseHitAt || 0) > POISE_REGEN_DELAY) {
        m.poise = Math.min(m.maxPoise, m.poise + m.maxPoise * 0.08);
      }
    }
  },

  // Called after every hero hit lands (the monster may already be dead).
  afterHeroHit(player, monster, hit, now = Date.now()) {
    const together = this.alliesNear(player, player, ALLY_RANGE).length > 0;
    this.gainUnity(player, (together ? 1.2 : 0.5) * Math.min(3, hit.mult) + (hit.flank ? 1 : 0));
    if (!monster.maxPoise) return;
    let poise = 7 * Math.min(4, hit.mult);
    if (player.cls === "warrior") poise *= 1.5;
    if (hit.crit) poise *= 1.3;
    if (hit.flank) poise *= 1 + 0.5 * hit.flank;
    if (hit.combo && hit.combo.team) poise += hit.combo.type === "frost" || hit.combo.type === "shock" ? 45 : 30;
    if (hit.combo && hit.combo.chain > 1) poise += 10 * (hit.combo.chain - 1);
    this.poiseDamage(player, monster, poise, now);
  },

  // ----------------------------------------------------------- combo chains
  // A team combo made by a skill marks the monster again for the next hero, and each
  // new hero in the chain hits harder. Returns the chain step for this combo.
  chainStep(player, monster, now) {
    const c = monster.chain;
    return c && c.until > now && c.last !== player.id ? Math.min(CHAIN_MAX, c.count + 1) : 1;
  },

  chainBonus(step) {
    return CHAIN_STEP * (step - 1);
  },

  afterCombo(player, monster, combo, prime, now) {
    monster.primed = null;
    if (!combo.team) return;
    monster.chain = { count: combo.chain, last: player.id, until: now + 6000 };
    if (prime && this.monsters.has(monster.id)) monster.primed = { type: prime, by: player.id, until: now + 6000 };
    this.gainUnity(player, 8 + 4 * (combo.chain - 1));
    const partner = this.players.get(combo.by);
    if (partner && !this.sameParty(partner, player)) this.gainUnity(partner, 6);
    if (combo.chain > 1) {
      player.counters.bestChain = Math.max(player.counters.bestChain || 0, combo.chain);
      this.checkAchievements(player);
    }
  },

  // ------------------------------------------------------------------ unity
  unityHolder(p) {
    return this.partyOf(p) || p;
  },

  unityOf(p) {
    return Math.floor(this.unityHolder(p).unity || 0);
  },

  gainUnity(p, amount) {
    if (!p || !p.cls || amount <= 0 || this.rallying) return;
    const holder = this.unityHolder(p);
    const before = holder.unity || 0;
    holder.unity = Math.min(UNITY_MAX, before + amount);
    if (before < UNITY_MAX && holder.unity >= UNITY_MAX) {
      for (const m of this.partyMembers(p)) {
        this.notify(m, "✦ UNITY is full - press the Rally key to unleash a LINKED RALLY with every ally near you!", UNITY_COLOR);
        this.fx(m, "toast", "✦ RALLY READY ✦", UNITY_COLOR);
        this.soundFor(m, "buff");
        this.markDirty(m);
      }
    }
  },

  // RALLY: spend a full unity meter. Every party member within range (downed ones are
  // brought back) unleashes their class ultimate together, stronger for each one linked.
  rally(p) {
    if (!p.cls) return { ok: false, message: "Choose a class first." };
    if (p.downed) return { ok: false, message: "You can't rally while down." };
    const holder = this.unityHolder(p);
    if ((holder.unity || 0) < UNITY_MAX) {
      return { ok: false, message: `Unity ${this.unityOf(p)}% - fight beside allies, land team combos and stagger foes to fill it.` };
    }
    holder.unity = 0;
    const now = Date.now();
    const linked = this.partyMembers(p).filter((m) => m.cls && dist(m, p) <= RALLY_RANGE);
    if (!linked.includes(p)) linked.push(p);
    const power = 1 + 0.2 * (linked.length - 1);
    const names = linked.map((m) => m.username).join(", ");
    this.rallying = true; // nothing done by the rally itself refills the meter
    for (const h of linked) {
      if (h.downed) this.revive(h, p);
      this.addBuff(h, "rally", "Rally", RALLY_MS);
      h.rallyPower = power;
      h.counters.rallies = (h.counters.rallies || 0) + 1;
    }
    const label = linked.length > 1 ? `LINKED RALLY ×${linked.length}` : "RALLY";
    try {
      for (const h of linked) this.ultimate(h, power, now);
    } finally {
      this.rallying = false;
    }
    for (const h of linked) {
      this.fx(h, "toast", `✦ ${label}! ✦`, UNITY_COLOR);
      this.notify(h, `✦ ${p.username} calls a ${label}${linked.length > 1 ? ` with ${names}` : ""}! +${Math.round(30 * power)}% damage, -25% damage taken, skills recharge twice as fast for ${RALLY_MS / 1000}s.`, UNITY_COLOR);
      this.checkAchievements(h);
      this.markProfile(h);
    }
    if (linked.length >= 3) this.announce(`${names} unleash a ${label}!`, UNITY_COLOR);
    this.floater(p.x, p.y, label, UNITY_COLOR);
    this.sound(p.x, p.y, "warcry");
    this.changed();
    return { ok: true };
  },

  ultimate(h, power, now) {
    const ult = ULTIMATES[h.cls];
    if (!ult) return;
    const foes = (r) =>
      Array.from(this.monsters.values()).filter((m) => chebyshev(m, h) <= r && this.los(h.x, h.y, m.x, m.y));
    const strike = (targets, mult, opts = {}) => {
      let total = 0;
      for (const m of targets) total += this.hitMonster(h, m, mult * power, { ...opts, quiet: true, prime: null, noCombo: true }).dmg;
      return total;
    };
    let text = "";
    switch (h.cls) {
      case "warrior": {
        const t = foes(2);
        const total = strike(t, 2.5);
        for (const m of t) this.poiseDamage(h, m, 40 * power, now);
        let taunted = 0;
        for (const m of foes(6)) {
          m.target = h.id;
          m.tauntUntil = now + 5000;
          taunted++;
        }
        text = `${total} damage and ${taunted} foes turn on you`;
        this.sound(h.x, h.y, "explode");
        break;
      }
      case "rogue": {
        const t = foes(4).slice(0, 6);
        const total = strike(t, 1.6, { forceCrit: true });
        for (const m of t) this.poiseDamage(h, m, 20 * power, now);
        text = `${t.length} foes cut for ${total}`;
        this.sound(h.x, h.y, "slash");
        break;
      }
      case "mage": {
        const t = this.visibleMonsters(h, 6);
        for (const m of t) {
          m.frozenUntil = Math.max(m.frozenUntil || 0, now + 2000);
          this.interruptTelegraph(m);
        }
        const total = strike(t, 2.5, { halfDef: true });
        text = `${t.length} foes frozen and blasted for ${total}`;
        this.sound(h.x, h.y, "explode");
        break;
      }
      case "cleric": {
        let saved = 0;
        for (const a of this.players.values()) {
          if (!a.cls || dist(a, h) > RALLY_RANGE) continue;
          if (a.downed) {
            this.revive(a, h);
            saved++;
          }
          this.healPlayer(a, Math.round(a.stats.maxHp * 0.5));
          this.addBuff(a, "aegis", "Aegis", 2500);
        }
        const undead = foes(4).filter((m) => m.undead);
        const total = strike(undead, 2, { halfDef: true });
        text = `allies healed and shielded${saved ? `, ${saved} revived` : ""}${total ? `, ${total} holy damage` : ""}`;
        this.sound(h.x, h.y, "holy");
        break;
      }
    }
    this.floater(h.x, h.y - 1, `${ult.name}!`, ult.color);
    this.notify(h, `${ult.name}! ${text}.`, ult.color);
  },

  // ------------------------------------------------------------- boss seals
  // At half health (and again at a fifth for the final boss) a boss seals itself in.
  // It takes almost no damage until heroes stand on every rune at the same moment.
  maybeSeal(m, now) {
    if (!m.boss || m.seal) return false;
    const done = m.seals || 0;
    const thresholds = m.final ? [0.5, 0.2] : [0.5];
    if (done >= thresholds.length || m.hp > m.maxHp * thresholds[done]) return false;
    const room = this.map.rooms.find((r) => r.id === m.roomId);
    if (!room) return false;
    m.seals = done + 1;
    const fighters = Array.from(this.players.values()).filter((p) => this.isPrey(p) && dist(p, m) <= 20);
    const n = Math.max(1, Math.min(3, fighters.length));
    const runes = [];
    for (let tries = 0; tries < 60 && runes.length < n; tries++) {
      const spot = this.randomFreeTileInRoom(room);
      if (!spot || chebyshev(spot, m) < 2) continue;
      const gap = tries < 30 ? 3 : 2;
      if (runes.some((r) => chebyshev(r, spot) < gap)) continue;
      runes.push({ x: spot.x, y: spot.y, lit: false });
    }
    if (!runes.length) return false;
    m.seal = { runes, until: now + SEAL_MS };
    this.interruptTelegraph(m);
    const how = runes.length > 1 ? `Stand on all ${runes.length} runes ◎ at the same time` : "Stand on the rune ◎";
    for (const h of this.alliesNear(null, m, 25)) {
      this.notify(h, `◎ The ${m.name} raises an ABYSSAL SEAL and shrugs off your blows! ${how} to shatter it (${SEAL_MS / 1000}s).`, SEAL_COLOR);
      this.fx(h, "toast", `◎ SEALED - ${how.toUpperCase()}! ◎`, SEAL_COLOR);
    }
    this.floater(m.x, m.y, "SEALED", SEAL_COLOR);
    this.sound(m.x, m.y, "curse");
    return true;
  },

  updateSeals(now) {
    for (const m of this.monsters.values()) {
      const seal = m.seal;
      if (!seal) continue;
      for (const r of seal.runes) r.lit = this.playerAt(r.x, r.y, (p) => this.isPrey(p)) || null;
      if (seal.runes.every((r) => r.lit)) {
        const heroes = seal.runes.map((r) => r.lit);
        m.seal = null;
        for (const r of seal.runes) this.floater(r.x, r.y, "✦", SEAL_COLOR);
        this.stagger(m, heroes[0], now);
        m.staggerUntil = now + 7000;
        for (const h of heroes) {
          h.counters.seals = (h.counters.seals || 0) + 1;
          this.gainUnity(h, 15);
          this.checkAchievements(h);
        }
        for (const h of this.alliesNear(null, m, 25)) {
          this.fx(h, "toast", "✦ SEAL SHATTERED - STRIKE NOW! ✦", SEAL_COLOR);
          this.notify(h, `✦ ${heroes.map((x) => x.username).join(" and ")} shatter the seal! The ${m.name} reels, defenceless!`, SEAL_COLOR);
        }
        this.sound(m.x, m.y, "explode");
        for (const r of seal.runes) delete r.lit;
        continue;
      }
      if (now >= seal.until) {
        m.seal = null;
        m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.1));
        this.floater(m.x, m.y, "+HEALS", [255, 90, 90]);
        for (const h of this.alliesNear(null, m, 25)) this.notify(h, `The seal holds - the ${m.name} drinks the dark and heals!`, [255, 90, 90]);
      }
    }
  },

  runesFor(isVisible) {
    const out = [];
    for (const m of this.monsters.values()) {
      if (!m.seal) continue;
      for (const r of m.seal.runes) if (isVisible(r)) out.push({ x: r.x, y: r.y, lit: !!r.lit, until: m.seal.until });
    }
    return out;
  },

  // ------------------------------------------------------------------- tick
  updateTeamplay(now) {
    this.updatePoise(now);
    this.updateSeals(now);
    // Blessed: a cleric's presence mends allies even mid-fight.
    if (this.tickCount % 10 === 0) {
      for (const p of this.players.values()) {
        if (!p.cls || p.downed || p.stats.hp >= p.stats.maxHp) continue;
        if (this.classAllyNear(p, "cleric", AURA_RANGE)) this.healPlayer(p, Math.max(1, Math.round(p.stats.maxHp * BLESSED_REGEN)), false);
      }
    }
  },

  // Fields the client shows for a monster.
  monsterTeamState(m, now) {
    return {
      poise: m.maxPoise ? Math.max(0, Math.round((m.poise / m.maxPoise) * 100) / 100) : null,
      staggered: m.staggerUntil > now,
      sealed: !!m.seal,
      chain: m.chain && m.chain.until > now ? m.chain.count : 0,
    };
  },
};
