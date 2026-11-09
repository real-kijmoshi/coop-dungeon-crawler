const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const http = require('node:http');
const { WebSocket } = require('ws');
const { inflateRawSync } = require('node:zlib');
const { Conn, createHub } = require('../net/hub');

class SlowSocket extends EventEmitter {
  OPEN = 1; readyState = 1; bufferedAmount = 0; frames = []; completions = [];
  send(raw, options, cb) {
    if (typeof options === 'function') cb = options;
    const compressed = Buffer.isBuffer(raw) && raw.subarray(0,4).toString() === 'CDC1';
    this.frames.push(JSON.parse(compressed ? inflateRawSync(raw.subarray(4)) : raw));
    if (cb) this.completions.push(cb);
  }
  terminate() { this.readyState = 3; this.emit('close'); }
  drain() { this.completions.shift()?.(); }
}

test('slow clients receive the newest snapshot; reliable events are not dropped', () => {
  const ws = new SlowSocket(); const c = new Conn(ws); let builds = 0;
  for (let n = 0; n < 1000; n++) c.sendState(() => { builds++; return { n }; });
  c.emit('message', { text: 'loot received' });
  c.emit('profile', { gold: 10 });
  assert.equal(builds, 1);
  assert.equal(ws.frames.filter(f => f.t === 'gameState').length, 1);
  ws.drain();
  assert.equal(builds, 2);
  assert.deepEqual(ws.frames.filter(f => f.t === 'gameState').map(f => f.d.n), [0, 999]);
  assert.deepEqual(ws.frames.filter(f => f.t !== 'gameState').map(f => f.t), ['message', 'profile']);
  ws.drain();
  ws.terminate();
});

test('snapshots wait for socket backpressure and stop retrying on disconnect', async () => {
  const ws = new SlowSocket(); const c = new Conn(ws); let builds = 0;
  ws.bufferedAmount = 100000;
  c.sendState(() => { builds++; return { n: 1 }; });
  c.sendState(() => { builds++; return { n: 2 }; });
  assert.equal(builds, 0);
  ws.bufferedAmount = 0;
  await new Promise(r => setTimeout(r, 60));
  assert.equal(builds, 1);
  assert.equal(ws.frames[0].d.n, 2);
  c.sendState(() => ({ n: 3 }));
  ws.terminate(); ws.drain();
  assert.equal(ws.frames.length, 1);
});

test('write errors close the socket instead of accumulating stale states', () => {
  const ws = new SlowSocket(); const c = new Conn(ws);
  c.sendState(() => ({ n: 1 }));
  c.sendState(() => ({ n: 2 }));
  ws.completions.shift()(new Error('closed'));
  assert.equal(ws.readyState, 3);
  assert.equal(c.statePending, null);
});

test('real WebSockets negotiate compression, preserve replies and accept legacy clients', async t => {
  const server = http.createServer();
  createHub(server, {
    authenticate: () => ({ id: 1 }),
    onConnection: c => {
      c.on('echo', (value, reply) => reply(value));
      c.sendState(() => ({ grid: Array.from({ length: 25 }, () => Array(25).fill(1)) }));
    },
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  for (const compressed of [false, true]) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { perMessageDeflate: compressed });
    const frames = []; const receive = (raw) => frames.push(JSON.parse(raw));
    ws.on('message', receive);
    await once(ws, 'open');
    const startBytes = ws._socket.bytesRead;
    assert.equal(ws.extensions.includes('permessage-deflate'), compressed);
    ws.send(JSON.stringify({ t: 'auth', d: {} }));
    while (!frames.some(f => f.t === 'gameState')) await new Promise(r => setTimeout(r, 5));
    assert.equal(frames[0].t, 'welcome');
    assert.equal(frames[1].d.grid.length, 25);
    const bytes = ws._socket.bytesRead - startBytes;
    if (compressed) assert.ok(bytes < 250, `compressed grid took ${bytes} bytes`);
    else assert.ok(bytes > 1000);
    ws.send(JSON.stringify({ t: 'echo', a: ['value'], id: 7 }));
    while (!frames.some(f => f.t === 'reply')) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(frames.find(f => f.t === 'reply'), { t: 'reply', id: 7, d: 'value' });
    ws.close(); await once(ws, 'close');
  }
});


test('application compression survives a WebSocket path with no extension support', { timeout: 5000 }, async t => {
  const server = http.createServer();
  createHub(server, { authenticate: () => ({ id: 1 }), onConnection: c => {
    c.sendState(() => ({ n: -1, grid: Array.from({ length: 25 }, () => Array(25).fill(1)) }));
    c.on('burst', () => {
      for(let n=0;n<1000;n++) c.sendState(() => ({ n, grid: Array.from({ length: 25 }, () => Array(25).fill(1)) }));
      c.emit('message', { text: 'reliable event' });
    });
  }});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { perMessageDeflate: false });
  const frames = []; let binaryFrames = 0;
  ws.on('message', (raw, binary) => {
    if (binary) { assert.equal(raw.subarray(0,4).toString(), 'CDC1'); raw = inflateRawSync(raw.subarray(4)); binaryFrames++; }
    frames.push(JSON.parse(raw));
  });
  await once(ws, 'open');
  assert.equal(ws.extensions, '');
  const startBytes = ws._socket.bytesRead;
  ws.send(JSON.stringify({ t:'auth', d:{}, features:['state-deflate-v1'] }));
  while (!frames.some(f=>f.t==='gameState')) await new Promise(r=>setTimeout(r,5));
  assert.equal(binaryFrames, 1);
  assert.ok(ws._socket.bytesRead-startBytes < 250);
  ws.send(JSON.stringify({t:'burst'}));
  while (!frames.some(f=>f.t==='gameState' && f.d.n===999)) await new Promise(r=>setTimeout(r,5));
  assert.ok(frames.some(f=>f.t==='message' && f.d.text==='reliable event'));
  assert.deepEqual(frames.filter(f=>f.t==='gameState').map(f=>f.d.n), [-1,0,999]);
  ws.close(); await once(ws,'close');
});

test('disconnect during application compression does not write or restart the queue', async () => {
  const ws = new SlowSocket(); const c = new Conn(ws); c.stateCompression = true;
  c.sendState(() => ({ grid: Array.from({ length: 25 }, () => Array(25).fill(1)) }));
  c.sendState(() => ({ grid: Array.from({ length: 25 }, () => Array(25).fill(2)) }));
  ws.terminate(); await new Promise(r=>setTimeout(r,30));
  assert.equal(ws.frames.length, 0);
  assert.equal(c.statePending, null);
  assert.equal(c.stateSending, false);
});
