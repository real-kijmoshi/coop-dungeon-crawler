const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Grid } = require("../utils/map");
const { World } = require("../game/World");

const key = (p) => `${p.x},${p.y}`;
const steps = [
  ["north", 0, -1], ["south", 0, 1], ["west", -1, 0], ["east", 1, 0],
];

function setup(t, map = new Grid(20, 20, 80, 777)) {
  if (!map.rooms.length) map.generateInitialRoom();
  const world = new World(map, { cities: true });
  t.after(() => world.stop());
  world.stop();
  return world;
}

function hero(world, id, position = { x: -1, y: -1 }, data) {
  return world.addPlayer({
    id, username: `hero${id}`, cls: "warrior", level: 1,
    position_x: position.x, position_y: position.y,
  }, data);
}

function point(world, area, marker) {
  return world.cities.areas.get(area).points.get(marker);
}

function shortest(world, from, to) {
  const goal = key(to);
  const queue = [{ x: from.x, y: from.y, directions: [] }];
  const seen = new Set([key(from)]);
  for (const current of queue) {
    if (key(current) === goal) return current.directions;
    for (const [direction, dx, dy] of steps) {
      const next = { x: current.x + dx, y: current.y + dy };
      const id = key(next);
      if (seen.has(id) || !world.isFloor(next.x, next.y)) continue;
      if (world.monsterAt(next.x, next.y) || (id !== goal && world.cities.featureAt(next.x, next.y))) continue;
      seen.add(id);
      queue.push({ ...next, directions: [...current.directions, direction] });
    }
  }
  assert.fail(`No path from ${key(from)} to ${goal}`);
}

function walk(world, p, area, marker) {
  const to = point(world, area, marker);
  if (key(p) === key(to) && world.cities.featureAt(to.x, to.y)) {
    assert.equal(world.interactCity(p).ok, true);
    return;
  }
  for (const direction of shortest(world, p, to)) {
    p.lastMove = 0;
    const result = world.movePlayer(p, direction);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
}

function finishMail(world, p) {
  walk(world, p, "emberfall", "d");
  walk(world, p, "emberfall", "e");
  walk(world, p, "emberfall", "b");
  walk(world, p, "emberfall", "a");
  assert.equal(world.cities.areaAt(p.x, p.y).id, "cellars");
}

function clearEncounter(world, p, area) {
  for (const id of world.cities.areas.get(area).enemyIds) {
    world.killMonster(world.monsters.get(id), p);
  }
  assert.ok(world.cities.cleared.has(area));
}

test("heroes spawn in a safe city, deliver letters, and cannot move the hinge under an ally", (t) => {
  const world = setup(t);
  const a = hero(world, 1);
  const b = hero(world, 2);
  assert.equal(key(a), key(b));
  const startingState = world.stateFor(a);
  assert.equal(startingState.district.id, "emberfall");
  assert.equal(startingState.player.safe, true);
  assert.ok(startingState.npcs.some((npc) => npc.name === "Postmaster Dena"));
  assert.equal(startingState.monsters.length, 0);

  const denial = [];
  world.on("dialogue", (_, dialogue) => denial.push(dialogue.text));
  walk(world, a, "emberfall", "a");
  assert.match(denial.at(-1), /both Mill Stair letters/);
  assert.equal(world.cities.areaAt(a.x, a.y).id, "emberfall");

  finishMail(world, a);
  finishMail(world, b);
  const market = [point(world, "cellars", "s"), point(world, "cellars", "u")];
  const rescue = [point(world, "cellars", "t"), point(world, "cellars", "v")];
  const lengths = () => [shortest(world, ...market).length, shortest(world, ...rescue).length];
  assert.deepEqual(lengths(), [8, 20]);
  walk(world, b, "cellars", "s");
  b.lastMove = 0;
  assert.ok(world.movePlayer(b, "east").ok);
  walk(world, a, "cellars", "h");
  assert.equal(world.cities.hinge, 0);
  assert.match(denial.at(-1), /on the moving road/);
  b.lastMove = 0;
  assert.ok(world.movePlayer(b, "west").ok);
  walk(world, a, "cellars", "h");
  assert.deepEqual(lengths(), [18, 10]);
  walk(world, a, "cellars", "b");
  assert.equal(world.cities.areaAt(a.x, a.y).id, "bellhaven");
  const city = world.cities.atlas(a).places.find((place) => place.id === "bellhaven");
  assert.ok(city.visited && city.routes.some((route) => route.name === "Old Cellars" && route.walked));
  assert.equal(world.stateFor(a).player.safe, true);
});

test("guarded routes, Veyr's register, and authored progress survive a restart", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdc-cities-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, "map.json");
  const world = setup(t);
  const p = hero(world, 1);
  finishMail(world, p);
  walk(world, p, "cellars", "m");
  assert.equal(world.cities.areaAt(p.x, p.y).id, "tollworks");
  const tollGate = point(world, "tollworks", "b");
  const blocked = world.cities.cross(p, world.cities.featureAt(tollGate.x, tollGate.y));
  assert.match(blocked.dialogue.text, /defenders/);
  clearEncounter(world, p, "tollworks");
  walk(world, p, "tollworks", "b");
  walk(world, p, "rootmarket", "c");
  clearEncounter(world, p, "aqueduct");
  walk(world, p, "aqueduct", "d");
  walk(world, p, "aqueduct", "l");
  assert.ok(world.cities.ladder);
  walk(world, p, "emberfall", "l");
  walk(world, p, "aqueduct", "c");
  walk(world, p, "kilnward", "p");
  walk(world, p, "kilnward", "d");
  walk(world, p, "long_ward", "m");
  walk(world, p, "long_ward", "b");
  const chamber = world.cities.areas.get("proving_chamber");
  assert.equal(world.cities.areaAt(p.x, p.y), chamber);
  const veyr = world.monsters.get([...chamber.enemyIds][0]);
  assert.equal(veyr.name, "Chief Surveyor Veyr");
  assert.equal(veyr.boss, true);
  walk(world, p, "proving_chamber", "r");
  assert.equal(world.cities.atlas(p).completed, false);
  clearEncounter(world, p, "proving_chamber");
  walk(world, p, "proving_chamber", "r");
  assert.equal(world.cities.atlas(p).completed, true);
  assert.equal(world.map.saveToFile(filename), true);

  const restoredMap = new Grid(20, 20, 80);
  assert.equal(restoredMap.loadFromFile(filename), true);
  const restored = setup(t, restoredMap);
  const rejoined = hero(restored, 1, p, JSON.parse(JSON.stringify(world.saveData(p))));
  assert.equal(key(rejoined), key(p));
  assert.ok(restored.cities.ladder && restored.cities.atlas(rejoined).completed);
  assert.ok(restored.cities.cleared.has("proving_chamber"));
  assert.equal(restored.cities.areas.get("proving_chamber").enemyIds.size, 0);

  const old = hero(restored, 2, restored.spawn);
  assert.equal(key(old), key(restored.spawn));
  assert.equal(restored.stateFor(old).district, undefined);
  assert.ok(restored.travelOptions(old).destinations.some((destination) => destination.id === "home"));
});

test("Lantern Row, inns, hidden caches, residents and city merchants", (t) => {
  const world = setup(t);
  const p = hero(world, 1);
  const dialogue = [];
  world.on("dialogue", (_, d) => dialogue.push(d));
  const cities = world.cities;
  assert.ok(cities.residents.size >= 15 && cities.caches.size >= 12);

  // Meeting a resident counts once and is remembered.
  walk(world, p, "emberfall", "d");
  assert.ok(p.exploration.met.has("emberfall:d"));
  const met = p.exploration.met.size;
  walk(world, p, "emberfall", "d");
  assert.equal(p.exploration.met.size, met);

  // A hidden cache pays once per hero.
  const gold = p.stats.gold;
  walk(world, p, "emberfall", "k");
  assert.ok(p.stats.gold > gold);
  const after = p.stats.gold;
  walk(world, p, "emberfall", "k");
  assert.equal(p.stats.gold, after);
  assert.match(dialogue.at(-1).text, /already searched/);
  assert.ok(world.stateFor(p).npcs.some((npc) => npc.name === "Loose Cistern Stone" && npc.color[0] < 150), "searched caches fade");

  // The inn heals and leaves the hero Well Rested.
  p.stats.hp = 1;
  walk(world, p, "emberfall", "i");
  assert.equal(p.stats.hp, p.stats.maxHp);
  assert.ok(world.hasBuff(p, "rested"));

  // Lantern Row hangs off Bellhaven, with a merchant and a cartographer.
  finishMail(world, p);
  walk(world, p, "cellars", "b");
  walk(world, p, "bellhaven", "l");
  assert.equal(cities.areaAt(p.x, p.y).id, "lantern_row");
  assert.equal(world.stateFor(p).player.safe, true);
  walk(world, p, "lantern_row", "c");
  assert.match(dialogue.at(-1).text, /hidden cache|district|resident/);
  const stall = point(world, "lantern_row", "m");
  p.x = stall.x - 1;
  p.y = stall.y;
  assert.ok(world.nearMerchant(p), "any city stall trades");

  const atlas = cities.atlas(p);
  assert.equal(atlas.cachesFound, 1);
  assert.equal(atlas.caches, cities.caches.size);
  const row = atlas.places.find((place) => place.id === "lantern_row");
  assert.ok(row.visited && row.caches === 1 && row.people >= 2);

  // Residents and caches survive a save.
  const saved = JSON.parse(JSON.stringify(world.saveData(p)));
  const again = setup(t);
  const back = hero(again, 2, undefined, saved);
  assert.ok(back.exploration.met.has("emberfall:d"));
  assert.ok(back.exploration.caches.has("emberfall:k"));
});

test("Emberfall has an open stair to the dungeon, and city streets are paved corridors", (t) => {
  const world = setup(t);
  const p = hero(world, 1);
  const home = { x: p.x, y: p.y };
  assert.equal(world.cell(p.x, p.y), -1, "the Post Court spawn is on a street");
  const area = world.cities.areas.get("emberfall");
  assert.ok(area.street.size > 0 && area.floor.size > area.street.size, "streets and building floors both exist");

  // No letters needed: walking into the Sinkhole Stair drops the hero into the dungeon.
  walk(world, p, "emberfall", "x");
  assert.equal(world.cities.areaAt(p.x, p.y), null);
  assert.ok(world.inDungeonBounds(p.x, p.y));
  assert.ok(p.exploration.routes.has("sinkhole"));

  // A stair beside the dungeon safe room climbs back up.
  const back = world.cities.featureAt(p.x, p.y);
  assert.equal(back?.name, "Sinkhole Stair to Emberfall");
  assert.equal(world.interactCity(p).ok, true);
  assert.deepEqual({ x: p.x, y: p.y }, home);
});

test("every safe city is a large district whose streets and rooms all connect", (t) => {
  const world = setup(t);
  for (const area of world.cities.areas.values()) {
    if (!area.safe) continue;
    const tiles = [...area.floor].map((id) => id.split(",").map(Number));
    const xs = tiles.map(([x]) => x);
    const ys = tiles.map(([, y]) => y);
    assert.ok(Math.max(...xs) - Math.min(...xs) >= 60, `${area.id} is wide`);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 35, `${area.id} is tall`);
    assert.ok(area.floor.size - area.street.size > 400, `${area.id} has buildings to walk into`);
    const start = tiles[0];
    const seen = new Set([start.join()]);
    const queue = [start];
    for (const [x, y] of queue) {
      for (const [, dx, dy] of steps) {
        const id = `${x + dx},${y + dy}`;
        if (!seen.has(id) && area.floor.has(id)) { seen.add(id); queue.push([x + dx, y + dy]); }
      }
    }
    assert.equal(seen.size, area.floor.size, `${area.id} has no sealed-off floor`);
  }
});
