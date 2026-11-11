// Compare real WebSocket traffic over a local bandwidth/latency-limited TCP proxy.
// This measures transport behavior, not Cloudflare's actual route or reliability.
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { WebSocket } = require('../server/node_modules/ws');
const { createHub } = require('../server/net/hub');
const { Grid } = require('../server/utils/map');
const { World } = require('../server/game/World');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', r));

async function measure(compressed) {
  const map = new Grid(20, 20, 400, 1234); map.generateInitialRoom();
  const world = new World(map); world.stop();
  const player = world.addPlayer({ id: 1, username: 'benchmark', cls: 'warrior', position_x: -1, position_y: -1 });
  const server = http.createServer();
  createHub(server, { authenticate: () => ({ id: 1 }), onConnection: c => {
    const timer = setInterval(() => c.sendState(() => world.stateFor(player)), 50);
    c.on('disconnect', () => clearInterval(timer));
  } });
  await listen(server);
  const connections = new Set();
  const proxy = net.createServer(client => {
    const upstream = net.connect(server.address().port, '127.0.0.1');
    connections.add(client); connections.add(upstream);
    const queue = []; let offset = 0;
    // 32 KiB/s downstream and 60ms latency in each direction (~120ms RTT).
    const downstream = setInterval(() => {
      let budget = 328;
      while (budget && queue.length && queue[0].at <= Date.now()) {
        const n = Math.min(budget, queue[0].data.length - offset);
        client.write(queue[0].data.subarray(offset, offset + n));
        offset += n; budget -= n;
        if (offset === queue[0].data.length) { queue.shift(); offset = 0; }
      }
    }, 10);
    upstream.on('data', data => queue.push({ data, at: Date.now() + 60 }));
    client.on('data', data => { const timer = setTimeout(() => { if (!upstream.destroyed) upstream.write(data); }, 60); timer.unref(); });
    const cleanup = () => { clearInterval(downstream); client.destroy(); upstream.destroy(); connections.delete(client); connections.delete(upstream); };
    client.on('close', cleanup); upstream.on('close', cleanup);
    client.on('error', cleanup); upstream.on('error', cleanup);
  });
  await listen(proxy);
  const ws = new WebSocket(`ws://127.0.0.1:${proxy.address().port}/ws`, { perMessageDeflate: compressed });
  const ages = [];
  ws.on('message', raw => { const f = JSON.parse(raw); if (f.t === 'gameState') ages.push(Date.now() - f.d.now); });
  try {
    await once(ws, 'open');
    ws.send(JSON.stringify({ t: 'auth', d: {} }));
    await sleep(4000);
    if (!ages.length) throw new Error('No states received');
    return { compression: compressed, snapshotsReceived: ages.length, lastStateAgeMs: ages.at(-1), receivedBytes: ws._socket.bytesRead };
  } finally {
    ws.terminate(); for (const socket of connections) socket.destroy();
    await new Promise(r => proxy.close(r));
    await new Promise(r => server.close(r));
  }
}
(async () => {
  const before = await measure(false); const after = await measure(true);
  console.log(JSON.stringify({ conditions: '32 KiB/s downstream, ~120ms RTT, 20 updates/sec, deterministic initial world', before, after }, null, 2));
  if (after.lastStateAgeMs >= before.lastStateAgeMs / 2) throw new Error('Compression failed to reduce snapshot backlog');
})().catch(e => { console.error(e); process.exitCode = 1; });
