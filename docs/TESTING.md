# Playtesting checklist

Thanks for helping test! Get the latest **server/host** and **client** from the
[releases page](https://github.com/real-kijmoshi/coop-dungeon-crawler/releases/latest).
Report anything odd as a [GitHub issue](https://github.com/real-kijmoshi/coop-dungeon-crawler/issues/new).
Include your client version (bottom-right of the main menu), the host mode (Cloudflare, Direct, LAN, Local) and what you did just before it happened.
Press **F3** in game to see ping and frame timing for lag reports.

## Before you start

- [ ] The host starts and prints an invite; friends can join with it.
- [ ] A new account can register, pick a class and enter Emberfall.
- [ ] Restarting the host keeps heroes, gold, gear and the map.

## Reconnecting and parties (fixed in v0.5.2)

- [ ] Form a party of 2–4. One hero logs in from a **second client** without closing the first:
      the party shows them leaving, and the leader can invite them back.
- [ ] Get **downed** in a party, then log in from another client: it counts as a death (penalty applies).
- [ ] Close the client mid-fight and log back in: you return where you were, out of the party.
- [ ] Party chat (`/p hello`) reaches only the party.

## Each class (try at least the first two skills)

- [ ] Warrior: Cleave, War Cry
- [ ] Rogue: Backstab, Smoke Bomb
- [ ] Mage: Fireball, Frost Nova
- [ ] Cleric: Heal (also heals nearby allies), Smite
- [ ] Ranger: Aimed Shot (farther = stronger), Snare Trap
- [ ] Necromancer: Drain Life heals you, Curse of Frailty makes the next hit stronger

## Cities and exploring

- [ ] Postmaster Dena's delivery opens the Old Cellars.
- [ ] The atlas (`M`) marks districts, residents and caches; ★ after fully exploring one.
- [ ] Hidden caches (`%`) can be searched once per hero.
- [ ] An inn heals you, refills potions and gives Well Rested.
- [ ] Merchants show the price and ask for confirmation before you buy.

## Combat

- [ ] Telegraphed attacks can be dodged.
- [ ] Team combos (PIERCE, WITHER, ...) trigger when two classes hit the same foe.
- [ ] Dying sends you back to a safe room with the usual penalty.

## For developers

```sh
cd server && npm ci && npm test            # unit, network and chaos tests
CHAOS_MS=60000 node --test test/chaos.test.js
node sim/simulate.js --hours 3 --quiet     # balance simulator
cd ../client && go test -race ./...
```
