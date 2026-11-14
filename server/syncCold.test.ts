import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,lstat,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createReadStream} from 'node:fs';
import {createPaperProject} from './projectFiles.ts';
import {projectStorage} from './projectStorage.ts';
import {getProject} from './projects.ts';
import {initializeSyncDevice,readSyncSnapshot,syncStatus} from './deviceSync.ts';
import {enableBulkSync} from './syncBulkCapture.ts';
import {syncWorkingCheckpoint,createSyncInventory,exportSyncExchange,receiveSyncExchange} from './syncExchange.ts';
import {previewSyncClone,commitSyncClone} from './syncClone.ts';
import {previewSshPeer,commitSshPeer,type SshRunner} from './syncSsh.ts';
import {planDesktopStorage,commitDesktopStorage,proveDesktopFiles,desktopFiles,fetchDesktopFile,deferIncomingArtifacts,verifyDesktopCopies} from './syncColdStore.ts';
import {verifyBlob,verifyStoredBlob,receiveBlob} from './syncBlobs.ts';
import {previewStagedSync} from './syncStaging.ts';
import {previewResearchMerge,commitResearchMerge} from './syncResearchMerge.ts';
import {configureSyncNetwork,syncNetworkAllowed,eligibleSyncNetwork} from './syncNetwork.ts';
import {coldEligible,coldClaim,coldAliasForTarget,coldProject} from './syncColdRefs.ts';
import {syncHash} from './syncProtocol.ts';
import {writeNotebook,readNotebook} from './notebookStore.ts';
import type {TestContext} from 'node:test';
async function fixture(t:TestContext){
 const home=await mkdtemp(path.join(os.tmpdir(),'aw-cold-test-'));t.after(async()=>{assert.equal(path.dirname(home),os.tmpdir());await rm(home,{recursive:true,force:true});});
 const project=await createPaperProject(home,'Synthetic desktop storage'),id=project.id,storage=await projectStorage(home,id);await mkdir(path.join(storage.folder,'research'),{recursive:true});const file=path.join(storage.folder,'research/data.npz');await writeFile(file,Buffer.alloc(2*1024**2,71));await initializeSyncDevice(home,'Laptop');await enableBulkSync(home,id);
 const base=await syncWorkingCheckpoint(home,id),snapshot=await readSyncSnapshot(base.path),desktop=path.join(home,'desktop'),o={destination:desktop,mainFile:project.mainFile,label:'Desktop',blobHome:home},p=await previewSyncClone(snapshot,o);await commitSyncClone(snapshot,o,p.planId);
 const opts={host:'synthetic-desktop',platform:'posix' as const,tool:'/opt/aw/scripts/awSync.ts',workspace:'/data/research',deviceId:(await syncStatus(desktop)).device!.id},peer=await previewSshPeer(home,id,opts);await commitSshPeer(home,id,opts,peer.id);
 const runner:SshRunner=async(_host,_command,input)=>{const r=JSON.parse(input.toString());return Buffer.from(JSON.stringify(await proveDesktopFiles(desktop,id,r.expectedDeviceId,r.records)));};
 return {home,id,project,file,base,snapshot,desktop,peer,runner};
}

test('alias lookup matches the exact destination without adopting unrelated missing files',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const data=(await projectStorage(f.home,f.id)).folder;
 assert.equal((await coldAliasForTarget(f.home,data,'research/data.npz'))?.record.path,'data/research/data.npz');
 assert.equal(await coldAliasForTarget(f.home,data,'research/another.npz'),undefined);
 const target=path.join(data,'research/data.npz'),elsewhere=path.join(data,'research/elsewhere');await mkdir(elsewhere);await (await import('node:fs/promises')).symlink(elsewhere,target,process.platform==='win32'?'junction':'dir');
 await assert.rejects(coldAliasForTarget(f.home,data,'research/data.npz'),/linked/);
});

test('cached validated indexes still reject external metadata changes',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const index=await coldProject(f.home,f.id);assert.equal(index.files.length,1);assert.ok(Object.isFrozen(index));assert.equal(await coldProject(f.home,f.id),index);
 const file=path.join(f.home,'.paperfocus/device-sync/cold/projects',f.id+'.json');await writeFile(file,JSON.stringify({...index,version:7}));
 await assert.rejects(coldProject(f.home,f.id),/Invalid desktop file index/);
});
test('offloading preserves source/notebooks/history and treats absence as availability, not deletion',async t=>{
 const f=await fixture(t),plan=await planDesktopStorage(f.home,f.id,f.peer.id);assert.equal(plan.files.length,1);const result=await commitDesktopStorage(f.home,f.id,plan.planId,f.runner);assert.equal(result.freedBytes,4*1024**2);await assert.rejects(lstat(f.file),/ENOENT/);
 const old=f.snapshot.records.find(r=>r.path==='data/research/data.npz')!;assert.equal((await verifyStoredBlob(f.home,old,f.id)).local,false);await assert.rejects(verifyBlob(f.home,old),/ENOENT/);
 const next=await syncWorkingCheckpoint(f.home,f.id),s=await readSyncSnapshot(next.path);assert.equal(next.id,f.base.id);assert.equal(s.tombstones.length,0);assert.equal(s.records.find(r=>r.path===old.path)?.sha256,old.sha256);
 const outgoing=await exportSyncExchange(f.desktop,f.id,f.base.id,await createSyncInventory(f.home,f.id));assert.deepEqual(outgoing.externalBlobs,[]);assert.equal((await desktopFiles(f.home,f.id)).files[0].resident,false);
});
test('failed desktop verification and stale source never evict local work',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await assert.rejects(commitDesktopStorage(f.home,f.id,p.planId,async()=>Buffer.from('{}')),/verification response/);assert.equal((await lstat(f.file)).size,2*1024**2);
 await writeFile(f.file,Buffer.alloc(2*1024**2,72));await assert.rejects(commitDesktopStorage(f.home,f.id,p.planId,f.runner),/changed since preview/);assert.equal((await readFile(f.file))[0],72);assert.equal((await desktopFiles(f.home,f.id)).files.length,0);
});
test('new desktop evidence stays remote through a guarded merge and explicit fetch restores exact pinned bytes',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const remoteData=(await projectStorage(f.desktop,f.id)).folder;await writeFile(path.join(remoteData,'research/data.npz'),Buffer.alloc(2*1024**2,83));const changed=await syncWorkingCheckpoint(f.desktop,f.id),remote=await readSyncSnapshot(changed.path);
 const exchange=await exportSyncExchange(f.desktop,f.id,changed.id,await createSyncInventory(f.home,f.id));assert.equal(exchange.externalBlobs.length,1);assert.deepEqual(await deferIncomingArtifacts(f.home,f.id,f.peer.id,exchange.bytes,exchange.externalBlobs,f.runner),[]);await receiveSyncExchange(f.home,f.id,exchange.bytes);
 const local=await syncWorkingCheckpoint(f.home,f.id),comp=await previewStagedSync(f.home,f.id,local.id,changed.id),merge=await previewResearchMerge(f.home,f.id,comp.id);assert.deepEqual(merge.held,[]);await commitResearchMerge(f.home,f.id,comp.id,merge.mergeId);await assert.rejects(lstat(f.file),/ENOENT/);
 const ref=remote.records.find(r=>r.path==='data/research/data.npz')!;assert.equal((await desktopFiles(f.home,f.id)).files[0].sha256,ref.sha256);
 await fetchDesktopFile(f.home,f.id,ref.path,{transfer:async(home,_id,_peer,refs)=>{for(const r of refs)await receiveBlob(home,r,createReadStream(await verifyBlob(f.desktop,r)));return {files:refs.length,bytes:refs.reduce((n,r)=>n+r.bytes,0)};}});
 assert.equal((await readFile(f.file))[0],83);assert.equal((await desktopFiles(f.home,f.id)).files[0].pinned,true);assert.equal((await planDesktopStorage(f.home,f.id,f.peer.id)).files.length,0);
 await writeFile(f.file,Buffer.from('A new local value.'));await assert.rejects(fetchDesktopFile(f.home,f.id,ref.path),/Local file differs/);assert.equal(await readFile(f.file,'utf8'),'A new local value.');
});
test('network gate requires campus/VPN and a reachable desktop route; ordinary text/figures never offload',async t=>{
 const f=await fixture(t),policy={version:1 as const,profiles:['aalto','eduroam'],vpnDescriptions:['Cisco AnyConnect'],host:'desktop.example.org',port:22};await configureSyncNetwork(f.home,policy);let connections=0;
 const off=await syncNetworkAllowed(f.home,{observe:async()=>({profiles:['Home'],vpnDescriptions:[]}),reachable:async()=>{connections++;return true;}});assert.equal(off.allowed,false);assert.equal(connections,0);
 assert.equal((await syncNetworkAllowed(f.home,{observe:async()=>({profiles:['aalto'],vpnDescriptions:[]}),reachable:async()=>false})).allowed,false);
 assert.equal((await syncNetworkAllowed(f.home,{observe:async()=>({profiles:['Home'],vpnDescriptions:['Cisco AnyConnect Adapter']}),reachable:async()=>true})).allowed,true);
 assert.equal(eligibleSyncNetwork(policy,{profiles:['Home'],vpnDescriptions:['Ethernet']}),false);
 for(const name of ['source/main.tex','data/research/readme.md','data/research/figure.pdf','data/experiments/owner/notebook.ipynb'])assert.equal(coldEligible({path:name,kind:'record',external:true,bytes:5000000,sha256:'a'.repeat(64),data:''}),false);
});

test('raw arrays and models stay desktop-backed even when small; reading files remain local',()=>{
 for(const bytes of [0,256,100000,1024**2])for(const ext of ['npz','npy','pt','pth','ckpt','parquet','h5','hdf5','pkl','zip','tar','gz'])assert.equal(coldEligible({path:`data/research/trial/input.${ext}`,kind:'record',external:true,bytes,sha256:'a'.repeat(64),data:''}),true);
 for(const name of ['summary.json','comparisons.csv','protocol.py','notes.tex','figure.png','reading.pdf','plot.svg','explanation.md','table.html','notebook.ipynb','small.results.json'])assert.equal(coldEligible({path:'data/research/'+name,kind:'record',external:true,bytes:1000,sha256:'a'.repeat(64),data:''}),false);
 assert.equal(coldEligible({path:'data/experiments/owner/runs/run.pt',kind:'run',external:true,bytes:1000,sha256:'a'.repeat(64),data:''}),false);
});

test('small arrays/model checkpoints retain exact virtual paths; fetch pins survive the new policy',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const remoteData=(await projectStorage(f.desktop,f.id)).folder;
 for(const name of ['tiny.npz','tiny.pt'])await writeFile(path.join(remoteData,'research',name),'small saved evidence');
 const head=await syncWorkingCheckpoint(f.desktop,f.id),exchange=await exportSyncExchange(f.desktop,f.id,head.id,await createSyncInventory(f.home,f.id));
 assert.deepEqual(await deferIncomingArtifacts(f.home,f.id,f.peer.id,exchange.bytes,exchange.externalBlobs,f.runner),[]);
 await receiveSyncExchange(f.home,f.id,exchange.bytes);const local=await syncWorkingCheckpoint(f.home,f.id),plan=await previewStagedSync(f.home,f.id,local.id,head.id),merge=await previewResearchMerge(f.home,f.id,plan.id);assert.deepEqual(merge.held,[]);
 await commitResearchMerge(f.home,f.id,plan.id,merge.mergeId);
 for(const name of ['tiny.npz','tiny.pt']){const saved=(await desktopFiles(f.home,f.id)).files.find(r=>r.path==='data/research/'+name)!;assert.ok(saved);assert.equal(saved.resident,false);}
 const name='data/research/tiny.pt';await fetchDesktopFile(f.home,f.id,name,{transfer:async(home,_id,_peer,refs)=>{for(const r of refs)await receiveBlob(home,r,createReadStream(await verifyBlob(f.desktop,r)));return {files:refs.length,bytes:refs.reduce((n,r)=>n+r.bytes,0)};}});
 const pin=(await desktopFiles(f.home,f.id)).files.find(r=>r.path===name)!;assert.equal(pin.pinned,true);assert.equal(pin.resident,true);
 assert.equal((await planDesktopStorage(f.home,f.id,f.peer.id)).files.some(r=>r.path===name),false);
 // Simulate a missing pinned copy. Knowing its cold hash is not permission to
 // leave a deliberately pinned file remote on the next exchange.
 await rm(path.join((await projectStorage(f.home,f.id)).folder,'research/tiny.pt'));
 await rm(await verifyBlob(f.home,pin));
 const same=await exportSyncExchange(f.desktop,f.id,head.id,await createSyncInventory(f.home,f.id));
 const required=await deferIncomingArtifacts(f.home,f.id,f.peer.id,same.bytes,same.externalBlobs,f.runner);assert.ok(required.some(r=>r.sha256===pin.sha256));
});

test('desktop proof batches retain verified progress but never publish a bad later batch',async t=>{
 const f=await fixture(t),records=Array.from({length:1001},(_,i)=>({path:`data/research/part-${i}.npz`,kind:'asset' as const,external:true as const,bytes:16,sha256:i.toString(16).padStart(64,'0'),data:''}));
 const sizes:number[]=[];await assert.rejects(verifyDesktopCopies(f.home,f.id,f.peer.id,records,async(_h,_c,input)=>{const value=JSON.parse(input.toString());sizes.push(value.records.length);return Buffer.from(JSON.stringify({version:1,projectId:f.id,deviceId:value.expectedDeviceId,verified:true,records:value.records.map((r:any)=>({path:r.path,sha256:r.sha256,bytes:r.bytes+(sizes.length===2?1:0)}))}));}),/verification response/);
 assert.deepEqual(sizes,[500,500]);
 assert.ok(await coldClaim(f.home,records[0],f.id,records[0].path));
 await assert.rejects(lstat(path.join(f.home,'.paperfocus/device-sync/cold/blobs',records[500].sha256+'.json')),/ENOENT/);
});

test('a newly referenced raw path needs proof even when its content hash is already known',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const data=(await projectStorage(f.desktop,f.id)).folder;await writeFile(path.join(data,'research/alias.npz'),Buffer.alloc(2*1024**2,71));
 const next=await syncWorkingCheckpoint(f.desktop,f.id),packet=await exportSyncExchange(f.desktop,f.id,next.id,await createSyncInventory(f.home,f.id));assert.equal(packet.externalBlobs.length,0);
 assert.deepEqual(await deferIncomingArtifacts(f.home,f.id,f.peer.id,packet.bytes,[],f.runner),[]);
 const record=(await readSyncSnapshot(next.path)).records.find(r=>r.path==='data/research/alias.npz')!;
 assert.ok(await coldClaim(f.home,record,f.id,record.path));await receiveSyncExchange(f.home,f.id,packet.bytes);
});

test('a new local pin invalidates an older offload plan without removing bytes',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 await writeFile(f.file,Buffer.alloc(2*1024**2,71));const beforePin=await planDesktopStorage(f.home,f.id,f.peer.id);assert.equal(beforePin.files.length,1);
 await fetchDesktopFile(f.home,f.id,'data/research/data.npz');
 await assert.rejects(commitDesktopStorage(f.home,f.id,beforePin.planId,f.runner),/pinned after/);assert.equal((await lstat(f.file)).size,2*1024**2);
});
test('a new reading figure sharing a cold hash is fetched even when the inventory already knows its bytes',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);const {root}=await getProject(f.desktop,f.id);await writeFile(path.join(root,'reading-figure.pdf'),Buffer.alloc(2*1024**2,71));const changed=await syncWorkingCheckpoint(f.desktop,f.id),exchange=await exportSyncExchange(f.desktop,f.id,changed.id,await createSyncInventory(f.home,f.id));assert.equal(exchange.externalBlobs.length,0);
 const required=await deferIncomingArtifacts(f.home,f.id,f.peer.id,exchange.bytes,[],f.runner);assert.equal(required.length,1);for(const r of required)await receiveBlob(f.home,r,createReadStream(await verifyBlob(f.desktop,r)));await receiveSyncExchange(f.home,f.id,exchange.bytes);
 const current=await syncWorkingCheckpoint(f.home,f.id),comparison=await previewStagedSync(f.home,f.id,current.id,changed.id),merge=await previewResearchMerge(f.home,f.id,comparison.id);assert.deepEqual(merge.held,[]);await commitResearchMerge(f.home,f.id,comparison.id,merge.mergeId);assert.equal((await lstat(path.join((await getProject(f.home,f.id)).root,'reading-figure.pdf'))).size,2*1024**2);
});

test('more than 300 raw references collect in one bounded index save without materializing files',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const data=(await projectStorage(f.desktop,f.id)).folder;await mkdir(path.join(data,'research/banks'));
 for(let i=0;i<305;i++)await writeFile(path.join(data,`research/banks/part-${i}.npz`),'synthetic raw input '+i);
 const next=await syncWorkingCheckpoint(f.desktop,f.id),packet=await exportSyncExchange(f.desktop,f.id,next.id,await createSyncInventory(f.home,f.id));
 assert.deepEqual(await deferIncomingArtifacts(f.home,f.id,f.peer.id,packet.bytes,packet.externalBlobs,f.runner),[]);await receiveSyncExchange(f.home,f.id,packet.bytes);
 const local=await syncWorkingCheckpoint(f.home,f.id),comparison=await previewStagedSync(f.home,f.id,local.id,next.id),merge=await previewResearchMerge(f.home,f.id,comparison.id);assert.equal(merge.complete,true);assert.equal(merge.changes.filter(c=>c.desktopBacked).length,305);
 const result=await commitResearchMerge(f.home,f.id,comparison.id,merge.mergeId);assert.equal(result.historyJoined,true);
 const files=await desktopFiles(f.home,f.id);assert.equal(files.files.length,306);assert.ok(files.files.every(r=>!r.resident));
 await assert.rejects(lstat(path.join((await projectStorage(f.home,f.id)).folder,'research/banks/part-0.npz')),/ENOENT/);
});

test('private helper payloads remain opaque archives with exact owner checks, not requests or answers',async t=>{
 const f=await fixture(t),p=await planDesktopStorage(f.home,f.id,f.peer.id);await commitDesktopStorage(f.home,f.id,p.planId,f.runner);
 const stamp='2026-10-23T00:00:00.000Z',entry={id:'question',title:'Synthetic owner',question:'Do not execute',notes:'',reply:'',proposal:'',status:'open' as const,route:'codex' as const,effort:2,handoffs:[],appliedChanges:[],createdAt:stamp,updatedAt:stamp};
 for(const home of [f.home,f.desktop])await writeNotebook(home,f.id,0,[entry]);
 const data=(await projectStorage(f.desktop,f.id)).folder,valid='delegate-request-11111111-1111-4111-8111-111111111111.json',foreign='delegate-request-22222222-2222-4222-8222-222222222222.json',legacy='delegate-request-33333333-3333-4333-8333-333333333333.json';
 for(const [name,project] of [[valid,f.id],[foreign,'different-project'],[legacy,f.id]])await writeFile(path.join(data,'research',name),JSON.stringify({version:1,task:'logs',instruction:name+' Rejected empty helper input; preserve only',context:[],owner:{project,entry:'question',notebook:'question'}}));
 const head=await syncWorkingCheckpoint(f.desktop,f.id),packet=await exportSyncExchange(f.desktop,f.id,head.id,await createSyncInventory(f.home,f.id));
 const required=await deferIncomingArtifacts(f.home,f.id,f.peer.id,packet.bytes,packet.externalBlobs,f.runner);assert.equal(required.length,3);
 for(const r of required)await receiveBlob(f.home,r,createReadStream(await verifyBlob(f.desktop,r)));await receiveSyncExchange(f.home,f.id,packet.bytes);
 // Older staged helpers have verified local bytes but no remote availability claim.
 const legacyHash=syncHash(await readFile(path.join(data,'research',legacy))),legacyRef=packet.externalBlobs.find(r=>r.sha256===legacyHash);assert.ok(legacyRef);
 await (await import('node:fs/promises')).unlink(path.join(f.home,'.paperfocus/device-sync/cold/blobs',legacyRef.sha256+'.json'));
 const local=await syncWorkingCheckpoint(f.home,f.id),comparison=await previewStagedSync(f.home,f.id,local.id,head.id),merge=await previewResearchMerge(f.home,f.id,comparison.id);
 assert.ok(merge.changes.some(c=>c.path==='data/research/'+valid&&c.desktopBacked));assert.ok(merge.held.some(c=>c.path==='data/research/'+foreign&&/owner/.test(c.reason)));
 assert.ok(merge.changes.some(c=>c.path==='data/research/'+legacy&&!c.desktopBacked));
 const done=await commitResearchMerge(f.home,f.id,comparison.id,merge.mergeId);assert.equal(done.historyJoined,false);assert.equal(done.tasksCompleted,false);assert.equal(done.codeExecuted,false);
 assert.equal((await readNotebook(f.home,f.id)).entries[0].reply,'');await assert.rejects(lstat(path.join((await projectStorage(f.home,f.id)).folder,'research',valid)),/ENOENT/);
 assert.deepEqual(await readFile(path.join((await projectStorage(f.home,f.id)).folder,'research',legacy)),await readFile(path.join(data,'research',legacy)));
});
