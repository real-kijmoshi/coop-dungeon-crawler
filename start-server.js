#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const server = path.join(__dirname, 'server');
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Node.js 22 or newer is required. Install the current LTS from https://nodejs.org and try again.');
  process.exit(1);
}
const marker = path.join(server, 'node_modules', '.cdc-installed');
const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(server, 'package-lock.json')))
  .update(`${process.platform}/${process.arch}/${process.versions.modules}`).digest('hex');
let installed = false;
try { installed = fs.readFileSync(marker, 'utf8') === fingerprint && fs.existsSync(path.join(server, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')); } catch {}
if (!installed) {
  console.log('\nSetting up the server (first launch or dependency update)...\n');
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], { cwd: server, stdio: 'inherit' })
    : spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: server, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error('\nSetup failed. Install Node.js LTS (including npm) from https://nodejs.org, check your Internet connection, then retry.');
    if (result.error) console.error(result.error.message);
    process.exit(1);
  }
  fs.writeFileSync(marker, fingerprint);
}
console.log('\nStarting Coop Dungeon Crawler. Keep this window open; press Ctrl+C to stop.');
console.log('Your world and heroes stay in this extracted folder. Back it up before replacing it.\n');
const child = spawn(process.execPath, ['index.js'], { cwd: server, stdio: 'inherit', env: process.env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : (code ?? 1); });
