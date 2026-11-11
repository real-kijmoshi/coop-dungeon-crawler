// Bounty quests: every player always has 3 active bounties scaled to their progress.
const { MONSTERS, BOSSES } = require("./data");
const { xpToNext } = require("./balance");

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
let qid = 0;

const QUEST_KINDS = ["kill_type", "kill_type", "kill_depth", "elite", "boss", "depth", "gold", "chest", "combo"];

const generateQuest = (player, existing = []) => {
  const s = player.stats;
  const depth = Math.max(0, s.maxDepth);
  const taken = new Set(existing.map((q) => q.kind + (q.target || "")));

  for (let attempt = 0; attempt < 20; attempt++) {
    const kind = pick(QUEST_KINDS);
    let q = null;
    switch (kind) {
      case "kill_type": {
        const options = MONSTERS.filter((m) => m.minLevel <= s.level && m.minLevel >= s.level - 25);
        const m = pick(options.length ? options : MONSTERS.slice(0, 3));
        const need = rand(5, 12);
        q = { kind, target: m.type, need, desc: `Slay ${need} ${m.name}s` };
        break;
      }
      case "kill_depth": {
        const lvl = Math.max(1, s.level - 3);
        const need = rand(8, 15);
        q = { kind, target: lvl, need, desc: `Slay ${need} monsters of level ${lvl}+` };
        break;
      }
      case "elite":
        if (s.level < 10) continue;
        q = { kind, need: rand(2, 4), desc: "" };
        q.desc = `Slay ${q.need} elite monsters`;
        break;
      case "boss": {
        if (s.level < 8) continue;
        const options = BOSSES.filter((b) => b.minLevel <= s.level + 2);
        if (!options.length) continue;
        const b = options[options.length - 1];
        q = { kind, target: b.type, need: 1, desc: `Defeat the ${b.name}` };
        break;
      }
      case "depth":
        q = { kind, target: depth + 1, need: 1, desc: `Reach depth ${depth + 1}` };
        break;
      case "gold": {
        const need = 100 * (1 + Math.floor(s.level / 2));
        q = { kind, need, desc: `Collect ${need} gold` };
        break;
      }
      case "chest":
        q = { kind, need: rand(1, 2), desc: "" };
        q.desc = `Open ${q.need} treasure chest${q.need > 1 ? "s" : ""}`;
        break;
      case "combo": {
        const need = rand(4, 7);
        q = { kind, target: need, need: 1, desc: `Get a x${need} kill combo` };
        break;
      }
    }
    if (!q || taken.has(q.kind + (q.target || ""))) continue;

    const difficulty = q.kind === "boss" ? 3 : q.kind === "elite" || q.kind === "depth" ? 1.6 : 1;
    q.id = ++qid;
    q.have = 0;
    q.reward = {
      gold: Math.round((40 + s.level * 20) * difficulty),
      xp: Math.round(xpToNext(s.level) * 0.2 * difficulty),
      item: q.kind === "boss" || Math.random() < 0.3,
    };
    return q;
  }
  return { id: ++qid, kind: "kill_depth", target: 0, need: 10, have: 0, desc: "Slay 10 monsters", reward: { gold: 50, xp: 20, item: false } };
};

// Returns the quests that just got completed.
const progressQuests = (quests, event, data = {}) => {
  const done = [];
  for (const q of quests) {
    if (q.have >= q.need) continue;
    let inc = 0;
    switch (q.kind) {
      case "kill_type":
        if (event === "kill" && data.type === q.target) inc = 1;
        break;
      case "kill_depth":
        if (event === "kill" && (data.level || 0) >= q.target) inc = 1;
        break;
      case "elite":
        if (event === "kill" && data.elite) inc = 1;
        break;
      case "boss":
        if (event === "kill" && data.type === q.target) inc = 1;
        break;
      case "depth":
        if (event === "depth" && data.depth >= q.target) inc = 1;
        break;
      case "gold":
        if (event === "gold") inc = data.amount;
        break;
      case "chest":
        if (event === "chest") inc = 1;
        break;
      case "combo":
        if (event === "combo" && data.combo >= q.target) inc = 1;
        break;
    }
    if (inc) {
      q.have = Math.min(q.need, q.have + inc);
      if (q.have >= q.need) done.push(q);
    }
  }
  return done;
};

module.exports = { generateQuest, progressQuests };
