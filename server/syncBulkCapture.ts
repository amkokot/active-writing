import {readFile,readdir,lstat,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getProject} from './projects.ts';
import {projectDataPath} from './projectStorage.ts';
import {sourceInventory} from './sourceZip.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {captureBlob,blobLimits,type BlobRef} from './syncBlobs.ts';
import {syncRecord,syncHash,safeSyncId,syncLimits,type SyncRecord,type SyncKind} from './syncProtocol.ts';
import {notebookSemanticHash} from './syncStructuredBlobs.ts';
import {coldProject,coldFilePath,verifyColdAvailability} from './syncColdRefs.ts';
import {boundedSyncReads} from './syncReads.ts';
const categories=new Set(['experiments','handoffs','references','research','study-evidence','trial-evidence']);
/** Main-file selection is host-local; already tracked PDF assets must not vanish. */
export async function trackedCompiledPdf(home:string,id:string,mainFile:string){
 // If no compiled PDF is present, enumerating every historical manifest cannot
 // change sourceInventory's result. Cold references are retained independently.
 const {root}=await getProject(home,id);
 try{await lstat(await guardedTarget(root,mainFile.replace(/\.tex$/i,'.pdf')));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
 const name='source/'+mainFile.replace(/\.tex$/i,'.pdf');
 const {stagedSnapshots,stagedManifest}=await import('./syncStaging.ts');
 for(const s of await stagedSnapshots(home,id))if(s.ready&&(await stagedManifest(home,id,s.id)).references.some(r=>r.kind==='asset'&&r.path.toLowerCase()===name.toLowerCase()))return true;
 return false;
}
export async function bulkEnabled(home:string,id:string){
 if(!safeSyncId(id))throw new Error('Use an exact project ID.');
 try{const value=JSON.parse(await readFile(await guardedTarget(home,`.paperfocus/device-sync/bulk/${id}/enabled.json`),'utf8'));if(value.version!==2||value.projectId!==id||value.enabled!==true)throw new Error('Invalid bulk sync settings.');return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
}
export async function enableBulkSync(home:string,id:string){
 await getProject(home,id);if(await bulkEnabled(home,id))return {enabled:true,version:2,projectId:id};
 await saveGuardedFile(home,`.paperfocus/device-sync/bulk/${id}/enabled.json`,'',Buffer.from(JSON.stringify({version:2,projectId:id,enabled:true})));
 return {enabled:true,version:2,projectId:id};
}
export async function captureBulkRecords(home:string,id:string,forceFull=false):Promise<SyncRecord[]>{
 return (await import('./syncChangeJournal.ts')).captureJournalRecords(home,id,()=>captureBulkRecordsFull(home,id),forceFull);
}
export async function captureBulkRecordsFull(home:string,id:string):Promise<SyncRecord[]>{
 const {project,root}=await getProject(home,id),data=projectDataPath(home,id),records:SyncRecord[]=[];
 try{await lstat(path.join(root,'.paperfocus'));throw new Error('Paper-local legacy records need explicit migration first.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 let hasData=true;try{await lstat(data);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;hasData=false;}
 if(hasData){const catalogue=JSON.parse(await readFile(await guardedTarget(home,path.relative(home,path.join(data,'project.json')).replaceAll('\\','/')),'utf8'));if(catalogue.version!==1||catalogue.projectId!==id)throw new Error('Project data catalogue identity mismatch.');}
 const cacheFile=await guardedTarget(home,`.paperfocus/device-sync/bulk/${id}/fingerprints.json`,true);
 let cache:Record<string,BlobRef&{fingerprint:string;semanticHash?:string}>={};
 try{const s=await lstat(cacheFile);if(s.size>16*1024**2)throw new Error('Bulk fingerprint cache too large.');cache=JSON.parse(await readFile(cacheFile,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const next:typeof cache={};let total=0,inline=0;
 async function add(name:string,kind:SyncKind,file:string){
  const isInline=['catalogue','review','policy'].includes(kind)||kind==='source'&&/\.(?:tex|bib|md|txt)$/.test(name);
  const ref=await captureBlob(home,file,cache[name]);next[name]=ref;
  if(records.length>=blobLimits.records||(total+=ref.bytes)>blobLimits.totalBytes)throw new Error('Bulk project exceeds 50,000 files / 128 GB.');
  if(isInline){if(ref.bytes>syncLimits.fileBytes||(inline+=ref.bytes)>syncLimits.totalBytes)throw new Error('Structured/text sync payload exceeds its bounded inline budget.');const bytes=await readFile(file);if(bytes.length!==ref.bytes||syncHash(bytes)!==ref.sha256)throw new Error('Inline source changed during capture.');records.push(syncRecord(name,kind,bytes));}
  else{let semanticHash:string|undefined;if(kind==='experiment'){if(cache[name]?.fingerprint===ref.fingerprint&&cache[name]?.semanticHash)semanticHash=cache[name].semanticHash;else{const actual=await notebookSemanticHash(file);if(actual.sha256!==ref.sha256)throw new Error('Notebook changed during capture.');semanticHash=actual.semanticHash;}next[name]={...ref,semanticHash};}records.push({path:name,kind,sha256:ref.sha256,bytes:ref.bytes,data:'',external:true,...(semanticHash?{semanticHash}:{})});}
 }
 // Validate the complete tree before hashing/copying any evidence. A late linked
 // path must not cause a multi-GB capture on every scheduled retry.
 const pending:Array<{name:string;kind:SyncKind;file:string}>=[];
 const sources=await sourceInventory(home,id,{retainCompiledPdf:await trackedCompiledPdf(home,id,project.mainFile)});for(const file of sources.files){const name=file.name,kind:SyncKind=/\.(tex|bib|md|txt|py|json|yaml|yml|sty|cls)$/i.test(name)?'source':'asset';pending.push({name:'source/'+name,kind,file:path.join(root,name)});}
 async function walk(relative:string,depth=0){
  if(depth>24)throw new Error('Research tree too deep.');const folder=relative?await guardedTarget(data,relative+'/__probe__'):path.join(data,'__probe__');
  for(const e of await readdir(path.dirname(folder),{withFileTypes:true})){
   if(e.name.startsWith('.')||/(?:\.tmp|\.aw-lock|\.previous\.(?:json|ipynb)|\.pyc)$/.test(e.name)||e.name==='__pycache__')continue;
   if(!relative&&!categories.has(e.name)&&!['notebook.json','workbench.json'].includes(e.name))continue;
   const name=relative?relative+'/'+e.name:e.name;
   if(e.isSymbolicLink())throw new Error(`Linked research path ${JSON.stringify('data/'+name)}; not followed. Preserve the link and inspect it before explicit recovery.`);
   if(e.isDirectory())await walk(name,depth+1);else if(e.isFile()){
    const kind:SyncKind=name==='notebook.json'?'catalogue':name==='workbench.json'?'review':/^experiments\/[^/]+\/notebook\.ipynb$/.test(name)?'experiment':/^experiments\/[^/]+\/runs\/[^/]+\.json$/.test(name)?'run':/\.(png|jpe?g|webp|gif|pdf|svg|npy|npz|csv)$/i.test(name)?'asset':'record';
    pending.push({name:'data/'+name,kind,file:path.join(data,name)});
   }
  }
 }
 if(hasData)await walk('');
 if(pending.length>=blobLimits.records)throw new Error('Bulk project exceeds 50,000 files / 128 GB.');
 // Bounded independent reads avoid serial NFS round trips for every unchanged
 // artifact. Settle all workers before returning an error or publishing cache;
 // every file still gets the same path/hash/fingerprint checks.
 await boundedSyncReads(pending,async item=>{await add(item.name,item.kind,await guardedTarget(home,path.relative(home,item.file).replaceAll('\\','/')));});
 const present=new Set(records.map(r=>r.path));
 await boundedSyncReads((await coldProject(home,id)).files,async f=>{if(present.has(f.record.path))return;const file=await coldFilePath(home,id,f.record.path);try{await lstat(file);throw new Error('A desktop-backed file exists but was excluded from capture. Preserve and inspect it.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await verifyColdAvailability(home,f.record,id);records.push(f.record);});
 records.push(syncRecord('project/manuscripts.json','policy',Buffer.from(JSON.stringify({name:project.name,createdAt:project.createdAt,manuscriptPurposes:project.manuscriptPurposes??{},manuscriptVersions:project.manuscriptVersions??[],manuscriptOverviewTargets:project.manuscriptOverviewTargets??{},...(project.manuscriptPins?{manuscriptPins:project.manuscriptPins}:{})}))));
 const ordered=Object.fromEntries(Object.entries(next).sort(([a],[b])=>a.localeCompare(b)));
 if(JSON.stringify(cache)!==JSON.stringify(ordered)){const temp=cacheFile+'.'+randomUUID()+'.part';await writeFile(temp,JSON.stringify(ordered),{flag:'wx',mode:0o600});await rename(temp,cacheFile);}
 return records.sort((a,b)=>a.path.localeCompare(b.path));
}
