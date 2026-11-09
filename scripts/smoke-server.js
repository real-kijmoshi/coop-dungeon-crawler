// Verify the packaged launcher starts and serves a usable status endpoint.
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
(async () => {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'start-server.js')], {
    cwd: require('node:os').tmpdir(), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; let exited = false;
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  child.on('exit', () => { exited = true; });
  try {
    const deadline = Date.now() + 180000;
    while (true) {
      if (exited) throw Error('Launcher exited before readiness');
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/status`);
        const s = await r.json();
        if (!r.ok || s.name !== 'coop-dungeon-crawler' || !Array.isArray(s.online)) throw Error('Bad status');
        const home = await fetch(`http://127.0.0.1:${port}/`);
        if (!home.ok || !(await home.text()).includes('Coop Dungeon')) throw Error('Bad landing page');
        console.log('Launcher smoke test passed: starts from another directory, status API and landing page respond.');
        break;
      } catch (e) {
        if (Date.now() > deadline) throw e;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } catch(e) { console.error(output); console.error(e); process.exitCode = 1; }
  finally {
    if (process.platform === 'win32') require('node:child_process').spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else { child.kill('SIGTERM'); }
  }
})();
