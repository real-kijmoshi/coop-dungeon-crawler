// Exercise the actual packaged executable without publishing a public tunnel.
const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cdc-host-'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const exe=path.resolve('client/dist/cdc-host-windows-amd64.exe');
 async function start(){const p=spawn(exe,['--local','--port',String(port),'--data-dir',root],{stdio:['pipe','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);let exited=false;p.on('exit',()=>exited=true);
 for(let i=0;i<120;i++){if(exited)throw Error(output);try{const r=await fetch(`http://127.0.0.1:${port}/api/status`);if(r.ok)return p;}catch{}await new Promise(r=>setTimeout(r,500));}p.kill();throw Error('Timeout: '+output);}
 async function stop(p){const finished=new Promise(r=>p.once('exit',r));p.stdin.write('\n');const code=await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(Error('stop timeout')),15000).unref())]);if(code!==0)throw Error('Host exit '+code);}
 const base=`http://127.0.0.1:${port}`;let p=await start();let r=await fetch(base+'/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'hosttest',password:'temporary-test-password'})});if(r.status!==201)throw Error('registration failed');await stop(p);
 if(!fs.existsSync(path.join(root,'saves','map.json'))||!fs.existsSync(path.join(root,'saves','users.db')))throw Error('missing saved files');
 p=await start();r=await fetch(base+'/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'hosttest',password:'temporary-test-password'})});if(!r.ok)throw Error('account did not persist');await stop(p);console.log('Bundled host: runtime extraction, API, graceful stop and account persistence passed.');
})().catch(e=>{console.error(e);process.exit(1)});
