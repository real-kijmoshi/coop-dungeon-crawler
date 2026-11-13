// Builds the ASCII map of a safe city from a block plan.
//
// A city is a grid of blocks separated by streets, with a ring road inside the
// outer wall. Each block is filled by a type (rows of houses, a hall with
// rooms, a plaza, a garden, a pool, a canal, ...). Markers (people, route
// gates, caches) are then placed in a named block, room or street edge. The
// layout is seeded by the city's name, so the same plan always gives the same
// map. Legend matches city-map.js: # wall, . floor, _ street, ' door, ~ water,
// = bridge, * lamp, , garden, : furnace.

function seeded(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Positions of the streets and blocks along one axis.
function axis(sizes, street) {
  const streets = [];
  const blocks = [];
  let pos = 1;
  for (const entry of sizes) {
    const size = typeof entry === "number" ? entry : entry.size;
    streets.push(pos);
    pos += street;
    blocks.push({ start: pos, size, canal: !!entry.canal });
    pos += size;
  }
  streets.push(pos);
  pos += street;
  return { streets, blocks, total: pos + 1 };
}

function buildCity(name, plan) {
  const random = seeded(name);
  const pick = (min, max) => min + Math.floor(random() * (max - min + 1));
  const street = plan.street ?? 3;
  const ground = plan.ground ?? "_";
  const cols = axis(plan.cols, street);
  const rows = axis(plan.rows, street);
  const width = cols.total;
  const height = rows.total;
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "#" : ground)));
  const at = (x, y) => grid[y]?.[x];
  const set = (x, y, ch) => {
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) grid[y][x] = ch;
  };
  const fill = (r, ch) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) set(x, y, ch);
  };
  const box = (r) => {
    for (let x = r.x; x < r.x + r.w; x++) { set(x, r.y, "#"); set(x, r.y + r.h - 1, "#"); }
    for (let y = r.y; y < r.y + r.h; y++) { set(r.x, y, "#"); set(r.x + r.w - 1, y, "#"); }
  };
  const inner = (r) => ({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 });

  // Split a building's interior into rooms side by side, joined by doors.
  function rooms(r, count) {
    box(r);
    const list = [];
    const room = inner(r);
    fill(room, ".");
    const span = room.w - (count - 1);
    let x = room.x;
    for (let i = 0; i < count; i++) {
      const w = i === count - 1 ? room.x + room.w - x : Math.floor(span / count);
      list.push({ x, y: room.y, w, h: room.h });
      x += w;
      if (i < count - 1) {
        for (let y = room.y; y < room.y + room.h; y++) set(x, y, "#");
        set(x, room.y + pick(0, room.h - 1), "'");
        x++;
      }
    }
    return list;
  }

  // A door in the top or bottom wall of a room, opening onto the street.
  function door(room, side) {
    const x = room.x + pick(Math.min(1, room.w - 1), Math.max(0, room.w - 2));
    set(x, side === "top" ? room.y - 1 : room.y + room.h, "'");
  }

  const types = {
    // Rows of narrow houses facing the streets above and below.
    houses(r) {
      box(r);
      const lots = [];
      const halves = r.h >= 9
        ? [{ y: r.y + 1, h: Math.floor((r.h - 3) / 2), side: "top" }]
        : [{ y: r.y + 1, h: r.h - 2, side: random() < 0.5 ? "top" : "bottom" }];
      if (r.h >= 9) {
        const split = halves[0].y + halves[0].h;
        for (let x = r.x; x < r.x + r.w; x++) set(x, split, "#");
        halves.push({ y: split + 1, h: r.y + r.h - 2 - split, side: "bottom" });
      }
      for (const half of halves) {
        let x = r.x + 1;
        const end = r.x + r.w - 1;
        while (x < end) {
          let w = pick(4, 8);
          if (end - (x + w + 1) < 4) w = end - x;
          const lot = { x, y: half.y, w, h: half.h };
          fill(lot, ".");
          door(lot, half.side);
          if (random() < 0.35) set(lot.x + (random() < 0.5 ? 0 : lot.w - 1), half.side === "top" ? lot.y + lot.h - 1 : lot.y, "*");
          if (random() < 0.25 && lot.w >= 5 && lot.h >= 3) {
            const yard = half.side === "top" ? lot.y + lot.h - 1 : lot.y;
            for (let gx = lot.x + 1; gx < lot.x + lot.w - 1; gx++) set(gx, yard, ",");
          }
          lots.push(lot);
          x += w;
          if (x < end) {
            for (let y = half.y; y < half.y + half.h; y++) set(x, y, "#");
            x++;
          }
        }
      }
      return lots;
    },
    // One large building divided into rooms, with doors on both streets.
    hall(r, opts) {
      const list = rooms(r, opts.rooms ?? 2);
      for (const room of list) {
        door(room, "top");
        door(room, "bottom");
        if (room.w >= 5) { set(room.x, room.y, "*"); set(room.x + room.w - 1, room.y + room.h - 1, "*"); }
      }
      return list;
    },
    // A hall whose rooms glow with furnace floors.
    furnace(r, opts) {
      const list = types.hall(r, opts);
      for (const room of list) {
        if (room.w < 6 || room.h < 5) continue;
        fill({ x: room.x + 2, y: room.y + 1, w: room.w - 4, h: room.h - 2 }, ":");
      }
      return list;
    },
    // Open paving with lamps, optional fountain and planters.
    plaza(r, opts) {
      for (const [x, y] of [[r.x + 1, r.y + 1], [r.x + r.w - 2, r.y + 1], [r.x + 1, r.y + r.h - 2], [r.x + r.w - 2, r.y + r.h - 2]]) set(x, y, "*");
      if (opts.fountain && r.w >= 9 && r.h >= 7) {
        const pool = { x: r.x + Math.floor(r.w / 2) - 2, y: r.y + Math.floor(r.h / 2) - 1, w: 4, h: 2 };
        fill({ x: pool.x - 1, y: pool.y - 1, w: pool.w + 2, h: pool.h + 2 }, ",");
        fill(pool, "~");
      }
      return [r];
    },
    // Planted beds crossed by paths.
    garden(r) {
      fill(inner(r), ",");
      const mx = r.x + Math.floor(r.w / 2);
      const my = r.y + Math.floor(r.h / 2);
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) set(x, my, ground);
      for (let y = r.y + 1; y < r.y + r.h - 1; y++) set(mx, y, ground);
      set(mx, my, "*");
      return [r];
    },
    // A walled pool with a walkway round it and a bridge across.
    pool(r) {
      fill(inner(r), "~");
      const my = r.y + Math.floor(r.h / 2);
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) set(x, my, "=");
      return [r];
    },
    canal(r) {
      fill(r, "~");
      return [r];
    },
    water(r) {
      fill(r, "~");
      return [r];
    },
    // A house on stilts in open water, reached by a boardwalk.
    stilts(r) {
      fill(r, "~");
      const house = { x: r.x + 2, y: r.y + 3, w: r.w - 4, h: r.h - 4 };
      const list = rooms(house, house.w >= 14 ? 2 : 1);
      for (const room of list) {
        const x = room.x + Math.floor(room.w / 2);
        set(x, house.y, "'");
        for (let y = r.y; y < house.y; y++) set(x, y, "=");
      }
      return list;
    },
    // Market stalls in rows, with lamps between them.
    market(r) {
      for (let y = r.y + 1; y < r.y + r.h - 1; y += 3) {
        for (let x = r.x + 1; x + 2 < r.x + r.w - 1; x += 5) {
          set(x, y, "#"); set(x + 1, y, "#"); set(x + 2, y, ",");
        }
      }
      set(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), "*");
      return [r];
    },
    // Counterweight pillars standing in open paving.
    pillars(r) {
      for (let y = r.y + 1; y + 1 < r.y + r.h - 1; y += 4) {
        for (let x = r.x + 1; x + 1 < r.x + r.w - 1; x += 5) fill({ x, y, w: 2, h: 2 }, "#");
      }
      return [r];
    },
  };

  // Street lamps at every crossing.
  for (const x of cols.streets) for (const y of rows.streets) set(x, y, "*");

  const blocks = new Map();
  rows.blocks.forEach((row, ry) => {
    cols.blocks.forEach((col, cx) => {
      const r = { x: col.start, y: row.start, w: col.size, h: row.size };
      let spec = plan.blocks?.[`${cx},${ry}`] ?? (row.canal ? "canal" : plan.fill ?? "houses");
      if (typeof spec === "string") spec = { type: spec };
      const list = types[spec.type](r, spec);
      blocks.set(`${cx},${ry}`, { rect: r, rooms: list });
    });
    // Bridges carry the streets over a canal row.
    if (row.canal) {
      for (const x of cols.streets) {
        for (let dx = 0; dx < street; dx++) for (let y = row.start; y < row.start + row.size; y++) set(x + dx, y, "=");
      }
      for (let x = 1; x < width - 1; x++) {
        if (at(x, row.start) === "=") continue;
        for (let y = row.start; y < row.start + row.size; y++) set(x, y, "~");
      }
    }
  });

  const open = (x, y) => at(x, y) && !"#~'".includes(at(x, y));
  const placed = [];
  const nearDoor = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) === "'");
  const crowded = (x, y) => placed.some((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1);

  for (const [ch, where] of plan.markers) {
    let spot = null;
    if (where.edge) {
      const k = where.street ?? 1;
      spot = {
        W: { x: 1, y: rows.streets[k] + 1 }, E: { x: width - 2, y: rows.streets[k] + 1 },
        N: { x: cols.streets[k] + 1, y: 1 }, S: { x: cols.streets[k] + 1, y: height - 2 },
      }[where.edge];
    } else {
      const block = blocks.get(where.block.join(","));
      if (!block) throw new Error(`${name}: no block ${where.block}`);
      if (where.dx !== undefined) {
        spot = { x: block.rect.x + where.dx, y: block.rect.y + where.dy };
      } else {
        const room = block.rooms[where.room ?? 0];
        if (!room) throw new Error(`${name}: block ${where.block} has no room ${where.room}`);
        const cx = room.x + Math.floor(room.w / 2);
        const cy = room.y + Math.floor(room.h / 2);
        const tiles = [];
        for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) tiles.push({ x, y });
        tiles.sort((a, b) => (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy)));
        const corner = where.corner;
        if (corner) tiles.reverse();
        spot = tiles.find(({ x, y }) => open(x, y) && at(x, y) !== "=" && !nearDoor(x, y) && !crowded(x, y));
      }
    }
    if (!spot || !open(spot.x, spot.y)) throw new Error(`${name}: cannot place ${ch}`);
    set(spot.x, spot.y, ch);
    placed.push(spot);
  }
  return grid.map((row) => row.join("")).join("\n");
}

module.exports = { buildCity };
