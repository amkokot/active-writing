import {slideChoice,validateSlideChoice,mergeSlideChoice,applySlideChoice} from './slideDecks.ts';
// Small, independent reading records. This deliberately does not acknowledge a
// whole-project head, transfer raw experiments, run code or resolve conflicts.
import path from 'node:path';
import {getProject} from './projects.ts';
import {projectDataPath} from './projectStorage.ts';
import {sourceInventory} from './sourceZip.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {privateSyncPath,readSyncBytes,syncStatus} from './deviceSync.ts';
import {saveImmutableSyncArtifact,stagedManifest} from './syncStaging.ts';
import {exchangeStatus} from './syncExchange.ts';
import {canonical,syncHash,safeSyncPath,syncRecord,type SyncSnapshot,validateSyncJson} from './syncProtocol.ts';
import {syncLockedFiles} from './syncReconcile.ts';
import {readWorkbench,writeWorkbench,validateWorkbench} from './workbenchStore.ts';
import {blankReviewStore,commentContent,mergeCommentStores,unionCommentStores,localCommentPresentation} from './syncComments.ts';
import {readNotebook} from './notebookStore.ts';
import {readExperiments,writeExperiments,serializeExperimentNotebook} from './experiments.ts';
import {validateExperimentNotebook} from '../src/experiments.ts';
import {withRecordLock} from './recordLock.ts';
import {readSshPeer,runSshMessage,sshPeerCommand,type SshRunner} from './syncSsh.ts';
import {requireSyncNetwork} from './syncNetwork.ts';
import {mergeLiteralText,textMergeLimits} from './syncText.ts';
import {readingPins,validateReadingPins,mergeReadingPins,applyReadingPins} from './syncDocumentPins.ts';
import {mergeableReadingSource,sourceText,rememberReadingSource,readingSourceBase,hasReadingSourceBase,saveReadingSourceReview,readingSourceChoice,clearReadingSourceReview} from './syncReadingSource.ts';

const hashPattern=/^[a-f0-9]{64}$/,ownerPattern=/^[A-Za-z0-9_-]{1,64}$/;
const limit=16*1024**2;
const sourceTypes=/\.(tex|bib|md|txt|png|jpe?g|webp|gif|pdf|svg|eps)$/i;
export interface Item {key:string;digest:string;raw:string;bytes:number;binding:string;blocked?:string}
export interface Packet {item:Item;data:string;runs?:Array<{name:string;data:string;sha256:string}>;commentUnion?:true}
export interface Inventory {projectId:string;deviceId:string;items:Item[];deferred:string[];absentNotebooks?:string[];documentPins?:Item;slideDeck?:Item;figures?:Item[];maintenance?:boolean}
class AbsentReadingNotebook extends Error {}
interface Baselines {version:1;projectId:string;peerId:string;files:Record<string,string>;documentPins?:string;slideDeck?:string}
function kind(key:string){
 if(key==='slide-deck')return 'slide-deck';
 if(key==='document-pins')return 'document-pins';
 if(key==='comments')return 'comments';
 if(key.startsWith('source/')&&safeSyncPath(key)&&sourceTypes.test(key))return 'source';
 if(/^notebook\/[A-Za-z0-9_-]{1,64}$/.test(key))return 'notebook';
 throw Error('Not a supported reading record.');
}
function checkItem(item:Item){if(!item||Object.keys(item).some(k=>!['key','digest','raw','bytes','binding','blocked'].includes(k))||!hashPattern.test(item.digest)||!hashPattern.test(item.raw)||!hashPattern.test(item.binding)||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>limit||item.blocked!==undefined&&(typeof item.blocked!=='string'||item.blocked.length>300))throw Error('Invalid reading record.');kind(item.key);}
function bytes(packet:Packet){checkItem(packet.item);if(typeof packet.data!=='string'||packet.data.length>Math.ceil(limit/3)*4)throw Error('Reading payload exceeds its budget.');const raw=Buffer.from(packet.data,'base64');if(raw.toString('base64')!==packet.data||raw.length!==packet.item.bytes||syncHash(raw)!==packet.item.raw)throw Error('Reading payload checksum changed.');
 const type=kind(packet.item.key);let digest=syncHash(raw);
 if(type==='source'&&/\.(tex|bib|md|txt)$/i.test(packet.item.key)){const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);if(/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text))throw Error('Source is not ordinary UTF-8 text.');}
 if(type==='comments'){const value=JSON.parse(raw.toString());validateWorkbench(value);digest=syncHash(canonical(comments(value)));}
 if(type==='notebook'){const value=JSON.parse(raw.toString());validateExperimentNotebook(value);digest=syncHash(canonical(value));}
 if(type==='slide-deck'){if(raw.length>8192)throw Error('Slide choice exceeds its budget.');validateSlideChoice(JSON.parse(raw.toString()));}
 if(type==='document-pins'){if(raw.length>8192)throw Error('Reading document pins exceed their budget.');validateReadingPins(JSON.parse(raw.toString()));}
 if(digest!==packet.item.digest)throw Error('Reading semantic checksum changed.');return raw;}
async function policy(home:string,id:string){
 const {project,root}=await getProject(home,id),wb=await readWorkbench(home,id);
 const locks=syncLockedFiles([{records:[syncRecord('data/workbench.json','review',Buffer.from(JSON.stringify(wb)))]} as SyncSnapshot]);
 // Host-local selection and unrelated note-version/pin metadata must not stall
 // ordinary reading files. Publication/wording locks are checked separately on
 // BOTH sides. Only negotiated ordinary reading pins/links cross separately;
 // publication, main-file selection and other policy remain device-local.
 const binding=syncHash(canonical({projectId:id,createdAt:project.createdAt}));
 return {root,project,wb,binding,locks,publication:Object.values(project.manuscriptPurposes??{}).includes('publication')};
}
function comments(wb:Pick<Awaited<ReturnType<typeof readWorkbench>>,'attentionTasks'>){return {...blankReviewStore(),attentionTasks:wb.attentionTasks.filter(t=>t.review?.kind==='comment').map(commentContent).sort((a:any,b:any)=>a.id.localeCompare(b.id))};}
async function owners(home:string,id:string){
 const store=await readNotebook(home,id),result=new Map<string,string>();
 for(const entry of store.entries){const owner=entry.experimentNotebookId??entry.id;if(!ownerPattern.test(owner))continue;const binding=syncHash(canonical({id:entry.id,owner,root:entry.manuscriptFile??entry.source?.rootFile??''}));if(result.has(owner))throw Error('Shared notebook ownership needs review.');result.set(owner,binding);}
 return result;
}
async function packet(home:string,id:string,key:string,inventoryPolicy?:Awaited<ReturnType<typeof policy>>):Promise<Packet>{
 const type=kind(key),p=inventoryPolicy??await policy(home,id);let raw:Buffer,binding=p.binding,digest:string,blocked:string|undefined;
 if(type==='source'){
  if(p.publication||p.locks.unknown||p.locks.files.has(key))blocked='Publication or locked source stays in its writing workflow.';
  raw=await readSyncBytes(await guardedTarget(p.root,key.slice(7)),limit);
  if(/\.(tex|bib|md|txt)$/i.test(key)){const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(raw);if(/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text))throw Error('Source is not ordinary UTF-8 text.');}
  digest=syncHash(raw);
 }else if(type==='slide-deck'){raw=Buffer.from(canonical(slideChoice(p.project)));digest=syncHash(raw);
 }else if(type==='document-pins'){
  raw=Buffer.from(canonical(readingPins(p.project)));digest=syncHash(raw);
 }else if(type==='comments'){
  raw=Buffer.from(JSON.stringify({...blankReviewStore(),attentionTasks:p.wb.attentionTasks.filter(t=>t.review?.kind==='comment')}));digest=syncHash(canonical(comments(p.wb)));
 }else{
  const owner=key.slice(9),bindings=await owners(home,id),ownerBinding=bindings.get(owner);if(!ownerBinding)throw Error('Notebook has no exact conversation owner.');
  const saved=await readExperiments(home,id,owner);if(!saved.revision)throw new AbsentReadingNotebook('Only existing, conversation-owned notebooks use the reading lane.');
  raw=Buffer.from(serializeExperimentNotebook(saved.notebook));digest=syncHash(canonical(saved.notebook));binding=syncHash(canonical([p.binding,ownerBinding]));
 }
 if(raw.length>limit)throw Error('Reading record exceeds its bounded size.');
 return {item:{key,digest,raw:syncHash(raw),bytes:raw.length,binding,...(blocked?{blocked}:{})},data:raw.toString('base64')};
}
function unionPacket(original:Packet,store:ReturnType<typeof blankReviewStore>):Packet{
 const raw=Buffer.from(JSON.stringify(store));if(raw.length>4_000_000)throw Error('Comment store exceeds its saved-work budget.');
 return {item:{...original.item,bytes:raw.length,raw:syncHash(raw),digest:syncHash(canonical(comments(store)))},data:raw.toString('base64'),commentUnion:true};
}
async function cacheSourcePacket(home:string,id:string,value:Packet){if((mergeableReadingSource(value.item.key)||value.item.key==='document-pins'||value.item.key==='slide-deck')&&value.item.bytes<=textMergeLimits.bytes)await rememberReadingSource(home,id,value.item.digest,bytes(value));}
function sourcePacket(original:Packet,text:string):Packet{const raw=Buffer.from(text);sourceText(raw);return {item:{...original.item,raw:syncHash(raw),digest:syncHash(raw),bytes:raw.length},data:raw.toString('base64')};}
/** Literal dependencies only: no macro expansion or execution, bounded reads. */
export async function fastReadingFigures(root:string,roots:string[]){
 const queue=[...new Set(roots)],seen=new Set<string>(),figures=new Set<string>();let bytesRead=0;
 const safe=(file:string)=>!!file&&!file.includes('\\')&&!file.startsWith('/')&&!file.split('/').includes('..')&&!/[:{}#$]/.test(file);
 while(queue.length&&seen.size<24&&bytesRead<4*1024**2){
  const file=queue.shift()!;if(!safe(file)||seen.has(file))continue;seen.add(file);
  let raw:Buffer;try{raw=await readSyncBytes(await guardedTarget(root,file),1024**2);}catch{continue;}bytesRead+=raw.length;
  const text=raw.toString('utf8').replace(/(?<!\\)%[^\r\n]*/g,'');
  for(const match of text.matchAll(/\\(includegraphics\*?|input|include)\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)){
   const name=match[2].trim();if(!safe(name))continue;
   const bases=[name,path.posix.join(path.posix.dirname(file),name)];
   if(match[1].startsWith('includegraphics')){for(const base of bases)for(const candidate of /\.(pdf|png|jpe?g|svg|eps|webp|gif)$/i.test(base)?[base]:['pdf','png','jpg','jpeg'].map(ext=>base+'.'+ext))if(figures.size<64&&safe(candidate))figures.add(candidate);}
   else for(const base of bases)if(queue.length<64)queue.push(/\.tex$/i.test(base)?base:base+'.tex');
  }
 }
 return [...figures];
}
export function readingTransferPriority(key:string){return key==='comments'||key==='document-pins'||key==='slide-deck'?0:/\.(tex|bib|md|txt)$/i.test(key)?1:/^source\/.+\//.test(key)&&sourceTypes.test(key)?2:key.startsWith('notebook/')?3:4;}
export async function readingInventory(home:string,id:string,fastOnly=false):Promise<Inventory>{
 const device=(await syncStatus(home)).device;if(!device)throw Error('Name the device first.');
 const items:Item[]=[],deferred:string[]=[],absentNotebooks:string[]=[];
 const keys:string[]=[];
 const inventoryPolicy=await policy(home,id);
 const readingAssets=fastOnly?await fastReadingFigures(inventoryPolicy.root,[inventoryPolicy.project.manuscriptPins?.overview,inventoryPolicy.project.manuscriptPins?.notes,inventoryPolicy.project.mainFile,inventoryPolicy.project.slideDeck].filter((f):f is string=>!!f)):[];
 try{const sources=await sourceInventory(home,id,{retainCompiledPdf:true,readingTextOnly:fastOnly,readingAssets});keys.push(...sources.files.filter(f=>sourceTypes.test(f.name)).map(f=>'source/'+f.name));}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||/changed|moved/i.test((error as Error).message))deferred.push('source/');else throw error;}
 keys.push('comments',...(fastOnly?[]:[...(await owners(home,id)).keys()].map(owner=>'notebook/'+owner)));
 if(keys.length>5000)throw Error('Reading index exceeds its bounded file count.');
 // One inventory is an observation, not permission to write. Reuse its policy
 // read instead of parsing the whole workbench once per source file. Actual
 // packet reads/imports below still recheck current policy and exact bytes.
 for(const key of keys)try{items.push((await packet(home,id,key,inventoryPolicy)).item);}catch(error){if(error instanceof AbsentReadingNotebook){absentNotebooks.push(key);continue;}deferred.push(key);if((error as Error).message.includes('Shared notebook ownership'))throw error;}
 // An optional capability, outside items, keeps older peers fully compatible.
 let documentPins:Item|undefined;
 try{documentPins=(await packet(home,id,'document-pins',inventoryPolicy)).item;}catch{deferred.push('document-pins');}
 let slideDeck:Item|undefined;try{slideDeck=(await packet(home,id,'slide-deck',inventoryPolicy)).item;}catch{deferred.push('slide-deck');}
 const figures=fastOnly?items.filter(i=>!/^source\/.*\.(tex|bib|md|txt)$/i.test(i.key)&&i.key!=='comments'):undefined;
 return {projectId:id,deviceId:device.id,items:figures?items.filter(i=>!figures.includes(i)):items,deferred,absentNotebooks,...(documentPins?{documentPins}:{}),...(slideDeck?{slideDeck}:{}),...(figures?{figures}:{}),maintenance:await (await import('./syncMaintenance.ts')).maintenanceEnabled()};
}
export async function readingPacket(home:string,id:string,item:Item,budget=limit):Promise<Packet>{
 if(!Number.isSafeInteger(budget)||budget<1||budget>limit)throw Error('Invalid reading packet budget.');
 checkItem(item);const result=await packet(home,id,item.key);if(result.item.digest!==item.digest||result.item.raw!==item.raw||result.item.binding!==item.binding)throw Error('Reading record moved; leave it for the next pass.');
 if(result.item.bytes>budget)throw Error('Reading batch budget reached; leave this record for the next pass.');
 if(kind(item.key)==='notebook'){
  const owner=item.key.slice(9),nb=JSON.parse(Buffer.from(result.data,'base64').toString()),ids=new Set<string>();
  for(const cell of nb.cells){const run=cell.metadata?.paperfocus?.runId;if(run){if(!ownerPattern.test(run))throw Error('Invalid notebook run identity.');ids.add(run);}}
  const runs:NonNullable<Packet['runs']>=[];let total=result.item.bytes;
  for(const run of ids){
   const name=`${run}.json`;let data:Buffer;
   try{const file=await guardedTarget(projectDataPath(home,id),`experiments/${owner}/runs/${name}`);data=await readSyncBytes(file,limit);}
   catch(error){if(['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code??''))throw Error(`Notebook run provenance is missing for ${run}.`);throw error;}
   if((total+=data.length)>budget)throw Error('Reading batch budget reached; leave this record for the next pass.');runs.push({name,data:data.toString('base64'),sha256:syncHash(data)});
  }
  result.runs=runs;
 }
 return result;
}
export async function applyReadingPacket(home:string,id:string,incoming:Packet,expected:Item|undefined){
 const data=bytes(incoming),type=kind(incoming.item.key);if(expected){checkItem(expected);if(expected.key!==incoming.item.key)throw Error('Reading target differs.');}
 if(incoming.commentUnion!==undefined&&(incoming.commentUnion!==true||type!=='comments'))throw Error('Invalid comment-only union flag.');
 const p=await policy(home,id);let previous:Packet|undefined;
 try{previous=await packet(home,id,incoming.item.key);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(previous?.item.digest===incoming.item.digest)return {applied:false,alreadyCurrent:true};
 if(previous?.item.raw!==expected?.raw||previous?.item.digest!==expected?.digest)throw Error('Reading destination changed; preserved for the next pass.');
 const binding=previous?.item.binding??p.binding;
 if(binding!==incoming.item.binding||previous?.item.blocked||incoming.item.blocked)throw Error('Reading policy/ownership changed or source is protected.');
 if(type==='source'&&(p.publication||p.locks.unknown||p.locks.files.has(incoming.item.key)))throw Error('Publication or locked source stays in its writing workflow.');
 const receipt=syncHash(canonical({projectId:id,key:incoming.item.key,before:previous?.item.raw??'',after:incoming.item.raw,binding}));
 if(previous)await saveImmutableSyncArtifact(await privateSyncPath(home,`reading/${id}/before/${receipt}.blob`,true),Buffer.from(previous.data,'base64'),limit);
 if(type==='slide-deck'){
  if(!previous)throw Error('Missing current slide choice.');
  await applySlideChoice(home,id,JSON.parse(data.toString()),previous.item.digest);
 }else if(type==='document-pins'){
  if(!previous)throw Error('Missing current reading document pins.');
  await applyReadingPins(home,id,JSON.parse(data.toString()),previous.item.digest);
 }else if(type==='source')await saveGuardedFile(p.root,incoming.item.key.slice(7),previous?.item.raw??'',data,limit);
 else if(type==='comments'){
  const value=JSON.parse(data.toString());validateWorkbench(value);
  if(value.attentionTasks.some((t:any)=>t.review?.kind!=='comment')||value.rewriteSessions.length||Object.keys(value.handoffDrafts).length||value.recoveredDrafts.length)throw Error('Only comments can cross this reading record.');
  const beforeHash=await workbenchHash(home,id),current=await readWorkbench(home,id);
  if(beforeHash!==await workbenchHash(home,id)||syncHash(canonical(comments(current)))!==previous?.item.digest)throw Error('Comments changed during collection; preserved.');
  if(incoming.commentUnion){
   const currentComments={...blankReviewStore(),attentionTasks:current.attentionTasks.filter(t=>t.review?.kind==='comment')};
   const union=unionCommentStores(id,currentComments,{...blankReviewStore(),attentionTasks:value.attentionTasks});
   // A claimed union must retain every current comment/variant. It cannot be
   // used to delete, silently replace an anchor or import non-comment state.
   if(syncHash(canonical(comments(union.store)))!==incoming.item.digest)throw Error('Comment union would discard a saved variant.');
   const byId=new Map(current.attentionTasks.map(t=>[t.id,t]));
   await writeWorkbench(home,id,current.revision,{...current,attentionTasks:[...current.attentionTasks.filter(t=>t.review?.kind!=='comment'),...value.attentionTasks.map(t=>localCommentPresentation(t,byId.get(t.id)))]},beforeHash);
  }else{
   const remote={...current,attentionTasks:[...current.attentionTasks.filter(t=>t.review?.kind!=='comment'),...value.attentionTasks]},merged=mergeCommentStores(id,current,current,remote);
   if(merged.held.length)throw Error('Comment identities, closure or competing edits require review.');
   if(merged.changed)await writeWorkbench(home,id,current.revision,merged.store,beforeHash);
  }
 }else{
  if(!previous)throw Error('A notebook must already belong to this conversation on both devices.');
  const owner=incoming.item.key.slice(9),nb=JSON.parse(data.toString()),old=JSON.parse(Buffer.from(previous.data,'base64').toString());validateExperimentNotebook(nb);
  const cells=new Map(nb.cells.map(c=>[c.id,c]));
  for(const c of old.cells){const next=cells.get(c.id);if(!next||next.cell_type!==c.cell_type||['filed','deleted'].some(flag=>c.metadata?.paperfocus?.[flag]&&!next.metadata?.paperfocus?.[flag]))throw Error('Notebook deletion, type change or resurrection needs review.');}
  if(incoming.runs!==undefined&&(!Array.isArray(incoming.runs)||incoming.runs.length>200))throw Error('Notebook run bundle exceeds its record limit.');
  const runs=new Map<string,Buffer>();let total=data.length;
  for(const run of incoming.runs??[]){if(!/^[A-Za-z0-9_-]{1,64}\.json$/.test(run.name)||!hashPattern.test(run.sha256)||runs.has(run.name))throw Error('Invalid notebook run bundle.');const raw=Buffer.from(run.data,'base64');if(raw.toString('base64')!==run.data||syncHash(raw)!==run.sha256||(total+=raw.length)>limit)throw Error('Changed or oversized notebook run.');const saved=JSON.parse(raw.toString());validateSyncJson(saved);if(saved.id+'.json'!==run.name||['working','queued'].includes(saved.status)||typeof saved.cellId!=='string')throw Error('Unsettled notebook run.');runs.set(run.name,raw);}
  for(const cell of nb.cells){const run=cell.metadata.paperfocus?.runId;if(run&&run!==old.cells.find((c:any)=>c.id===cell.id)?.metadata.paperfocus?.runId){const raw=runs.get(run+'.json');if(!raw||JSON.parse(raw.toString()).cellId!==cell.id)throw Error('New output is missing its exact saved run provenance.');}}
  const folder=path.join(projectDataPath(home,id),'experiments',owner);
  await withRecordLock(path.join(folder,'python-run'),async()=>{
   for(const [name,raw] of runs)await saveImmutableSyncArtifact(await guardedTarget(folder,'runs/'+name,true),raw,limit);
   const current=await readExperiments(home,id,owner);if(syncHash(canonical(current.notebook))!==previous!.item.digest)throw Error('Notebook changed during collection; run evidence retained.');
   await writeExperiments(home,id,owner,current.revision,nb);
  },0);
 }
 const checked=await packet(home,id,incoming.item.key);if(checked.item.digest!==incoming.item.digest)throw Error('Reading save changed during confirmation; inspect preserved work.');
 await saveImmutableSyncArtifact(await privateSyncPath(home,`reading/${id}/receipts/${receipt}.json`,true),Buffer.from(JSON.stringify({version:1,projectId:id,key:incoming.item.key,before:previous?.item.raw??'',after:checked.item.raw,codeExecuted:false,approvalGranted:false})),4000);
 return {applied:true,alreadyCurrent:false};
}
async function workbenchHash(home:string,id:string){try{return syncHash(await readSyncBytes(await guardedTarget(projectDataPath(home,id),'workbench.json'),4_000_000));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw error;}}

export async function handleReadingMessage(home:string,id:string,value:any){
 validateSyncJson(value);const extras=value?.action==='reading-maintenance'?['detail']:value?.action==='reading-get'?['item','budget']:value?.action==='reading-put'?['packet','expected']:value?.action==='reading-inventory'?['fastOnly']:[];
 if(!value||value.version!==1||!['reading-maintenance','reading-inventory','reading-get','reading-put'].includes(value.action)||Object.keys(value).some(k=>!['version','expectedDeviceId','action','maxBytes',...extras].includes(k))||value.expectedDeviceId!==(await syncStatus(home)).device?.id||value.maxBytes!==limit)throw Error('Invalid scoped reading message.');
 if(value.action==='reading-maintenance')return {version:1,maintenance:await (await import('./syncMaintenance.ts')).maintenanceReport(id,value.detail)};
 if(value.action==='reading-inventory'){if(value.fastOnly!==undefined&&typeof value.fastOnly!=='boolean')throw Error('Invalid fast reading scope.');return {version:1,liveImport:false,inventory:await readingInventory(home,id,value.fastOnly===true)};}
 if(value.action==='reading-get')return {version:1,liveImport:false,packet:await readingPacket(home,id,value.item,value.budget??limit)};
 return {version:1,liveImport:true,...await applyReadingPacket(home,id,value.packet,value.expected)};
}
async function initialBaselines(home:string,id:string){
 const result:Record<string,string>={};const state=await exchangeStatus(home,id);if(!state.commonHead)return result;
 const manifest=await stagedManifest(home,id,state.commonHead);
 for(const ref of manifest.references){if(ref.path.startsWith('source/')&&sourceTypes.test(ref.path))result[ref.path]=ref.sha256;
  else if(ref.kind==='experiment'){const owner=/^data\/experiments\/([^/]+)\/notebook\.ipynb$/.exec(ref.path)?.[1];if(owner){if(ref.semanticHash)result['notebook/'+owner]=ref.semanticHash;else{const nb=JSON.parse((await readSyncBytes(await privateSyncPath(home,`blobs/${ref.sha256}.blob`),limit)).toString());result['notebook/'+owner]=syncHash(canonical(nb));}}}
  else if(ref.path==='data/workbench.json'){const wb=JSON.parse((await readSyncBytes(await privateSyncPath(home,`blobs/${ref.sha256}.blob`),limit)).toString());validateWorkbench(wb);result.comments=syncHash(canonical(comments(wb)));}
 }
 return result;
}
export async function syncReadingRecords(home:string,id:string,peerId:string,runner:SshRunner=runSshMessage,options:{mayWrite?:()=>Promise<boolean>;fastOnly?:boolean;timeoutMs?:number}={}){
 const timeout=options.timeoutMs??30000;
 if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>120000)throw Error('Reading timeout must be bounded to 1–120 seconds.');
 await requireSyncNetwork(home);const peer=await readSshPeer(home,id,peerId),file=await privateSyncPath(home,`reading/${id}/${peerId}.json`,true);
 let prior='',base:Baselines;
 try{const raw=await readSyncBytes(file,2*1024**2);prior=syncHash(raw);base=JSON.parse(raw.toString());validateSyncJson(base);if(base.version!==1||base.projectId!==id||base.peerId!==peerId||base.documentPins!==undefined&&!hashPattern.test(base.documentPins)||base.slideDeck!==undefined&&!hashPattern.test(base.slideDeck)||Object.keys(base.files).length>5000||Object.entries(base.files).some(([k,v])=>{kind(k);return !hashPattern.test(v);}))throw Error('Invalid reading baseline; preserved.');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;base={version:1,projectId:id,peerId,files:await initialBaselines(home,id)};}
 const send=async(action:string,extra:object={})=>{await requireSyncNetwork(home);const request=Buffer.from(JSON.stringify({version:1,expectedDeviceId:peer.options.deviceId,action,maxBytes:limit,...extra}));if(request.length>Math.ceil(limit/3)*4+100000)throw Error('Reading request exceeds its budget.');const raw=await runner(peer.options.host,sshPeerCommand(peer.options,id),request,Math.ceil(limit/3)*4+100000,timeout),reply=JSON.parse(raw.toString());validateSyncJson(reply);if(reply.version!==1||reply.liveImport!==(action==='reading-put'))throw Error('Unexpected reading reply.');return reply;};
 const local=await readingInventory(home,id,options.fastOnly),remote:Inventory=(await send('reading-inventory',options.fastOnly?{fastOnly:true}:{})).inventory;
 if(remote.projectId!==id||remote.deviceId!==peer.options.deviceId||!Array.isArray(remote.items)||remote.items.length>5000||!Array.isArray(remote.deferred)||remote.deferred.length>5000)throw Error('Reading inventory belongs to another project/device or exceeds its budget.');
 for(const item of remote.items)checkItem(item);
 if(remote.absentNotebooks!==undefined&&(!Array.isArray(remote.absentNotebooks)||remote.absentNotebooks.length>2000||remote.absentNotebooks.some(k=>!/^notebook\/[A-Za-z0-9_-]{1,64}$/.test(k))))throw Error('Invalid absent notebook inventory.');
 if(options.fastOnly&&remote.items.some(i=>i.key!=='comments'&&!/^source\/.*\.(tex|bib|md|txt)$/i.test(i.key)))throw Error('Remote exceeded the fast reading scope.');
 // Optional side capability: old clients ignore it and keep their text lane.
 if(options.fastOnly&&local.figures&&remote.figures){
  if(!Array.isArray(remote.figures)||remote.figures.length>64)throw Error('Fast figure scope exceeds its limit.');
  let size=0;for(const item of remote.figures){checkItem(item);if(!/^source\/.+\.(pdf|png|jpe?g|svg|eps|webp|gif)$/i.test(item.key)||item.bytes>2*1024**2||(size+=item.bytes)>8*1024**2)throw Error('Fast figure scope exceeds its byte limit.');}
  local.items.push(...local.figures);remote.items.push(...remote.figures);
 }
 if(remote.documentPins&&local.documentPins&&local.items.length<5000&&remote.items.length<5000){
  checkItem(remote.documentPins);if(remote.documentPins.key!=='document-pins'||remote.documentPins.bytes>8192)throw Error('Invalid document pin capability.');
  local.items.push(local.documentPins);remote.items.push(remote.documentPins);
 }
 if(remote.slideDeck&&local.slideDeck&&local.items.length<5000&&remote.items.length<5000){checkItem(remote.slideDeck);if(remote.slideDeck.key!=='slide-deck'||remote.slideDeck.bytes>8192)throw Error('Invalid slide choice capability.');local.items.push(local.slideDeck);remote.items.push(remote.slideDeck);}
 if(new Set(remote.items.map(i=>i.key)).size!==remote.items.length)throw Error('Duplicate reading identity.');
 const left=new Map(local.items.map(i=>[i.key,i])),right=new Map(remote.items.map(i=>[i.key,i]));
 const allKeys=[...new Set([...left.keys(),...right.keys()])];
 if(new Set(allKeys.map(key=>key.toLowerCase())).size!==allKeys.length)throw Error('Reading paths differ only by letter case; review the names before syncing.');
 const deferred=[...new Set([...local.deferred,...remote.deferred])],held:string[]=[],copied:string[]=[],issues:Array<{key:string;reason:string}>=[];
 // A conversation that never had experiments is ordinary. Losing previously
 // synchronized evidence still needs review, even if absent on both copies.
 for(const key of new Set([...(local.absentNotebooks??[]),...(remote.absentNotebooks??[])]))if(base.files[key])held.push(key);
 let transferredBytes=0,connectionLost=false,seededBytes=0,seededFiles=0;
 for(const key of [...new Set([...left.keys(),...right.keys()])].sort((a,b)=>readingTransferPriority(a)-readingTransferPriority(b)||a.localeCompare(b))){
  if(deferred.includes(key)||key.startsWith('source/')&&deferred.includes('source/'))continue;const l=left.get(key),r=right.get(key),b=key==='slide-deck'?base.slideDeck:key==='document-pins'?base.documentPins:base.files[key];
  if(l&&r&&l.digest===r.digest){
   if(mergeableReadingSource(key)||key==='document-pins'||key==='slide-deck')try{
    if(l.bytes<=textMergeLimits.bytes&&seededFiles<16&&seededBytes+l.bytes<=1024**2&&!await hasReadingSourceBase(home,id,l.digest)){await cacheSourcePacket(home,id,await readingPacket(home,id,l));seededFiles++;seededBytes+=l.bytes;}
    await clearReadingSourceReview(home,id,key);
   }catch(error){issues.push({key,reason:(error as Error).message.slice(0,500)});deferred.push(key);continue;}
   if(key==='slide-deck')base.slideDeck=l.digest;else if(key==='document-pins')base.documentPins=l.digest;else base.files[key]=l.digest;continue;
  }
  if(connectionLost){deferred.push(key);continue;}
  // Fast inventories contain only selected-root figure dependencies. An absent
  // counterpart is not evidence of deletion; the ordinary reading pass checks
  // the complete source inventory and retains its deletion/conflict guards.
  if(options.fastOnly&&b&&(!l||!r)&&/^source\/.+\.(pdf|png|jpe?g|svg|eps|webp|gif)$/i.test(key)){
   // An unchanged known figure needs no fast-lane action. Keep its baseline and
   // let ordinary inventories discover changes outside the selected root.
   if((l??r)?.digest!==b)deferred.push(key);
   continue;
  }
  if(l?.binding&&r?.binding&&l.binding!==r.binding||l?.blocked||r?.blocked){held.push(key);continue;}
  if((key==='document-pins'||key==='slide-deck')&&l&&r){
   try{
    const lp=await readingPacket(home,id,l),rp:Packet=(await send('reading-get',{item:r,budget:8192})).packet;
    if(rp.item.key!==key||rp.item.raw!==r.raw||rp.item.digest!==r.digest||rp.item.binding!==r.binding)throw Error('Reading document pins changed.');
    const saved=b?await readingSourceBase(home,id,b):undefined;
    if(b&&!saved)throw Error('Saved common reading document choices unavailable; both choices are preserved.');
    const value=(key==='slide-deck'?mergeSlideChoice:mergeReadingPins)(saved?JSON.parse(saved):undefined,JSON.parse(bytes(lp).toString()),JSON.parse(bytes(rp).toString()));
    const leftPacket=sourcePacket(lp,canonical(value)),rightPacket=sourcePacket(rp,canonical(value));
    if(transferredBytes+lp.item.bytes+rp.item.bytes+rightPacket.item.bytes>32*1024**2||copied.length>=32)throw Error('Reading batch budget reached');
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no pin write started.');
    if(rightPacket.item.digest!==r.digest)await send('reading-put',{packet:rightPacket,expected:r});
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no local pin write started.');
    if(leftPacket.item.digest!==l.digest)await applyReadingPacket(home,id,leftPacket,l);
    await cacheSourcePacket(home,id,leftPacket);if(key==='slide-deck')base.slideDeck=leftPacket.item.digest;else base.documentPins=leftPacket.item.digest;copied.push(key);transferredBytes+=lp.item.bytes+rp.item.bytes+rightPacket.item.bytes;
   }catch(error){const reason=(error as Error).message;issues.push({key,reason:reason.slice(0,500)});connectionLost=/SSH exchange (?:timed out|unavailable \(255\))|Connection (?:closed|reset|refused|timed out|dropped)|write EOF|ETIMEDOUT|ECONN\w*|ENET\w*|EHOST\w*|Waiting for campus|SSH entry point is unavailable|Network status unavailable/i.test(reason);if(connectionLost||/changed|arrived|locked|budget/i.test(reason))deferred.push(key);else held.push(key);}
   const raw=Buffer.from(JSON.stringify(base));if(syncHash(raw)!==prior)prior=await saveGuardedFile(path.dirname(file),path.basename(file),prior,raw,2*1024**2);
   continue;
  }
  if(mergeableReadingSource(key)&&l&&r&&(!b||l.digest!==b&&r.digest!==b)){
   if(copied.length>=32||transferredBytes+l.bytes+r.bytes+textMergeLimits.bytes>32*1024**2){deferred.push(key);continue;}
   try{
    const localPacket=await readingPacket(home,id,l),remotePacket:Packet=(await send('reading-get',{item:r,budget:limit})).packet;
    if(remotePacket.item.key!==key||remotePacket.item.digest!==r.digest||remotePacket.item.raw!==r.raw||remotePacket.item.binding!==r.binding)throw Error('Reading source moved.');
    const localText=sourceText(bytes(localPacket)),remoteText=sourceText(bytes(remotePacket)),baseText=b?await readingSourceBase(home,id,b):undefined;
    const merge=baseText===undefined?{status:'conflict' as const}:mergeLiteralText(baseText,localText,remoteText);let text=merge.text;
    if(merge.status!=='combined'){
     const review=await saveReadingSourceReview(home,id,{version:1,projectId:id,peerId,key,binding:l.binding,baseHash:b??'',localHash:l.digest,remoteHash:r.digest,...(baseText!==undefined?{baseText}:{}),localText,remoteText,reason:baseText===undefined?'Saved common version unavailable':merge.status==='too-large'?'Comparison exceeds bounded merge work':'Overlapping source edits'});
     const choice=await readingSourceChoice(home,id,review);
     if(choice)text=choice==='local'?localText:remoteText;
     else{held.push(key);issues.push({key,reason:'Both saved versions are kept. Use Compare revisions to choose; neither source was replaced.'});continue;}
    }
    if(text===undefined)throw Error('No checked source merge result.');
    const targetLocal=sourcePacket(localPacket,text),targetRemote=sourcePacket(remotePacket,text);
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no source merge started.');
    if(targetRemote.item.digest!==r.digest)await send('reading-put',{packet:targetRemote,expected:r});
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no local source merge started.');
    if(targetLocal.item.digest!==l.digest)await applyReadingPacket(home,id,targetLocal,l);
    await cacheSourcePacket(home,id,targetLocal);base.files[key]=targetLocal.item.digest;
    await clearReadingSourceReview(home,id,key);copied.push(key);transferredBytes+=localPacket.item.bytes+remotePacket.item.bytes+targetRemote.item.bytes;
   }catch(error){const reason=(error as Error).message;issues.push({key,reason:reason.slice(0,500)});
    connectionLost=/SSH exchange (?:timed out|unavailable \(255\))|Connection (?:closed|reset|refused|timed out|dropped)|write EOF|ETIMEDOUT|ECONN\w*|ENET\w*|EHOST\w*|Waiting for campus|SSH entry point is unavailable|Network status unavailable/i.test(reason);
    if(connectionLost||/changed|moved|locked|budget reached/i.test(reason))deferred.push(key);else held.push(key);}
   const raw=Buffer.from(JSON.stringify(base));if(syncHash(raw)!==prior)prior=await saveGuardedFile(path.dirname(file),path.basename(file),prior,raw,2*1024**2);
   continue;
  }
  if(key==='comments'&&l&&r&&(!b||l.digest!==b&&r.digest!==b)){
   try{
    const localPacket=await readingPacket(home,id,l),remotePacket:Packet=(await send('reading-get',{item:r,budget:limit})).packet;
    if(remotePacket.item.key!==key||remotePacket.item.raw!==r.raw||remotePacket.item.digest!==r.digest||remotePacket.item.binding!==r.binding)throw Error('Reading comments moved.');
    bytes(remotePacket);
    const union=unionCommentStores(id,JSON.parse(Buffer.from(localPacket.data,'base64').toString()),JSON.parse(Buffer.from(remotePacket.data,'base64').toString()));
    const targetLocal=unionPacket(localPacket,union.store),targetRemote=unionPacket(remotePacket,union.store);
    if(transferredBytes+localPacket.item.bytes+remotePacket.item.bytes+targetRemote.item.bytes>32*1024**2)throw Error('Reading batch budget reached');
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no comment write started.');
    // Each side saves with its existing exact-byte/revision guard and before
    // image. An interrupted pair is retried as a union, never rolled back.
    if(targetRemote.item.digest!==r.digest)await send('reading-put',{packet:targetRemote,expected:r});
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no local comment write started.');
    if(targetLocal.item.digest!==l.digest)await applyReadingPacket(home,id,targetLocal,l);
    base.files[key]=targetLocal.item.digest;copied.push(key);transferredBytes+=localPacket.item.bytes+remotePacket.item.bytes+targetRemote.item.bytes;
   }catch(error){const reason=(error as Error).message;issues.push({key,reason:reason.slice(0,500)});
    connectionLost=/SSH exchange (?:timed out|unavailable \(255\))|Connection (?:closed|reset|refused|timed out|dropped)|write EOF|ETIMEDOUT|ECONN\w*|ENET\w*|EHOST\w*|Waiting for campus|SSH entry point is unavailable|Network status unavailable/i.test(reason);
    if(/changed|moved|locked|Connection|SSH exchange|budget reached/i.test(reason))deferred.push(key);else held.push(key);}
   const raw=Buffer.from(JSON.stringify(base));if(syncHash(raw)!==prior)prior=await saveGuardedFile(path.dirname(file),path.basename(file),prior,raw,2*1024**2);
   continue;
  }
  if(b&&(!l||!r)||l&&r&&(!b||l.digest!==b&&r.digest!==b)){held.push(key);continue;}
  const budget=Math.min(limit,32*1024**2-transferredBytes);
  if(budget<1||copied.length>=32){deferred.push(key);continue;}
  try{
   if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no new reading write started.');
   if(r&&(!l||l.digest===b)){
    const value:Packet=(await send('reading-get',{item:r,budget})).packet;if(value.item.key!==key||value.item.digest!==r.digest||value.item.raw!==r.raw||value.item.binding!==r.binding)throw Error('Reading source moved.');
    if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no new reading write started.');
    await applyReadingPacket(home,id,value,l);await cacheSourcePacket(home,id,value);await clearReadingSourceReview(home,id,key);base.files[key]=r.digest;copied.push(key);
    transferredBytes+=value.item.bytes+(value.runs??[]).reduce((n,run)=>n+Buffer.from(run.data,'base64').length,0);
   }else if(l&&(!r||r.digest===b)){
    const value=await readingPacket(home,id,l,budget);if(options.mayWrite&&!await options.mayWrite())throw Error('Sync settings changed; no new reading write started.');await send('reading-put',{packet:value,...(r?{expected:r}:{})});await cacheSourcePacket(home,id,value);await clearReadingSourceReview(home,id,key);base.files[key]=l.digest;copied.push(key);
    transferredBytes+=value.item.bytes+(value.runs??[]).reduce((n,run)=>n+Buffer.from(run.data,'base64').length,0);
   }
  }catch(error){const message=(error as Error).message;issues.push({key,reason:message.slice(0,500)});
   connectionLost=/SSH exchange (?:timed out|unavailable \(255\))|Connection (?:closed|reset|refused|timed out|dropped)|write EOF|ETIMEDOUT|ECONN\w*|ENET\w*|EHOST\w*|Waiting for campus|SSH entry point is unavailable|Network status unavailable/i.test(message);
   const protectedFailure=/checksum|invalid|identity|protected|policy|ownership|deletion|resurrection|provenance|bound|limit|notebook is full/i.test(message);
   if(!protectedFailure&&(connectionLost||/changed|moved|locked|already.*running|\blease\b|Reading batch budget reached|No record lock|SSH exchange (?:unavailable|timed out)|connection|\bEOF\b/i.test(message)))deferred.push(key);else held.push(key);}
  // Each confirmed one-sided record gets its own baseline. Losing a later
  // connection cannot erase earlier progress or require replaying a whole batch.
  const raw=Buffer.from(JSON.stringify(base));if(syncHash(raw)!==prior)prior=await saveGuardedFile(path.dirname(file),path.basename(file),prior,raw,2*1024**2);
 }
 const raw=Buffer.from(JSON.stringify(base));if(syncHash(raw)!==prior)await saveGuardedFile(path.dirname(file),path.basename(file),prior,raw,2*1024**2);
 let maintenance:any;
 if(held.length&&remote.maintenance===true)try{maintenance=(await send('reading-maintenance',{detail:'Held reading records: '+held.slice(0,12).join(', ')})).maintenance;}catch{maintenance={phase:'attention',detail:'Desktop maintenance could not be reached',updatedAt:new Date().toISOString()};}
 return {scope:'reading' as const,copied,held,deferred:[...new Set(deferred)],issues,checked:local.items.length,transferredBytes,wholeProjectAcknowledged:false,codeExecuted:false,approvalGranted:false,maintenance};
}

