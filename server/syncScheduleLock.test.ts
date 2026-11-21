import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {acquireScheduleLease,acquireSyncSchedule,schedulingOwnerGone} from './syncScheduleLock.ts';
import {acquireRecordLock,RecordLocked} from './recordLock.ts';

async function fixture(){const root=await mkdtemp(path.join(os.tmpdir(),'aw-schedule-test-')),folder=path.join(root,'auto');await mkdir(folder);return {root,folder,target:path.join(folder,'reading-coordinator')};}

test('PID reuse is recoverable only with strictly newer process start evidence; uncertainty stays held',async()=>{
 const created=Date.now()-60000,owner={pid:process.pid,createdAt:new Date(created).toISOString()};
 assert.equal(await schedulingOwnerGone(owner,async()=>created+30000),true);
 assert.equal(await schedulingOwnerGone(owner,async()=>created-30000),false);
 assert.equal(await schedulingOwnerGone(owner,async()=>created+500),false);
 assert.equal(await schedulingOwnerGone(owner,async()=>NaN),false);
 assert.equal(await schedulingOwnerGone(owner,async()=>{throw Error('Access denied');}),false);
});

test('native scheduling lease excludes another process and releases normally',async()=>{
 const f=await fixture(),release=await acquireScheduleLease(f.target);
 try{await assert.rejects(acquireScheduleLease(f.target),RecordLocked);}finally{await release();}
 await(await acquireScheduleLease(f.target))();
 const inbox=path.join(f.folder,'reading-link-coordinator'),inboxRelease=await acquireScheduleLease(inbox);
 try{await assert.rejects(acquireScheduleLease(inbox),RecordLocked);}finally{await inboxRelease();}
 const transfer=path.join(f.folder,'transfer-coordinator'),transferRelease=await acquireScheduleLease(transfer);
 try{await assert.rejects(acquireScheduleLease(transfer),RecordLocked);}finally{await transferRelease();}
 await assert.rejects(acquireScheduleLease(path.join(f.folder,'workbench')),/Only Aw scheduling/);
});

test('live and damaged legacy scheduling owners stay held; generic data locks are unchanged',async()=>{
 const f=await fixture(),release=await acquireRecordLock(f.target,0),original=await readFile(f.target+'.aw-lock');
 try{await assert.rejects(acquireSyncSchedule(f.target),/still running/);assert.deepEqual(await readFile(f.target+'.aw-lock'),original);}finally{await release();}
 await writeFile(f.target+'.aw-lock','invalid');
 await assert.rejects(acquireSyncSchedule(f.target),/JSON/);assert.equal(await readFile(f.target+'.aw-lock','utf8'),'invalid');
 const data=path.join(f.root,'workbench.json');await writeFile(data+'.aw-lock',JSON.stringify({pid:2147483647,token:'dead',createdAt:new Date().toISOString()}));
 await assert.rejects(acquireRecordLock(data,0),RecordLocked);assert.ok(await readFile(data+'.aw-lock'));
});

for(const cycle of [false,true])test(`a crashed ${cycle?'project cycle':'coordinator'} releases the native lease and archives its exact marker before retry`,async()=>{
 const f=await fixture(),module=new URL('./syncScheduleLock.ts',import.meta.url).href;
 if(cycle){f.folder=path.join(f.folder,'example-project');await mkdir(f.folder);f.target=path.join(f.folder,'cycle');}
 const code=`import {acquireSyncSchedule} from ${JSON.stringify(module)}; await acquireSyncSchedule(${JSON.stringify(f.target)}); process.stdout.write('READY\\n');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const stderr:Buffer[]=[];child.stderr.on('data',b=>stderr.push(b));
 try{
  await new Promise<void>((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Fixture failed: '+Buffer.concat(stderr))),12000);child.stdout.on('data',b=>{data+=b;if(data.includes('READY')){clearTimeout(timer);resolve();}});child.once('error',e=>{clearTimeout(timer);reject(e);});});
  const original=await readFile(f.target+'.aw-lock'),ended=once(child,'exit');child.kill();await ended;
  let release:(()=>Promise<void>)|undefined;
  for(let tries=0;tries<30;tries++){try{release=await acquireSyncSchedule(f.target);break;}catch(error){if(!(error instanceof RecordLocked))throw error;await new Promise(r=>setTimeout(r,100));}}
  assert.ok(release,'Crashed owner must not strand the scheduling slot');
  try{const archives=(await readdir(f.folder)).filter(name=>name.includes('.recovered-'));assert.equal(archives.length,1);assert.deepEqual(await readFile(path.join(f.folder,archives[0])),original);await assert.rejects(acquireSyncSchedule(f.target),RecordLocked);}finally{await release();}
 }finally{child.kill();}
});
