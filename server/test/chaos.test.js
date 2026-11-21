// Chaos test: six heroes (one per class) hammer a real server with random and malformed
// commands, reconnect mid-game and fight, and the server must stay up without throwing.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { WebSocket } = require('ws');
const { inflateRawSync } = require('node:zlib');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DURATION = Number(process.env.CHAOS_MS || 12000);
const CLASSES = ['warrior', 'rogue', 'mage', 'cleric', 'ranger', 'necromancer'];
const DIRS = ['north', 'south', 'east', 'west'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const JUNK = [null, undefined, -1, 0, 1, 99, 1e9, NaN, '', 'x'.repeat(500), {}, [], { __proto__: { a: 1 } }, true, 'north', 'invite', 'sell', 'equip'];

async function until(fn, ms = 10000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const r = await fn(); if (r) return r; await sleep(10); }
  throw new Error('timed out');
}

function connect(port, username) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const c = { ws, username, frames: 0, last: null, replies: new Map(), id: 1 };
  ws.on('message', (raw, binary) => {
    if (binary) raw = inflateRawSync(raw.subarray(4));
    const f = JSON.parse(raw);
    c.frames++;
    if (f.t === 'gameState') c.last = f.d;
    if (f.t === 'reply') c.replies.set(f.id, f.d);
  });
  ws.on('error', () => {});
  c.send = (t, a, withReply = true) => {
    if (ws.readyState !== ws.OPEN) return null;
    const id = withReply ? c.id++ : undefined;
    ws.send(JSON.stringify({ t, a, id }));
    return id;
  };
  return c;
}

test('random and malformed commands from six heroes never crash the server', { timeout: DURATION + 40000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdc-chaos-'));
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const clients = [];
  t.after(async () => {
    for (const c of clients) c.ws.terminate();
    if (child.exitCode === null) {
      fs.writeFileSync(path.join(dir, 'stop.request'), 'stop');
      await Promise.race([once(child, 'exit'), sleep(5000)]);
      if (child.exitCode === null) child.kill();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (child.exitCode !== null) throw new Error(output);
    try { return (await fetch(base + '/api/status')).ok; } catch { return false; }
  });

  const login = async (username, cls) => {
    const c = connect(port, username);
    await once(c.ws, 'open');
    c.ws.send(JSON.stringify({ t: 'auth', d: { username, password: 'chaos-password' }, features: Math.random() < 0.5 ? ['state-deflate-v1'] : [] }));
    await until(() => c.last);
    if (cls) { const id = c.send('chooseClass', [cls]); await until(() => c.replies.has(id)); }
    return c;
  };
  for (const cls of CLASSES) {
    const username = `chaos${cls.slice(0, 6)}`;
    const r = await fetch(base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'chaos-password' }) });
    assert.equal(r.status, 201);
    clients.push(await login(username, cls));
  }

  // Form a party so co-op paths (shared XP, revives, party chat) are exercised.
  for (const c of clients.slice(1, 4)) {
    const inv = clients[0].send('party', ['invite', c.username]); await until(() => clients[0].replies.has(inv));
    const acc = c.send('party', ['accept', '']); await until(() => c.replies.has(acc));
  }
  await until(() => clients[0].last?.party?.members?.length === 4);

  // Logging in again from a second client while the first is still open must not leave
  // a ghost behind in the party: the replaced session leaves it like a normal disconnect.
  const replaced = clients[1];
  clients[1] = await login(replaced.username);
  await until(() => clients[0].last?.party?.members?.length === 3);
  assert.equal(clients[1].last.party, null, 'the new session starts outside the old party');
  replaced.ws.terminate();
  const reinv = clients[0].send('party', ['invite', clients[1].username]); await until(() => clients[0].replies.has(reinv));
  assert.equal(clients[0].replies.get(reinv).ok, true, JSON.stringify(clients[0].replies.get(reinv)));
  const reacc = clients[1].send('party', ['accept', '']); await until(() => clients[1].replies.has(reacc));
  await until(() => clients[0].last?.party?.members?.length === 4);

  const actions = [
    c => c.send('move', [pick(DIRS)]),
    c => c.send('move', [pick(DIRS)]),
    c => c.send('move', [pick(DIRS)]),
    c => c.send('dodge', [pick(DIRS)]),
    c => c.send('skill', [Math.floor(Math.random() * 5)], false),
    c => c.send('potion', [], false),
    c => c.send('interact', []),
    c => c.send('atlas', []),
    c => c.send('travelOptions', []),
    c => c.send('travel', [pick(['emberfall', 'town', 'safe', 0, 1, 2, pick(JUNK)])]),
    c => c.send('inventory', [pick(['equip', 'drop', 'sell', 'use', 'junk']), c.last?.player?.inventory?.[0]?.uid ?? pick(JUNK)]),
    c => c.send('smith', [pick(['upgrade', 'salvage', 'x']), pick(JUNK)]),
    c => c.send('buy', [pick(['potion', 'whetstone', 'plating', 'tonic', 'heart', pick(JUNK)]), pick(JUNK)]),
    c => c.send('party', [pick(['create', 'invite', 'accept', 'leave', 'kick', 'x']), pick([...clients.map(o => o.username), pick(JUNK)])]),
    c => c.send('chat', [pick(['hi', '/p party hello', '\u0000\u001b[2J', 'x'.repeat(300)])], false),
    c => c.send('getProfile', []),
    c => c.send('leaderboard', []),
    c => c.send('ping', [], false),
    c => c.send(pick(['move', 'skill', 'buy', 'travel', 'party', 'inventory', 'nonsense', '__proto__', 'constructor']), [pick(JUNK), pick(JUNK), pick(JUNK)]),
    c => c.ws.readyState === c.ws.OPEN && c.ws.send(pick(['not json', '{}', '{"t":null}', '{"t":"move","a":"north"}', '[]', 'null'])),
  ];

  // Lifecycle events are server-only: a client "disconnect" must not remove its own hero.
  const spoof = clients[5];
  spoof.send('disconnect', []); spoof.send('error', ['boom']); spoof.send('newListener', ['move']);
  await sleep(300);
  const probeId = spoof.send('move', ['east']);
  await until(() => spoof.replies.has(probeId));
  assert.ok(clients[0].last.online.some(o => (o.username ?? o) === spoof.username), 'spoofed disconnect kept the hero online');
  // Short argument lists still get their reply.
  const short = spoof.send('party', ['leave']); await until(() => spoof.replies.has(short));

  const end = Date.now() + DURATION;
  let reconnects = 0;
  while (Date.now() < end) {
    if (child.exitCode !== null) break;
    for (let i = 0; i < clients.length; i++) {
      for (let k = 0; k < 3; k++) pick(actions)(clients[i]);
      if (Math.random() < 0.004) {
        // Reconnect mid-game, sometimes kicking a still-open session.
        const old = clients[i];
        if (Math.random() < 0.5) old.ws.terminate();
        clients[i] = await login(old.username);
        if (old.ws.readyState === old.ws.OPEN) old.ws.terminate();
        reconnects++;
      }
    }
    await sleep(40);
  }

  assert.equal(child.exitCode, null, 'server exited:\n' + output.slice(-4000));
  const errors = output.split('\n').filter(l => /Error handling|TypeError|RangeError|ReferenceError|Uncaught|at .*\.js:\d+/.test(l));
  assert.deepEqual(errors, [], output.slice(-6000));
  // Every hero still gets live state after the storm.
  for (const c of clients) {
    const before = c.frames;
    const id = c.send('getGameState', []);
    await until(() => c.replies.has(id) && c.frames >= before);
    assert.ok(c.replies.get(id).player, `${c.username} has state`);
  }
  console.log(`chaos: ${clients.reduce((s, c) => s + c.frames, 0)} frames, ${reconnects} reconnects`);
});
