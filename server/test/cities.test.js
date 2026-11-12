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
