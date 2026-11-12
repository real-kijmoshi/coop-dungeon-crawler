const { areas: layouts, routes } = require("./city-map");
const { monsterBase, xpLevelMult } = require("./balance");

const STRIDE = 64;
const FIRST_ROOM_ID = 1_000_000;
const NPC_COLOR = [245, 209, 138];
const ROUTE_COLOR = [145, 216, 211];
const MAP_TILES = {
  "~": { char: "~", color: [76, 151, 197], bg: [14, 40, 66], solid: true },
  "=": { char: "=", color: [188, 151, 93], bg: [52, 43, 30] },
  "*": { char: "*", color: [255, 209, 118], bg: [56, 42, 24], light: true },
  ",": { char: ",", color: [123, 183, 111], bg: [28, 52, 33] },
  ":": { char: ":", color: [252, 143, 74], bg: [64, 31, 22], light: true },
};
const key = ({ x, y }) => `${x},${y}`;
const close = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1;
const facts = new Set(["letters", "emberDoor", "orravethDoor", "stamp", "mould", "receiver", "register", "ending"]);
const surveyedRoutes = new Set([...routes.map((route) => route.id), "dungeon"]);

function readSet(value, allowed) {
  return new Set(Array.isArray(value) ? value.filter((id) => allowed.has(id)) : []);
}

function road(start, end, detour) {
  const points = [start];
  let { x, y } = start;
  const add = (nx, ny) => {
    while (x !== nx || y !== ny) {
      x += Math.sign(nx - x);
      y += Math.sign(ny - y);
      points.push({ x, y });
    }
  };
  add(x, start.y + detour);
  add(end.x, y);
  add(end.x, end.y);
  return points.slice(1, -1); // end landings are permanent floor
}

class Cities {
  constructor(world) {
    this.world = world;
    this.firstX = world.map.size + STRIDE;
    this.areas = new Map();
    this.byRoom = new Map();
    this.features = new Map();
    const saved = world.map.cityProgress || {};
    this.hinge = saved.hinge === 1 ? 1 : 0;
    this.cleared = readSet(saved.cleared, new Set(Object.keys(layouts)));
    this.ladder = saved.ladder === true && this.cleared.has("aqueduct");

    for (const [id, layout] of Object.entries(layouts)) this.addArea(id, layout);
    this.home = this.areas.get("emberfall").points.get("s");
    this.merchant = this.areas.get("emberfall").points.get("m");
    for (const route of routes) {
      this.addGate(route, route.a, route.b, true);
      this.addGate(route, route.b, route.a, false);
    }

    const cellars = this.areas.get("cellars");
    const east = { x: world.spawn.x + 1, y: world.spawn.y + 1 };
    const dungeon = world.isFloor(east.x, east.y) && !world.isMerchant(east.x, east.y) ? east : world.spawn;
    const gate = cellars.points.get("p");
    this.addFeature(gate, { name: "Procedural Dungeon", char: ">", kind: "route", route: "dungeon", to: dungeon });
    this.addFeature(dungeon, { name: "Old Cellars", char: "<", kind: "route", route: "dungeon", to: gate });
    const market = [cellars.points.get("s"), cellars.points.get("u")];
    const rescue = [cellars.points.get("t"), cellars.points.get("v")];
    this.roads = [
      [...road(...market, 0), ...road(...rescue, -5)],
      [...road(...market, 5), ...road(...rescue, 0)],
    ];
    this.roadKeys = this.roads.map((points) => new Set(points.map(key)));
    this.applyRoads();
  }

  addArea(id, layout) {
    const index = this.areas.size;
    const area = {
      ...layout, id, roomId: FIRST_ROOM_ID + index,
      floor: new Set(), terrain: [], water: new Set(), points: new Map(),
      spawned: false, enemyIds: new Set(),
    };
    this.areas.set(id, area);
    this.byRoom.set(area.roomId, area);
    layout.map.trimEnd().replace(/^\n/, "").split("\n").forEach((row, y) => {
      Array.from(row).forEach((char, x) => {
        if (char === "#" || char === " ") return;
        const tile = { x: this.firstX + x, y: index * STRIDE + y };
        const style = MAP_TILES[char];
        if (style?.solid) area.water.add(key(tile));
        else area.floor.add(key(tile));
        if (style) area.terrain.push({ ...tile, ...style });
        if (/^[a-z1-9]$/.test(char)) {
          if (area.points.has(char)) throw new Error(`Duplicate marker ${char} in ${id}`);
          area.points.set(char, tile);
        }
      });
    });
    for (const [char, npc] of Object.entries(layout.npcs || {})) {
      this.addFeature(area.points.get(char), npc);
    }
  }

  addFeature(point, feature) {
    if (!point || this.features.has(key(point))) throw new Error(`Invalid city feature: ${feature.name}`);
    this.features.set(key(point), { kind: "npc", color: NPC_COLOR, ...feature, ...point });
  }

  addGate(route, from, to, outward) {
    const area = this.areas.get(from[0]);
    const target = this.areas.get(to[0]);
    const name = outward && route.label ? `${route.label} to ${target.name}` : target.name;
    this.addFeature(area.points.get(from[1]), {
      name, char: route.shortcut ? "^" : ">", color: ROUTE_COLOR, kind: "route",
      route: route.id, to: target.points.get(to[1]), target: target.id,
      gate: { ...route, outward },
    });
  }

  areaAt(x, y) {
    if (x < this.firstX || x >= this.firstX + STRIDE || y < 0) return null;
    return this.byRoom.get(FIRST_ROOM_ID + Math.floor(y / STRIDE)) || null;
  }

  featureAt(x, y) {
    return this.features.get(key({ x, y }));
  }

  readProgress(data) {
    return {
      areas: readSet(data?.areas, this.areas),
      routes: readSet(data?.routes, surveyedRoutes),
      facts: readSet(data?.facts, facts),
    };
  }

  saveProgress(player) {
    const { areas, routes, facts } = player.exploration;
    return { areas: [...areas], routes: [...routes], facts: [...facts] };
  }

  saveWorld() {
    this.world.map.cityProgress = { hinge: this.hinge, cleared: [...this.cleared], ladder: this.ladder };
    this.world.map.scheduleSave();
  }

  arrive(player) {
    const area = this.areaAt(player.x, player.y);
    if (!area) return;
    const progress = player.exploration;
    if (!progress.areas.has(area.id)) {
      progress.areas.add(area.id);
      this.world.notify(player, `Atlas updated: ${area.name}. ${area.description}`, ROUTE_COLOR);
      this.world.markDirty(player);
      if (player.cls && area.id !== "emberfall") {
        const xp = Math.round(2 * monsterBase(area.level).xp * xpLevelMult(player.stats.level, area.level));
        if (xp > 0) this.world.gainXp(player, xp);
        player.counters.rooms = (player.counters.rooms || 0) + 1;
        this.world.questEvent(player, "explore");
      }
    }
    if (area.enemies && !area.spawned && !this.cleared.has(area.id)) {
      area.spawned = true;
      for (const [marker, def] of Object.entries(area.enemies)) {
        const point = area.points.get(marker);
        const location = this.world.monsterCanEnter(point.x, point.y) ? point : this.world.freeSpotNear(point, (x, y) => this.world.monsterCanEnter(x, y));
        if (!location) continue;
        const monster = this.world.spawnMonster(location.x, location.y, area.level, area.roomId, def);
        area.enemyIds.add(monster.id);
      }
    }
  }

  onKill(monster) {
    const area = this.byRoom.get(monster.roomId);
    if (!area || !area.enemyIds.delete(monster.id) || area.enemyIds.size) return;
    this.cleared.add(area.id);
    this.saveWorld();
    for (const player of this.world.players.values()) {
      if (this.areaAt(player.x, player.y) === area) {
        this.world.notify(player, `${area.name} is clear. The way ahead is open.`, ROUTE_COLOR);
      }
    }
  }

  nearbyFeature(player) {
    const point = this.featureAt(player.x, player.y);
    if (point) return point;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const feature = this.featureAt(player.x + dx, player.y + dy);
      if (feature) return feature;
    }
    return null;
  }

  interact(player, feature = this.nearbyFeature(player)) {
    if (!player.cls || player.downed) return { ok: false, message: "You can't interact right now." };
    if (!feature || !close(player, feature)) return { ok: false, message: "Move next to a person or a route marker." };
    if (feature.kind === "merchant") {
      this.world.emit("shop", player.id, this.world.shopFor(player));
      return { ok: true };
    }
    if (feature.kind === "route") return this.cross(player, feature);
    const known = player.exploration.facts;
    switch (feature.action) {
      case "hinge":
        return this.turnHinge(feature);
      case "letters":
        if (known.has("emberDoor") && known.has("orravethDoor")) {
          return this.speak(feature, "Both letters are accounted for. Take the cellar plan east to the Old Cellars.");
        }
        break;
      case "emberDoor":
      case "orravethDoor":
        if (!known.has("letters")) return this.speak(feature, "If you're looking for a delivery, ask Dena in the Post Court.");
        break;
      case "register":
        if (known.has("stamp") && known.has("receiver")) {
          this.recordFact(player, feature.action);
          return this.speak(feature, "That is the fourth road. Veyr took the counterseal into the proving chamber. I can hold the register open while you follow him.");
        }
        return this.speak(feature, feature.text);
      case "registerEnding":
        if (!this.cleared.has("proving_chamber")) return this.speak(feature, "Veyr's frame still holds the public hinge. Defeat him to release the override.");
        this.recordFact(player, "ending");
        return this.speak(feature, "Veyr's counterseal releases the public hinge. Mera records the crossing under Orraveth. The way home is open.");
    }
    if (feature.action) this.recordFact(player, feature.action);
    return this.speak(feature, feature.text);
  }

  recordFact(player, fact) {
    if (player.exploration.facts.has(fact)) return;
    player.exploration.facts.add(fact);
    this.world.markDirty(player);
    this.world.changed();
  }

  speak(feature, text) {
    return { ok: true, dialogue: { name: feature.name, text } };
  }

  cross(player, feature) {
    const gate = feature.gate;
    const known = player.exploration.facts;
    if (gate?.mail && gate.outward && (!known.has("emberDoor") || !known.has("orravethDoor"))) {
      return this.speak(feature, "Dena needs both Mill Stair letters delivered before you can use the cellar plan.");
    }
    if (gate?.evidence && gate.outward && !known.has("register")) {
      return this.speak(feature, "Bring Mera the fourth stamp from the Glass Aqueduct and Pela's account from Kilnward.");
    }
    if (gate?.shortcut && !gate.outward && !this.ladder) {
      return this.speak(feature, "The ladder is latched from the aqueduct side.");
    }
    if (gate?.clear && gate.outward && !this.cleared.has(gate.clear)) {
      return this.speak(feature, "The way is blocked. Clear the defenders before crossing.");
    }
    const to = feature.to;
    if (!to || !this.world.isFloor(to.x, to.y) || this.world.monsterAt(to.x, to.y)) {
      return this.speak(feature, "The landing is blocked.");
    }
    if (gate?.shortcut && !this.ladder) {
      this.ladder = true;
      this.saveWorld();
    }
    player.exploration.routes.add(feature.route);
    this.world.arrive(player, to.x, to.y, Date.now());
    return { ok: true, reason: "crossing" };
  }

  applyRoads() {
    const floor = this.areas.get("cellars").floor;
    for (const points of this.roads) for (const point of points) floor.delete(key(point));
    for (const point of this.roads[this.hinge]) floor.add(key(point));
  }

  turnHinge(feature) {
    const next = 1 - this.hinge;
    const closing = new Set([...this.roadKeys[this.hinge]].filter((tile) => !this.roadKeys[next].has(tile)));
    const world = this.world;
    if ([...world.players.values(), ...world.monsters.values()].some((actor) => closing.has(key(actor))) ||
        [...closing].some((tile) => world.items.has(tile))) {
      return this.speak(feature, "The hinge won't move while a hero, creature or item is on the moving road.");
    }
    this.hinge = next;
    this.applyRoads();
    this.saveWorld();
    world.changed();
    const market = this.hinge ? 18 : 8;
    const rescue = this.hinge ? 10 : 20;
    const message = `Market Stair: ${market} paces. Rescue Landing: ${rescue} paces. Together: 28.`;
    for (const player of world.players.values()) {
      if (this.areaAt(player.x, player.y)?.id === "cellars") world.notify(player, message, ROUTE_COLOR);
    }
    return this.speak(feature, message);
  }

  atlas(player) {
    const current = this.areaAt(player.x, player.y);
    const progress = player.exploration;
    const places = [...this.areas.values()]
      .filter((area) => area.id !== "proving_chamber" || progress.areas.has(area.id))
      .map((area) => ({
        id: area.id, name: area.name, label: area.label, description: area.description, safe: !!area.safe,
        visited: progress.areas.has(area.id),
        routes: !progress.areas.has(area.id) ? [] : [...this.features.values()]
          .filter((feature) => feature.kind === "route" && this.areaAt(feature.x, feature.y) === area)
          .filter((feature) => feature.route !== "proving-chamber" || progress.facts.has("register"))
          .map((feature) => ({
            name: feature.name, walked: progress.routes.has(feature.route),
          })),
      }));
    let lead = "Explore either route out of the Old Cellars.";
    if (!progress.facts.has("letters")) lead = "Talk to Postmaster Dena in Emberfall.";
    else if (!progress.facts.has("emberDoor") || !progress.facts.has("orravethDoor")) lead = "Deliver both Mill Stair letters in the west of Post Court.";
    else if (progress.facts.has("ending")) lead = "The crossing is registered. Return to Emberfall.";
    else if (progress.facts.has("register")) lead = "Enter the proving chamber from Long Ward.";
    else if (progress.facts.has("receiver") && progress.facts.has("stamp")) lead = "Show Mera in Long Ward what you found.";
    else if (progress.facts.has("stamp")) lead = "Follow the service roads to Pela in Kilnward.";
    return { current: current?.id ?? "", places, lead, completed: progress.facts.has("ending") };
  }

  describe(area, visible, player) {
    const fg = area.color;
    const bg = fg.map((value) => Math.round(value * 0.26));
    const feature = this.nearbyFeature(player);
    return {
      id: area.id, name: area.name, label: area.label, safe: !!area.safe,
      floor: { fg, bg }, corridor: { fg, bg }, wall: fg.map((value) => Math.round(value * 0.48)),
      terrain: area.terrain.filter(visible),
      prompt: feature ? feature.name : null,
    };
  }
}

module.exports = { Cities };
