# Fight Together: telegraphed combat, team combos, things to find, and a new soundtrack

**Update both your server (or Windows host) and your client.** Old clients still connect, but they won't see the red danger tiles or hear the new sounds.

## Combat you can play, together

- **Red floor means move.** Monsters now have special attacks that mark the tiles they will hit about half a second before they land: smashes, bombs, pounces, hexes, lines of fire and blinks. Step out and take nothing. Freezing or killing the monster cancels the attack.
- **Team combos.** Most skills leave a mark on the monsters they hit (a tint and a ✦ in the enemy list). When an ally hits a marked monster, the mark detonates: Frost Nova → SHATTER, Fireball → IGNITE, Chain Lightning → OVERLOAD, Smite → JUDGEMENT, and more.
- **Fight side by side.** Standing next to an ally gives you both 15% less damage. Hitting a monster another hero just hit flanks it for bonus damage. A party now builds one shared kill combo.
- **Smarter bosses.** They call for help at 60% health, and their doom mark (☠) is split between everyone standing next to the marked hero: run towards your friend.
- **More variety.** Elites get an affix (Volatile, Frenzied, Warding, Vampiric), slimes split, and rats and goblins call their pack.

## More to find

- **Urns** to smash, **healing fountains**, and **mimics** hiding in some chests from level 10.
- **Sealed vaults** that open with better loot when two heroes stand together.
- **Cursed chests** that start a three-wave fight and reward everyone who stays.
- First visits to a chamber give a little XP, and there are new bounties and achievements for exploring, breaking curses and landing team combos.

## A new soundtrack, and sound effects

- **No more cut or repetition.** The music is composed live while you play, so there is no loop point and it never repeats exactly. It is dark fantasy now (harp, choir, flute, horns, bells and war drums) with a mood for every biome.
- **It reacts to fights:** drums and low strings fade into the music when monsters hunt you.
- **About 50 sound effects**: hits, crits, skills, pickups, chests, telegraphed attacks, combos, revives and more. They are positional, so a fight to your left sounds like it is on your left.
- Audio now goes through one built-in mixer: directly on Windows and macOS, and streamed into `paplay`, `pw-cat`, `aplay` or `ffplay` on Linux. Without a sound device the game simply runs silent.
- `CDC_AUDIO_PLAYER` must now be a command that reads raw 16-bit 44.1 kHz stereo audio from stdin.
- Windows and macOS audio is new in this release. If you have no sound there, please open an issue.
