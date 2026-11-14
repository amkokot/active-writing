import {readFile,lstat,rename,unlink,link,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {canonical,canonicalHash,syncHash,safeSyncId,validateSyncJson,type SyncRecord} from './syncProtocol.ts';
import {coldEligible,coldProject,coldClaim,saveColdClaim,saveColdAlias,coldFilePath,type ColdClaim} from './syncColdRefs.ts';
import {streamedHash,verifyBlob,materializeBlob,fingerprint,type BlobRef} from './syncBlobs.ts';
import {readSshPeer,runSshMessage,type SshRunner} from './syncSsh.ts';
import {syncStatus} from './deviceSync.ts';
import {stagedSnapshots,stagedManifest} from './syncStaging.ts';
import {withRecordLock} from './recordLock.ts';
import {withSyncCycle,autoSyncStatus} from './syncAuto.ts';
import {requireSyncNetwork} from './syncNetwork.ts';
import {transferSshBlobs} from './syncBlobSsh.ts';
import {getProject} from './projects.ts';
import {assistanceArtifactPath} from './syncAssistanceArtifacts.ts';
interface Plan {version:1;projectId:string;peerId:string;files:Array<{record:SyncRecord;fingerprint:string}>}
const settings='.paperfocus/device-sync/cold/settings.json';
async function optional(file:string){try{return await lstat(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
export async function desktopFirstEnabled(home:string){const file=await guardedTarget(home,settings);if(!await optional(file))return false;const v=JSON.parse(await readFile(file,'utf8'));if(v.version!==1||typeof v.enabled!=='boolean')throw new Error('Invalid desktop storage settings.');return v.enabled;}
export async function enableDesktopFirst(home:string){const file=await guardedTarget(home,settings),old=await optional(file)?syncHash(await readFile(file)):'';await saveGuardedFile(home,settings,old,Buffer.from(JSON.stringify({version:1,enabled:true})));}
export async function desktopFiles(home:string,id:string){await getProject(home,id);const p=await coldProject(home,id),automatic=await autoSyncStatus(home,id),peerId=automatic.config?.peerId??p.files[0]?.peerId,peer=peerId?await readSshPeer(home,id,peerId):undefined;const recoveryFiles:Array<{target:string;quarantine:string}>=[],folder=path.dirname(await guardedTarget(home,'.paperfocus/device-sync/cold/quarantine/__probe__'));if(await optional(folder))for(const name of await readdir(folder)){if(!name.endsWith('.part'))continue;const metadata=await guardedTarget(home,`.paperfocus/device-sync/cold/quarantine/${name}.json`);if(!await optional(metadata))throw new Error('An offload quarantine needs explicit inspection.');const r=JSON.parse(await readFile(metadata,'utf8'));if(r.projectId===id)recoveryFiles.push({target:r.path,quarantine:path.join(folder,name)});}return {projectId:id,desktopFirst:await desktopFirstEnabled(home),desktopWorkspace:peer?.options.workspace,desktopHost:peer?.options.host,recoveryFiles,files:await Promise.all(p.files.map(async f=>({...f.record,peerId:f.peerId,pinned:Boolean(f.pinned),resident:Boolean(await optional(await coldFilePath(home,id,f.record.path)))})))};}
export async function proveDesktopFiles(home:string,id:string,expectedDeviceId:string,records:SyncRecord[]){
 if((await syncStatus(home)).device?.id!==expectedDeviceId||records.length>1000||records.some(r=>!coldEligible(r)))throw new Error('Invalid desktop artifact proof scope.');
 const allowed=new Set<string>();for(const s of await stagedSnapshots(home,id)){if(!s.ready)continue;for(const r of (await stagedManifest(home,id,s.id)).references)allowed.add(`${r.path}|${r.sha256}|${r.bytes}`);}
 for(const r of records){if(!allowed.has(`${r.path}|${r.sha256}|${r.bytes}`))throw new Error('Artifact is not in this project’s checked history.');await verifyBlob(home,r);}
 return {version:1,projectId:id,deviceId:expectedDeviceId,records:records.map(r=>({path:r.path,sha256:r.sha256,bytes:r.bytes})),verified:true};
}
export async function verifyDesktopCopies(home:string,id:string,peerId:string,records:SyncRecord[],runner:SshRunner=runSshMessage){
 if(!records.length)return;await requireSyncNetwork(home);const peer=await readSshPeer(home,id,peerId);if(peer.options.platform!=='posix')throw new Error('Desktop-backed artifacts currently need the paired POSIX host.');
 const tool=peer.options.tool.replace(/awSync\.ts$/,'awStore.ts');if(tool===peer.options.tool)throw new Error('Unknown desktop storage tool location.');const q=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 // Keep the proof endpoint bounded; a large study is several checked batches,
 // not a larger request or an exemption from verification.
 for(let start=0;start<records.length;start+=500){const batch=records.slice(start,start+500);
 const raw=await runner(peer.options.host,`exec node ${q(tool)} proof --workspace ${q(peer.options.workspace)} --project ${q(id)}`,Buffer.from(JSON.stringify({expectedDeviceId:peer.options.deviceId,records:batch})),2*1024**2,120000);
 const proof=JSON.parse(raw.toString());validateSyncJson(proof);if(proof.version!==1||proof.projectId!==id||proof.deviceId!==peer.options.deviceId||proof.verified!==true||canonical(proof.records)!==canonical(batch.map(r=>({path:r.path,sha256:r.sha256,bytes:r.bytes}))))throw new Error('Desktop verification response does not match the selected files.');
 for(const record of batch)await saveColdClaim(home,{projectId:id,peerId,deviceId:peer.options.deviceId,record,verifiedAt:new Date().toISOString()});
 }
}
export async function planDesktopStorage(home:string,id:string,peerId:string){
 await readSshPeer(home,id,peerId);const file=await guardedTarget(home,`.paperfocus/device-sync/bulk/${id}/fingerprints.json`);if(!await optional(file))throw new Error('This project needs streaming sync enrollment before offloading files.');if((await lstat(file)).size>16*1024**2)throw new Error('Fingerprint index too large.');
 const cache=JSON.parse(await readFile(file,'utf8')),aliases=await coldProject(home,id),files:Plan['files']=[];
 for(const [name,r] of Object.entries(cache) as Array<[string,BlobRef]>){const record:SyncRecord={path:name,sha256:r.sha256,bytes:r.bytes,kind:name.startsWith('source/')?/\.(?:tex|bib|md|txt|py|json|yaml|yml|sty|cls)$/i.test(name)?'source':'asset':/\.(?:png|jpe?g|webp|gif|pdf|svg|npy|npz|csv)$/i.test(name)?'asset':'record',data:'',external:true};if(!coldEligible(record)||aliases.files.some(f=>f.record.path===name&&f.pinned))continue;const s=await optional(await coldFilePath(home,id,name));if(!s)continue;if(s.isSymbolicLink()||!s.isFile())throw new Error('Linked/non-file artifact; preserved.');files.push({record,fingerprint:fingerprint(s)});}
 if(files.length>1000)throw new Error('Choose a smaller artifact batch.');const body:Plan={version:1,projectId:id,peerId,files},planId=canonicalHash(body),name=`.paperfocus/device-sync/cold/plans/${planId}.json`,target=await guardedTarget(home,name,true);if(!await optional(target))await saveGuardedFile(home,name,'',Buffer.from(JSON.stringify(body)));
 return {planId,projectId:id,files:files.map(f=>({path:f.record.path,bytes:f.record.bytes})),bytes:files.reduce((n,f)=>n+f.record.bytes,0),localNotesKept:true};
}
async function cacheDependencies(home:string){
 const result=new Map<string,{inline:boolean;projects:Set<string>}>(),registry=JSON.parse(await readFile(await guardedTarget(home,'.paperfocus/projects.json'),'utf8'));for(const p of registry.projects){if(!safeSyncId(p.id))throw new Error('Invalid project registry identity.');const folder=path.dirname(await guardedTarget(home,`.paperfocus/device-sync/staged/${p.id}/__probe__`));if(!await optional(folder))continue;const names=await readdir(folder);if(names.length>1500)throw new Error('Too much staged history for cache eviction.');for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))){for(const r of (await stagedManifest(home,p.id,name.slice(0,-5))).references){const v=result.get(r.sha256)??{inline:false,projects:new Set<string>()};v.inline||=!r.external;v.projects.add(p.id);result.set(r.sha256,v);}}}return result;
}
export async function commitDesktopStorage(home:string,id:string,planId:string,runner?:SshRunner){
 if(!/^[a-f0-9]{64}$/.test(planId))throw new Error('Use the exact offload plan.');const body:Plan=JSON.parse(await readFile(await guardedTarget(home,`.paperfocus/device-sync/cold/plans/${planId}.json`),'utf8'));if(canonicalHash(body)!==planId||body.projectId!==id)throw new Error('Offload plan changed.');
 return withSyncCycle(home,id,async()=>{
  const pinned=new Set((await coldProject(home,id)).files.filter(f=>f.pinned).map(f=>f.record.path));
  if(body.files.some(f=>pinned.has(f.record.path)))throw new Error('A file was pinned after the offload preview; preserve it and make a fresh plan.');
  // No background writer may infer an eviction from a deletion. Claims and
  // virtual aliases are saved first; changed bytes remain in quarantine.
  for(const f of body.files){if(!coldEligible(f.record))throw new Error('Non-artifact in offload plan.');const file=await coldFilePath(home,id,f.record.path);if(!await optional(file)){if((await coldProject(home,id)).files.some(a=>a.record.path===f.record.path&&a.record.sha256===f.record.sha256))continue;throw new Error('Artifact moved since preview.');}const r=await streamedHash(file);if(r.sha256!==f.record.sha256||r.fingerprint!==f.fingerprint)throw new Error('Artifact changed since preview; nothing removed.');}
  await verifyDesktopCopies(home,id,body.peerId,body.files.map(f=>f.record),runner);await enableDesktopFirst(home);
  let freedBytes=0;const cacheCandidates=new Map<string,SyncRecord>();
  for(const f of body.files){const target=await coldFilePath(home,id,f.record.path);await saveColdAlias(home,id,f.record,body.peerId);if(!await optional(target)){cacheCandidates.set(f.record.sha256,f.record);continue;}
   await withRecordLock(target,async()=>{if(fingerprint(await lstat(target))!==f.fingerprint)throw new Error('Artifact changed before eviction; kept locally.');const relative=`.paperfocus/device-sync/cold/quarantine/${planId.slice(0,12)}-${randomUUID()}.part`,quarantine=await guardedTarget(home,relative,true);await saveGuardedFile(home,relative+'.json','',Buffer.from(JSON.stringify({version:1,projectId:id,path:f.record.path,sha256:f.record.sha256,bytes:f.record.bytes,planId})));await rename(target,quarantine);const actual=await streamedHash(quarantine);if(actual.sha256!==f.record.sha256){try{await link(quarantine,target);}catch{/* Keep changed bytes, including concurrent replacement. */}throw new Error(`Artifact changed during eviction. Preserved at ${quarantine}; inspect before retry.`);}await unlink(quarantine);freedBytes+=f.record.bytes;});cacheCandidates.set(f.record.sha256,f.record);
  }
  // CAS is shared across projects. Never discard a legacy inline dependency or
  // another project's only locally available historical content.
  const dependencies=await cacheDependencies(home);
  for(const r of cacheCandidates.values()){const d=dependencies.get(r.sha256);if(d?.inline)continue;let safe=true;for(const projectId of d?.projects??[])if(!await coldClaim(home,r,projectId))safe=false;if(safe){const file=await guardedTarget(home,`.paperfocus/device-sync/blobs/${r.sha256}.blob`);if(await optional(file)){await verifyBlob(home,r);await unlink(file);freedBytes+=r.bytes;}}}
  return {projectId:id,files:body.files.length,freedBytes,desktopCopiesVerified:true,notesAndNotebooksKept:true};
 },0);
}
export async function fetchDesktopFile(home:string,id:string,name:string,runtime:{transfer?:typeof transferSshBlobs}={}){return withSyncCycle(home,id,async()=>{
 const p=await coldProject(home,id),f=p.files.find(x=>x.record.path===name);if(!f)throw new Error('Choose an exact desktop-backed file.');const target=await coldFilePath(home,id,name);
 if(await optional(target)){if((await streamedHash(target)).sha256!==f.record.sha256)throw new Error('Local file differs; preserved without replacement.');await saveColdAlias(home,id,f.record,f.peerId,true);return {path:target,alreadyLocal:true};}
 await requireSyncNetwork(home);const peer=await readSshPeer(home,id,f.peerId);await (runtime.transfer??transferSshBlobs)(home,id,peer.options,[f.record],'read',f.record.bytes);await materializeBlob(home,path.dirname(target),path.basename(target),f.record,f.record.sha256);await saveColdAlias(home,id,f.record,f.peerId,true);return {path:target,bytes:f.record.bytes,pinned:true};
},0);}
// New bulky evidence is represented by a checked desktop receipt, not downloaded
// just to delete it again. The live alias is created only by the guarded merge.
export async function deferIncomingArtifacts(home:string,id:string,peerId:string,bytes:Buffer,refs:BlobRef[],runner?:SshRunner){
 if(!await desktopFirstEnabled(home))return refs;
 const packet=JSON.parse(gunzipSync(bytes,{maxOutputLength:192*1024**2}).toString());validateSyncJson(packet);const {id:checksum,...body}=packet;if(packet.format!=='aw-sync-exchange'||packet.projectId!==id||checksum!==syncHash(canonical(body)))throw new Error('Invalid incoming artifact exchange.');
 const peer=await readSshPeer(home,id,peerId);if(packet.sender?.id!==peer.options.deviceId)throw new Error('Wrong artifact sender.');
 const index=await coldProject(home,id),pins=new Set(index.files.filter(f=>f.pinned).map(f=>f.record.path));
 // A newly essential figure may reuse bytes previously known only as a cold
 // dataset. The inventory knows the hash, but its reading copy must still arrive.
 const transfers=[...refs],folder=path.dirname(await guardedTarget(home,'.paperfocus/device-sync/cold/blobs/__probe__')),coldHashes=new Set(await optional(folder)?(await readdir(folder)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>n.slice(0,-5)):[]);
 for(const f of index.files.filter(f=>f.pinned&&f.peerId===peerId)){if(transfers.some(r=>r.sha256===f.record.sha256))continue;try{await verifyBlob(home,f.record);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(await coldClaim(home,f.record,id,f.record.path))transfers.push({sha256:f.record.sha256,bytes:f.record.bytes});}}
 for(const m of packet.manifests??[])for(const r of m.references??[]){if(!r.external||coldEligible({...r,data:''})&&!pins.has(r.path)&&!assistanceArtifactPath(r.path)||!coldHashes.has(r.sha256)||transfers.some(f=>f.sha256===r.sha256))continue;try{await verifyBlob(home,r);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;if(await coldClaim(home,r,id))transfers.push({sha256:r.sha256,bytes:r.bytes});}}
 const selected:SyncRecord[]=[],requiredLocally=new Set(index.files.filter(f=>f.pinned).map(f=>f.record.sha256));
 for(const m of packet.manifests??[])for(const r of m.references??[]){
  const incoming=transfers.some(f=>f.sha256===r.sha256&&f.bytes===r.bytes);
  // Tiny helper payloads are cached to check ownership; they remain opaque
  // archives, never imported as a model request/reply or evidence certification.
  if(incoming&&assistanceArtifactPath(r.path))requiredLocally.add(r.sha256);
  if(!r.external||!coldEligible({...r,data:''})){if(incoming)requiredLocally.add(r.sha256);continue;}
  if(pins.has(r.path)||await optional(await coldFilePath(home,id,r.path))){if(incoming)requiredLocally.add(r.sha256);continue;}
  // Hash inventories deduplicate content, not path ownership. A new alias needs
  // its own exact desktop proof even when an older path already knows the hash.
  if(await coldClaim(home,r,id,r.path))continue;
  if(!selected.some(f=>f.path===r.path&&f.sha256===r.sha256))selected.push({...r,data:''});
 }
 for(let n=selected.length-1;n>=0;n--)if(requiredLocally.has(selected[n].sha256)&&!assistanceArtifactPath(selected[n].path))selected.splice(n,1);
 if(selected.length)await verifyDesktopCopies(home,id,peerId,selected,runner);
 const deferred=new Set(selected.filter(f=>!requiredLocally.has(f.sha256)).map(f=>f.sha256));
 for(const ref of transfers)if(!requiredLocally.has(ref.sha256)&&await coldClaim(home,ref,id))deferred.add(ref.sha256);
 return transfers.filter(f=>!deferred.has(f.sha256));
}
