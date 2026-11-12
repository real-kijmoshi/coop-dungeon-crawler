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
async function until(fn) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(10); }
  throw new Error('Timed out waiting for game network state');
}

test('mixed legacy and application-compressed clients authenticate, move and chat on a real server', { timeout: 25000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdc-network-'));
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
      // The bundled Windows host uses this same graceful save-and-stop path.
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
  for (let n = 0; n < 4; n++) {
    const username = `network${n}`;
    const registered = await fetch(base + '/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'test-password' }) });
    assert.equal(registered.status, 201);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const c = { ws, frames: [], applicationCompressedFrames: 0 }; clients.push(c);
    ws.on('message', (raw, binary) => {
      if (binary) { assert.equal(raw.subarray(0,4).toString(),'CDC1'); raw=inflateRawSync(raw.subarray(4)); c.applicationCompressedFrames++; }
      c.frames.push(JSON.parse(raw));
    });
    await once(ws, 'open');
    assert.ok(ws.extensions.includes('permessage-deflate'));
    ws.send(JSON.stringify({ t: 'auth', d: { username, password: 'test-password' }, features: n%2 ? [] : ['state-deflate-v1'] }));
    await until(() => c.frames.some(f => f.t === 'welcome'));
    ws.send(JSON.stringify({ t: 'chooseClass', a: ['warrior'], id: 1 }));
    await until(() => c.frames.some(f => f.t === 'reply' && f.id === 1 && f.d.ok));
  }
  for (const c of clients) await until(() => c.frames.some(f => f.t === 'gameState' && f.d.online.length === 4));
  for (let turn = 0; turn < 6; turn++) {
    for (const c of clients) c.ws.send(JSON.stringify({ t: 'move', a: [turn % 2 ? 'west' : 'east'], id: turn + 10 }));
    for (const c of clients) {
      const reply = await until(() => c.frames.find(f => f.t === 'reply' && f.id === turn + 10));
      assert.equal(reply.d.ok, true, JSON.stringify(reply.d));
    }
    await sleep(125);
  }
  const modern = clients[0];
  modern.ws.send(JSON.stringify({ t: 'getProfile', id: 30 }));
  const profile = await until(() => modern.frames.find(f => f.t === 'reply' && f.id === 30));
  assert.equal(profile.d.chronicles[0].title, 'The Warm Well');

  modern.ws.send(JSON.stringify({ t: 'dodge', a: ['east'], id: 31 }));
  const dodge = await until(() => modern.frames.find(f => f.t === 'reply' && f.id === 31));
  assert.equal(dodge.d.ok, true);
  await until(() => modern.frames.some(f => f.t === 'gameState' && f.d.player.dodgeReadyAt > f.d.now));

  assert.ok(clients[0].applicationCompressedFrames>0 && clients[2].applicationCompressedFrames>0);
  assert.equal(clients[1].applicationCompressedFrames+clients[3].applicationCompressedFrames,0);
  clients[0].ws.send(JSON.stringify({ t: 'chat', a: ['transport-test'] }));
  for (const c of clients) {
    await until(() => c.frames.some(f => f.t === 'message' && f.d.text.includes('transport-test')));
    const latest = c.frames.filter(f => f.t === 'gameState').at(-1).d;
    assert.ok(latest.view.grid.length > 0);
    assert.equal(latest.player.cls, 'warrior');
  }
});
