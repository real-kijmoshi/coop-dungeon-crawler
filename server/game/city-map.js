const { MONSTERS } = require("./data");
const { buildCity } = require("./city-builder");

const goblin = MONSTERS.find((monster) => monster.type === "goblin");
const guard = {
  type: "survey_guard", name: "Survey Guard", char: "g", color: [238, 130, 100],
  hp: 0.9, atk: 0.9, def: 1.1, xp: 1.1, speed: 3, aggro: 7, verb: "strikes",
  ability: "smash",
};

// Safe cities are laid out by city-builder.js from a block plan; the
// encounter areas below are drawn by hand.
// Map legend: # wall, . building floor, _ street, ' doorway, ~ water,
// = bridge, * lamp, , garden, : furnace. Letters and digits mark people,
// route gates and enemies. Emberfall's x is the Sinkhole Stair to the dungeon.
const areas = {
  emberfall: {
    name: "Emberfall", label: "Post Court", safe: true, level: 1, color: [140, 184, 179],
    description: "Rain runs down the sinkhole wall. Postmaster Dena works beside the lantern bridge.",
    map: buildCity("emberfall", {
      cols: [14, 12, 16, 12, 14], rows: [10, 10, { size: 4, canal: true }, 10],
      blocks: {
        "0,0": { type: "hall", rooms: 2 }, "2,0": { type: "hall", rooms: 3 }, "4,0": "garden",
        "2,1": "plaza", "3,1": { type: "hall", rooms: 2 },
        "1,3": { type: "hall", rooms: 2 }, "2,3": { type: "plaza", fountain: true }, "3,3": "pool", "4,3": { type: "hall", rooms: 1 },
      },
      markers: [
        ["s", { block: [2, 1], dx: 6, dy: 6 }], ["d", { block: [2, 1], dx: 8, dy: 4 }],
        ["e", { block: [0, 0], room: 0 }], ["b", { block: [0, 0], room: 1 }],
        ["m", { block: [2, 0], room: 1 }], ["r", { edge: "N", street: 4 }],
        ["i", { block: [3, 1], room: 0 }], ["c", { block: [1, 3], room: 0 }], ["k", { block: [1, 3], room: 1, corner: true }],
        ["x", { block: [2, 3], dx: 3, dy: 2 }], ["l", { block: [4, 3], room: 0 }], ["a", { edge: "E", street: 1 }],
      ],
    }),
    npcs: {
      d: { name: "Postmaster Dena", char: "D", action: "letters",
        text: "Two letters. Both say 8 Mill Stair. One says Emberfall and one says Orraveth. The woman at the west door can show you where the other goes." },
      e: { name: "Emberfall Door", char: "e", action: "emberDoor",
        text: "The woman signs for the Emberfall letter with a pen tied to a red cord. It runs into the wall." },
      b: { name: "Orraveth Grille", char: "o", action: "orravethDoor",
        text: "A woman takes the letter through the grille. 'My sister gets the morning post. I get the road they charge for it.' She slips you a cellar plan." },
      m: { name: "Merchant", char: "M", kind: "merchant" },
      c: { name: "Cistern Keeper", char: "C", text: "Up top, rain runs straight through the stone. This cistern keeps the whole court supplied through a dry season." },
      r: { name: "Rim Stair", char: "^", thing: true, text: "From the landing you can see the rim farms. The growers carry their baskets down to the city every evening." },
      i: { name: "The Lantern Bridge Inn", kind: "inn", text: "Old Hobb pours you something hot and points at a bunk under the eaves." },
      k: { name: "Loose Cistern Stone", kind: "cache", text: "A stone by the cistern wall rocks under your boot. Someone kept their savings behind it." },
    },
  },
  cellars: {
    name: "Old Cellars", label: "Survey Hinge", level: 1, color: [182, 158, 114],
    description: "One hinge moves paces between Market Stair and Rescue Landing. Watch both roads change.",
    // The two measured approaches sit apart from the fixed corridor on the left.
    map: [
      "   a  ",
      " #...#",
      " #...#",
      " #.*.#",
      " ..s       u..m",
      " .",
      " .",
      " .",
      " .",
      " .",
      " .",
      " ..h",
      " .",
      " .",
      " .",
      " .",
      " .",
      " .",
      " ..t         vb",
      " #..",
      " #..",
      " #p.",
    ].join("\n"),
    npcs: { h: { name: "Survey Hinge", char: "H", thing: true, action: "hinge" } },
  },
  tollworks: {
    name: "Tollworks", label: "Goblin-held road", level: 2, color: [151, 173, 108],
    description: "A striped gate marks the salvage gang's claim. The high service path overlooks the road.",
    map: `
#######################
#...*....k#.......*...#
#a........#......3...b#
#....1....#...........#
#.........#..*........#
#.........#...........#
#....####.#..#........#
#..*.........#...2....#
#............#........#
#######################`,
    npcs: {
      k: { name: "Gang Stash", kind: "cache", text: "The salvage gang hid their take under a loose board on the service path." },
    },
    enemies: {
      1: { ...goblin, name: "Tollworks Scout", hp: 0.75, atk: 0.75 },
      2: { ...goblin, name: "Tern, Tollworks Captain", hp: 1.2, atk: 0.85 },
      3: { ...goblin, name: "Tollworks Sentry", hp: 0.75, atk: 0.75 },
    },
  },
  rootmarket: {
    name: "Rootmarket", label: "Growing terraces", safe: true, level: 2, color: [158, 180, 108],
    description: "Straw wagons rattle past the mushroom stalls toward the sunlit terraces.",
    map: buildCity("rootmarket", {
      cols: [12, 14, 12, 14, 12], rows: [9, 10, 9],
      blocks: {
        "0,0": "garden", "1,0": { type: "hall", rooms: 2 }, "2,0": "garden", "4,0": "garden",
        "1,1": "garden", "2,1": "market", "3,1": "garden",
        "0,2": "garden", "2,2": "garden", "4,2": "garden",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "E", street: 1 }], ["c", { edge: "S", street: 3 }],
        ["q", { block: [1, 0], room: 0 }], ["s", { block: [1, 1] }], ["m", { block: [2, 1] }],
        ["k", { block: [1, 2], room: 2, corner: true }],
      ],
    }),
    npcs: {
      q: { name: "Scale Keeper", char: "q", text: "One sack, two prices. The lease makes this gate cheaper for wagons. Ask a grower at Sporehold what it costs on foot." },
      s: { name: "Straw Grower", char: "s", text: "Grain grows above. Down here I trade its straw for mushrooms. Every cart has to come through one of these ramps." },
      m: { name: "Root Trader", char: "M", kind: "merchant" },
      k: { name: "Mushroom Crate", kind: "cache", text: "Under a crate of dried caps, someone forgot a pouch." },
    },
  },
  sporehold: {
    name: "Sporehold", label: "Root bridges", safe: true, level: 3, color: [168, 155, 106],
    description: "The clinic lamp hangs above a wet stair. Rope bridges join the homes along the roots.",
    map: buildCity("sporehold", {
      cols: [14, 12, 14, 12], rows: [10, { size: 4, canal: true }, 10, { size: 4, canal: true }, 9],
      blocks: {
        "0,0": { type: "hall", rooms: 2 }, "2,0": "garden",
        "1,2": "pool", "2,2": { type: "hall", rooms: 3 },
        "0,4": "garden", "3,4": "garden",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "S", street: 3 }],
        ["q", { block: [0, 0], room: 0 }], ["c", { block: [2, 2], room: 1 }], ["k", { block: [3, 2], room: 1, corner: true }],
      ],
    }),
    npcs: {
      q: { name: "Clinic Worker", char: "q", text: "The freight board says the clinic is close. Come across the bridge and count the paces yourself." },
      c: { name: "Apothecary", char: "+", text: "The fixed stair goes to Cinderkeep. Tell the shift workers you came down from the clinic." },
      k: { name: "Root Hollow", kind: "cache", text: "A hollow in the root wall holds a wrapped bundle and a note: 'For whoever needs it more.'" },
    },
  },
  bellhaven: {
    name: "Bellhaven", label: "Rescue quay", safe: true, level: 2, color: [118, 180, 207],
    description: "A ferry cage hangs over the water. Brass marks show where the old floods reached.",
    map: buildCity("bellhaven", {
      cols: [14, 12, 14, 12, 14], rows: [10, { size: 6, canal: true }, 10, 9],
      blocks: {
        "0,0": { type: "hall", rooms: 2 }, "2,0": "pool", "4,0": { type: "hall", rooms: 2 },
        "1,2": { type: "plaza", fountain: true }, "2,2": { type: "hall", rooms: 2 },
        "1,3": "garden", "3,3": "pool",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "E", street: 3 }], ["l", { edge: "S", street: 2 }],
        ["d", { block: [0, 0], room: 0 }], ["k", { block: [4, 0], room: 1, corner: true }], ["c", { block: [2, 2], room: 0 }],
      ],
    }),
    npcs: {
      d: { name: "Iven, Dispatcher", char: "I", text: "Two bells for one rescue. Ours starts at dispatch. Siltwatch starts theirs at the house that raised it." },
      c: { name: "Ferry Keeper", char: "f", text: "The cage takes you over the deep channel. Walk down to Siltwatch for the small boats." },
      k: { name: "Flood Marker", kind: "cache", text: "Behind the brass flood marker is a dry niche. Someone sealed coins in wax there." },
    },
  },
  siltwatch: {
    name: "Siltwatch", label: "Boardwalks", safe: true, level: 3, color: [101, 190, 179],
    description: "Boat hooks hang over the doors. Nemi tests her pier with the handle of a hammer.",
    map: buildCity("siltwatch", {
      cols: [14, 14, 14, 14], rows: [11, 11, 10], ground: "=", fill: "water",
      blocks: {
        "0,0": "stilts", "2,0": "stilts", "3,0": "plaza", "1,1": "stilts", "3,1": "stilts", "0,2": "stilts", "2,2": "stilts",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "E", street: 2 }],
        ["n", { block: [0, 0], room: 0 }], ["q", { block: [1, 1], room: 0 }], ["k", { block: [0, 2], room: 0, corner: true }],
      ],
    }),
    npcs: {
      n: { name: "Nemi, Boatwright", char: "N", text: "That hollow board tells me where the water got to. Follow the far pier and you can reach the aqueduct without the freight road." },
      q: { name: "Rescue Pilot", char: "q", text: "We put our first notch on the tag at the house itself. Iven can compare it with the one in his booth." },
      k: { name: "Sunken Strongbox", kind: "cache", text: "A strongbox is tied under the boardwalk on a fraying rope. You haul it up." },
    },
  },
  aqueduct: {
    name: "Glass Aqueduct", label: "Winch crossing", level: 3, color: [125, 190, 213],
    description: "Three public pipes cross the chamber. A fourth stamp hides behind the winch.",
    map: `
#########################
#a....*...#....d........#
#.........#......*.....c#
#..*......#.............#
#...========....1.......#
#...~~~~~~=.............#
#.........#........2....#
#b....*..k#.......l.....#
#########################`,
    npcs: {
      d: { name: "Fourth Stamp", char: "4", thing: true, action: "stamp",
        text: "The survey drawing lists three roads. This inspection plate carries a fourth stamp, marked with the old Orraveth address." },
      k: { name: "Pipe Inspection Hatch", kind: "cache", text: "The hatch sticks, then gives. An inspector's emergency kit is still inside." },
    },
    enemies: {
      1: { ...guard, name: "Winch Lookout", ranged: 4, ability: null, verb: "shoots at" },
      2: { ...guard, name: "Winch Crew Guard" },
    },
  },
  foundry_gate: {
    name: "Foundry Gate", label: "Armed closure", level: 4, color: [210, 129, 90],
    description: "The posted order bars the foundry. A freight gallery runs along the guards' shield line.",
    map: `
#######################
#a......w....*........#
#..######...######....#
#..#k.............#...#
#..#...1..........#...#
#..#........2.....#...#
#..#...*..........#...#
#..........3......*..b#
#######################`,
    npcs: {
      w: { name: "Shift Worker", char: "w", text: "They searched every tool cart this morning. The gallery runs round their shield line. The fitters are waiting on the other side." },
      k: { name: "Confiscated Tool Cart", kind: "cache", text: "The guards never got round to emptying this cart. Its owner won't miss what's at the bottom." },
    },
    enemies: {
      1: guard, 2: guard,
      3: { ...guard, name: "Gallery Crossbowman", ranged: 4, ability: null, verb: "shoots at" },
    },
  },
  cinderkeep: {
    name: "Cinderkeep", label: "Casting floor", safe: true, level: 4, color: [208, 149, 108],
    description: "Furnaces breathe through tall draft shafts. The fitters are examining an older mould.",
    map: buildCity("cinderkeep", {
      cols: [14, 16, 14, 16], rows: [10, 10, 10],
      blocks: {
        "1,0": { type: "furnace", rooms: 2 }, "2,0": { type: "furnace", rooms: 1 }, "3,0": { type: "hall", rooms: 2 },
        "0,1": "plaza", "2,1": { type: "furnace", rooms: 2 },
        "0,2": { type: "furnace", rooms: 2 }, "2,2": "plaza",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "E", street: 2 }],
        ["s", { block: [1, 0], room: 0 }], ["f", { block: [2, 0], room: 0 }], ["m", { block: [3, 0], room: 1 }],
        ["k", { block: [0, 2], room: 0, corner: true }],
      ],
    }),
    npcs: {
      s: { name: "Sera Dain", char: "S", text: "Veyr signed a drawing with three sockets. I filed a fourth into his replacement so it would work. The mould is by the furnace." },
      f: { name: "Old Casting Mould", char: "4", thing: true, action: "mould",
        text: "Four sockets. The small one has the same stamp as the old road at the aqueduct. Follow the workers' lift to Kilnward." },
      m: { name: "Foundry Quartermaster", char: "M", kind: "merchant" },
      k: { name: "Cooling Slag Pile", kind: "cache", text: "Under the cooled slag is a fitter's lost pay packet, still sealed." },
    },
  },
  kilnward: {
    name: "Kilnward", label: "Counterweight fields", safe: true, level: 5, color: [151, 175, 161],
    description: "Shift bells travel down the handrails between the counterweights.",
    map: buildCity("kilnward", {
      cols: [15, 15, 15, 15], rows: [9, 9, 9], fill: "pillars",
      blocks: {
        "0,0": "houses", "2,0": { type: "hall", rooms: 3 }, "3,0": "houses", "1,1": "plaza", "3,1": "houses",
        "0,2": "houses", "1,2": "houses", "2,2": { type: "hall", rooms: 3 },
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["c", { edge: "S", street: 1 }], ["d", { edge: "E", street: 2 }],
        ["p", { block: [1, 1] }], ["k", { block: [0, 2], room: 0, corner: true }],
      ],
    }),
    npcs: {
      p: { name: "Pela, Apprentice", char: "P", action: "receiver",
        text: "Watch the last receiver. Each time the city shortens a public road, this branch takes the missing paces. It still leads to the Long Ward." },
      k: { name: "Counterweight Gap", kind: "cache", text: "Between two counterweights, out of reach of the bells, someone wedged a bundle." },
    },
  },
  long_ward: {
    name: "Long Ward", label: "Orraveth's old street", safe: true, level: 6, color: [168, 152, 192],
    description: "Two sets of house numbers face an approach that takes days to walk.",
    map: buildCity("long_ward", {
      cols: [10, 10, 10, 10, 10, 10], rows: [8, 8, 8],
      blocks: {
        "4,0": { type: "hall", rooms: 2 }, "1,1": "market", "2,1": "pool", "3,1": { type: "hall", rooms: 2 }, "0,2": "plaza",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["b", { edge: "E", street: 2 }],
        ["m", { block: [4, 0], room: 0 }], ["n", { block: [1, 1] }], ["i", { block: [3, 1], room: 0 }],
        ["k", { block: [5, 2], room: 0, corner: true }],
      ],
    }),
    npcs: {
      m: { name: "Mera, Tollkeeper", char: "M", action: "register",
        text: "I still count the crossings. Walk both ends of the old approach and bring me the fourth stamp. Then we can challenge Veyr's override." },
      n: { name: "Ward Trader", char: "M", kind: "merchant" },
      i: { name: "The Two Numbers Inn", kind: "inn", text: "The landlady asks which house number you'd like on your door. Both rooms are the same bed." },
      k: { name: "Doubled Doorstep", kind: "cache", text: "One of the doubled doorsteps is hollow. Inside: a forgotten rent payment." },
    },
  },
  proving_chamber: {
    name: "Proving Chamber", label: "Veyr's last road", level: 6, color: [219, 125, 102],
    description: "Veyr has locked the public hinge. The only way to recover the counterseal is through him.",
    map: `
#########################
#a.....*...........*...k#
#.......................#
#....##..........##.....#
#....##.....1....##.....#
#.......................#
#....##..........##.....#
#....##..........##..r..#
#......*...........*....#
#########################`,
    npcs: {
      r: { name: "Public Register", char: "R", thing: true, action: "registerEnding" },
      k: { name: "Veyr's Field Case", kind: "cache", text: "Veyr's field case holds his survey fee, paid in advance and never earned." },
    },
    enemies: {
      1: { ...guard, type: "veyr", name: "Chief Surveyor Veyr", char: "V", boss: true,
        hp: 0.23, atk: 0.68, def: 0.9, aggro: 10 },
    },
  },
  lantern_row: {
    name: "Lantern Row", label: "Night market", safe: true, level: 3, color: [226, 182, 118],
    description: "Lamplit stalls climb the old flood steps. Travellers from every district trade stories here.",
    map: buildCity("lantern_row", {
      cols: [12, 16, 12, 16], rows: [9, 10, 9],
      blocks: {
        "0,0": "plaza", "2,0": { type: "hall", rooms: 2 }, "1,1": "market", "3,1": { type: "hall", rooms: 2 },
        "0,2": "pool", "2,2": "garden",
      },
      markers: [
        ["a", { edge: "W", street: 1 }], ["n", { block: [0, 0] }], ["c", { block: [2, 0], room: 1 }],
        ["m", { block: [1, 1] }], ["i", { block: [3, 1], room: 0 }], ["l", { block: [0, 2], corner: true }],
        ["k", { block: [3, 2], room: 1, corner: true }],
      ],
    }),
    npcs: {
      n: { name: "Ysolde, Lamplighter", char: "Y", text: "Every lamp on this row was lit by someone who came back from below. Light one when you return from somewhere nobody's mapped." },
      l: { name: "Old Fisher", char: "f", text: "The dungeon under Emberfall shifts its chambers. Some have names older than the city. Find one and the earth gives up what it hid." },
      c: { name: "Corin, Cartographer", char: "C", action: "cartographer" },
      i: { name: "The Last Lamp Inn", kind: "inn", text: "Lanterns sway over the beds. The innkeeper says the light keeps the bad dreams below the waterline." },
      m: { name: "Night Market Trader", char: "M", kind: "merchant" },
      k: { name: "Lamp Oil Barrel", kind: "cache", text: "The barrel is half empty, and the bottom half is mostly coins." },
    },
  },
};

// Each endpoint names a fixed map marker. Requirements apply in both directions
// unless a route is only guarded on its outward approach.
const routes = [
  { id: "court-cellars", a: ["emberfall", "a"], b: ["cellars", "a"], mail: true },
  { id: "market-stair", a: ["cellars", "m"], b: ["tollworks", "a"], label: "Market Stair" },
  { id: "toll-road", a: ["tollworks", "b"], b: ["rootmarket", "a"], clear: "tollworks" },
  { id: "rescue-landing", a: ["cellars", "b"], b: ["bellhaven", "a"], label: "Rescue Landing" },
  { id: "root-bridges", a: ["rootmarket", "b"], b: ["sporehold", "a"] },
  { id: "freight-road", a: ["rootmarket", "c"], b: ["aqueduct", "a"] },
  { id: "lantern-steps", a: ["bellhaven", "l"], b: ["lantern_row", "a"], label: "Lantern Steps" },
  { id: "ferry-walk", a: ["bellhaven", "b"], b: ["siltwatch", "a"] },
  { id: "marsh-pier", a: ["siltwatch", "b"], b: ["aqueduct", "b"] },
  { id: "post-court-ladder", a: ["aqueduct", "l"], b: ["emberfall", "l"], shortcut: true, clear: "aqueduct" },
  { id: "clinic-stair", a: ["sporehold", "b"], b: ["foundry_gate", "a"] },
  { id: "casting-yard", a: ["foundry_gate", "b"], b: ["cinderkeep", "a"], clear: "foundry_gate" },
  { id: "workers-lift", a: ["cinderkeep", "b"], b: ["kilnward", "a"] },
  { id: "field-stair", a: ["aqueduct", "c"], b: ["kilnward", "c"], clear: "aqueduct" },
  { id: "ward-approach", a: ["kilnward", "d"], b: ["long_ward", "a"] },
  { id: "proving-chamber", a: ["long_ward", "b"], b: ["proving_chamber", "a"], evidence: true },
];

module.exports = { areas, routes };
