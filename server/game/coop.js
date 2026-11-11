// Co-op systems mixed into World: parties, pings, travel and boss mechanics.
const { BOSS_LINES } = require("./lore");

const PARTY_SIZE = 4;
const INVITE_MS = 30000;
const PING_MS = 6000;
const PING_COOLDOWN = 1500;
const TRAVEL_COOLDOWN = 20000;
const COMBAT_LOCK_MS = 5000;
const SLAM_RADIUS = 2;
const SLAM_WARN_TICKS = 3; // ~0.9s to get out of the way
const SLAM_EVERY_MS = 9000;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const compass = (from, to) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "here";
  const a = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ["E", "SE", "S", "SW", "W", "NW", "N", "NE"][Math.round(((a + 360) % 360) / 45) % 8];
};

const PARTY_COLOR = [140, 220, 255];

module.exports = {
  compass,

  // ---------------------------------------------------------------- parties
  partyOf(p) {
    return p.partyId ? this.parties.get(p.partyId) || null : null;
  },

  partyMembers(p) {
    const party = this.partyOf(p);
    if (!party) return [p];
    return Array.from(party.members).map((id) => this.players.get(id)).filter(Boolean);
  },

  sameParty(a, b) {
    return a === b || (a.partyId && a.partyId === b.partyId);
  },

  partyNotify(party, text, color = PARTY_COLOR) {
    for (const id of party.members) {
      const m = this.players.get(id);
      if (m) this.notify(m, text, color);
    }
  },

  findOnline(name) {
    const n = String(name || "").toLowerCase();
    for (const p of this.players.values()) if (p.username.toLowerCase() === n) return p;
    return null;
  },

  partyAction(p, action, arg) {
    const now = Date.now();
    switch (action) {
      case "invite": {
        const target = this.findOnline(arg);
        if (!target) return { ok: false, message: "That hero isn't online." };
        if (target === p) return { ok: false, message: "You can't invite yourself." };
        if (target.partyId && target.partyId === p.partyId) return { ok: false, message: `${target.username} is already in your party.` };
        if (target.partyId) return { ok: false, message: `${target.username} is already in another party.` };
        let party = this.partyOf(p);
        if (!party) {
          party = { id: this.nextPartyId++, leader: p.id, members: new Set([p.id]) };
          this.parties.set(party.id, party);
          p.partyId = party.id;
        }
        if (party.members.size >= PARTY_SIZE) return { ok: false, message: "Your party is full (4 heroes)." };
        target.pendingInvite = { partyId: party.id, from: p.username, until: now + INVITE_MS };
        this.notify(target, `${p.username} invites you to their party. Press Y to accept, N to decline.`, PARTY_COLOR);
        this.fx(target, "toast", `Party invite from ${p.username}  ·  Y accept · N decline`, PARTY_COLOR);
        this.notify(p, `Invited ${target.username} to your party.`, PARTY_COLOR);
        break;
      }
      case "accept": {
        const inv = p.pendingInvite;
        p.pendingInvite = null;
        if (!inv || inv.until < now) return { ok: false, message: "The invite has expired." };
        const party = this.parties.get(inv.partyId);
        if (!party) return { ok: false, message: "That party no longer exists." };
        if (party.members.size >= PARTY_SIZE) return { ok: false, message: "That party is full." };
        if (p.partyId) this.leaveParty(p, true);
        party.members.add(p.id);
        p.partyId = party.id;
        this.partyNotify(party, `${p.username} joined the party! (${party.members.size}/${PARTY_SIZE})`);
        for (const id of party.members) {
          const m = this.players.get(id);
          if (m && m !== p) this.fx(m, "toast", `${p.username} joined your party`, PARTY_COLOR);
        }
        this.fx(p, "toast", "You joined the party!", PARTY_COLOR);
        break;
      }
      case "decline":
        if (p.pendingInvite) {
          const from = this.findOnline(p.pendingInvite.from);
          if (from) this.notify(from, `${p.username} declined your invite.`, PARTY_COLOR);
        }
        p.pendingInvite = null;
        break;
      case "leave":
        if (!p.partyId) return { ok: false, message: "You are not in a party." };
        this.leaveParty(p);
        break;
      case "kick": {
        const party = this.partyOf(p);
        if (!party || party.leader !== p.id) return { ok: false, message: "Only the party leader can kick." };
        const target = this.findOnline(arg);
        if (!target || target.partyId !== party.id || target === p) return { ok: false, message: "No such party member." };
        this.notify(target, "You were removed from the party.", PARTY_COLOR);
        this.leaveParty(target, true);
        break;
      }
      default:
        return { ok: false, message: "Unknown party action." };
    }
    this.changed();
    return { ok: true };
  },

  leaveParty(p, quiet = false) {
    const party = this.partyOf(p);
    p.partyId = null;
    if (!party) return;
    party.members.delete(p.id);
    if (!quiet) this.notify(p, "You left the party.", PARTY_COLOR);
    if (party.members.size <= 1) {
      for (const id of party.members) {
        const m = this.players.get(id);
        if (m) {
          m.partyId = null;
          this.notify(m, "Your party has disbanded.", PARTY_COLOR);
        }
      }
      this.parties.delete(party.id);
      return;
    }
    if (party.leader === p.id) party.leader = party.members.values().next().value;
    const leader = this.players.get(party.leader);
    this.partyNotify(party, `${p.username} left the party.${leader ? ` ${leader.username} leads now.` : ""}`);
  },

  partyChat(p, text) {
    const party = this.partyOf(p);
    if (!party) {
      this.notify(p, "You are not in a party. Press P to invite someone.", PARTY_COLOR);
      return;
    }
    this.partyNotify(party, `[party] <${p.username}> ${text}`, [120, 255, 200]);
  },

  // ------------------------------------------------------------------ pings
  ping(p) {
    const now = Date.now();
    if (now - (p.lastPing || 0) < PING_COOLDOWN || !p.cls) return;
    p.lastPing = now;
    // Ping the most interesting thing in sight, or your own spot.
    const seen = this.visibleMonsters(p, 10);
    const target = seen.find((m) => m.boss) || seen[0];
    const at = target ? { x: target.x, y: target.y } : { x: p.x, y: p.y };
    const label = target ? `${target.boss ? "BOSS " : ""}${target.name} here!` : "Over here!";
    this.pings.push({ x: at.x, y: at.y, by: p.username, partyId: p.partyId, label, until: now + PING_MS });
    this.floater(at.x, at.y, "!", [120, 230, 255]);
    const recipients = p.partyId
      ? this.partyMembers(p)
      : Array.from(this.players.values()).filter((o) => dist(o, p) <= 30);
    for (const r of recipients) {
      const where = r === p ? "" : ` (${Math.round(dist(r, at))} tiles ${compass(r, at)}, depth ${this.tierAt(at.x, at.y)})`;
      this.notify(r, `📍 ${p.username}: ${label}${where}`, [120, 230, 255]);
    }
    this.changed();
  },

  pingsFor(p) {
    const now = Date.now();
    this.pings = this.pings.filter((x) => x.until > now);
    return this.pings
      .filter((x) => (x.partyId && x.partyId === p.partyId) || x.by === p.username || (!x.partyId && dist(x, p) <= 30))
      .map((x) => ({ x: x.x, y: x.y, by: x.by, label: x.label, until: x.until }));
  },

  // ----------------------------------------------------------------- travel
  canTravel(p) {
    const now = Date.now();
    if (!p.cls || p.downed) return "You can't travel right now.";
    const atWaystone = Array.from(this.waystones.values()).some((w) => chebyshev(w, p) <= 1);
    if (!this.inSafeRoom(p.x, p.y) && !atWaystone) return "Travel from the safe room or a waystone (Ω).";
    if (now - p.lastHurt < COMBAT_LOCK_MS) return "You can't travel while in combat.";
    if (now - (p.lastTravel || 0) < TRAVEL_COOLDOWN) return `Travel is ready in ${Math.ceil((TRAVEL_COOLDOWN - (now - p.lastTravel)) / 1000)}s.`;
    return null;
  },

  travelOptions(p) {
    const reason = this.canTravel(p);
    const dests = [{ id: "home", label: "Safe Room · Emberfall", kind: "home" }];
    const found = (p.waystones || []).slice().sort((a, b) => a - b);
    for (const tier of found) {
      const w = this.waystones.get(tier);
      if (!w) continue;
      dests.push({ id: `ws:${tier}`, label: `Waystone · ${this.biomeAt(w.x, w.y).name} · depth ${tier}`, kind: "waystone" });
    }
    for (const m of this.partyMembers(p)) {
      if (m === p) continue;
      dests.push({ id: `p:${m.id}`, label: `${m.username} · depth ${this.tierAt(m.x, m.y)}${m.downed ? " (DOWN!)" : ""}`, kind: "party" });
    }
    return { can: !reason, reason, destinations: dests };
  },

  travel(p, dest) {
    const reason = this.canTravel(p);
    if (reason) return { ok: false, message: reason };
    let to = null;
    let label = "";
    if (dest === "home") {
      to = { ...this.spawn };
      label = "the safe room";
    } else if (typeof dest === "string" && dest.startsWith("ws:")) {
      const tier = Number(dest.slice(3));
      const w = this.waystones.get(tier);
      if (!w || !(p.waystones || []).includes(tier)) return { ok: false, message: "You haven't found that waystone." };
      to = this.freeSpotNear(w);
      label = `the depth ${tier} waystone`;
    } else if (typeof dest === "string" && dest.startsWith("p:")) {
      const m = this.players.get(Number(dest.slice(2)));
      if (!m || !this.sameParty(m, p) || m === p) return { ok: false, message: "That party member isn't available." };
      to = this.freeSpotNear(m);
      label = m.username;
    }
    if (!to) return { ok: false, message: "Nowhere safe to arrive there." };
    p.x = to.x;
    p.y = to.y;
    p.lastTravel = Date.now();
    this.ensureChunksAround(p.x, p.y);
    this.checkBiome(p);
    this.notify(p, `You step through the waystone and arrive at ${label}.`, [120, 230, 255]);
    this.fx(p, "toast", `✦ Traveled to ${label}`, [120, 230, 255]);
    this.markDirty(p);
    this.changed();
    return { ok: true };
  },

  freeSpotNear(o) {
    const spots = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1], [2, 0], [-2, 0], [0, 2], [0, -2]];
    for (const [dx, dy] of spots) {
      const x = o.x + dx;
      const y = o.y + dy;
      if (this.isFloor(x, y) && !this.monsterAt(x, y) && !this.isMerchant(x, y)) return { x, y };
    }
    return null;
  },

  // ---------------------------------------------------------- boss mechanics
  // Returns true when the boss used its action on a mechanic.
  bossMechanics(m, now) {
    // First sight: intro line, and scale health for the party it's facing.
    if (!m.introduced) {
      const seer = Array.from(this.players.values()).find((p) => this.isPrey(p) && this.canSee(m, p, m.aggro));
      if (seer) {
        m.introduced = true;
        const fighters = Array.from(this.players.values()).filter((p) => p.cls && dist(p, m) <= 20).length;
        if (fighters > 1) {
          const mult = 1 + 0.6 * (fighters - 1);
          m.maxHp = Math.round(m.maxHp * mult);
          m.hp = Math.round(m.hp * mult);
        }
        const line = BOSS_LINES[m.type];
        for (const p of this.players.values()) {
          if (dist(p, m) > 25) continue;
          if (line) {
            this.notify(p, `${m.name.toUpperCase()}: ${line}`, [255, 150, 80]);
            this.fx(p, "toast", `${m.name.toUpperCase()}: ${line}`, [255, 150, 80]);
          }
          if (fighters > 1) this.notify(p, `The ${m.name} grows stronger against your party (${fighters} heroes).`, [255, 150, 80]);
        }
      }
    }

    // Enrage at low health.
    if (!m.enraged && m.hp < m.maxHp * 0.3) {
      m.enraged = true;
      m.atk = Math.round(m.atk * 1.3);
      m.speed = Math.max(1, m.speed - 1);
      for (const p of this.players.values()) {
        if (dist(p, m) <= 25) this.notify(p, `The ${m.name} becomes ENRAGED!`, [255, 80, 60]);
      }
      this.floater(m.x, m.y, "ENRAGED", [255, 80, 60]);
    }

    // Calls for help once, when the fight turns against it.
    if (!m.calledAdds && m.hp < m.maxHp * 0.6) {
      m.calledAdds = true;
      this.bossCallsAdds(m);
    }

    // Doom mark: heroes must stand together to share it.
    if (m.introduced) this.bossMark(m, now);

    // Telegraphed ground slam: warn, then hit everyone close by.
    const target = m.target ? this.players.get(m.target) : null;
    if (target && this.isPrey(target) && chebyshev(target, m) <= 3 && now >= (m.nextSlam || 0)) {
      m.nextSlam = now + SLAM_EVERY_MS;
      const tiles = [];
      for (let dy = -SLAM_RADIUS; dy <= SLAM_RADIUS; dy++) {
        for (let dx = -SLAM_RADIUS; dx <= SLAM_RADIUS; dx++) tiles.push({ x: m.x + dx, y: m.y + dy });
      }
      this.telegraph(tiles, SLAM_WARN_TICKS, { by: m, mult: 1.6, what: "ground slam", label: "SLAM!" });
      for (const p of this.players.values()) {
        if (dist(p, m) > 12) continue;
        this.notify(p, `⚠ The ${m.name} gathers its strength - get away from it!`, [255, 200, 60]);
        if (chebyshev(p, m) <= SLAM_RADIUS + 1) this.fx(p, "toast", `⚠ ${m.name} is about to SLAM - MOVE!`, [255, 200, 60]);
      }
      this.floater(m.x, m.y, "!!", [255, 200, 60]);
      return true;
    }
    return false;
  },
};
