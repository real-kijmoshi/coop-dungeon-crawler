# Steadier servers: reconnect and party fixes, plus a stress-tested protocol

**Update your server (or Windows host).** The client is unchanged from v0.5.1, so players don't need a new client. Heroes, saves and maps carry over.

## Fixes

- **No more ghost party members.** Logging in from a second client while the first was still connected left your old self in the party. The party showed a member who wasn't there, counted them toward the 4-hero limit, and you couldn't be invited back. The old session now leaves the party cleanly, and you can be re-invited right away.
- **You can't escape being downed by logging in again.** Reconnecting from another client while downed used to bring the hero back at full health with no death penalty. It now counts as dying, the same as closing the game.
- **Clients can't fake their own disconnect.** A crafted `disconnect` or `error` message could remove a hero from the world while their connection stayed open. The server now ignores these internal events from clients.
- **Commands with missing arguments still get an answer.** A request with fewer arguments than expected (for example, `party accept` with no name) used to lose its reply, and the client waited forever. It now always gets a reply.

## For testers and server hosts

- **A new chaos test** puts six heroes (one per class) in a party on a real server. They send thousands of random and malformed commands, reconnect mid-fight, and the server must stay up without a single error. It runs in CI and with `npm test`. Set `CHAOS_MS=60000` for a longer run.
- **A playtest checklist** in [`docs/TESTING.md`](https://github.com/real-kijmoshi/coop-dungeon-crawler/blob/main/docs/TESTING.md) lists what to try in this release and how to report bugs.
