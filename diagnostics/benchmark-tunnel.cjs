// Real Cloudflare path comparison. No personal saves or accounts are used.
// node diagnostics/benchmark-tunnel.cjs --cloudflared=/path/to/cloudflared
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { inflateRawSync } = require('node:zlib');
const { WebSocket } = require('../server/node_modules/ws');
const { createHub } = require('../server/net/hub');
const { Grid } = require('../server/utils/map');
const { World } = require('../server/game/World');
const args = Object.fromEntries(process.argv.slice(2).map(x => x.replace(/^--/, '').split('=')));
const binary = args.cloudflared || 'cloudflared';
const duration = Number(args.duration || 30) * 1000;
const rounds = Number(args.rounds || 2);
const outDir = path.resolve(args.output || 'diagnostics/results');
fs.mkdirSync(outDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const password = crypto.randomBytes(32).toString('hex');
const report = { started: new Date().toISOString(), node: process.version, platform: process.platform, players: 4, durationSeconds: duration / 1000, rounds, scenario: 'Four synthetic heroes in the initial dungeon, 20 full snapshots/s/client, movement every 150ms and reliable probe every 250ms. Clients and origin on same machine; public paths actually traverse Cloudflare. This does not measure a Polish home connection.', results: [] };
const percentile = (a, p) => { if (!a.length) return null; const s = [...a].sort((a,b) => a-b); return Math.round(s[Math.min(s.length-1, Math.floor((s.length-1)*p))]*10)/10; };
const summary = a => ({ samples: a.length, p50: percentile(a,.5), p95: percentile(a,.95), max: a.length ? Math.round(Math.max(...a)*10)/10 : null });
let activeTunnel;
const activeClients = new Set();

async function stopTunnel(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  const ended = once(proc, 'exit'); proc.kill('SIGTERM');
  await Promise.race([ended, sleep(3000)]);
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
}
async function startTunnel(port, protocol) {
  const proc = spawn(binary, ['tunnel', '--no-autoupdate', '--protocol', protocol, '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore','pipe','pipe'] });
  activeTunnel = proc;
  const log = fs.createWriteStream(path.join(outDir, `cloudflare-${protocol}.log`));
  let text = ''; let url; let connected; let spawnError;
  const consume = b => { log.write(b); text += b; url ||= text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0]; const m=text.match(/Registered tunnel connection[^\n]*protocol=(\w+)/); if (m) connected=m[1]; };
  proc.stdout.on('data',consume); proc.stderr.on('data',consume);
  proc.on('error', e => spawnError = e);
  proc.on('close', () => log.end());
  const deadline = Date.now()+65000;
  while (Date.now()<deadline) {
    if (spawnError) throw spawnError;
    if (proc.exitCode !== null) throw Error(`cloudflared exited (${proc.exitCode}): ${text.slice(-800)}`);
    if (url && connected) {
      try { const r=await fetch(url+'/health', { signal: AbortSignal.timeout(4000) }); if (r.ok) return {proc,url,negotiatedProtocol:connected}; } catch {}
    }
    await sleep(500);
  }
  throw Error(`Tunnel did not become reachable: ${text.slice(-1200)}`);
}

async function measure(base, label, round, negotiatedProtocol) {
  const clients=[]; const rtts=[]; const ages=[]; const errors=[];
  let applicationCompressedFrames=0; let disconnected=0; let frames=0; let finished=false; let sampling=false; let compressed=true;
  const probeTimers=[];
  try {
    for(let n=0;n<4;n++) {
      const ws=new WebSocket(base.replace(/^http/,'ws')+'/ws', {perMessageDeflate:true,handshakeTimeout:15000});
      const c={ws,pending:new Map(),next:0,initialBytes:0,lastStateAt:0}; clients.push(c); activeClients.add(ws);
      ws.on('error', e => errors.push(e.message));
      ws.on('close',()=>{if(!finished)disconnected++;activeClients.delete(ws);});
      ws.on('message', raw=>{
        if(raw.subarray(0,4).toString()==='CDC1'){raw=inflateRawSync(raw.subarray(4));if(sampling)applicationCompressedFrames++;}
        const f=JSON.parse(raw);
        if(f.t==='gameState') { c.lastStateAt=performance.now(); if(sampling){frames++;ages.push(Date.now()-f.d.now);} }
        if(f.t==='reply' && c.pending.has(f.id)) { const sent=c.pending.get(f.id); c.pending.delete(f.id); if(sampling)rtts.push(performance.now()-sent); }
      });
      await once(ws,'open');
      compressed &&= ws.extensions.includes('permessage-deflate');
      const welcome=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Authentication timed out')),10000);
        const listener=raw=>{const f=JSON.parse(raw);if(f.t==='welcome'){clearTimeout(timer);ws.off('message',listener);resolve();}else if(f.t==='error'){clearTimeout(timer);ws.off('message',listener);reject(Error(f.d));}};
        ws.on('message',listener);
      });
      ws.send(JSON.stringify({t:'auth',d:{username:`bench${n}`,password},features:['state-deflate-v1']}));await welcome;
      probeTimers.push(setInterval(()=>{if(ws.readyState!==WebSocket.OPEN)return;const id=++c.next;c.pending.set(id,performance.now());ws.send(JSON.stringify({t:'benchProbe',id}));},250));
      let step=0;probeTimers.push(setInterval(()=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({t:'move',a:[step++%2?'west':'east']}));},150));
    }
    await sleep(3000); // Exclude connection/authentication warmup.
    if(clients.some(c=>!c.lastStateAt))throw Error('A client received no game state');
    clients.forEach(c=>c.initialBytes=c.ws._socket.bytesRead);
    sampling=true; const began=performance.now();
    await sleep(duration); const elapsed=(performance.now()-began)/1000; sampling=false;
    const bytes=clients.reduce((n,c)=>n+c.ws._socket.bytesRead-c.initialBytes,0);
    const result={label,round,negotiatedProtocol,compression:compressed,applicationCompressedFrames,measuredSeconds:Math.round(elapsed*10)/10,rttMs:summary(rtts),snapshotAgeMs:summary(ages),snapshots:frames,snapshotsPerSecondPerPlayer:Math.round(frames/elapsed/4*10)/10,websocketBytesReceived:bytes,websocketKiBPerSecondAllPlayers:Math.round(bytes/elapsed/1024*10)/10,disconnects:disconnected,errors,clientStateSilenceMs:clients.map(c=>Math.round(performance.now()-c.lastStateAt))};
    console.log('TUNNEL_RESULT '+JSON.stringify(result));return result;
  } finally {
    finished=true;probeTimers.forEach(clearInterval);clients.forEach(c=>c.ws.terminate());
    await sleep(100);
  }
}

async function main() {
  const map=new Grid(20,20,400,1234);map.generateInitialRoom();const world=new World(map);world.stop();
  for(let n=0;n<4;n++)world.addPlayer({id:n+1,username:`bench${n}`,cls:'warrior',position_x:-1,position_y:-1});
  const server=http.createServer((q,r)=>{r.setHeader('content-type','application/json');r.end(JSON.stringify({diagnostic:true}));});
  createHub(server,{authenticate:({username,password:provided})=>provided===password&&/^bench[0-3]$/.test(username)?{id:Number(username.slice(5))+1}:null,onConnection:c=>{
    const player=world.players.get(c.user.id);c.emit('profile',world.profileFor(player));
    c.on('move',direction=>world.movePlayer(player,direction));
    c.on('benchProbe',reply=>{if(typeof reply==='function')reply({now:Date.now()});});
    const timer=setInterval(()=>c.sendState(()=>world.stateFor(player)),50);c.on('disconnect',()=>clearInterval(timer));
  }});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  try {
    report.results.push(await measure(`http://127.0.0.1:${port}`,'direct-local',1,'none'));
    for(const protocol of ['http2','auto']) {
      try {
        const tunnel=await startTunnel(port,protocol);
        console.log(`Tunnel ready: requested=${protocol}, negotiated=${tunnel.negotiatedProtocol}`);
        for(let round=1;round<=rounds;round++)report.results.push(await measure(tunnel.url,`cloudflare-${protocol}`,round,tunnel.negotiatedProtocol));
      } catch(e) {const result={label:`cloudflare-${protocol}`,error:String(e)};report.results.push(result);console.log('TUNNEL_RESULT '+JSON.stringify(result));}
      finally {await stopTunnel(activeTunnel);activeTunnel=null;}
    }
  } finally {
    await stopTunnel(activeTunnel);for(const ws of activeClients)ws.terminate();
    world.stop();await new Promise(r=>server.close(r));
    report.finished=new Date().toISOString();
    fs.writeFileSync(path.join(outDir,'results.json'),JSON.stringify(report,null,2));
    console.log('TUNNEL_REPORT '+JSON.stringify(report));
  }
  if(!report.results.some(r=>r.label.startsWith('cloudflare-')&&!r.error))process.exitCode=1;
}
process.on('SIGINT',()=>{activeTunnel?.kill();for(const ws of activeClients)ws.terminate();process.exit(130);});
main().catch(async e=>{console.error(e);await stopTunnel(activeTunnel);process.exitCode=1;});
