// Batch existing guarded first-copy tools; never execute transferred research.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {readSyncSnapshot} from '../server/deviceSync.ts';
import {canonical,syncHash} from '../server/syncProtocol.ts';
import {previewSyncClone,commitSyncClone} from '../server/syncClone.ts';
import {previewSshPeer,commitSshPeer,listSshPeers} from '../server/syncSsh.ts';
import {readSyncNetworkPolicy,configureSyncNetwork,requireSyncNetwork} from '../server/syncNetwork.ts';
import {setupPairedJournals} from '../server/syncJournalSetup.ts';
import {configureAutoSync,followReadingSync,autoSyncStatus,autoSyncCycle} from '../server/syncAuto.ts';
import {enableDesktopFirst} from '../server/syncColdStore.ts';
import {readingPort} from './readingWorkspaceLauncher.mjs';
import {registerLinkedWorkspace} from '../server/linkedWorkspaces.ts';

export function checkLink(plan,snapshot,bytes,host){
 if(plan?.version!==1||plan.sshAlias!==host||!/^[-A-Za-z0-9_]{1,100}$/.test(host)||plan.projectId!==snapshot.projectId||plan.desktopDeviceId!==snapshot.device.id||plan.snapshotId!==snapshot.id||plan.packetSha256!==syncHash(bytes)||plan.packetBytes!==bytes.length)throw Error('Link identity or packet checksum mismatch.');
 for(const name of ['desktopWorkspace','remoteTool'])if(typeof plan[name]!=='string'||!plan[name].startsWith('/')||/[\x00-\x1f]/.test(plan[name]))throw Error('Use an exact installed desktop home/tool.');
 if(typeof plan.mainFile!=='string'||!plan.mainFile.endsWith('.tex'))throw Error('Missing selected TeX root.');
 if(plan.rawArraysIncluded!==false)throw Error('The quick reading baseline must explicitly exclude raw arrays.');
 if(snapshot.ancestors.length||snapshot.records.some(r=>r.external))throw Error('This quick first-copy path needs a complete inline baseline without missing parents. Use the full exchange tools for other packets.');
 return {host,platform:'posix',tool:plan.remoteTool,workspace:plan.desktopWorkspace,deviceId:plan.desktopDeviceId};
}
export function linkOptions(args){
 const flags={};for(let n=0;n<args.length;n++){
  const name=args[n];if(name==='--commit'){if(flags.commit)throw Error('Duplicate commit');flags.commit=true;continue;}
  if(!['--workspace','--packet','--link-plan','--destination','--host','--review'].includes(name)||flags[name.slice(2)]||!args[n+1]||args[n+1].startsWith('--'))throw Error('Unknown/repeated/incomplete option');
  flags[name.slice(2)]=args[++n];
 }
 if(['workspace','packet','link-plan','destination','host'].some(k=>!flags[k])||Boolean(flags.commit)!==Boolean(flags.review))throw Error('Use explicit control workspace, packet, link-plan, NEW destination and host. Commit requires exact --review HASH --commit.');
 return flags;
}
export async function linkReading(flags){
 const control=await realpath(flags.workspace),packet=path.resolve(flags.packet),planFile=path.resolve(flags['link-plan']);
 const bytes=await readFile(packet),planBytes=await readFile(planFile),plan=JSON.parse(planBytes),snapshot=await readSyncSnapshot(packet),peerOptions=checkLink(plan,snapshot,bytes,flags.host);
 const network=await readSyncNetworkPolicy(control);if(!network)throw Error('Configure the control home campus/VPN gate first.');
 const options={destination:path.resolve(flags.destination),mainFile:plan.mainFile,label:'Laptop'};
 const relative=path.relative(control,options.destination);
 if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Choose a NEW child home under the control workspace, so it can appear in the normal project chooser.');
 const clone=await previewSyncClone(snapshot,options);if(clone.pending.length)throw Error('Waiting requests require the full first-copy workflow.');
 if(plan.expectedCells!==undefined&&clone.counts.cells!==plan.expectedCells)throw Error('Notebook cell count differs from handoff.');
 if(plan.manuscriptPins&&canonical(clone.project.manuscriptPins)!==canonical(plan.manuscriptPins))throw Error('Pinned reading documents differ from handoff.');
 const body={version:1,control,packet,packetHash:syncHash(bytes),linkPlanHash:syncHash(planBytes),peerOptions,clonePlan:clone.planId,network};
 const review=syncHash(canonical(body));
 const result={review,projectId:plan.projectId,name:clone.project.name,home:options.destination,clone,peerOptions,url:`http://127.0.0.1:${readingPort(options.destination)}/?awProject=${plan.projectId}`,codeExecution:false};
 if(!flags.commit)return {...result,committed:false};
 if(flags.review!==review)throw Error('Setup inputs changed. Preview again; nothing imported.');
 await requireSyncNetwork(control);
 const copied=await commitSyncClone(snapshot,options,clone.planId),home=copied.workspace;
 const priorNetwork=await readSyncNetworkPolicy(home);
 if(priorNetwork&&canonical(priorNetwork)!==canonical(network))throw Error('Existing home gate differs; preserved.');
 if(!priorNetwork)await configureSyncNetwork(home,network);
 const peer=await previewSshPeer(home,plan.projectId,peerOptions),existing=await listSshPeers(home,plan.projectId);
 if(existing.some(p=>p.id!==peer.id))throw Error('A different saved peer exists; preserved.');
 await commitSshPeer(home,plan.projectId,peerOptions,peer.id);
 const journals={configFile:path.join(control,'.paperfocus/device-sync/change-journal/daemon/config.json')};
 const j=await setupPairedJournals(home,plan.projectId,peer.id,undefined,journals);
 await setupPairedJournals(home,plan.projectId,peer.id,j.review,journals);
 await enableDesktopFirst(home);
 const current=(await autoSyncStatus(home,plan.projectId)).config;
 if(current&&(!current.enabled||current.mode!=='safe'||current.peerId!==peer.id))throw Error('Existing sync was paused or changed; preserved.');
 if(!current)await configureAutoSync(home,plan.projectId,{peerId:peer.id,mode:'safe',intervalSeconds:180,timeoutSeconds:120,savedDraftsConfirmed:true});
 if(!current?.readingOnly)await followReadingSync(home,plan.projectId);
 const sync=await autoSyncCycle(home,plan.projectId,{checkNow:true});
 await registerLinkedWorkspace(control,home,plan.projectId);
 const code=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 let scheduler='not-installed',shortcut;
 if(process.platform==='win32'){
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(code,'scripts/installSyncTask.ps1'),'-WorkspacePath',home,'-ProjectId',plan.projectId],{encoding:'utf8',windowsHide:true,timeout:30000});
  if(r.status!==0)throw Error('Copy/pair retained, but scheduler setup needs attention: '+(r.stderr||r.error?.message));
  const task='Aw sync '+syncHash(home+'|'+plan.projectId).slice(0,12).toUpperCase();
  const start=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-ScheduledTask -TaskName '${task}'`],{encoding:'utf8',windowsHide:true,timeout:10000});
  if(start.status!==0)throw Error('Worker installed but immediate start failed; inspect scheduled task: '+task);
  const installShortcut=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(code,'scripts/installReadingShortcut.ps1'),'-WorkspacePath',home,'-Name',clone.project.name.slice(0,75)],{encoding:'utf8',windowsHide:true,timeout:15000});
  if(installShortcut.status!==0)throw Error('Reading link retained; shortcut installation needs attention: '+(installShortcut.stderr||installShortcut.error?.message));
  shortcut=installShortcut.stdout.trim();
  scheduler='installed';
 }
 return {...result,committed:true,peerId:peer.id,cloneReceipt:copied,journalsEnrolled:true,scheduler,shortcut,projectChooserRegistered:true,sync,note:'Reading scope only. No full-history acknowledgement or research execution. Open from the normal project chooser or shortcut; retain packet and receipts.'};
}
if(process.argv[1]&&path.resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
 if(process.argv.includes('--help'))console.log('Batch laptop first-copy setup for a staged desktop reading baseline. Preview, inspect, then repeat with --review HASH --commit. No service required.\nnode scripts/awLinkReading.mjs --workspace CONTROL_HOME --packet BASELINE.json --link-plan LINK-PLAN.json --destination NEW_HOME --host APPROVED_SSH_ALIAS\nOnly explicitly authorized host/data scopes. Copies existing gate, pins peer, enrolls existing journals, enables reading/comments, installs the Windows worker and checks saved sync. Does not fetch raw archives, execute code or replace an occupied home. Retry after inspecting partial receipts; never delete them.');
 else linkReading(linkOptions(process.argv.slice(2))).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
