// Opt-in first-copy inbox. Only the installed tool runs; received content is inert.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdir,realpath} from 'node:fs/promises';
import {getProject,registry} from '../server/projects.ts';
import {projectStorage} from '../server/projectStorage.ts';
import {readingInventory} from '../server/syncReading.ts';
import {readNotebook} from '../server/notebookStore.ts';
import {initializeSyncDevice,syncStatus,readSyncBytes} from '../server/deviceSync.ts';
import {canonical,syncHash,syncRecord,makeSnapshot,safeSyncId} from '../server/syncProtocol.ts';
import {guardedTarget,saveGuardedFile} from '../server/guardedFile.ts';
import {saveImmutableSyncArtifact,stageSyncSnapshot} from '../server/syncStaging.ts';
import {previewSyncClone} from '../server/syncClone.ts';
import {spawnOwnedSsh} from '../server/ownedProcess.ts';
import {requireSyncNetwork,readSyncNetworkPolicy} from '../server/syncNetwork.ts';
import {linkedWorkspaces} from '../server/linkedWorkspaces.ts';
import {autoSyncStatus} from '../server/syncAuto.ts';
import {readSshPeer} from '../server/syncSsh.ts';
import {acquireScheduleLease} from '../server/syncScheduleLock.ts';
import {linkReading,checkLink} from './awLinkReading.mjs';

const code=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=/^[a-f0-9]{64}$/,maxPacket=96*1024**2;
const json=b=>JSON.parse(b.toString('utf8'));
const bytes=v=>Buffer.from(JSON.stringify(v)+'\n');
async function optional(file,limit=40000){try{return await readSyncBytes(file,limit);}catch(e){if(e.code!=='ENOENT')throw e;}}
function absolute(p){return typeof p==='string'&&path.posix.isAbsolute(p)&&!/[\x00-\x1f'\\]/.test(p)&&path.posix.normalize(p)===p;}
export function validateConfig(c,role){
 if(c?.version!==1||c.enabled!==true||!/^[-A-Za-z0-9_]{1,100}$/.test(c.host)||!absolute(c.projectsRoot)||!absolute(c.queue)||!absolute(c.remoteTool)||!c.remoteTool.endsWith('/scripts/awReadingLink.mjs')||!absolute(c.producerConfig)||!Number.isSafeInteger(c.maxPacketBytes)||c.maxPacketBytes<10000||c.maxPacketBytes>maxPacket)throw Error('Reading-link configuration is disabled or invalid.');
 if(role==='laptop'&&(!path.isAbsolute(c.workspace)||!path.isAbsolute(c.destinationRoot)))throw Error('Use exact laptop control and destination homes.');
 return c;
}
async function config(file,role){const c=validateConfig(json(await readSyncBytes(file,12000)),role);if(role==='desktop'&&path.resolve(file)!==path.resolve(c.producerConfig))throw Error('Producer configuration does not match its pinned path.');return c;}
async function queueFile(c,id,name){if(!hash.test(id)||!['request.json','prepared.json','completed.json'].includes(name))throw Error('Invalid inbox key.');return guardedTarget(c.queue,id+'/'+name,true);}
async function containedHome(c,home){
 if(!absolute(home)||home===c.projectsRoot||!home.startsWith(c.projectsRoot+'/'))throw Error('Project is outside the approved desktop projects root.');
 // Reject symlinks in every child component, then compare resolved parents.
 await guardedTarget(c.projectsRoot,home.slice(c.projectsRoot.length+1)+'/.paperfocus/projects.json');
 const parent=await realpath(c.projectsRoot),actual=await realpath(home),rel=path.relative(parent,actual);
 if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Project escapes its enrolled root.');
 return home;
}
export async function requestLink(c,home,id,mainFile){
 validateConfig(c,'desktop');await containedHome(c,home);if(!safeSyncId(id))throw Error('Choose an exact project ID.');
 const {project}=await getProject(home,id);
 if(mainFile!==undefined&&(typeof mainFile!=='string'||!mainFile.endsWith('.tex')||/[\x00-\x1f]/.test(mainFile)))throw Error('Invalid selected root.');
 const key=syncHash(canonical({home,projectId:id})),target=await queueFile(c,key,'request.json'),prior=await optional(target);
 if(prior){const saved=json(prior);if(saved.home!==home||saved.projectId!==id||mainFile!==undefined&&saved.mainFile!==mainFile)throw Error('An existing request has another reading scope; preserved.');return {id:key,status:(await optional(await queueFile(c,key,'completed.json')))?'linked':'queued',alreadyRequested:true};}
 const intent={version:1,id:key,home,projectId:id,name:project.name,...(mainFile?{mainFile}:{}),requestedAt:new Date().toISOString()};
 await saveImmutableSyncArtifact(target,bytes(intent),12000);
 return {id:key,status:'queued',alreadyRequested:false};
}
function policy(p){return {name:p.name,createdAt:p.createdAt,manuscriptPurposes:p.manuscriptPurposes??{},manuscriptVersions:p.manuscriptVersions??[],manuscriptOverviewTargets:p.manuscriptOverviewTargets??{},...(p.manuscriptPins?{manuscriptPins:p.manuscriptPins}:{}),...(p.slideDeck?{slideDeck:p.slideDeck}:{})};}
export async function prepareLink(c,key){
 const intent=json(await readSyncBytes(await queueFile(c,key,'request.json'),12000));
 if(intent.version!==1||intent.id!==key||!safeSyncId(intent.projectId)||syncHash(canonical({home:intent.home,projectId:intent.projectId}))!==key)throw Error('Invalid request identity.');
 await containedHome(c,intent.home);
 const prepared=await queueFile(c,key,'prepared.json'),prior=await optional(prepared,c.maxPacketBytes+100000);
 if(prior)return json(prior);
 const home=intent.home,id=intent.projectId,{project,root}=await getProject(home,id),storage=await projectStorage(home,id);
 if(!(await syncStatus(home)).device)await initializeSyncDevice(home,'Desktop');
 const inventory=await readingInventory(home,id);if(inventory.deferred.length)throw Error('Waiting for unsettled saved reading records.');
 const records=[],observed=[];let total=0;
 async function add(name,kind,folder,relative){const raw=await readSyncBytes(await guardedTarget(folder,relative),24*1024**2);total+=raw.length;if(total>c.maxPacketBytes*0.70)throw Error('Reading copy exceeds its configured inline budget; explicit smaller scope required.');observed.push({folder,relative,hash:syncHash(raw)});records.push(syncRecord(name,kind,raw));return raw;}
 for(const item of inventory.items.filter(i=>i.key.startsWith('source/')))await add(item.key,/\.(tex|bib|md|txt|py|json|ya?ml|sty|cls)$/i.test(item.key)?'source':'asset',root,item.key.slice(7));
 const nb=await readNotebook(home,id);
 try{await add('data/notebook.json','catalogue',storage.folder,'notebook.json');}catch(e){
  if(e.code!=='ENOENT')throw e;
  // A newly created project may not have saved a notebook yet. Retain the
  // native empty catalogue without creating/replacing desktop records.
  if(nb.entries.length||nb.revision)throw Error('Missing saved notebook catalogue.');
  records.push(syncRecord('data/notebook.json','catalogue',bytes(nb)));
  observed.push({folder:storage.folder,relative:'notebook.json',hash:null});
 }
 try{await add('data/workbench.json','review',storage.folder,'workbench.json');}catch(e){if(e.code!=='ENOENT')throw e;}
 for(const owner of new Set(nb.entries.map(e=>e.experimentNotebookId??e.id))){
  let raw;try{raw=await add(`data/experiments/${owner}/notebook.ipynb`,'experiment',storage.folder,`experiments/${owner}/notebook.ipynb`);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  const notebook=json(raw),runs=new Set(notebook.cells.flatMap(c=>c.metadata?.paperfocus?.executionId?[c.metadata.paperfocus.executionId]:[]));
  for(const run of runs){if(!/^[A-Za-z0-9_-]{1,100}$/.test(run))throw Error('Invalid saved run identity.');await add(`data/experiments/${owner}/runs/${run}.json`,'run',storage.folder,`experiments/${owner}/runs/${run}.json`);}
 }
 records.push(syncRecord('project/manuscripts.json','policy',bytes(policy(project))));
 for(const f of observed){const raw=await optional(await guardedTarget(f.folder,f.relative),24*1024**2);if((raw?syncHash(raw):null)!==f.hash)throw Error('Saved files changed during preparation; retry later.');}
 if(canonical(policy((await getProject(home,id)).project))!==canonical(policy(project)))throw Error('Reading policy changed; retry later.');
 const snapshot=makeSnapshot(id,(await syncStatus(home)).device,records),packet=bytes(snapshot),mainFile=intent.mainFile??project.manuscriptPins?.notes??project.mainFile;
 if(packet.length>c.maxPacketBytes)throw Error('Reading packet is over budget.');
 // Full native schema, ownership and pending-request guards; no destination is created.
 const preview=await previewSyncClone(snapshot,{destination:path.join(c.queue,'validation-'+key),mainFile,label:'Laptop'});
 if(preview.pending.length)throw Error('Waiting for pending requests to settle; nothing replayed.');
 const plan={version:1,sshAlias:c.host,projectId:id,desktopDeviceId:snapshot.device.id,snapshotId:snapshot.id,packetSha256:syncHash(packet),packetBytes:packet.length,desktopWorkspace:home,remoteTool:c.remoteTool.replace(/awReadingLink\.mjs$/,'awSync.ts'),mainFile,expectedCells:preview.counts.cells,...(project.manuscriptPins?{manuscriptPins:project.manuscriptPins}:{}),rawArraysIncluded:false};
 const bundle={version:1,id:key,plan,snapshot};
 await stageSyncSnapshot(home,id,snapshot);
 await saveImmutableSyncArtifact(prepared,bytes(bundle),c.maxPacketBytes+100000);
 return bundle;
}
export async function pendingLinks(c){
 const names=await readdir(c.queue,{withFileTypes:true});if(names.length>256)throw Error('Reading inbox requires archival housekeeping.');
 const pending=[];
 for(const item of names){if(!item.isDirectory()||!hash.test(item.name))continue;
  if(await optional(await queueFile(c,item.name,'completed.json')))continue;
  const raw=await optional(await queueFile(c,item.name,'request.json'));if(raw)pending.push({id:item.name,requestedAt:json(raw).requestedAt});
 }
 return pending.sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)).slice(0,64);
}
export async function acknowledgeLink(c,key,receipt){
 const bundle=await prepareLink(c,key);
 if(receipt?.version!==1||receipt.id!==key||receipt.projectId!==bundle.plan.projectId||receipt.snapshotId!==bundle.plan.snapshotId||receipt.committed!==true||!safeSyncId(receipt.laptopDevice)||receipt.laptopDevice===bundle.plan.desktopDeviceId||!hash.test(receipt.peerId))throw Error('Invalid laptop completion receipt.');
 await saveImmutableSyncArtifact(await queueFile(c,key,'completed.json'),bytes(receipt),20000);
 return {id:key,status:'linked'};
}
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
async function remote(c,action,key,part,input){
 const command=['node',c.remoteTool,'serve','--config',c.producerConfig,'--action',action,...(key?['--id',key]:[]),...(part?['--part',part]:[])].map(quote).join(' ');
 const child=await spawnOwnedSsh(['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=30',c.host,command]);
 return new Promise((resolve,reject)=>{const chunks=[];let length=0,error='',settled=false;
  const end=(e,v)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(v);};
  const timer=setTimeout(()=>{child.kill();end(Error('Reading-link connection timed out; request retained.'));},120000);
  child.stdout.on('data',b=>{length+=b.length;if(length>c.maxPacketBytes+100000){child.kill();end(Error('Reading inbox response exceeds budget.'));}else chunks.push(b);});
  child.stderr.on('data',b=>{if(error.length<2000)error+=b.toString();});child.on('error',e=>end(e));child.stdin.on('error',e=>end(e));
  child.on('close',n=>end(n?Error(error||'Desktop request is not ready.'):undefined,Buffer.concat(chunks)));
  child.stdin.end(input);
 });
}
export function validateOffer(c,key,plan,snapshot,packet){
 if(!hash.test(key)||!safeSyncId(plan.projectId)||syncHash(canonical({home:plan.desktopWorkspace,projectId:plan.projectId}))!==key||!absolute(plan.desktopWorkspace)||!plan.desktopWorkspace.startsWith(c.projectsRoot+'/')||plan.remoteTool!==c.remoteTool.replace(/awReadingLink\.mjs$/,'awSync.ts')||plan.packetBytes>c.maxPacketBytes)throw Error('Offer is outside the enrolled first-copy scope.');
 checkLink(plan,snapshot,packet,c.host);
 return plan.projectId;
}
export async function collectLinks(c,hooks={}){
 validateConfig(c,'laptop');const home=await realpath(c.workspace);
 if(!await readSyncNetworkPolicy(home))throw Error('Configure the campus/VPN gate before enabling the inbox.');
 await (hooks.gate??requireSyncNetwork)(home);
 const call=hooks.remote??((action,key,part,input)=>remote(c,action,key,part,input));
 const entries=json(await call('list'));if(!Array.isArray(entries)||entries.length>64||entries.some(e=>!hash.test(e.id)))throw Error('Invalid desktop inbox.');
 const root=path.resolve(c.destinationRoot),relative=path.relative(home,root);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Reading homes must be children of the control home.');
 await guardedTarget(home,relative.split(path.sep).join('/')+'/sentinel',true);
 let links;
 const known=new Set((await registry(home)).projects.map(p=>p.id));
 const summary=[];
 for(const entry of entries){
  const folder='.paperfocus/device-sync/reading-inbox/'+entry.id;
  const statusFile=await guardedTarget(home,folder+'/status.json',true),prior=await optional(statusFile);const priorStatus=prior?json(prior):{};
  if(priorStatus.retryAt&&Date.parse(priorStatus.retryAt)>Date.now())continue;
  try{
   const completionFile=await guardedTarget(home,folder+'/completed.json'),completed=await optional(completionFile);
   if(completed){await call('ack',entry.id,undefined,completed);summary.push({id:entry.id,status:'linked',alreadyComplete:true});continue;}
   const planFile=await guardedTarget(home,folder+'/link-plan.json'),packetFile=await guardedTarget(home,folder+'/baseline.json');
   let planRaw=await optional(planFile),packet=await optional(packetFile,c.maxPacketBytes);
   if(!planRaw){planRaw=await call('get',entry.id,'plan');if(planRaw.length>20000)throw Error('Oversized link plan.');await saveImmutableSyncArtifact(planFile,planRaw,20000);}
   const plan=json(planRaw);
   // Check metadata before downloading the larger packet.
   if(plan.packetBytes>c.maxPacketBytes||plan.remoteTool!==c.remoteTool.replace(/awReadingLink\.mjs$/,'awSync.ts')||!absolute(plan.desktopWorkspace)||!plan.desktopWorkspace.startsWith(c.projectsRoot+'/'))throw Error('Offer exceeds enrolled scope.');
   if(!safeSyncId(plan.projectId)||syncHash(canonical({home:plan.desktopWorkspace,projectId:plan.projectId}))!==entry.id||plan.sshAlias!==c.host)throw Error('Invalid link identity.');
   links??=await linkedWorkspaces(home);
   const id=plan.projectId,destination=path.join(root,'reading-'+id),existing=links.find(p=>p.projectId===id);
   if(known.has(id)||existing){
    const existingHome=known.has(id)?home:path.resolve(home,existing.folder),state=await autoSyncStatus(existingHome,id);
    if((known.has(id)||path.resolve(home,existing.folder)!==destination)&&state.config?.enabled&&state.config.mode==='safe'&&state.config.readingOnly){
     const peer=await readSshPeer(existingHome,id,state.config.peerId),device=(await syncStatus(existingHome)).device;
     if(peer.options.host===c.host&&peer.options.workspace===plan.desktopWorkspace&&peer.options.tool===plan.remoteTool&&peer.options.deviceId===plan.desktopDeviceId&&device){
      const receipt={version:1,id:entry.id,projectId:id,snapshotId:plan.snapshotId,laptopDevice:device.id,peerId:peer.id,committed:true,home:existingHome,reusedExisting:true,baselineImported:false};
      await saveImmutableSyncArtifact(completionFile,bytes(receipt),20000);await call('ack',entry.id,undefined,bytes(receipt));summary.push({id:entry.id,projectId:id,status:'linked',reusedExisting:true});continue;
     }
    }
    // A partial new copy may already be in the chooser; native exact-plan retry
    // below is allowed only at its assigned deterministic destination.
    if(known.has(id)||path.resolve(home,existing.folder)!==destination)throw Error('An existing project has a different/paused peer; preserved.');
   }
   if(!packet){packet=await call('get',entry.id,'packet');await saveImmutableSyncArtifact(packetFile,packet,c.maxPacketBytes);}
   const snapshot=json(packet);validateOffer(c,entry.id,plan,snapshot,packet);
   const options={workspace:home,packet:packetFile,'link-plan':planFile,destination,host:c.host};
   const preview=await (hooks.link??linkReading)(options);
   const reviewFile=await guardedTarget(home,folder+'/review.json'),savedReview=await optional(reviewFile);
   if(savedReview&&json(savedReview).review!==preview.review)throw Error('Interrupted setup inputs changed; explicit inspection required.');
   if(!savedReview)await saveImmutableSyncArtifact(reviewFile,bytes({review:preview.review,projectId:id,snapshotId:snapshot.id}),20000);
   const result=await (hooks.link??linkReading)({...options,review:preview.review,commit:true});
   if(!result.committed||!result.journalsEnrolled||!result.projectChooserRegistered)throw Error('Setup did not return all completion receipts.');
   const receipt={version:1,id:entry.id,projectId:id,snapshotId:snapshot.id,laptopDevice:result.cloneReceipt.deviceId,peerId:result.peerId,committed:true,home:result.home,url:result.url};
   await saveImmutableSyncArtifact(completionFile,bytes(receipt),20000);
   await call('ack',entry.id,undefined,bytes(receipt));summary.push({id:entry.id,projectId:id,status:'linked',url:result.url});
  }catch(e){const s={id:entry.id,status:'pending',detail:e.message,retryAt:new Date(Date.now()+5*60000).toISOString()};await saveGuardedFile(home,folder+'/status.json',prior?syncHash(prior):'',bytes(s),20000);summary.push(s);}
  break; // One first copy per scheduled pass; existing sync keeps its slots.
 }
 return {checkedAt:new Date().toISOString(),pending:Math.max(0,entries.length-summary.filter(r=>r.status==='linked').length),results:summary};
}
export function options(args){const command=args.shift(),o={};for(let i=0;i<args.length;i+=2){if(!['--workspace','--project','--main-file','--config','--action','--id','--part'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||o[args[i].slice(2)])throw Error('Unknown/repeated/incomplete option.');o[args[i].slice(2)]=args[i+1];}return {command,...o};}
async function main(args){
 if(args.includes('--help'))return console.log('Opt-in desktop → laptop reading inbox. No service, cloud or research execution.\nDesktop: request --workspace HOME --project ID [--main-file ROOT.tex] [--config PRODUCER.json]\nLaptop: once --config RECIPIENT.json | status --config RECIPIENT.json\nPrivate configs pin the approved SSH alias, installed tool, queue and project roots. Requests persist offline; use existing homes for later versions. See docs/DEVICE_SYNC.md.');
 const o=options(args),role=['request','serve'].includes(o.command)?'desktop':'laptop';
 const file=o.config??path.join(code,'.paperfocus/device-sync/reading-producer.json'),c=await config(file,role);
 if(o.command==='request')return console.log(JSON.stringify(await requestLink(c,o.workspace,o.project,o['main-file'])));
 if(o.command==='serve'){
  if(o.action==='list')return console.log(JSON.stringify(await pendingLinks(c)));
  if(!hash.test(o.id))throw Error('Choose an exact inbox key.');
  if(o.action==='get'){const b=await prepareLink(c,o.id);if(o.part==='plan')process.stdout.write(bytes(b.plan));else if(o.part==='packet')process.stdout.write(bytes(b.snapshot));else throw Error('Unknown part.');return;}
  if(o.action==='ack'){let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>20000)throw Error('Receipt too large.');}return console.log(JSON.stringify(await acknowledgeLink(c,o.id,JSON.parse(raw))));}
  throw Error('Unknown inbox action.');
 }
 const statusName='.paperfocus/device-sync/reading-inbox/status.json';
 if(o.command==='status')return console.log((await optional(await guardedTarget(c.workspace,statusName)))?.toString()??'{"status":"not-checked"}');
 if(o.command!=='once')throw Error('Unknown command.');
 const slot=await guardedTarget(c.workspace,'.paperfocus/device-sync/auto/reading-link-coordinator',true),release=await acquireScheduleLease(slot);
 try{
  let result;try{result=await collectLinks(c);}catch(e){result={checkedAt:new Date().toISOString(),status:'waiting',detail:e.message};}
  const target=await guardedTarget(c.workspace,statusName,true),old=await optional(target);await saveGuardedFile(c.workspace,statusName,old?syncHash(old):'',bytes(result),40000);console.log(JSON.stringify(result));
 }finally{await release();}
}
if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase())main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
