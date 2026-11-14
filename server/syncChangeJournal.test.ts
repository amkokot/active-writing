import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rename,unlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {getProject} from './projects.ts';
import {projectDataPath,projectStorage} from './projectStorage.ts';
import {initializeSyncDevice,captureSyncSnapshot} from './deviceSync.ts';
import {captureBulkRecordsFull,enableBulkSync} from './syncBulkCapture.ts';
import {startChangeJournal,captureJournalRecords,changeJournalStatus} from './syncChangeJournal.ts';
async function fixture(){
 const parent=path.join(process.cwd(),'.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'change-journal-'));
 const project=await createPaperProject(home,'Journal fixture'),id=project.id,root=(await getProject(home,id)).root;
 await initializeSyncDevice(home,'Journal device');await enableBulkSync(home,id);await projectStorage(home,id);await mkdir(path.join(projectDataPath(home,id),'research'),{recursive:true});
 let scans=0;const full=async()=>{scans++;return captureBulkRecordsFull(home,id);};
 const journal=await startChangeJournal(home,id);return {home,id,root,journal,full,scans:()=>scans};
}
const source=(records:any[],name:string)=>Buffer.from(records.find(r=>r.path===name)?.data??'','base64').toString();
test('steady captures inspect changed/new paths, preserve unrelated evidence and do not rescan trees',async()=>{
 const f=await fixture();try{
  await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),1);
  await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),1);
  await writeFile(path.join(f.root,'main.tex'),'Human edit');await writeFile(path.join(f.root,'new.tex'),'New passage');await writeFile(path.join(f.root,'remove.tex'),'Temporary note');
  const records=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),1);assert.equal(source(records,'source/main.tex'),'Human edit');assert.equal(source(records,'source/new.tex'),'New passage');
  await rename(path.join(f.root,'new.tex'),path.join(f.root,'renamed.tex'));await unlink(path.join(f.root,'remove.tex'));
  const next=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),1);assert.equal(source(next,'source/renamed.tex'),'New passage');assert.ok(!next.some(r=>r.path==='source/remove.tex'||r.path==='source/new.tex'));
  const status=await changeJournalStatus(f.home,f.id);assert.equal((status.capture as any).mode,'incremental');
 }finally{await f.journal.close();}
});
test('offline edits accumulate without a network dependency; daemon restart performs one recovery inventory',async()=>{
 const f=await fixture();let restarted:Awaited<ReturnType<typeof startChangeJournal>>|undefined;
 try{
  await captureJournalRecords(f.home,f.id,f.full);
  // No network operation is available or invoked by either producer or reader.
  await writeFile(path.join(f.root,'offline.tex'),'Saved while disconnected');await f.journal.flush();
  const got=await captureJournalRecords(f.home,f.id,f.full);assert.equal(source(got,'source/offline.tex'),'Saved while disconnected');assert.equal(f.scans(),1);
  await f.journal.close();await writeFile(path.join(f.root,'offline.tex'),'Changed while owner stopped');
  restarted=await startChangeJournal(f.home,f.id);await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),2);
  const final=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),2);assert.equal(source(final,'source/offline.tex'),'Changed while owner stopped');
 }finally{if(restarted)await restarted.close();else await f.journal.close();}
});
test('truncated/missing events and a damaged cache trigger reconciliation, never a clean cached result',async()=>{
 const f=await fixture();try{
  await captureJournalRecords(f.home,f.id,f.full);await writeFile(path.join(f.root,'main.tex'),'Newest');await new Promise(r=>setTimeout(r,80));await f.journal.flush();
  const folder=path.join(f.home,'.paperfocus/device-sync/change-journal',f.id);
  for(const file of await readdir(folder))if(file.endsWith('.jsonl'))await unlink(path.join(folder,file));
  let records=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),2);assert.equal(source(records,'source/main.tex'),'Newest');
  await writeFile(path.join(folder,'index.json'),'{broken');records=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),3);assert.equal(source(records,'source/main.tex'),'Newest');
 }finally{await f.journal.close();}
});
test('strong fences bypass the journal; new directories reconcile once and duplicate producers are refused',async()=>{
 const f=await fixture();try{
  await assert.rejects(startChangeJournal(f.home,f.id),/already exists/);await captureJournalRecords(f.home,f.id,f.full);
  await mkdir(path.join(f.root,'chapters'));await writeFile(path.join(f.root,'chapters/intro.tex'),'New subtree');
  const records=await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),2);assert.equal(source(records,'source/chapters/intro.tex'),'New subtree');
  await captureJournalRecords(f.home,f.id,f.full);assert.equal(f.scans(),2);
  await captureJournalRecords(f.home,f.id,f.full,true);assert.equal(f.scans(),3);
  await captureSyncSnapshot(f.home,f.id,undefined,{forceFull:true});assert.equal(((await changeJournalStatus(f.home,f.id)).capture as any).mode,'full');
 }finally{await f.journal.close();}
});
test('events arriving during baseline capture remain pending for the next incremental pass',async()=>{
 const f=await fixture();try{
  const first=await captureJournalRecords(f.home,f.id,async()=>{const before=await f.full();await writeFile(path.join(f.root,'during.tex'),'Arrived during scan');await new Promise(r=>setTimeout(r,80));await f.journal.flush();return before;});
  assert.ok(!first.some(r=>r.path==='source/during.tex'));const next=await captureJournalRecords(f.home,f.id,f.full);assert.equal(source(next,'source/during.tex'),'Arrived during scan');assert.equal(f.scans(),1);
 }finally{await f.journal.close();}
});
