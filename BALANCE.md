# Balance: level 1 to 100

The game is balanced so a hero can climb from level 1 to the level cap of **100**, with fights that stay
interesting the whole way: monsters keep pace with you, gear keeps mattering, and nothing becomes trivial or
impossible. Everything that scales lives in one file, [`server/game/balance.js`](server/game/balance.js), and a
fast-forward simulator ([`server/sim/simulate.js`](server/sim/simulate.js)) plays the real game engine for
hours of game time to check it.

## The model

**Areas have a level.** The safe room is level 1; the level rises with the distance from it, reaching 100 about
190 tiles out (just inside the edge of the 400x400 world) and up to 110 in the far corners. The curve is a little
steeper further out, so the early levels get more room:

| Distance from the safe room | 10 | 20 | 30 | 60 | 100 | 140 | 180 | 190+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Monster level | 1 | 4 | 8 | 21 | 40 | 61 | 84 | 100+ |

Biomes, waystones and depth records still use *depth* (one depth every 10 tiles).

**Monsters are built against an "expected hero".** `heroAtk(L)`, `heroHp(L)` and `heroMitigation(L)` describe a
typical hero of level L, counting class growth, gear, merchant upgrades and the blacksmith. The curves were fitted
to what the simulated heroes actually had. A normal monster of level L is then sized so that:

- the expected hero kills it in about **3.4 hits** (`HITS_TO_KILL`)
- one of its hits takes about **5% of the hero's max HP** (`HIT_PCT`)

Each monster type then multiplies those numbers (a Slime is slow and tanky, a Cultist hits hard but is frail, a
Golem has twice the HP and armor, ...). Elites are x2.4 HP, x1.35 ATK, x3 XP. Bosses are x14 HP, x1.55 ATK, x25 XP,
and the Abyss Lord is x40 HP, x1.9 ATK. Bosses also get +60% HP for each extra hero they face.

**Armor is a percentage:** `def / (def + 20 + 4 x attacker level)`. It is useful at every level and never makes
anyone immune. Damage has +-10% variance, and crits do double damage.

**XP:** the kills needed per level grow from ~8 at level 1 to ~95 at 50 and ~210 at 99
(`killsToLevel`). Monsters far below you give less XP (down to 10%); monsters above you give up to +50%. So you keep
moving outward as you grow.

**Gear** is generated at the level of the monster or area it comes from (item level), with five rarities. The
**blacksmith** adds 4% of an item's base stats per +1 (up to +10, so +40%), non-compounding.

**The merchant** sells permanent *percentage* upgrades that cap out: +2% ATK per whetstone (up to +50%), +3% DEF per
plating (up to +60%), +3% HP per tonic (up to +60%). Heart crystals add +1% HP each, up to 25. Prices grow 16% per
purchase.

**Co-op:** party members within 30 tiles get the **full XP** of every party kill, plus 10% per member fighting
nearby, capped at 20% of a level per kill so being carried isn't instant. More heroes in one place also means more
monsters spawn around them.

## What the simulator showed

The simulator runs the real `World` on a fake clock with AI heroes that play like careful humans: they hunt
monsters near their level, drink potions at 40% HP, use their skills, go back to town to sell, shop and smith,
take waystones, retreat from fights they can't win and avoid places where they just died. Because they never stop
to read, chat or think, **real players should expect roughly 1.5x these times, about 15-25 hours to level 100.**

Hours of game time to reach each level (seed 1, latest balance):

| Hero | L10 | L20 | L30 | L50 | L70 | L90 | **L100** | Deaths | Abyss Lord |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Warrior (solo) | 0.6 | 1.0 | 1.3 | 2.5 | 4.2 | 9.8 | **14.2** | 7 | defeated |
| Rogue (solo) | 0.3 | 0.7 | 1.0 | 2.2 | 4.5 | 8.0 | **11.1** | 2 | defeated |
| Mage (solo) | 0.6 | 0.8 | 1.2 | 3.2 | 7.0 | 12.4 | **15.9** | 16 | not yet |
| Cleric (solo) | 0.5 | 0.8 | 1.2 | 2.3 | 5.5 | 11.7 | **17.0** | 3 | defeated |
| Party of 4 (seed 4) | 0.3 | 0.5 | 0.9 | 2.0-2.4 | 4.9-5.9 | 9.0-10.9 | **12.3-15.1** | 0-3 each | defeated |

A second seed gave 10.9-15.4 hours for the four solo classes.

Per level band, for the same-level normal monsters a hero meets:

- **hits to kill:** about 3-4 (warriors 4-5, since they hit less hard and take less damage)
- **damage taken per hit:** warrior ~2.5%, cleric ~3.5%, rogue ~4%, mage ~5-6% of max HP

These stay flat from level 10 to 100, which is the point: level 90 plays like level 20, just with scarier names.
Deaths cluster where they should: in the first levels, on the way past a lair, and at the Ancient Dragon and the
Abyss Lord.

## Things the simulator found and fixed

- **Monsters camped the spawn.** Monsters chased heroes anywhere, so high-level elites drifted to the safe room
  door and killed new heroes over and over (one test hero died 103 times before level 10). Monsters now have a
  **leash**: they follow you about 10 tiles from home, then walk back and heal.
- **The world emptied out.** Respawns added one monster every 30 seconds for the whole map. Now they keep the area
  around every hero populated (more for groups).
- **Players outgrew everything.** With flat merchant upgrades and unlimited hearts, heroes ended with 3-4x the
  stats monsters were built for, and level 50+ monsters died in one or two hits. Hence capped percentage
  upgrades and monsters built against the expected hero.
- **Parties levelled slower than solo heroes,** because a group finds monsters about as fast as one hero and split
  the XP. Party members now get the full XP of party kills.

## Running it yourself

```bash
cd server
npm test                                   # engine checks
node sim/simulate.js --hours 25            # one solo hero of each class in a shared world
node sim/simulate.js --classes mage --hours 25 --seed 2
node sim/simulate.js --party --hours 25    # the six classes in one party
node sim/simulate.js --hours 5 --json out.json
```

A 25-hour run takes a minute or two (a party run a few minutes). The report shows when each level was reached,
deaths, kills per minute, hits-to-kill and damage taken per level band, the hero's stats against a same-level
monster every 10 levels, and the bosses defeated. Set `SIM_DEATHS=1` to list every death and where it happened.

To retune, change the knobs in `balance.js` (`HITS_TO_KILL`, `HIT_PCT`, `killsToLevel`, the `hero*` curves, the
gear rolls, `SHOP_PCT`/`SHOP_MAX`) and re-run the simulator.
