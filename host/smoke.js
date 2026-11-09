// Exercise the packaged Windows host, real TLS/WebSocket proxy, firewall rule,
// save persistence and child-process cleanup without opening a public tunnel.
const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const https=require('node:https');
const {createHash,X509Certificate}=require('node:crypto');const {once}=require('node:events');const {inflateRawSync}=require('node:zlib');
const {WebSocket}=require('../server/node_modules/ws');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=fs.mkdtempSync(path.join(os.tmpdir(),"cdc host's test-"));
const exe=path.resolve('client/dist/cdc-host-windows-amd64.exe');const children=new Set();let port;
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function httpsJSON(route,method='GET',body){return new Promise((resolve,reject)=>{
 const ca=fs.readFileSync(path.join(root,'tls','host-cert.pem'));
 const req=https.request({hostname:'127.0.0.1',port,path:route,method,ca,timeout:2500,headers:{'content-type':'application/json'}},res=>{let data='';res.on('data',b=>data+=b);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data)})}catch(e){reject(e)}})});
 req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTPS timeout')));if(body)req.write(JSON.stringify(body));req.end();
});}
function launch(args){const p=spawn(exe,[...args,'--port',String(port),'--data-dir',root],{stdio:['pipe','pipe','pipe']});children.add(p);p.output='';p.stdout.on('data',b=>p.output+=b);p.stderr.on('data',b=>p.output+=b);p.on('exit',()=>children.delete(p));return p;}
async function start(direct=false){
 const p=launch(direct?['--direct','--no-upnp','--no-fallback','--public-ip','203.0.113.1']:['--local']);
 for(let i=0;i<180;i++){
  if(p.exitCode!==null)throw Error('Host exited: '+p.output);
  try{const ok=direct?(await httpsJSON('/api/status')).status===200:(await fetch(`http://127.0.0.1:${port}/api/status`)).ok;if(ok)return p;}catch{}
  await sleep(500);
 }
 p.kill();throw Error('Host startup timed out: '+p.output);
}
async function stop(p){const done=once(p,'exit');p.stdin.write('\n');const [code]=await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('stop timeout: '+p.output)),15000).unref())]);if(code!==0)throw Error('Host exit '+code+': '+p.output);}
function ps(script,vars={}){return execFileSync(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,...vars},timeout:30000});}
async function websocketCheck(){
 const ca=fs.readFileSync(path.join(root,'tls','host-cert.pem'));const ws=new WebSocket(`wss://127.0.0.1:${port}/ws`,{ca});let binaryStates=0;const frames=[];
 ws.on('message',(raw,binary)=>{if(binary){if(raw.subarray(0,4).toString()!=='CDC1')throw Error('bad binary frame');raw=inflateRawSync(raw.subarray(4));binaryStates++;}frames.push(JSON.parse(raw));});
 ws.on('error',()=>{});await once(ws,'open');ws.send(JSON.stringify({t:'auth',d:{username:'hosttest',password:'temporary-test-password'},features:['state-deflate-v1']}));
 const deadline=Date.now()+8000;while(!frames.some(f=>f.t==='welcome')&&Date.now()<deadline)await sleep(10);
 if(!frames.some(f=>f.t==='welcome'))throw Error('TLS WebSocket authentication failed');
 ws.send(JSON.stringify({t:'chooseClass',a:['warrior'],id:1}));
 while(!binaryStates&&Date.now()<deadline)await sleep(10);
 if(!binaryStates)throw Error('No compressed game state through direct TLS proxy');ws.close();await once(ws,'close');
}
(async()=>{
 port=await freePort();let p=await start();
 let r=await fetch(`http://127.0.0.1:${port}/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'hosttest',password:'temporary-test-password'})});if(r.status!==201)throw Error('registration failed');await stop(p);
 if(!fs.existsSync(path.join(root,'saves','map.json'))||!fs.existsSync(path.join(root,'saves','users.db')))throw Error('missing saved files');
 p=await start(true);await sleep(300);
 const cert=new X509Certificate(fs.readFileSync(path.join(root,'tls','host-cert.pem')));const pin=createHash('sha256').update(cert.publicKey.export({type:'spki',format:'der'})).digest('hex');
 if(!p.output.includes(`https://203.0.113.1:${port}/#key=${pin}`)||!p.output.includes('NOT independently verified'))throw Error('Bad direct invite/status: '+p.output);
 if((await httpsJSON('/login','POST',{username:'hosttest',password:'temporary-test-password'})).status!==200)throw Error('direct login did not preserve account');
 await websocketCheck();
 const rootHash=createHash('sha256').update(path.normalize(root).toLowerCase()).digest('hex').slice(0,12);const name=`CoopDungeonHost-direct-${rootHash}-${port}`;
 const rule=JSON.parse(ps("$ErrorActionPreference='Stop';$r=Get-NetFirewallRule -Name $env:CDC_RULE;$a=$r|Get-NetFirewallAddressFilter;$p=$r|Get-NetFirewallPortFilter;$e=$r|Get-NetFirewallApplicationFilter;[pscustomobject]@{Profile=[int]$r.Profile;Address=$a.RemoteAddress;Port=$p.LocalPort;Program=$e.Program;Enabled=$r.Enabled.ToString()}|ConvertTo-Json -Compress",{CDC_RULE:name}));
 if(rule.Profile!==6||String(rule.Address)!=='Any'||String(rule.Port)!==String(port)||rule.Program.toLowerCase()!==exe.toLowerCase()||rule.Enabled!=='True')throw Error('Firewall rule is not restricted to the intended app/port/profiles: '+JSON.stringify(rule));
 const otherPort=await freePort();const duplicate=spawn(exe,['--local','--port',String(otherPort),'--data-dir',root],{stdio:['ignore','pipe','pipe']});children.add(duplicate);duplicate.on('exit',()=>children.delete(duplicate));let duplicateOutput='';duplicate.stderr.on('data',b=>duplicateOutput+=b);const [duplicateCode]=await Promise.race([once(duplicate,'exit'),sleep(5000).then(()=>{duplicate.kill();throw Error('Concurrent host did not reject the save folder')})]);if(duplicateCode===0||!duplicateOutput.includes('save folder'))throw Error('Concurrent save folder was not rejected');
 await stop(p);p=await start(true);
 const restarted=new X509Certificate(fs.readFileSync(path.join(root,'tls','host-cert.pem')));if(createHash('sha256').update(restarted.publicKey.export({type:'spki',format:'der'})).digest('hex')!==pin)throw Error('TLS identity changed on restart');await stop(p);
 // Simulate closing the launcher window: its Job Object must kill Node too.
 p=await start();const exited=once(p,'exit');p.kill();await exited;await sleep(500);
 let stillServing=false;try{stillServing=(await fetch(`http://127.0.0.1:${port}/api/status`,{signal:AbortSignal.timeout(1500)})).ok;}catch{}
 if(stillServing)throw Error('Backend survived closing the host process');
 console.log('Packaged host passed: local and direct HTTPS, real compressed WebSocket, persistent heroes/key, scoped Windows firewall, exclusive saves and crash child cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 for(const p of children)p.kill();
 if(port){try{execFileSync(exe,['--direct','--remove-firewall','--port',String(port),'--data-dir',root],{timeout:45000,stdio:'pipe'});}catch(e){console.error('Firewall test cleanup failed:',e.message);process.exitCode=1;}}
 await sleep(300);fs.rmSync(root,{recursive:true,force:true});
});
