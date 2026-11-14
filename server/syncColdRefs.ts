// Availability metadata is local-only. Remote copies are verified before any
// eviction; a missing local file remains a reference, never a source deletion.
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {canonicalHash,safeSyncId,safeSyncPath,syncHash,validSyncReference,type SyncRecord} from './syncProtocol.ts';
import {assistanceArtifactPath} from './syncAssistanceArtifacts.ts';
export interface ColdClaim {projectId:string;peerId:string;deviceId:string;record:SyncRecord;verifiedAt:string}
export interface ColdIndex {version:1;projectId:string;files:Array<{record:SyncRecord;peerId:string;pinned?:boolean}>}
const digest=/^[a-f0-9]{64}$/;
// Role, not individual file size: thousands of small fitted models/arrays can
// outweigh a large archive. Reading material is deliberately not on this list.
export function coldEligible(r:SyncRecord){return r.external===true&&/^(?:source\/|data\/research\/)/.test(r.path)&&['asset','record'].includes(r.kind)&&(/\.(?:npy|npz|zip|parquet|h5|hdf5|pt|pth|ckpt|pkl|tar|gz)$/i.test(r.path)||/idx[13]-ubyte$/i.test(r.path)||assistanceArtifactPath(r.path)||r.bytes>=1024**2&&/^data\/research\/.+\.results\.json$/i.test(r.path));}
const metadataCache=new Map<string,{stamp:string;bytes:number;result:{value:any;hash:string}}>();let metadataBytes=0;
const validatedIndexes=new WeakSet<object>();
const stamp=(s:Awaited<ReturnType<typeof lstat>>)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs].join(':');
function immutable(value:any):any{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;}
async function json(home:string,name:string,max=8*1024**2){try{
 const file=await guardedTarget(home,name),before=await lstat(file);if(before.size>max)throw new Error('Desktop file index is too large.');
 const previous=metadataCache.get(file);if(previous?.stamp===stamp(before))return previous.result;
 const bytes=await readFile(file);if(bytes.length>max)throw new Error('Desktop file index grew beyond its limit.');
 if(stamp(await lstat(file))!==stamp(before))throw new Error('Desktop availability metadata changed while reading; inspect before retry.');
 const result={value:immutable(JSON.parse(bytes.toString('utf8'))),hash:syncHash(bytes)};
 const replaced=metadataCache.get(file);if(replaced){metadataBytes-=replaced.bytes;metadataCache.delete(file);}
 while(metadataCache.size>=20000||metadataBytes+bytes.length>32*1024**2){const first=metadataCache.keys().next().value;if(!first)break;metadataBytes-=metadataCache.get(first)!.bytes;metadataCache.delete(first);}
 metadataCache.set(file,{stamp:stamp(before),bytes:bytes.length,result});metadataBytes+=bytes.length;return result;
}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}}
function record(r:SyncRecord){if(!validSyncReference(r)||r.data!==''||!coldEligible(r))throw new Error('This file must remain local; it is not a bulk research artifact.');}
function indexName(id:string){if(!safeSyncId(id))throw new Error('Use an exact project ID.');return `.paperfocus/device-sync/cold/projects/${id}.json`;}
export async function coldProject(home:string,id:string):Promise<ColdIndex>{const s=await json(home,indexName(id));if(!s)return {version:1,projectId:id,files:[]};const p=s.value;
 // json() rechecks the guarded path and file fingerprint on every read and
 // freezes parsed objects. A changed index gets a different object and must
 // validate again; do not rescan 8,000 unchanged entries for each file save.
 if(p?.projectId===id&&validatedIndexes.has(p))return p;
 if(p.version!==1||p.projectId!==id||!Array.isArray(p.files)||p.files.length>20000||new Set(p.files.map((f:{record:SyncRecord})=>f.record.path)).size!==p.files.length)throw new Error('Invalid desktop file index.');for(const f of p.files){record(f.record);if(!digest.test(f.peerId)||f.pinned!==undefined&&typeof f.pinned!=='boolean')throw new Error('Invalid desktop file owner.');}validatedIndexes.add(p);return p;}
export async function coldClaim(home:string,ref:{sha256:string;bytes:number},id?:string,recordPath?:string):Promise<ColdClaim|undefined>{
 if(!digest.test(ref.sha256))throw new Error('Invalid content hash.');const s=await json(home,`.paperfocus/device-sync/cold/blobs/${ref.sha256}.json`);if(!s)return;
 const {checksum,...body}=s.value;if(checksum!==canonicalHash(body)||body.version!==1||body.sha256!==ref.sha256||body.bytes!==ref.bytes||!Array.isArray(body.claims)||body.claims.length>100)throw new Error('Desktop availability receipt changed.');
 for(const c of body.claims as ColdClaim[]){record(c.record);if(!safeSyncId(c.projectId)||!safeSyncId(c.deviceId)||!digest.test(c.peerId)||c.record.sha256!==ref.sha256||c.record.bytes!==ref.bytes||!Number.isFinite(Date.parse(c.verifiedAt)))throw new Error('Invalid desktop availability receipt.');if(id&&c.projectId!==id||recordPath&&c.record.path!==recordPath)continue;
  const p=await json(home,`.paperfocus/device-sync/peers/${c.projectId}/${c.peerId}.json`,20000);if(!p)continue;const {id:peerId,...peerBody}=p.value;if(peerId!==c.peerId||syncHash((await import('./syncProtocol.ts')).canonical(peerBody))!==peerId||p.value.projectId!==c.projectId||p.value.options?.deviceId!==c.deviceId)throw new Error('Desktop file peer identity changed.');return c;
 }
}
export async function saveColdClaim(home:string,c:ColdClaim){record(c.record);if(!safeSyncId(c.projectId)||!digest.test(c.peerId)||!safeSyncId(c.deviceId))throw new Error('Invalid desktop file scope.');const name=`.paperfocus/device-sync/cold/blobs/${c.record.sha256}.json`,old=await json(home,name);const claims:ColdClaim[]=old?.value?.claims??[];const current=await coldClaim(home,c.record,c.projectId,c.record.path);if(current&&current.peerId===c.peerId&&current.record.path===c.record.path)return;
 const body={version:1,sha256:c.record.sha256,bytes:c.record.bytes,claims:[...claims.filter(x=>!(x.projectId===c.projectId&&x.record.path===c.record.path)),c]};await saveGuardedFile(home,name,old?.hash??'',Buffer.from(JSON.stringify({...body,checksum:canonicalHash(body)})));
}
export async function saveColdAlias(home:string,id:string,r:SyncRecord,peerId:string,pinned=false){record(r);const claim=await coldClaim(home,r,id,r.path);if(!claim||claim.peerId!==peerId||claim.record.kind!==r.kind)throw new Error('No verified desktop copy exists at this exact path.');const name=indexName(id),old=await json(home,name),p=await coldProject(home,id);pinned||=p.files.some(f=>f.record.path===r.path&&f.pinned);const files=p.files.filter(f=>f.record.path!==r.path);files.push({record:r,peerId,pinned});await saveGuardedFile(home,name,old?.hash??'',Buffer.from(JSON.stringify({...p,files:files.sort((a,b)=>a.record.path.localeCompare(b.record.path))})));
}
/** Caller holds the destination leases. One guarded index save, not N rewrites. */
export async function saveColdAliases(home:string,id:string,updates:Array<{record:SyncRecord;before:string}>){
 if(updates.length>20000||new Set(updates.map(u=>u.record.path)).size!==updates.length)throw new Error('Invalid desktop-reference batch.');
 const name=indexName(id),old=await json(home,name),p=await coldProject(home,id),files=new Map(p.files.map(f=>[f.record.path,f]));
 for(const update of updates){record(update.record);const claim=await coldClaim(home,update.record,id,update.record.path),previous=files.get(update.record.path);
  if(!claim||claim.record.kind!==update.record.kind||previous?.pinned)throw new Error('Desktop-reference ownership or local pin changed; preserved.');
  if((previous?.record.sha256??'')!==update.before&&previous?.record.sha256!==update.record.sha256)throw new Error('Desktop-reference destination changed; preserved.');
  files.set(update.record.path,{record:update.record,peerId:claim.peerId,pinned:false});
 }
 const bytes=Buffer.from(JSON.stringify({...p,files:[...files.values()].sort((a,b)=>a.record.path.localeCompare(b.record.path))}));
 if(files.size>20000||bytes.length>8*1024**2)throw new Error('Desktop-reference index exceeds its bounded size.');
 await saveGuardedFile(home,name,old?.hash??'',bytes);
}
export async function coldFilePath(home:string,id:string,name:string){if(!safeSyncPath(name)||!safeSyncId(id)||!name.startsWith('source/')&&!name.startsWith('data/research/'))throw new Error('Invalid desktop file path.');if(name.startsWith('source/')){const {getProject}=await import('./projects.ts');const {root}=await getProject(home,id);return guardedTarget(root,name.slice(7));}return guardedTarget(home,`.paperfocus/project-data/${id}/${name.slice(5)}`);}
export async function coldAliasForTarget(home:string,root:string,name:string){const absolute=path.resolve(root,name),base=await realpath(home);let registry;try{registry=JSON.parse(await readFile(await guardedTarget(home,'.paperfocus/projects.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
 for(const p of registry.projects){const index=await coldProject(home,p.id);let sourceRoot:string|undefined;
  for(const f of index.files){let candidate:string;
   if(f.record.path.startsWith('source/')){sourceRoot??=await realpath((await (await import('./projects.ts')).getProject(home,p.id)).root);candidate=path.resolve(sourceRoot,f.record.path.slice(7));}
   else candidate=path.resolve(base,`.paperfocus/project-data/${p.id}/${f.record.path.slice(5)}`);
   // Compare lexical candidates first; validate every component of the exact
   // match, not thousands of unrelated paths on every ordinary file save.
   if(candidate===absolute&&(await coldFilePath(home,p.id,f.record.path))===absolute)return {projectId:p.id,...f};
  }
 }
}
export async function verifyColdAvailability(home:string,ref:{sha256:string;bytes:number;path?:string},id?:string){const claim=await coldClaim(home,ref,id,ref.path);if(!claim)throw new Error('Bulk evidence is missing locally and has no verified desktop copy.');return claim;}
