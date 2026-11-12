const { MONSTERS } = require("./data");

const goblin = MONSTERS.find((monster) => monster.type === "goblin");
const guard = {
  type: "survey_guard", name: "Survey Guard", char: "g", color: [238, 130, 100],
  hp: 0.9, atk: 0.9, def: 1.1, xp: 1.1, speed: 3, aggro: 7, verb: "strikes",
  ability: "smash",
};

const areas = {
  emberfall: {
    name: "Emberfall", label: "Post Court", safe: true, level: 1, color: [140, 184, 179],
    description: "Rain runs down the sinkhole wall. Postmaster Dena works beside the lantern bridge.",
    map: `
     ###################
     #..d......m......r#
######....*......,.....#
#e....s........,,,,....#
#....#....#####........#
#....#~~~~~#..#........#
#....=======..*.......a#
#....#~~~~~#...........#
#..b.#~~~~~#..c....l...#
########################`,
    npcs: {
      d: { name: "Postmaster Dena", char: "D", action: "letters",
        text: "Two letters. Both say 8 Mill Stair. One says Emberfall and one says Orraveth. The woman at the west door can show you where the other goes." },
      e: { name: "Emberfall Door", char: "e", action: "emberDoor",
        text: "The woman signs for the Emberfall letter with a pen tied to a red cord. It runs into the wall." },
      b: { name: "Orraveth Grille", char: "o", action: "orravethDoor",
        text: "A woman takes the letter through the grille. 'My sister gets the morning post. I get the road they charge for it.' She slips you a cellar plan." },
      m: { name: "Merchant", char: "M", kind: "merchant" },
      c: { name: "Cistern Keeper", char: "C", text: "Up top, rain runs straight through the stone. This cistern keeps the whole court supplied through a dry season." },
      r: { name: "Rim Stair", char: "^", text: "From the landing you can see the rim farms. The growers carry their baskets down to the city every evening." },
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
    npcs: { h: { name: "Survey Hinge", char: "H", action: "hinge" } },
  },
  tollworks: {
    name: "Tollworks", label: "Goblin-held road", level: 2, color: [151, 173, 108],
    description: "A striped gate marks the salvage gang's claim. The high service path overlooks the road.",
    map: `
#######################
#...*.....#.......*...#
#a........#......3...b#
#....1....#...........#
#.........#..*........#
#.........#...........#
#....####.#..#........#
#..*.........#...2....#
#............#........#
#######################`,
    enemies: {
      1: { ...goblin, name: "Tollworks Scout", hp: 0.75, atk: 0.75 },
      2: { ...goblin, name: "Tern, Tollworks Captain", hp: 1.2, atk: 0.85 },
      3: { ...goblin, name: "Tollworks Sentry", hp: 0.75, atk: 0.75 },
    },
  },
  rootmarket: {
    name: "Rootmarket", label: "Growing terraces", safe: true, level: 2, color: [158, 180, 108],
    description: "Straw wagons rattle past the mushroom stalls toward the sunlit terraces.",
    map: `
#######################
#a....,,,,..#......b..#
#..*..,,,,..#..,,,,...#
#...........#..,,,,...#
#..q.......===........#
#..,,,,.....#....*....#
#..,,,,.....#.........#
#..........s#........c#
#######################`,
    npcs: {
      q: { name: "Scale Keeper", char: "q", text: "One sack, two prices. The lease makes this gate cheaper for wagons. Ask a grower at Sporehold what it costs on foot." },
      s: { name: "Straw Grower", char: "s", text: "Grain grows above. Down here I trade its straw for mushrooms. Every cart has to come through one of these ramps." },
    },
  },
  sporehold: {
    name: "Sporehold", label: "Root bridges", safe: true, level: 3, color: [168, 155, 106],
    description: "The clinic lamp hangs above a wet stair. Rope bridges join the homes along the roots.",
    map: `
#############     #######
#a.....q..*##     #..c..#
#....,,,....#     #.....#
#...........=======..*..#
#...*.......#     #.....#
#.........###     ###.###
####.################.###
   #......*...........b.#
   ######################`,
    npcs: {
      q: { name: "Clinic Worker", char: "q", text: "The freight board says the clinic is close. Come across the bridge and count the paces yourself." },
      c: { name: "Apothecary", char: "+", text: "The fixed stair goes to Cinderkeep. Tell the shift workers you came down from the clinic." },
    },
  },
  bellhaven: {
    name: "Bellhaven", label: "Rescue quay", safe: true, level: 2, color: [118, 180, 207],
    description: "A ferry cage hangs over the water. Brass marks show where the old floods reached.",
    map: `
#########################
#a......*#~~~~~#.....*..#
#........#~~~~~#........#
#....d...#~~~~~#...c....#
#........=======........#
#........#~~~~~#........#
#.....*..#~~~~~#....b...#
#########################`,
    npcs: {
      d: { name: "Iven, Dispatcher", char: "I", text: "Two bells for one rescue. Ours starts at dispatch. Siltwatch starts theirs at the house that raised it." },
      c: { name: "Ferry Keeper", char: "f", text: "The cage takes you over the deep channel. Walk down to Siltwatch for the small boats." },
    },
  },
  siltwatch: {
    name: "Siltwatch", label: "Boardwalks", safe: true, level: 3, color: [101, 190, 179],
    description: "Boat hooks hang over the doors. Nemi tests her pier with the handle of a hammer.",
    map: `
#######################
#a......~~~~~~~~~~~~~~#
#..*....~~~~~~~~~~~~~~#
#....n..=====....*...b#
#~~~~~~~=~~~=.........#
#~~~~~~~=~~~=...q.....#
#~~..*..=====.........#
#~~.....~~~~~~~~~~~~~~#
#######################`,
    npcs: {
      n: { name: "Nemi, Boatwright", char: "N", text: "That hollow board tells me where the water got to. Follow the far pier and you can reach the aqueduct without the freight road." },
      q: { name: "Rescue Pilot", char: "q", text: "We put our first notch on the tag at the house itself. Iven can compare it with the one in his booth." },
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
#b....*...#.......l.....#
#########################`,
    npcs: {
      d: { name: "Fourth Stamp", char: "4", action: "stamp",
        text: "The survey drawing lists three roads. This inspection plate carries a fourth stamp, marked with the old Orraveth address." },
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
#..#..............#...#
#..#...1..........#...#
#..#........2.....#...#
#..#...*..........#...#
#..........3......*..b#
#######################`,
    npcs: { w: { name: "Shift Worker", char: "w", text: "They searched every tool cart this morning. The gallery runs round their shield line. The fitters are waiting on the other side." } },
    enemies: {
      1: guard, 2: guard,
      3: { ...guard, name: "Gallery Crossbowman", ranged: 4, ability: null, verb: "shoots at" },
    },
  },
  cinderkeep: {
    name: "Cinderkeep", label: "Casting floor", safe: true, level: 4, color: [208, 149, 108],
    description: "Furnaces breathe through tall draft shafts. The fitters are examining an older mould.",
    map: `
#######################
#a.....:::::.......b..#
#..*...........*......#
#.......s.............#
#....#...........#....#
#::::#.....f.....#::::#
#....#...........#....#
#.....*............*..#
#######################`,
    npcs: {
      s: { name: "Sera Dain", char: "S", text: "Veyr signed a drawing with three sockets. I filed a fourth into his replacement so it would work. The mould is by the furnace." },
      f: { name: "Old Casting Mould", char: "4", action: "mould",
        text: "Four sockets. The small one has the same stamp as the old road at the aqueduct. Follow the workers' lift to Kilnward." },
    },
  },
  kilnward: {
    name: "Kilnward", label: "Counterweight fields", safe: true, level: 5, color: [151, 175, 161],
    description: "Shift bells travel down the handrails between the counterweights.",
    map: `
########################
#a..##..##..##..##..b..#
#...##..##..##..##.....#
#.*....................#
#.........p............#
#...##..##..##..##.....#
#...##..##..##..##.....#
#c.............*......d#
########################`,
    npcs: {
      p: { name: "Pela, Apprentice", char: "P", action: "receiver",
        text: "Watch the last receiver. Each time the city shortens a public road, this branch takes the missing paces. It still leads to the Long Ward." },
    },
  },
  long_ward: {
    name: "Long Ward", label: "Orraveth's old street", safe: true, level: 6, color: [168, 152, 192],
    description: "Two sets of house numbers face an approach that takes days to walk.",
    map: `
########################
#a..#..#..#..#.........#
#..*..............m....#
#......................#
#..#..#..#..#...*......#
#......................#
#.........======......b#
#...*.....#~~~~#.......#
########################`,
    npcs: {
      m: { name: "Mera, Tollkeeper", char: "M", action: "register",
        text: "I still count the crossings. Walk both ends of the old approach and bring me the fourth stamp. Then we can challenge Veyr's override." },
    },
  },
  proving_chamber: {
    name: "Proving Chamber", label: "Veyr's last road", level: 6, color: [219, 125, 102],
    description: "Veyr has locked the public hinge. The only way to recover the counterseal is through him.",
    map: `
#########################
#a.....*...........*....#
#.......................#
#....##..........##.....#
#....##.....1....##.....#
#.......................#
#....##..........##.....#
#....##..........##..r..#
#......*...........*....#
#########################`,
    npcs: { r: { name: "Public Register", char: "R", action: "registerEnding" } },
    enemies: {
      1: { ...guard, type: "veyr", name: "Chief Surveyor Veyr", char: "V", boss: true,
        hp: 0.23, atk: 0.68, def: 0.9, aggro: 10 },
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
