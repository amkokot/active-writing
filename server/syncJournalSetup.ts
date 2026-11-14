// Explicit enrollment in already installed watchers. No transfer or execution of research.
import path from 'node:path';
import os from 'node:os';
import {lstat} from 'node:fs/promises';
import {projectStorage} from './projectStorage.ts';
import {getProject} from './projects.ts';
import {syncStatus,readSyncBytes} from './deviceSync.ts';
import {safeSyncId,syncHash,canonical} from './syncProtocol.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {requireSyncNetwork} from './syncNetwork.ts';
import {readSshPeer,runSshMessage,type SshRunner} from './syncSsh.ts';

export function journalConfigPath(home:string){return process.platform==='win32'
 ?path.join(home,'.paperfocus/device-sync/change-journal/daemon/config.json')
 :path.join(os.homedir(),'.local/share/active-writing/change-journal/config.json');}
export async function enrollJournalScope(home:string,id:string,expectedDevice:string,review?:string,configFile=journalConfigPath(home)){
 if(!path.isAbsolute(home)||!safeSyncId(id)||!safeSyncId(expectedDevice))throw Error('Use exact project, absolute home and saved device identity.');
 const {root}=await getProject(home,id);if((await syncStatus(home)).device?.id!==expectedDevice)throw Error('Journal enrollment device mismatch.');
 // Enrollment may initialize the native empty data catalogue, not migrate old
 // paper-local records or restructure source as a side effect of setup.
 try{await lstat(path.join(root,'.paperfocus'));throw Error('Migrate legacy paper-local records explicitly before journal enrollment.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(!path.isAbsolute(configFile))throw Error('Use an absolute installed journal configuration.');
 const base=path.dirname(configFile),name=path.basename(configFile),target=await guardedTarget(base,name);
 let bytes:Buffer;try{bytes=await readSyncBytes(target,40000);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw Error('Install the local journal daemon once before enrolling projects. See DEVICE_SYNC.md.');throw e;}
 const config=JSON.parse(bytes.toString());
 if(config.version!==1||!Array.isArray(config.projects)||config.projects.length>32||Object.keys(config).some(k=>!['version','projects'].includes(k)))throw Error('Invalid installed journal configuration.');
 const keys=new Set<string>();for(const p of config.projects){if(!p||!path.isAbsolute(p.workspace)||!safeSyncId(p.projectId)||Object.keys(p).some(k=>!['workspace','projectId'].includes(k)))throw Error('Invalid installed journal scope.');const key=path.resolve(p.workspace)+'|'+p.projectId;if(keys.has(key))throw Error('Duplicate installed journal scope.');keys.add(key);}
 const registered=keys.has(path.resolve(home)+'|'+id);
 if(!registered&&config.projects.length>=32)throw Error('Journal capacity reached; inspect the enrolled projects.');
 const body={version:1,workspace:home,projectId:id,deviceId:expectedDevice,config:configFile,before:syncHash(bytes),registered};
 const plan=syncHash(canonical(body));
 if(review!==undefined){if(review!==plan)throw Error('Journal enrollment changed; preview again. Nothing overwritten.');
  await projectStorage(home,id);
  if(!registered)await saveGuardedFile(base,name,body.before,Buffer.from(JSON.stringify({...config,projects:[...config.projects,{workspace:home,projectId:id}]})+'\n'),40000);
 }
 return {...body,review:plan,committed:review!==undefined,registered:registered||review!==undefined,activation:'Existing daemon adopts this scope within five seconds; no research or service restart.'};
}
export async function setupPairedJournals(home:string,id:string,peerId:string,review?:string,runtime:{runner?:SshRunner;configFile?:string}={}){
 const peer=await readSshPeer(home,id,peerId),device=(await syncStatus(home)).device!;
 if(peer.options.platform!=='posix')throw Error('This setup command currently supports the Linux desktop peer.');
 const local=await enrollJournalScope(home,id,device.id,undefined,runtime.configFile);
 await requireSyncNetwork(home);
 const q=(value:string)=>`'${value.replaceAll("'",`'"'"'`)}'`;
 const tool=path.posix.join(path.posix.dirname(peer.options.tool),'awSyncJournalSetup.ts');
 const invoke=async(commit?:string)=>{
  const command='node '+q(tool)+' local --workspace '+q(peer.options.workspace)+' --project '+q(id)+' --device '+q(peer.options.deviceId)+(commit?' --commit '+q(commit):'');
  await requireSyncNetwork(home);const raw=await (runtime.runner??runSshMessage)(peer.options.host,command,Buffer.alloc(0),16000,30000);
  const result=JSON.parse(raw.toString());
  if(result.projectId!==id||result.workspace!==peer.options.workspace||result.deviceId!==peer.options.deviceId||!/^[a-f0-9]{64}$/.test(result.review)||typeof result.registered!=='boolean'||typeof result.committed!=='boolean')throw Error('Invalid remote journal enrollment reply.');
  return result;
 };
 const remote=await invoke(),plan=syncHash(canonical({peerId,local:local.review,remote:remote.review}));
 if(review!==undefined){
  if(review!==plan)throw Error('Paired journal setup changed; preview again. No scopes changed.');
  // Remote first; an interruption preserves that harmless enrollment. Preview
  // again on retry instead of pretending two configuration writes are atomic.
  const enrolled=await invoke(remote.review);if(!enrolled.committed||!enrolled.registered)throw Error('Remote enrollment not confirmed; local configuration unchanged.');
  const saved=await enrollJournalScope(home,id,device.id,local.review,runtime.configFile);
  return {review:plan,committed:true,local:saved,remote:enrolled,filesTransferred:false,researchStarted:false};
 }
 return {review:plan,committed:false,local,remote,filesTransferred:false,researchStarted:false};
}
