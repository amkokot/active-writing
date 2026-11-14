// Local change discovery, never merge authority. Strong write/acceptance fences
// explicitly bypass this index. No network, model, transferred-code execution.
import {watch,type FSWatcher} from 'node:fs';
import {lstat,appendFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getProject} from './projects.ts';
import {projectDataPath} from './projectStorage.ts';
import {privateSyncPath,readSyncBytes} from './deviceSync.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {canonical,syncHash,safeSyncPath,validSyncReference,syncRecord,type SyncRecord,type SyncKind} from './syncProtocol.ts';
import {captureBlob,fingerprint} from './syncBlobs.ts';
import {coldProject} from './syncColdRefs.ts';
import {notebookSemanticHash} from './syncStructuredBlobs.ts';
import {journalSourceEligible} from './sourceZip.ts';
import {readerSnapshotPaths} from './readerFolder.ts';
import {withRecordLock} from './recordLock.ts';
import {replaceFile} from './atomicFile.ts';

const maxIndex=24*1024**2,maxLog=1024**2,categories=new Set(['experiments','handoffs','references','research','study-evidence','trial-evidence']);
interface Owner{version:1;projectId:string;epoch:string;pid:number;root:string;seq:number;heartbeat:number;valid:boolean;barrierAt?:number;error?:string}
interface Index{version:1;projectId:string;epoch:string;root:string;binding:string;seq:number;at:number;records:SyncRecord[];hash:string}
interface Event{seq:number;paths:string[];uncertain:boolean}
const paths=async(home:string,id:string)=>({owner:await privateSyncPath(home,`change-journal/${id}/owner.json`,true),index:await privateSyncPath(home,`change-journal/${id}/index.json`,true),status:await privateSyncPath(home,`change-journal/${id}/status.json`,true)});
async function atomic(file:string,value:unknown){const temp=file+'.'+randomUUID()+'.part';await writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await replaceFile(temp,file);}
async function optional<T>(file:string,max:number):Promise<T|undefined>{for(let attempt=0;;attempt++)try{return JSON.parse((await readSyncBytes(file,max)).toString());}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;
 if(attempt<4&&/sync input changed/i.test((e as Error).message)){await new Promise(r=>setTimeout(r,5));continue;}throw e;}}
function healthy(o:Owner|undefined,id:string,root:string){
 if(!o||o.version!==1||o.projectId!==id||o.root!==root||!o.valid||!Number.isSafeInteger(o.seq)||o.seq<0||!Number.isSafeInteger(o.pid)||o.pid<1||!Number.isFinite(o.heartbeat)||o.heartbeat>Date.now()+1000||Date.now()-o.heartbeat>20000||!/^[-a-zA-Z0-9]{1,100}$/.test(o.epoch))return false;
 try{process.kill(o.pid,0);return true;}catch{return false;}
}
function eligible(key:string){
 if(!safeSyncPath(key))return false;
 if(key.startsWith('source/'))return journalSourceEligible(key.slice(7));
 if(!key.startsWith('data/'))return false;const rel=key.slice(5),parts=rel.split('/');
 return (categories.has(parts[0])||['notebook.json','workbench.json','project.json'].includes(rel))&&!parts.some(p=>p.startsWith('.')||p==='__pycache__'||/(?:\.tmp|\.aw-lock|\.previous\.(?:json|ipynb)|\.pyc)$/.test(p));
}
const segment=(epoch:string,seq:number)=>`${epoch}-${Math.floor((seq-1)/128)}.jsonl`;

/** Remains alive offline. Watcher errors/overflow invalidate discovery, not data. */
export async function startChangeJournal(home:string,id:string){
 const {root}=await getProject(home,id),files=await paths(home,id),previous=await optional<Owner>(files.owner,4000);
 if(healthy(previous,id,root))throw Error('A live change-journal owner already exists.');
 const owner:Owner={version:1,projectId:id,epoch:randomUUID(),pid:process.pid,root,seq:0,heartbeat:Date.now(),valid:true};
 await withRecordLock(files.owner,async()=>{
  const current=await optional<Owner>(files.owner,4000);
  if(current&&current.pid>0){try{process.kill(current.pid,0);throw Error('A live change-journal owner already exists.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}
  await atomic(files.owner,{...owner,valid:false});
 });
 const pending=new Set<string>();let uncertain=false,closed=false,chain=Promise.resolve(),timer:ReturnType<typeof setTimeout>|undefined;
 const handles:FSWatcher[]=[];
 const flush=()=>{const keys=[...pending];pending.clear();const unknown=uncertain;uncertain=false;
  chain=chain.then(async()=>{
   if(keys.length||unknown){const event:Event={seq:++owner.seq,paths:keys,uncertain:unknown};
    const target=await privateSyncPath(home,`change-journal/${id}/${segment(owner.epoch,event.seq)}`,true);
    const line=JSON.stringify(event)+'\n';if(Buffer.byteLength(line)>maxLog){owner.valid=false;}else{
     const info=await lstat(target).catch(e=>{if(e.code==='ENOENT')return;throw e;});
     if(info&&(info.isSymbolicLink()||!info.isFile()||info.size+Buffer.byteLength(line)>maxLog))owner.valid=false;
     else await appendFile(target,line,{mode:0o600});
    }
    // A reader behind the retained segments falls back to one full inventory.
    if(owner.seq%128===1&&owner.seq>512){const name=`${owner.epoch}-${Math.floor((owner.seq-1)/128)-4}.jsonl`,old=await privateSyncPath(home,`change-journal/${id}/${name}`),archive=await privateSyncPath(home,`change-journal/${id}/archive/${name}`,true);
     try{await lstat(old);if(await lstat(archive).catch(e=>{if(e.code==='ENOENT')return;throw e;}))throw Error('Journal archive already exists; preserved.');await rename(old,archive);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
   }
   owner.heartbeat=Date.now();await atomic(files.owner,owner);
  }).catch(async error=>{owner.valid=false;owner.error=(error as Error).message.slice(0,500);owner.heartbeat=Date.now();await atomic(files.owner,owner).catch(()=>{});});
  return chain;
 };
 const signal=(prefix:string,name:string|null)=>{
  if(closed)return;if(name===null){uncertain=true;}else{const key=prefix+String(name).replaceAll('\\','/');if(!eligible(key))return;
   if(pending.size>=4096)uncertain=true;else pending.add(key);}
  if(!timer)timer=setTimeout(()=>{timer=undefined;void flush();},100);
 };
 for(const [folder,prefix] of [[root,'source/'],[projectDataPath(home,id),'data/']])try{
  const handle=watch(folder,{recursive:true},(_event,name)=>signal(prefix,name===null?null:String(name)));
  handle.on('error',error=>{owner.valid=false;owner.error=error.message;uncertain=true;void flush();});handles.push(handle);
 }catch{owner.valid=false;}
 // A private file barrier asks the persistent owner to drain pending events.
 // It is local IPC only: no network listener, polling process or execution.
 let barrierTimer:ReturnType<typeof setTimeout>|undefined;
 try{const h=watch(path.dirname(files.owner),(_event,name)=>{if(String(name)!=='barrier.request')return;
  if(barrierTimer)clearTimeout(barrierTimer);barrierTimer=setTimeout(()=>{barrierTimer=undefined;
   chain=chain.then(async()=>{const request=await optional<{at:number}>(path.join(path.dirname(files.owner),'barrier.request'),2000);if(!request||!Number.isFinite(request.at)||Math.abs(request.at-Date.now())>5000)return;
    owner.barrierAt=Math.max(Date.now(),request.at+1);
   });void flush();
  },30);
 });h.on('error',()=>{owner.valid=false;void flush();});handles.push(h);}catch{owner.valid=false;}
 await atomic(files.owner,owner);
 const heartbeat=setInterval(()=>{void flush();},5000);heartbeat.unref();
 return {epoch:owner.epoch,root,isHealthy:()=>owner.valid,flush:async()=>{if(timer){clearTimeout(timer);timer=undefined;}await flush();},close:async()=>{
  if(closed)return;closed=true;clearInterval(heartbeat);if(timer)clearTimeout(timer);if(barrierTimer)clearTimeout(barrierTimer);for(const h of handles)h.close();await flush();owner.valid=false;owner.pid=0;await atomic(files.owner,owner);
 }};
}

function checkIndex(index:Index,id:string,root:string){
 if(index?.version!==1||index.projectId!==id||index.root!==root||!Number.isFinite(index.at)||index.at>Date.now()+1000||!Number.isSafeInteger(index.seq)||index.seq<0||!Array.isArray(index.records)||index.records.length>50000||index.hash!==syncHash(canonical(index.records)))throw Error('Invalid change index; reconcile instead.');
 const names=new Set<string>();for(const r of index.records){if(!validSyncReference(r)||names.has(r.path)||typeof r.data!=='string')throw Error('Invalid change-index record.');names.add(r.path);
  if(!r.external){const b=Buffer.from(r.data,'base64');if(b.length!==r.bytes||syncHash(b)!==r.sha256||b.toString('base64')!==r.data)throw Error('Changed inline index bytes.');}
 }
}
async function recordAt(home:string,id:string,key:string,previous?:SyncRecord):Promise<SyncRecord|undefined>{
 const {root,project}=await getProject(home,id),source=key.startsWith('source/'),relative=key.slice(source?7:5),base=source?root:projectDataPath(home,id);
 if(key==='data/project.json')throw Error('Project ownership changed; reconcile.');
 const target=await guardedTarget(base,relative);let info;try{info=await lstat(target);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){
  if(previous?.external&&(await coldProject(home,id)).files.some(f=>f.record.path===key&&f.record.sha256===previous.sha256))return previous;
  return;
 }throw e;}
 if(!info.isFile()||info.isSymbolicLink())throw Error('Directory or linked change needs reconciliation.');
 if(source&&!previous){if((await readerSnapshotPaths(root)).has(relative))return;
  // An untracked main PDF is a build product, not a newly shared figure.
  if(relative.toLowerCase()===project.mainFile.replace(/\.tex$/i,'.pdf').toLowerCase())throw Error('New compiled PDF needs retention reconciliation.');}
 const kind:SyncKind=source?/\.(tex|bib|md|txt|py|json|yaml|yml|sty|cls)$/i.test(relative)?'source':'asset':relative==='notebook.json'?'catalogue':relative==='workbench.json'?'review':/^experiments\/[^/]+\/notebook\.ipynb$/.test(relative)?'experiment':/^experiments\/[^/]+\/runs\/[^/]+\.json$/.test(relative)?'run':/\.(png|jpe?g|webp|gif|pdf|svg|npy|npz|csv)$/i.test(relative)?'asset':'record';
 const ref=await captureBlob(home,target),inline=['catalogue','review'].includes(kind)||kind==='source'&&/\.(tex|bib|md|txt)$/.test(relative);
 if(inline){const bytes=await readSyncBytes(target,24*1024**2);if(syncHash(bytes)!==ref.sha256)throw Error('Journal source changed during capture.');return syncRecord(key,kind,bytes);}
 let semanticHash:string|undefined;if(kind==='experiment'){const semantic=await notebookSemanticHash(target);if(semantic.sha256!==ref.sha256)throw Error('Journal notebook changed during capture.');semanticHash=semantic.semanticHash;}
 return {path:key,kind,sha256:ref.sha256,bytes:ref.bytes,data:'',external:true,...(semanticHash?{semanticHash}:{})};
}
export async function captureJournalRecords(home:string,id:string,full:()=>Promise<SyncRecord[]>,forceFull=false){
 const {root,project}=await getProject(home,id),files=await paths(home,id);let owner:Owner|undefined,index:Index|undefined,reason=forceFull?'strong live-file verification':'journal not ready';
 await guardedTarget(home,path.relative(home,root).replaceAll('\\','/')+'/__journal_probe__');
 await guardedTarget(home,path.relative(home,projectDataPath(home,id)).replaceAll('\\','/')+'/project.json');
 let cold='';try{cold=fingerprint(await lstat(await privateSyncPath(home,`cold/projects/${id}.json`)));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const binding=syncHash(canonical({root,mainFile:project.mainFile,cold}));
 // Ownership metadata remains a direct read, not merely a watcher assertion.
 try{const catalogue=JSON.parse((await readSyncBytes(await guardedTarget(projectDataPath(home,id),'project.json'),10000)).toString());
 if(catalogue.version!==1||catalogue.projectId!==id)throw Error('Change journal project ownership mismatch.');
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{await lstat(projectDataPath(home,id));throw Error('Missing change-journal owning catalogue.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 try{owner=await optional<Owner>(files.owner,4000);if(healthy(owner,id,root)&&!forceFull){index=await optional<Index>(files.index,maxIndex);if(index)checkIndex(index,id,root);}}catch{index=undefined;reason='invalid journal/index';}
 if(index&&owner&&healthy(owner,id,root)&&!forceFull){
  const epoch=owner.epoch,at=Date.now();await atomic(path.join(path.dirname(files.owner),'barrier.request'),{at,id:randomUUID()});
  const until=Date.now()+3000;let acknowledged=false;
  while(Date.now()<until){await new Promise(resolve=>setTimeout(resolve,20));const next=await optional<Owner>(files.owner,4000);
   if(!healthy(next,id,root)||next!.epoch!==epoch)break;
   if((next!.barrierAt??0)>at){owner=next;acknowledged=true;break;}}
  if(!acknowledged){index=undefined;reason='journal barrier unavailable';}
 }
 let records:SyncRecord[]|undefined,mode='full',checked:string[]=[];
 if(index&&owner&&index.binding===binding&&index.epoch===owner.epoch&&Date.now()-index.at<60*60*1000&&index.seq<=owner.seq)try{
  const dirty=new Set<string>(['data/workbench.json','data/notebook.json']);let expected=index.seq+1;
  if(owner.seq-index.seq>512)throw Error('Journal retention gap.');
  for(let group=Math.floor(index.seq/128);expected<=owner.seq;group++){
   const log=await readSyncBytes(await privateSyncPath(home,`change-journal/${id}/${owner.epoch}-${group}.jsonl`),maxLog);
   for(const line of log.toString().trim().split('\n')){const event:Event=JSON.parse(line);if(event.seq<=index.seq||event.seq>owner.seq)continue;
    if(event.seq!==expected++||event.uncertain||!Array.isArray(event.paths)||event.paths.length>4096)throw Error('Uncertain or missing filesystem events.');
    for(const key of event.paths){if(!eligible(key))throw Error('Invalid journal path.');dirty.add(key);}
   }
   if(group>Math.floor(owner.seq/128)+1)throw Error('Journal sequence gap.');
  }
  const result=new Map(index.records.map(r=>[r.path,r]));
  for(const key of dirty){checked.push(key);const value=await recordAt(home,id,key,result.get(key));
   if(value)result.set(key,value);else{if([...result.keys()].some(k=>k.startsWith(key+'/')))throw Error('Directory removal needs reconciliation.');result.delete(key);}}
  result.set('project/manuscripts.json',syncRecord('project/manuscripts.json','policy',Buffer.from(JSON.stringify({name:project.name,createdAt:project.createdAt,manuscriptPurposes:project.manuscriptPurposes??{},manuscriptVersions:project.manuscriptVersions??[],manuscriptOverviewTargets:project.manuscriptOverviewTargets??{},...(project.manuscriptPins?{manuscriptPins:project.manuscriptPins}:{})}))));
  records=[...result.values()].sort((a,b)=>a.path.localeCompare(b.path));mode='incremental';reason='continuous local journal';
 }catch(error){reason=(error as Error).message;}
 if(!records)records=await full();
 // Record the sequence observed BEFORE capture. Later events stay pending; never
 // acknowledge a transfer here or consume an event which arrived during a read.
 if(owner&&healthy(owner,id,root)){
  const next:Index={version:1,projectId:id,epoch:owner.epoch,root,binding,seq:owner.seq,at:mode==='full'?Date.now():index!.at,records,hash:syncHash(canonical(records))};
  const raw=Buffer.from(JSON.stringify(next));if(raw.length<=maxIndex)try{let prior='';try{prior=syncHash(await readSyncBytes(files.index,maxIndex));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await saveGuardedFile(path.dirname(files.index),'index.json',prior,raw,maxIndex);}catch{/* Another snapshot may publish first; native snapshot/write guards remain authoritative. */}
 }
 await atomic(files.status,{version:1,projectId:id,mode,reason,checked:mode==='full'?records.length:checked.length,paths:checked.slice(0,100),at:new Date().toISOString()});
 return records;
}
export async function changeJournalStatus(home:string,id:string){const p=await paths(home,id);return {owner:await optional<Owner>(p.owner,4000),capture:await optional<unknown>(p.status,20000)};}
