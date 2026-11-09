// The world's setting: biomes, the story, lore fragments and character lines.

// Each depth band is its own biome with its own look and mood.
// Colors are [r, g, b]; clients use them to paint tiles.
const BIOMES = [
  {
    id: "cellars",
    name: "The Old Cellars",
    from: 0,
    to: 1,
    floor: { bg: [44, 37, 30], fg: [96, 84, 68] },
    corridor: { bg: [40, 40, 56], fg: [70, 70, 92] },
    wall: [92, 78, 64],
    enter: "Damp stone and the smell of spilled wine. Rats skitter somewhere in the dark.",
  },
  {
    id: "caverns",
    name: "The Fungal Caverns",
    from: 2,
    to: 3,
    floor: { bg: [26, 44, 38], fg: [70, 150, 120] },
    corridor: { bg: [28, 40, 46], fg: [60, 110, 110] },
    wall: [52, 82, 70],
    enter: "Glowing mushrooms light the way. The air is thick with drifting spores.",
  },
  {
    id: "crypts",
    name: "The Sunken Crypts",
    from: 4,
    to: 5,
    floor: { bg: [30, 36, 48], fg: [100, 120, 150] },
    corridor: { bg: [26, 30, 46], fg: [80, 90, 130] },
    wall: [70, 82, 100],
    enter: "Black water drips over ancient tombs. Something beneath the stone is listening.",
  },
  {
    id: "infernal",
    name: "The Infernal Halls",
    from: 6,
    to: 7,
    floor: { bg: [52, 24, 20], fg: [170, 80, 50] },
    corridor: { bg: [44, 22, 26], fg: [140, 60, 50] },
    wall: [110, 44, 32],
    enter: "The walls glow with heat and the floor is warm underfoot. Brimstone burns your throat.",
  },
  {
    id: "abyss",
    name: "The Dragon's Abyss",
    from: 8,
    to: 11,
    floor: { bg: [34, 24, 48], fg: [140, 100, 190] },
    corridor: { bg: [28, 22, 44], fg: [110, 80, 160] },
    wall: [76, 52, 104],
    enter: "Scorched bones and molten gold. Somewhere far below, something enormous breathes.",
  },
  {
    id: "throne",
    name: "The Throne of the Abyss",
    from: 12,
    to: 999,
    floor: { bg: [40, 34, 16], fg: [200, 170, 80] },
    corridor: { bg: [30, 26, 16], fg: [150, 120, 60] },
    wall: [100, 84, 40],
    enter: "Black obsidian and cold gold. This is where the darkness began.",
  },
];

const biomeForTier = (tier) => BIOMES.find((b) => tier >= b.from && tier <= b.to) || BIOMES[BIOMES.length - 1];

const STORY = [
  "Long ago the town of Emberfall was built on top of the old wine cellars.",
  "Nobody remembers who dug the tunnels that lead further down.",
  "",
  "Last winter the ground shook. Fire rose from the wells, and the things",
  "that live below began to climb out of the dark.",
  "",
  "The old merchant has set up shop in the last safe room before the depths.",
  "He says something woke up down there: first the dragon, and then",
  "something older that the dragon was guarding.",
  "",
  "Gather your friends. Go down. Find out what woke up, and put it back to sleep.",
];

// Found in order, one per lore scroll, so the story unfolds as you explore.
const LORE = [
  { title: "A Cellar Ledger", text: "Three casks missing again. The boy swears the rats are as big as dogs now. I told him to stop drinking the stock." },
  { title: "Scratched on a Door", text: "WE DUG TOO DEEP. THE WALLS ARE WARM. DO NOT FOLLOW THE GLOWING ROOTS." },
  { title: "A Mushroom Farmer's Note", text: "The caps here feed on something under the rock. They glow brighter every night, and they turn toward the deep tunnels like flowers toward the sun." },
  { title: "Goblin Scrawl", text: "Big King say: dig down, find shiny. Big King not say what make the shiny so hot." },
  { title: "Epitaph", text: "Here lie the Wardens of the Deep, who sealed the Abyss and paid with their names. Should the seal break, may another bear the burden." },
  { title: "The Bone Lord's Oath", text: "I served the Wardens once. Then the voice below promised me I would never die. It kept its word. I only wish it hadn't." },
  { title: "A Priest's Warning", text: "The heat is not fire. It is breath. The dragon is not sleeping beneath the city. It is lying awake, keeping something else asleep." },
  { title: "Demon Contract", text: "In exchange for the Halls, the Prince shall keep the dragon distracted. Signed in ash, on behalf of the One Below." },
  { title: "Dragon Scale Carving", text: "I was the last Warden's oath. I guard the door so that the Lord of the Abyss stays dreaming. Kill me, and you must finish what I started." },
  { title: "The Last Warden's Diary", text: "The seal is the Throne itself. Whoever sits on it holds the dark in place. I am too old now. Someone else will have to come." },
  { title: "Whisper in Gold", text: "Come down, little lights. Wake me fully. I have been so patient." },
  { title: "Emberfall Chronicle", text: "And when the heroes came back up, the wells ran clear and the ground was cool again. No one in the town asked what they had seen. They did not want to know." },
];

// What bosses say the first time they see you.
const BOSS_LINES = {
  goblin_king: "\"Shiny! Bring me the shiny ones, alive!\"",
  bone_lord: "\"Another soul for my throne of bones.\"",
  orc_warlord: "\"Finally, a fight worth having!\"",
  wraith_queen: "\"Your warmth... give it to me.\"",
  troll_chief: "\"Smash small things. Eat small things.\"",
  demon_prince: "\"The One Below sends its regards.\"",
  ancient_dragon: "\"Turn back, little ones. You do not know what I am guarding.\"",
  abyss_lord: "\"AT LAST. YOU HAVE COME TO WAKE ME.\"",
};

const MERCHANT_LINES = [
  "\"Welcome, traveller! Gold for steel, steel for glory.\"",
  "\"Back again? The deep pays well, if you live to spend it.\"",
  "\"I'd go down there myself, but who would mind the shop?\"",
  "\"Every item is guaranteed. Guaranteed to be an item, that is.\"",
  "\"Bring me something shiny from the Infernal Halls and I'll make it worth your while.\"",
  "\"The dragon? Oh, it's real. I sold it a hat once.\"",
];

module.exports = { BIOMES, biomeForTier, STORY, LORE, BOSS_LINES, MERCHANT_LINES };
