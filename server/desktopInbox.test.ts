import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {scanInbox,transferInboxBatch} from './desktopInbox.ts';
import {desktopServer} from '../scripts/desktopServer.mjs';
const config={version:1 as const,enabled:true,host:'approved',remoteRoot:'/approved',remoteFolder:'references/inbox'};
async function fixture(){const home=await mkdtemp(path.join(tmpdir(),'aw-file-inbox-')),inbox=path.join(home,'Desktop inbox');await mkdir(inbox);return {home,inbox};}
test('verified transfer clears the pending inbox and keeps exact recovery bytes and receipts',async()=>{
 const f=await fixture();await mkdir(f.inbox+'/slides');await writeFile(f.inbox+'/slides/talk.pdf','synthetic slide file');const scan=await scanInbox(f.inbox);
 const results=await transferInboxBatch(f.home,f.inbox,config,scan.files,'trial',async(c,file,name,h)=>({path:c.remoteRoot+'/'+c.remoteFolder+'/'+name,...h}));
 assert.equal(results[0].status,'sent');assert.equal((await scanInbox(f.inbox)).files.length,0);assert.equal(await readFile(results[0].recoveryPath!,'utf8'),'synthetic slide file');assert.match(results[0].remotePath!,/slides\/talk.pdf$/);
});
test('disconnects and bad desktop checksums leave the original pending',async()=>{
 for(const fail of ['disconnect','bad-hash']){const f=await fixture();await writeFile(f.inbox+'/note.txt','human file');const scan=await scanInbox(f.inbox);
  const r=await transferInboxBatch(f.home,f.inbox,config,scan.files,'trial',async(_c,_f,_n,h)=>{if(fail==='disconnect')throw Error('VPN disconnected');return {path:'/approved/references/inbox/note.txt',...h,sha256:'bad'};});
  assert.equal(r[0].status,'pending');assert.equal(await readFile(f.inbox+'/note.txt','utf8'),'human file');
 }
});
test('editing or replacing a file during transfer keeps the new local version pending',async()=>{
 for(const replace of [false,true]){const f=await fixture();const file=f.inbox+'/note.txt';await writeFile(file,'old');const scan=await scanInbox(f.inbox);
  const r=await transferInboxBatch(f.home,f.inbox,config,scan.files,'trial',async(_c,_f,_n,h)=>{if(replace)await rename(file,f.home+'/original.txt');await writeFile(file,'newer human version');return {path:'/approved/references/inbox/note.txt',...h};});
  assert.equal(r[0].status,'pending');assert.equal(await readFile(file,'utf8'),'newer human version');assert.equal((await scanInbox(f.inbox)).files.length,1);
 }
});
test('new arrivals during a batch are not cleared by that batch',async()=>{
 const f=await fixture();await writeFile(f.inbox+'/first.txt','first');const scan=await scanInbox(f.inbox);
 await transferInboxBatch(f.home,f.inbox,config,scan.files,'trial',async(_c,_f,_n,h)=>{await writeFile(f.inbox+'/second.txt','second');return {path:'/approved/references/inbox/first.txt',...h};});
 assert.deepEqual((await scanInbox(f.inbox)).files.map(f=>f.path),['second.txt']);
});
test('the inbox API reports pending files and refuses a cross-origin send',async()=>{
 const f=await fixture();await mkdir(f.home+'/.paperfocus/device-sync',{recursive:true});await writeFile(f.home+'/.paperfocus/device-sync/transfer-inbox.json',JSON.stringify(config));await writeFile(f.inbox+'/pending.txt','not sent');
 const server=desktopServer(f.home);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 try{const status=await fetch(base+'/api/paperfocus/desktop-inbox').then(r=>r.json());assert.equal(status.configured,true);assert.equal(status.files[0].path,'pending.txt');const denied=await fetch(base+'/api/paperfocus/desktop-inbox',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify({action:'send',configHash:status.configHash})});assert.equal(denied.status,403);assert.equal(await readFile(f.inbox+'/pending.txt','utf8'),'not sent');}
 finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
