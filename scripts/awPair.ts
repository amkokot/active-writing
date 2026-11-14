// One selected project's first desktop copy, journalled and resumable. All data
// stays private on the chosen SSH host. No model, experiment or editor is started.
import path from 'node:path';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {getProject} from '../server/projects.ts';
import {createPaperProject} from '../server/projectFiles.ts';
import {enableBulkSync} from '../server/syncBulkCapture.ts';
import {syncWorkingCheckpoint} from '../server/syncExchange.ts';
import {privateSyncPath,readSyncSnapshot,initializeSyncDevice,syncStatus,captureSyncSnapshot,saveSyncSnapshot} from '../server/deviceSync.ts';
import {canonical,syncHash,safeSyncId} from '../server/syncProtocol.ts';
import {guardedTarget} from '../server/guardedFile.ts';
import {saveImmutableSyncArtifact,syncStateHash,stagedHistory,hydrateStagedSnapshot,stageSyncSnapshot} from '../server/syncStaging.ts';
import {verifyBlob,receiveBlob,type BlobRef} from '../server/syncBlobs.ts';
import {createReadStream} from 'node:fs';
import {previewSshPeer,commitSshPeer,listSshPeers} from '../server/syncSsh.ts';
import {transferSshBlobs} from '../server/syncBlobSsh.ts';
import {configureAutoSync} from '../server/syncAuto.ts';
import {withRecordLock} from '../server/recordLock.ts';
import {appCodeRoot} from '../server/appPaths.ts';
import {previewSyncClone} from '../server/syncClone.ts';

const run=promisify(execFile),q=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'";
const args=process.argv.slice(2),command=args.shift(),flags:Record<string,string>={};
for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!args[i].startsWith('--')||!key||flags[key]||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Use complete, unique --option VALUE pairs.');flags[key]=args[i+1];}
const ssh=async(host:string,cmd:string,timeout=120000)=>(await run('ssh',['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','--',host,cmd],{windowsHide:true,timeout,maxBuffer:16*1024**2})).stdout;
const report=(value:unknown)=>console.log(JSON.stringify(value));
async function saved(file:string){const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>140*1024**2)throw new Error('Linked or oversized setup record.');return JSON.parse(await readFile(file,'utf8'));}
async function copyPacket(host:string,local:string,target:string){const hash=syncHash(await readFile(local)),known=await ssh(host,`if test -e ${q(target)}; then sha256sum ${q(target)}; fi`);if(known){if(known.split(/\s/)[0]!==hash)throw new Error('Existing immutable transfer packet changed; preserved.');return;}const upload=path.posix.dirname(target)+'/upload-'+randomUUID()+'.part';await run('scp',['-q','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',local,host+':'+upload],{windowsHide:true,timeout:120000});await ssh(host,`test "$(sha256sum ${q(upload)} | cut -d ' ' -f1)" = ${q(hash)} && ln ${q(upload)} ${q(target)}`);}
async function packets(file:string,projectId:string){
 const value=await saved(file);if(value.format!=='aw-setup-history'){const snapshot=await readSyncSnapshot(file);if(snapshot.projectId!==projectId)throw new Error('Wrong transfer project.');return [snapshot];}
 if(value.version!==2||value.projectId!==projectId||!Array.isArray(value.ids)||value.ids.length>257||new Set(value.ids).size!==value.ids.length||value.ids.some((id:unknown)=>typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id)))throw new Error('Invalid setup history index.');
 const result=[];let metadataBytes=0;for(const id of value.ids){const target=await guardedTarget(path.dirname(file),id+'.json');if((metadataBytes+=(await lstat(target)).size)>512*1024**2)throw new Error('Initial history metadata exceeds its one-time 512 MB budget; use the incremental history workflow.');const snapshot=await readSyncSnapshot(target);if(snapshot.projectId!==projectId||snapshot.id!==id)throw new Error('History project/checksum mismatch.');result.push(snapshot);}
 const head=result.at(-1);if(!head||canonical([...head.ancestors].sort())!==canonical(value.ids.slice(0,-1).sort()))throw new Error('Incomplete or unrelated setup history.');return result;
}
function posix(value:string){if(!value?.startsWith('/')||/[\x00-\x1f]/.test(value)||value.split('/').some(p=>p==='..')||value.length>400)throw new Error('Use an explicit absolute desktop path without traversal.');return value.replace(/\/$/,'');}
async function progress(home:string,id:string,value:unknown){const file=await privateSyncPath(home,`setup/${id}/progress.json`,true);await writeFile(file,JSON.stringify({at:new Date().toISOString(),...value as object}));report(value);}
try{
 const allowed:Record<string,string[]>={capabilities:[],cache:['workspace','name'],missing:['workspace','project','file'],'adopt-history':['workspace','project','file','cache'],prepare:['workspace','project','host','remote-code','remote-parent','auto'],new:['workspace','name','host','remote-code','remote-parent','auto'],commit:['workspace','project','plan','saved-drafts'],status:['workspace','project','plan']};
 if(command&&allowed[command]&&Object.keys(flags).some(k=>!allowed[command].includes(k)))throw new Error('Unknown setup option; use --help.');
 if(flags.auto!==undefined&&!['yes','no'].includes(flags.auto))throw new Error('Use --auto yes or no.');
 if(!command||['help','--help'].includes(command)){report({help:`Aw paired-project setup (private SSH, no API calls)
node scripts/awPair.ts prepare --workspace LAPTOP_HOME --project ID --host SSH_ALIAS --remote-code /INSTALLED/CODE --remote-parent /DESKTOP/PROJECTS [--auto yes]
node scripts/awPair.ts commit --workspace LAPTOP_HOME --project ID --plan RETURNED_HASH --saved-drafts yes
node scripts/awPair.ts status --workspace LAPTOP_HOME --project ID --plan RETURNED_HASH
node scripts/awPair.ts new --workspace LAPTOP_HOME --name NAME --host SSH_ALIAS --remote-code /INSTALLED/CODE --remote-parent /DESKTOP/PROJECTS [--auto yes]

prepare stages a streaming checkpoint and checks the chosen host; it never copies
over an existing desktop home. Review then commit the exact saved plan. new creates
a standard research-notes project first, then prepares it. Laptop source/records
remain independent. Only saved work transfers; save browser drafts first.
Commit returns a laptop viewing link and desktop workspace/launcher instructions.
Auto yes enables safe saved-work sync, never job replay or conflict overrides.
Repeat an interrupted commit with the same plan; changed copies stop, not overwrite.
App code/Node must already be installed remotely; no credentials or dependencies
are installed by this helper. Desktop compute/chat control remains separate.`});}
 else if(command==='capabilities'){report({format:'aw-pair-capabilities',version:2,codeRoot:appCodeRoot,streamingBlobs:true});}
 else if(command==='cache'){
  if(!/^\.aw-incoming-[a-f0-9]{16}$/.test(flags.name??''))throw new Error('Use an exact private cache name.');
  const file=await guardedTarget(await realpath(flags.workspace),flags.name+'/project.json',true),cache=path.dirname(file);
  await initializeSyncDevice(cache,'Transfer-cache');report({workspace:cache,deviceId:(await syncStatus(cache)).device?.id});
 }else if(command==='missing'){
  const snapshots=await packets(flags.file,flags.project);
  const refs=new Map<string,BlobRef>();for(const snapshot of snapshots)for(const record of snapshot.records.filter(r=>r.external)){try{await verifyBlob(flags.workspace,record);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;refs.set(record.sha256,{sha256:record.sha256,bytes:record.bytes});}}
  report({deviceId:(await syncStatus(flags.workspace)).device?.id,refs:[...refs.values()]});
 }else if(command==='adopt-history'){
  const home=await realpath(flags.workspace),snapshots=await packets(flags.file,flags.project),receipt=await saved(await privateSyncPath(home,'clone-ready.json'));
  if(receipt.projectId!==flags.project||receipt.snapshotId!==snapshots.at(-1)?.id)throw new Error('History is not this first-copy baseline.');
  for(const snapshot of snapshots){for(const record of snapshot.records.filter(r=>r.external)){try{await verifyBlob(home,record);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await receiveBlob(home,record,createReadStream(await verifyBlob(flags.cache,record)));}}await saveSyncSnapshot(home,snapshot);await stageSyncSnapshot(home,flags.project,snapshot);}
  const history=await stagedHistory(home,flags.project,[receipt.snapshotId]);if(history.missing.length||history.pending.length)throw new Error('History staging incomplete; retain all preparations.');report({complete:true,head:receipt.snapshotId,staged:snapshots.length});
 }else{
  const home=await realpath(flags.workspace);
  if(['new','prepare'].includes(command)){
   if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(flags.host??''))throw new Error('Choose a concrete trusted SSH alias.');
   const remoteCode=posix(flags['remote-code']),parent=posix(flags['remote-parent']);
   let projectId=flags.project;
   if(command==='new'){if(!flags.name||projectId)throw new Error('Choose one new project name, not an existing project ID.');projectId=(await createPaperProject(home,flags.name)).id;report({createdProject:projectId});}
   if(!safeSyncId(projectId))throw new Error('Choose an exact registered project.');
   const {project}=await getProject(home,projectId);
   if((await listSshPeers(home,projectId)).length)throw new Error('This project already has a pinned peer. Use Sync now, not a second first copy.');
   if(!(await syncStatus(home)).device)await initializeSyncDevice(home,'Laptop');
   await enableBulkSync(home,projectId);await progress(home,projectId,{step:'capture',projectId});
   const checkpoint=await syncWorkingCheckpoint(home,projectId),snapshot=await readSyncSnapshot(checkpoint.path);
   const preflight=await previewSyncClone(snapshot,{destination:await privateSyncPath(home,`setup/${projectId}/checked-home`),mainFile:project.mainFile,label:'Desktop',blobHome:home,...(project.engine?{engine:project.engine}:{})});
   if(preflight.pending.length)throw new Error('Pending saved requests/runs must settle before first copy: '+preflight.pending.slice(0,8).join('; '));
   const graph=await stagedHistory(home,projectId,[snapshot.id]);if(graph.missing.length||graph.pending.length)throw new Error('Finish staged history before setup.');
   const history=[];for(const manifest of [...graph.graph.values()].sort((a,b)=>a.metadata.ancestors.length-b.metadata.ancestors.length)){let file=await privateSyncPath(home,`snapshots/${manifest.metadata.id}.json`);try{await lstat(file);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;file=(await saveSyncSnapshot(home,await hydrateStagedSnapshot(home,projectId,manifest.metadata.id))).path;}history.push({id:manifest.metadata.id,path:file});}
   const remoteHome=parent+'/'+(project.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'research')+'-'+projectId.slice(0,8);
   const capability=JSON.parse(await ssh(flags.host,`test -d ${q(parent)} && test ! -e ${q(remoteHome)} && node ${q(remoteCode+'/scripts/awPair.ts')} capabilities`));
   if(capability.version!==2||capability.streamingBlobs!==true)throw new Error('Desktop Aw needs the streaming-sync code installed separately first.');
   const options={host:flags.host,remoteCode,remoteHome,parent,auto:flags.auto==='yes',mainFile:project.mainFile,...(project.engine?{engine:project.engine}:{})};
   const body={format:'aw-paired-project-setup',version:2,projectId,localHome:home,snapshotId:snapshot.id,snapshotPath:checkpoint.path,stateHash:syncStateHash(snapshot),history,options};
   const plan={...body,id:syncHash(canonical(body))},file=await privateSyncPath(home,`setup/${projectId}/${plan.id}.json`,true);await saveImmutableSyncArtifact(file,Buffer.from(JSON.stringify(plan)),16*1024**2);
   report({planId:plan.id,projectId,name:project.name,remoteWorkspace:remoteHome,fileCount:snapshot.records.length,evidenceBytes:snapshot.records.filter(r=>r.external).reduce((n,r)=>n+r.bytes,0),inlineBytes:snapshot.records.filter(r=>!r.external).reduce((n,r)=>n+r.bytes,0),automaticSync:options.auto,localViewingQuery:'?awProject='+projectId,next:`node ${q(path.join(appCodeRoot,'scripts/awPair.ts'))} commit --workspace ${q(home)} --project ${projectId} --plan ${plan.id} --saved-drafts yes`,liveImport:false});
  }else if(['commit','status'].includes(command)){
   if(!safeSyncId(flags.project)||!/^[a-f0-9]{64}$/.test(flags.plan??''))throw new Error('Use the exact saved project/plan.');
   const plan=await saved(await privateSyncPath(home,`setup/${flags.project}/${flags.plan}.json`)),{id,...body}=plan;
   if(id!==flags.plan||syncHash(canonical(body))!==id||plan.localHome!==home||plan.projectId!==flags.project)throw new Error('Setup plan identity changed.');
   const resultFile=await privateSyncPath(home,`setup/${flags.project}/${id}.ready.json`,true);
   try{const result=await saved(resultFile);report({...result,alreadyComplete:true});process.exit(0);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   if(command==='status'){report({planId:id,complete:false,progress:await saved(await privateSyncPath(home,`setup/${flags.project}/progress.json`)).catch(()=>undefined)});process.exit(0);}
   if(flags['saved-drafts']!=='yes')throw new Error('Save drafts on both copies; pass --saved-drafts yes for this exact first copy.');
   await withRecordLock(await privateSyncPath(home,`setup/${flags.project}/${id}.operation`,true),async()=>{
    const snapshot=await readSyncSnapshot(plan.snapshotPath);if(snapshot.id!==plan.snapshotId||syncStateHash(snapshot)!==plan.stateHash||syncStateHash(await captureSyncSnapshot(home,plan.projectId))!==plan.stateHash)throw new Error('Saved laptop work or packet changed; prepare a fresh plan. Original preparations retained.');
    const o=plan.options,cache=o.parent+'/.aw-incoming-'+id.slice(0,16),packet=cache+'/project.json';
    const cacheInfo=JSON.parse(await ssh(o.host,`node ${q(o.remoteCode+'/scripts/awPair.ts')} cache --workspace ${q(o.parent)} --name ${q(path.posix.basename(cache))}`));if(cacheInfo.workspace!==cache)throw new Error('Desktop cache path changed.');
    await copyPacket(o.host,plan.snapshotPath,packet);
    const history=plan.history??[{id:plan.snapshotId,path:plan.snapshotPath}];
    for(const item of history)await copyPacket(o.host,item.path,cache+'/'+item.id+'.json');
    const index=await privateSyncPath(home,`setup/${plan.projectId}/${id}.history.json`,true);await saveImmutableSyncArtifact(index,Buffer.from(JSON.stringify({format:'aw-setup-history',version:2,projectId:plan.projectId,ids:history.map((x:{id:string})=>x.id)})),100000);
    await copyPacket(o.host,index,cache+'/history.json');
    const missing=JSON.parse(await ssh(o.host,`node ${q(o.remoteCode+'/scripts/awPair.ts')} missing --workspace ${q(cache)} --project ${plan.projectId} --file ${q(cache+'/history.json')}`));
    await progress(home,plan.projectId,{step:'transfer',files:missing.refs.length,bytes:missing.refs.reduce((n:number,r:BlobRef)=>n+r.bytes,0)});
    await transferSshBlobs(home,plan.projectId,{host:o.host,platform:'posix',tool:o.remoteCode+'/scripts/awSync.ts',workspace:cache,deviceId:missing.deviceId},missing.refs,'write',128*1024**3);
    await progress(home,plan.projectId,{step:'first-copy',remoteWorkspace:o.remoteHome});
    const clone=`node ${q(o.remoteCode+'/scripts/awSync.ts')} clone --file ${q(packet)} --destination ${q(o.remoteHome)} --main-file ${q(o.mainFile)} --label Desktop --blob-home ${q(cache)}${o.engine?' --engine '+q(o.engine):''}`;
    const preview=JSON.parse(await ssh(o.host,clone,30*60000));if(preview.pending.length)throw new Error('Pending work prevents first copy. Nothing was replayed.');
    const copied=JSON.parse(await ssh(o.host,clone+' --plan '+preview.planId+' --commit',30*60000));
    await ssh(o.host,`node ${q(o.remoteCode+'/scripts/awPair.ts')} adopt-history --workspace ${q(o.remoteHome)} --project ${plan.projectId} --file ${q(cache+'/history.json')} --cache ${q(cache)}`,30*60000);
    const settings={host:o.host,platform:'posix' as const,tool:o.remoteCode+'/scripts/awSync.ts',workspace:o.remoteHome,deviceId:copied.deviceId};
    const peer=await previewSshPeer(home,plan.projectId,settings);await commitSshPeer(home,plan.projectId,settings,peer.id);
    if(o.auto){await configureAutoSync(home,plan.projectId,{peerId:peer.id,mode:'safe',intervalSeconds:600,timeoutSeconds:120,savedDraftsConfirmed:true});if(process.platform==='win32')await run('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(appCodeRoot,'scripts/installSyncTask.ps1'),'-WorkspacePath',home,'-ProjectId',plan.projectId],{windowsHide:true,timeout:30000});}
    const result={format:'aw-paired-project-ready',version:2,projectId:plan.projectId,planId:id,localHome:home,remoteWorkspace:o.remoteHome,peerId:peer.id,remoteDeviceId:copied.deviceId,automaticSync:o.auto,localViewingQuery:'?awProject='+plan.projectId,desktopLauncher:`node ${q(o.remoteCode+'/scripts/desktopLauncher.mjs')} --workspace ${q(o.remoteHome)}`,counts:preview.counts,completedAt:new Date().toISOString(),experimentsExecuted:false,laptopOriginalsRetained:true};
    await saveImmutableSyncArtifact(resultFile,Buffer.from(JSON.stringify(result)),100000);await progress(home,plan.projectId,{step:'ready'});report(result);
   },0);
  }else throw new Error('Unknown setup command; use --help.');
 }
}catch(e){console.error((e as Error).message);process.exitCode=1;}
