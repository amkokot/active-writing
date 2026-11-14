// One private SSH stdio channel. No port, shell requests or notebook execution.
import {spawnOwnedSsh} from './ownedProcess.ts';
import {watch,type FSWatcher} from 'node:fs';
import path from 'node:path';
import type {Readable,Writable} from 'node:stream';
import {getProject} from './projects.ts';
import {projectDataPath} from './projectStorage.ts';
import {readingInventory,handleReadingMessage,type Inventory} from './syncReading.ts';
import {readSshPeer,sshPeerCommand,sshConnectTimeout,type SshRunner} from './syncSsh.ts';
import {requireSyncNetwork} from './syncNetwork.ts';

export const readingFrameLimit=Math.ceil(16*1024**2/3)*4+100000;
export async function* readingFrames(input:Readable){
 let pending=Buffer.alloc(0);
 for await(const part of input){
  const chunk=Buffer.isBuffer(part)?part:Buffer.from(part);let start=0;
  for(;;){const end=chunk.indexOf(10,start),stop=end<0?chunk.length:end;
   if(pending.length+stop-start>readingFrameLimit)throw Error('Reading stream frame exceeds its budget.');
   pending=Buffer.concat([pending,chunk.subarray(start,stop)]);
   if(end<0)break;
   if(pending.length)yield JSON.parse(pending.toString('utf8'));
   pending=Buffer.alloc(0);start=end+1;
  }
 }
 if(pending.length)throw Error('Incomplete reading stream frame.');
}
async function line(output:Writable,value:unknown){
 const data=JSON.stringify(value)+'\n';if(Buffer.byteLength(data)>readingFrameLimit)throw Error('Reading reply exceeds its budget.');
 await new Promise<void>((resolve,reject)=>output.write(data,error=>error?reject(error):resolve()));
}

/** Watch only directories containing readable source and the assistance store.
 * Never recursively watch experiments, arrays or archives. Polling is the NFS fallback. */
export async function watchReadingFiles(home:string,id:string,changed:()=>void,inventory?:Inventory){
 const root=(await getProject(home,id)).root,folders=new Set([root,projectDataPath(home,id)]);
 for(const item of (inventory??await readingInventory(home,id,true)).items)if(item.key.startsWith('source/'))folders.add(path.dirname(path.join(root,item.key.slice(7))));
 const handles:FSWatcher[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
 const signal=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;changed();},300);};
 for(const folder of folders)try{
  const assistance=folder===projectDataPath(home,id);
  const handle=watch(folder,(_event,name)=>{if(name===null||(assistance?String(name)==='workbench.json':/\.(tex|bib|md|txt)$/i.test(String(name))))signal();});
  handle.on('error',()=>{handle.close();signal();});handles.push(handle);
 }catch{/* Missing directories/unsupported NFS notifications use the five-second fallback. */}
 return ()=>{if(timer)clearTimeout(timer);for(const handle of handles)handle.close();};
}

export async function serveReadingStream(home:string,id:string,input:Readable,output:Writable,notifications=true){
 let closeWatch:(()=>void)|undefined;
 try{for await(const envelope of readingFrames(input)){
  if(!envelope||Object.keys(envelope).some(k=>!['id','request'].includes(k))||!Number.isSafeInteger(envelope.id)||envelope.id<1)throw Error('Invalid reading stream envelope.');
  try{
   // The native handler rechecks pinned identity, schema, byte guards and policy.
   const reply=await handleReadingMessage(home,id,envelope.request);
   await line(output,{id:envelope.id,reply});
   if(notifications&&envelope.request.action==='reading-inventory'){
    closeWatch?.();closeWatch=await watchReadingFiles(home,id,()=>{void line(output,{event:'changed'}).catch(()=>input.destroy());},envelope.request.fastOnly?reply.inventory:undefined);
   }
  }catch(error){await line(output,{id:envelope.id,error:(error as Error).message.slice(0,2000)});}
 }}finally{closeWatch?.();}
}

export function readingStreamClient(input:Readable,output:Writable,changed:()=>void=()=>{},stop:()=>void=()=>{}){
 let next=0,closed:Error|undefined,pending:{id:number;maximum:number;resolve:(b:Buffer)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
 const fail=(error:Error)=>{if(closed)return;closed=error;if(pending){clearTimeout(pending.timer);pending.reject(error);pending=undefined;}stop();};
 output.on('error',fail);input.on('error',fail);
 const reader=(async()=>{try{for await(const value of readingFrames(input)){
  if(value?.event==='changed'&&Object.keys(value).length===1){changed();continue;}
  const request=pending;
  if(!request||value?.id!==request.id||Object.keys(value).some(k=>!['id','reply','error'].includes(k))||('reply' in value)===('error' in value))throw Error('Unexpected reading stream reply.');
  pending=undefined;clearTimeout(request.timer);
  if(typeof value.error==='string'){request.reject(Error(value.error));continue;}
  const data=Buffer.from(JSON.stringify(value.reply));if(data.length>request.maximum){request.reject(Error('Reading reply exceeds its budget.'));throw Error('Oversized reading reply.');}request.resolve(data);
 }fail(Error('Connection closed: reading stream ended.'));}catch(error){fail(error as Error);}})();
 const request=async(data:Buffer,maximum:number,timeoutMs:number)=>{
  if(closed)throw closed;if(pending)throw Error('Only one reading request may be in flight.');
  if(data.length>readingFrameLimit)throw Error('Reading input exceeds its budget.');
  const value=JSON.parse(data.toString());if(!['reading-inventory','reading-get','reading-put','reading-maintenance'].includes(value.action))throw Error('Only reading records use this channel.');
  return new Promise<Buffer>((resolve,reject)=>{
   const id=++next,timer=setTimeout(()=>fail(Error('Connection timed out: reading stream request.')),timeoutMs);
   pending={id,maximum,resolve,reject,timer};void line(output,{id,request:value}).catch(fail);
  });
 };
 return {request,close:()=>fail(Error('Connection closed: reading stream stopped.')),isClosed:()=>!!closed,done:reader};
}
export async function openReadingStream(home:string,id:string,peerId:string,changed:()=>void){
 await requireSyncNetwork(home);const peer=await readSshPeer(home,id,peerId),command=sshPeerCommand(peer.options,id,true);
 const child=await spawnOwnedSsh(['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o',sshConnectTimeout(),'-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','--',peer.options.host,command]);
 let errorText='';child.stderr.on('data',(b:Buffer)=>{errorText=(errorText+b.toString()).slice(-2000);});
 const channel=readingStreamClient(child.stdout,child.stdin,changed,()=>{child.stdin.end();child.kill();});
 child.on('error',()=>channel.close());child.on('close',()=>channel.close());
 const runner:SshRunner=async(host,expected,input,maximum,timeout)=>{
  if(host!==peer.options.host||expected!==sshPeerCommand(peer.options,id))throw Error('Reading stream is bound to another peer/project.');
  await requireSyncNetwork(home);
  try{return await channel.request(input,maximum,timeout);}catch(error){if(channel.isClosed()&&errorText)throw Error(`${(error as Error).message} ${errorText}`);throw error;}
 };
 return {...channel,runner};
}
