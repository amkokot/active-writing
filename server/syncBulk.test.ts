import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile,lstat,open,symlink} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createReadStream} from 'node:fs';
import {createPaperProject} from './projectFiles.ts';
import {getProject} from './projects.ts';
import {initializeSyncDevice,readSyncSnapshot,captureSyncSnapshot} from './deviceSync.ts';
import {sourceEntries} from './sourceZip.ts';
import {enableBulkSync,captureBulkRecords,trackedCompiledPdf} from './syncBulkCapture.ts';
import {syncWorkingCheckpoint,exportSyncExchange,createSyncInventory,receiveSyncExchange} from './syncExchange.ts';
import {verifyBlob,streamedHash,receiveBlob,materializeBlob,captureBlob} from './syncBlobs.ts';
import {previewSyncClone,commitSyncClone} from './syncClone.ts';
import {BlobReader,sendBlobs,readBlobs} from './syncBlobWire.ts';
import {PassThrough} from 'node:stream';
import {previewStagedSync,stageSyncSnapshot} from './syncStaging.ts';
import {makeSnapshot,canonicalHash,canonical,syncHash,validateSyncJson} from './syncProtocol.ts';
import {writeNotebook} from './notebookStore.ts';
import {newExperimentNotebook} from '../src/experiments.ts';
import {writeExperiments,readExperiments} from './experiments.ts';
import {previewResearchMerge,commitResearchMerge} from './syncResearchMerge.ts';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stagedHistory} from './syncStaging.ts';
import {boundedSyncReads} from './syncReads.ts';

test('absent compiled PDF skips unrelated historical manifest enumeration',async()=>{
 const home=await mkdtemp(path.join(process.cwd(),'.paperfocus/trials/pdf-track-')),p=await createPaperProject(home,'PDF tracking');
 const dir=path.join(home,'.paperfocus/device-sync/staged',p.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'a'.repeat(64)+'.json'),'deliberately invalid unrelated history');
 assert.equal(await trackedCompiledPdf(home,p.id,'not-built.tex'),false);
});

test('bounded verification preserves order and settles in-flight reads before reporting failure',async()=>{
 let active=0,peak=0;const values=await boundedSyncReads([0,1,2,3,4,5,6],async n=>{active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>setImmediate(resolve));active--;return n*2;});
 assert.deepEqual(values,[0,2,4,6,8,10,12]);assert.equal(peak,4);assert.equal(active,0);
 const started:number[]=[];await assert.rejects(boundedSyncReads([0,1,2,3,4,5],async n=>{started.push(n);active++;try{if(n===0)throw new Error('fixture verification failure');await new Promise<void>(resolve=>setImmediate(resolve));}finally{active--;}}),/fixture verification failure/);
 assert.equal(active,0);assert.ok(started.every(n=>n<4));
});

test('research category names do not bypass prototype-chain guards',()=>{
 assert.doesNotThrow(()=>validateSyncJson({outputs:[{data:{'application/json':[{prototype:'pilot A'}]}}]}));
 for(const value of ['{"prototype":{"polluted":true}}','{"__proto__":"bad"}','{"constructor":"bad"}'])assert.throws(()=>validateSyncJson(JSON.parse(value)),/Unsafe sync record key/);
 assert.equal(({} as Record<string,unknown>).polluted,undefined);
});

async function fixture(bulk=true){const parent=path.join(process.cwd(),'.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'bulk-sync-'));const project=await createPaperProject(home,'Bulk evidence fixture');await initializeSyncDevice(home,'Laptop');if(bulk)await enableBulkSync(home,project.id);const root=(await getProject(home,project.id)).root;return {home,project,root};}
async function large(file:string,mb=26){const f=await open(file,'wx');try{const chunk=Buffer.alloc(256*1024,73);for(let i=0;i<mb*4;i++)await f.write(chunk);}finally{await f.close();}}

test('checked PDF assets stay in sync after a host changes its main file; source ZIP still omits the compiled PDF',async()=>{
 for(const bulk of [true,false]){
  const f=await fixture(bulk),pdf=Buffer.from('%PDF-1.4 synthetic retained asset');await writeFile(path.join(f.root,'overview.tex'),'\\documentclass{article}\n\\begin{document}Notes\\end{document}');await writeFile(path.join(f.root,'overview.pdf'),pdf);
  const before=await captureSyncSnapshot(f.home,f.project.id);assert.ok(before.records.some(r=>r.path==='source/overview.pdf'));await stageSyncSnapshot(f.home,f.project.id,before);
  const registryPath=path.join(f.home,'.paperfocus/projects.json'),registry=JSON.parse(await readFile(registryPath,'utf8'));registry.projects.find(p=>p.id===f.project.id).mainFile='overview.tex';await writeFile(registryPath,JSON.stringify(registry));
  const after=await captureSyncSnapshot(f.home,f.project.id);assert.equal(after.records.find(r=>r.path==='source/overview.pdf')?.sha256,syncHash(pdf));assert.equal((await sourceEntries(f.home,f.project.id)).some(f=>f.name==='overview.pdf'),false);
  const changed=Buffer.from('%PDF-1.4 updated synthetic bytes');await writeFile(path.join(f.root,'overview.pdf'),changed);assert.equal((await captureSyncSnapshot(f.home,f.project.id)).records.find(r=>r.path==='source/overview.pdf')?.sha256,syncHash(changed));
 }
});

test('late research links fail before evidence capture and identify the exact path',async()=>{
 const f=await fixture(),{projectStorage}=await import('./projectStorage.ts'),data=(await projectStorage(f.home,f.project.id)).folder;
 const research=path.join(data,'research');await mkdir(research,{recursive:true});
 await writeFile(path.join(research,'first.npz'),'saved experiment evidence');
 const target=path.join(f.home,'linked-target');await mkdir(target);await writeFile(path.join(target,'keep.txt'),'preserved');
 await symlink(target,path.join(research,'late-link'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(captureBulkRecords(f.home,f.project.id),/Linked research path "data\/research\/late-link"; not followed/);
 await assert.rejects(lstat(path.join(f.home,'.paperfocus/device-sync/blobs')),/ENOENT/);
 await assert.rejects(lstat(path.join(f.home,`.paperfocus/device-sync/bulk/${f.project.id}/fingerprints.json`)),/ENOENT/);
 assert.equal((await lstat(path.join(research,'late-link'))).isSymbolicLink(),true);
 assert.equal(await readFile(path.join(target,'keep.txt'),'utf8'),'preserved');
});
test('streaming canonical hashes preserve all existing IDs, Unicode and exact formatting rules',()=>{
 for(const value of [null,undefined,[],{z:'𝛼\ud800',a:[1,true,null,{big:'abc'.repeat(100000)}]},Array.from({length:20000},(_,i)=>({id:i,text:'π '+i}))])assert.equal(canonicalHash(value),syncHash(canonical(value)));
});
test('enrolling old inline logs creates a thin descendant and exports them as streamed content',async()=>{
 const f=await fixture(false),{projectStorage}=await import('./projectStorage.ts'),data=(await projectStorage(f.home,f.project.id)).folder;await mkdir(path.join(data,'research'),{recursive:true});await writeFile(path.join(data,'research/archive.md'),'Historical context.\n'.repeat(100000));
 const before=await syncWorkingCheckpoint(f.home,f.project.id);await enableBulkSync(f.home,f.project.id);const after=await syncWorkingCheckpoint(f.home,f.project.id),packet=await readSyncSnapshot(after.path);assert.notEqual(before.id,after.id);assert.ok(packet.ancestors.includes(before.id));assert.equal(packet.records.find(r=>r.path==='data/research/archive.md')!.external,true);assert.ok((await lstat(after.path)).size<100000);
 const exported=await exportSyncExchange(f.home,f.project.id,after.id);assert.equal(exported.externalBlobs.length,1);assert.ok(exported.dataBytes<100000);
});
test('large first copy is a reference manifest; clone materializes and keeps an independent device',async()=>{
 const f=await fixture();await large(path.join(f.root,'evidence.npz'));
 const saved=await syncWorkingCheckpoint(f.home,f.project.id),snapshot=await readSyncSnapshot(saved.path);
 assert.equal(snapshot.version,2);const ref=snapshot.records.find(r=>r.path==='source/evidence.npz')!;assert.equal(ref.external,true);assert.equal(ref.data,'');assert.ok((await lstat(saved.path)).size<100000);
 const dest=path.join(f.home,'desktop'),options={destination:dest,mainFile:f.project.mainFile,label:'Desktop',blobHome:f.home};
 await assert.rejects(previewSyncClone(snapshot,{...options,blobHome:undefined}),/blob-home/);
 const preview=await previewSyncClone(snapshot,options);assert.deepEqual(preview.pending,[]);const cloned=await commitSyncClone(snapshot,options,preview.planId);
 assert.notEqual(cloned.deviceId,snapshot.device.id);assert.equal((await streamedHash(path.join(dest,'paper/evidence.npz'))).sha256,ref.sha256);
 // Only a TeX edit changes the following exchange. No unchanged evidence payload.
 await writeFile(path.join(f.root,f.project.mainFile),(await readFile(path.join(f.root,f.project.mainFile),'utf8')).replace('documentclass','documentclass'));
 const again=await syncWorkingCheckpoint(f.home,f.project.id);assert.equal(again.id,saved.id);
 const exported=await exportSyncExchange(f.home,f.project.id,again.id,await createSyncInventory(dest,f.project.id));assert.deepEqual(exported.externalBlobs,[]);assert.equal(exported.blobCount,0);assert.ok(exported.compressedBytes<5000);
});
test('partial and corrupt streams never publish a blob; a live-byte fence preserves edits',async()=>{
 const f=await fixture(),file=path.join(f.root,'input.bin');await writeFile(file,'original');const ref=await streamedHash(file);
 await assert.rejects(receiveBlob(f.home,ref,Readable.from([Buffer.from('short')])),/Incomplete|corrupt/);
 await assert.rejects(verifyBlob(f.home,ref),/ENOENT/);
 await receiveBlob(f.home,ref,createReadStream(file));await writeFile(path.join(f.root,'target.bin'),'human');
 await assert.rejects(materializeBlob(f.home,f.root,'target.bin',ref,''),/changed/);assert.equal(await readFile(path.join(f.root,'target.bin'),'utf8'),'human');
 const cached=await captureBlob(f.home,file);await writeFile(file,'modified');const changed=await captureBlob(f.home,file,cached);assert.notEqual(changed.sha256,cached.sha256);
});
test('stream framing preserves exact boundaries and rejects trailing data',async()=>{
 const f=await fixture(),other=await fixture();await writeFile(path.join(f.root,'a'),'abc');await writeFile(path.join(f.root,'b'),'defghi');
 const refs=[await captureBlob(f.home,path.join(f.root,'a')),await captureBlob(f.home,path.join(f.root,'b'))];
 const wire=new PassThrough({highWaterMark:2});const receive=readBlobs(other.home,refs,new BlobReader(wire));await sendBlobs(f.home,refs,wire);wire.end();await receive;
 for(const r of refs)assert.equal((await streamedHash(await verifyBlob(other.home,r))).sha256,r.sha256);
 await assert.rejects(readBlobs(other.home,[],new BlobReader(Readable.from([Buffer.from('extra')]))),/trailing/);
});
test('v2 independent source edits merge while a large unchanged asset stays referenced',async()=>{
 const f=await fixture();await large(path.join(f.root,'figure.pdf'));
 const source='\\documentclass{article}\n\\begin{document}\nFirst idea.\n\nContext.\n\nLast idea.\n\\end{document}\n';await writeFile(path.join(f.root,f.project.mainFile),source);
 const base=await syncWorkingCheckpoint(f.home,f.project.id),packet=await readSyncSnapshot(base.path),dest=path.join(f.home,'desktop'),options={destination:dest,mainFile:f.project.mainFile,label:'Desktop',blobHome:f.home};const p=await previewSyncClone(packet,options);await commitSyncClone(packet,options,p.planId);
 await writeFile(path.join(f.root,f.project.mainFile),source.replace('First idea.','Laptop idea.'));await writeFile(path.join(dest,'paper',f.project.mainFile),source.replace('Last idea.','Desktop idea.'));
 const local=await syncWorkingCheckpoint(f.home,f.project.id),remote=await syncWorkingCheckpoint(dest,f.project.id);
 const exchange=await exportSyncExchange(dest,f.project.id,remote.id,await createSyncInventory(f.home,f.project.id));assert.equal(exchange.externalBlobs.length,0);await receiveSyncExchange(f.home,f.project.id,exchange.bytes);
 const compare=await previewStagedSync(f.home,f.project.id,local.id,remote.id),plan=await previewResearchMerge(f.home,f.project.id,compare.id);assert.deepEqual(plan.held,[]);await commitResearchMerge(f.home,f.project.id,compare.id,plan.mergeId);
 const merged=await readFile(path.join(f.root,f.project.mainFile),'utf8');assert.match(merged,/Laptop idea/);assert.match(merged,/Desktop idea/);
});

test('notebooks stay lazy, identical-content owners keep their paths, and independent cells combine',async()=>{
 const f=await fixture(),stamp=new Date().toISOString();
 const entries=['one','two'].map(id=>({id,title:id,question:'Synthetic fixture',notes:'',reply:'',proposal:'',status:'open' as const,route:'codex' as const,effort:2,handoffs:[],appliedChanges:[],createdAt:stamp,updatedAt:stamp}));await writeNotebook(f.home,f.project.id,0,entries);
 const notebook={...newExperimentNotebook(),cells:[{id:'first',cell_type:'markdown' as const,source:'First',metadata:{}},{id:'last',cell_type:'markdown' as const,source:'Last',metadata:{}}]};
 for(const id of ['one','two'])await writeExperiments(f.home,f.project.id,id,'',notebook);
 const base=await syncWorkingCheckpoint(f.home,f.project.id),packet=await readSyncSnapshot(base.path);assert.ok(packet.records.filter(r=>r.kind==='experiment').every(r=>r.external&&r.semanticHash&&r.data===''));
 const bad=makeSnapshot(f.project.id,packet.device,packet.records.map(r=>r.kind==='experiment'?{...r,semanticHash:'0'.repeat(64)}:r),undefined,2);await assert.rejects(stageSyncSnapshot(f.home,f.project.id,bad),/semantic/);
 const dest=path.join(f.home,'desktop'),options={destination:dest,mainFile:f.project.mainFile,label:'Desktop',blobHome:f.home},p=await previewSyncClone(packet,options);await commitSyncClone(packet,options,p.planId);
 const localBook=await readExperiments(f.home,f.project.id,'one');localBook.notebook.cells[0].source='Laptop';await writeExperiments(f.home,f.project.id,'one',localBook.revision,localBook.notebook);
 const remoteBook=await readExperiments(dest,f.project.id,'one');remoteBook.notebook.cells[1].source='Desktop';await writeExperiments(dest,f.project.id,'one',remoteBook.revision,remoteBook.notebook);
 const local=await syncWorkingCheckpoint(f.home,f.project.id),remote=await syncWorkingCheckpoint(dest,f.project.id),exchange=await exportSyncExchange(dest,f.project.id,remote.id,await createSyncInventory(f.home,f.project.id));assert.equal(exchange.externalBlobs.length,1);
 for(const ref of exchange.externalBlobs)await receiveBlob(f.home,ref,createReadStream(await verifyBlob(dest,ref)));await receiveSyncExchange(f.home,f.project.id,exchange.bytes);
 const compare=await previewStagedSync(f.home,f.project.id,local.id,remote.id),plan=await previewResearchMerge(f.home,f.project.id,compare.id);assert.deepEqual(plan.held,[]);await commitResearchMerge(f.home,f.project.id,compare.id,plan.mergeId);
 const actual=await readExperiments(f.home,f.project.id,'one');assert.equal(actual.notebook.cells[0].source,'Laptop');assert.equal(actual.notebook.cells[1].source,'Desktop');assert.deepEqual((await readExperiments(f.home,f.project.id,'two')).notebook,notebook);
});

test('a first copy after earlier checkpoints stages full ancestry without resetting saved work',async()=>{
 const f=await fixture(),base=await syncWorkingCheckpoint(f.home,f.project.id),source=path.join(f.root,f.project.mainFile);await writeFile(source,(await readFile(source,'utf8')).replace('\\begin{document}','\\begin{document}\nNew note.'));
 const next=await syncWorkingCheckpoint(f.home,f.project.id),snapshot=await readSyncSnapshot(next.path),dest=path.join(f.home,'desktop'),options={destination:dest,mainFile:f.project.mainFile,label:'Desktop',blobHome:f.home};const preview=await previewSyncClone(snapshot,options);assert.deepEqual(preview.missingHistory,[base.id]);await commitSyncClone(snapshot,options,preview.planId);
 const index=path.join(path.dirname(next.path),'test-history.json');await writeFile(index,JSON.stringify({format:'aw-setup-history',version:2,projectId:f.project.id,ids:[base.id,next.id]}),{flag:'wx'});
 const exec=promisify(execFile),result=await exec(process.execPath,['scripts/awPair.ts','adopt-history','--workspace',dest,'--project',f.project.id,'--file',index,'--cache',f.home],{windowsHide:true,timeout:30000});assert.equal(JSON.parse(result.stdout).complete,true);
 const checked=await stagedHistory(dest,f.project.id,[next.id]);assert.deepEqual(checked.missing,[]);assert.deepEqual(checked.pending,[]);assert.match(await readFile(path.join(dest,'paper',f.project.mainFile),'utf8'),/New note/);
 await assert.rejects(exec(process.execPath,['scripts/awPair.ts','prepare','--unexpected','value'],{windowsHide:true}),/Unknown setup option/);
});
