import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Readable} from 'node:stream';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {serveReadingStream,readingStreamClient,readingFrames,readingFrameLimit,watchReadingFiles} from './syncReadingStream.ts';
import {createPaperProject} from './projectFiles.ts';
import {getProject} from './projects.ts';
import {initializeSyncDevice,syncStatus} from './deviceSync.ts';
import {projectDataPath} from './projectStorage.ts';

async function fixture(){
 const home=await mkdtemp(path.join(os.tmpdir(),'aw-reading-stream-')),project=await createPaperProject(home,'Stream fixture');await initializeSyncDevice(home,'Stream device');
 return {home,id:project.id,root:(await getProject(home,project.id)).root,device:(await syncStatus(home)).device!.id};
}
test('one private stdio stream serves multiple guarded reading requests and refuses a different identity or general operation',async()=>{
 const f=await fixture(),requests=new PassThrough(),responses=new PassThrough();
 const server=serveReadingStream(f.home,f.id,requests,responses,false),client=readingStreamClient(responses,requests);
 const ask=async(extra:object)=>JSON.parse((await client.request(Buffer.from(JSON.stringify({version:1,expectedDeviceId:f.device,maxBytes:16*1024**2,...extra})),readingFrameLimit,3000)).toString());
 try{
  const first=await ask({action:'reading-inventory',fastOnly:true});assert.ok(first.inventory.items.every((i:any)=>i.key==='comments'||i.key.startsWith('source/')));
  await writeFile(path.join(f.root,'new.tex'),'New source');const next=await ask({action:'reading-inventory',fastOnly:true});
  const item=next.inventory.items.find((i:any)=>i.key==='source/new.tex');assert.ok(item);const packet=await ask({action:'reading-get',item});assert.equal(Buffer.from(packet.packet.data,'base64').toString(),'New source');
  await assert.rejects(ask({action:'reading-inventory',expectedDeviceId:'foreign'}),/Invalid scoped/);
  await assert.rejects(ask({action:'inventory'}),/Only reading records/);
  assert.equal((await ask({action:'reading-inventory',fastOnly:true})).liveImport,false);
 }finally{requests.end();await server;responses.end();await client.done;}
});
test('events are separate from replies; disconnects reject an in-flight request without retry',async()=>{
 const input=new PassThrough(),output=new PassThrough();let changed=0;const client=readingStreamClient(input,output,()=>changed++);
 const data=Buffer.from(JSON.stringify({action:'reading-inventory'})),pending=client.request(data,1000,3000);
 input.write(JSON.stringify({event:'changed'})+'\n');input.write(JSON.stringify({id:1,reply:{ok:true}})+'\n');assert.deepEqual(JSON.parse((await pending).toString()),{ok:true});assert.equal(changed,1);
 const next=client.request(data,1000,3000);input.end();await assert.rejects(next,/Connection closed/);await client.done;await assert.rejects(client.request(data,1000,3000),/Connection closed/);
});
test('stream frames reject oversize and truncated data; bounded server errors do not poison later requests',async()=>{
 await assert.rejects(async()=>{for await(const _ of readingFrames(Readable.from([Buffer.alloc(readingFrameLimit+1,65)]))){}},/budget/);
 await assert.rejects(async()=>{for await(const _ of readingFrames(Readable.from(['{"id":1}']))){}},/Incomplete/);
 const input=new PassThrough(),output=new PassThrough(),client=readingStreamClient(input,output);
 const pending=client.request(Buffer.from('{"action":"reading-inventory"}'),10,3000);input.write(JSON.stringify({id:1,reply:{oversized:'long payload'}})+'\n');await assert.rejects(pending,/budget/);input.end();await client.done;
});
test('source saves and comment-store replacements emit debounced events without watching notebook output trees',async()=>{
 const f=await fixture();let count=0;const close=await watchReadingFiles(f.home,f.id,()=>count++);
 try{
  await writeFile(path.join(f.root,'main.tex'),'First save');await writeFile(path.join(f.root,'main.tex'),'Settled save');
  await new Promise(r=>setTimeout(r,500));assert.equal(count,1);
  await writeFile(path.join(projectDataPath(f.home,f.id),'irrelevant.json'),'{}');await new Promise(r=>setTimeout(r,400));assert.equal(count,1);
  await writeFile(path.join(projectDataPath(f.home,f.id),'workbench.json'),'{}');await new Promise(r=>setTimeout(r,500));assert.equal(count,2);
 }finally{close();}
});
import {withLiveReadingSlot} from './syncLive.ts';

test('one pool queues local fast passes fairly instead of repeatedly probing shared filesystem locks',async()=>{
 let active=0,maximum=0;const order:number[]=[];
 await Promise.all(Array.from({length:12},(_,index)=>withLiveReadingSlot('test-home',async()=>{
  active++;maximum=Math.max(maximum,active);order.push(index);
  await new Promise(resolve=>setTimeout(resolve,1));active--;if(index===4)throw Error('single pass failed');
 })).map(run=>run.catch(error=>assert.match(error.message,/single pass/))));
 assert.equal(maximum,1);assert.deepEqual(order,Array.from({length:12},(_,index)=>index));
 assert.equal(await withLiveReadingSlot('test-home',async()=>42),42,'Failed passes must release the slot');
});
import {sshConnectTimeout} from './syncSsh.ts';

test('slow-link handshakes have room to connect without exceeding the exchange budget',()=>{
 assert.equal(sshConnectTimeout(),'ConnectTimeout=30');
 assert.equal(sshConnectTimeout(120000),'ConnectTimeout=30');
 assert.equal(sshConnectTimeout(5500),'ConnectTimeout=5');
 assert.equal(sshConnectTimeout(1000),'ConnectTimeout=1');
 for(const invalid of [0,999,NaN,Infinity])assert.throws(()=>sshConnectTimeout(invalid),/bounded/);
});
