import {networkInterfaces} from 'node:os';
import {autoSyncCycle,readAutoSyncConfig} from './syncAuto.ts';
import {syncNetworkAllowed} from './syncNetwork.ts';
import {openReadingStream,watchReadingFiles} from './syncReadingStream.ts';

const localSlots=new Map<string,Promise<void>>();
/** The pool shares a queue before touching filesystem locks. Native leases still
 * arbitrate other processes; waiting projects do not repeatedly probe OneDrive. */
export async function withLiveReadingSlot<T>(home:string,work:()=>Promise<T>) {
 const before=localSlots.get(home)??Promise.resolve();let release!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),tail=before.then(()=>held);
 localSlots.set(home,tail);await before;
 try{return await work();}finally{release();if(localSlots.get(home)===tail)localSlots.delete(home);}
}

/** A single optional background follower for an already authorized pair.
 * Saved source/comments get events + a five-second NFS fallback. All data guards
 * live in the same reading collector; this loop never guesses or executes edits. */
export async function followLiveReading(home:string,id:string,signal:AbortSignal,report:(value:unknown)=>void=console.log,options:{fastOnly?:boolean}={}){
 let channel:Awaited<ReturnType<typeof openReadingStream>>|undefined,closeWatch:(()=>void)|undefined;
 let dirty=true,nextPoll=0,nextSlow=0,retryAt=0,failures=0,generation='',interfaces='',lastReport='';
 let wake:(()=>void)|undefined;
 const mark=()=>{dirty=true;wake?.();};
 const say=(value:unknown)=>{const {milliseconds:ignored,...stable}=value as Record<string,unknown>;const text=JSON.stringify(stable);if(text!==lastReport){report({at:new Date().toISOString(),...value as object});lastReport=text;}};
 const close=()=>{channel?.close();channel=undefined;closeWatch?.();closeWatch=undefined;};
 const wait=async(ms:number)=>{if(signal.aborted)return;await new Promise<void>(resolve=>{
  const done=()=>{clearTimeout(timer);wake=undefined;signal.removeEventListener('abort',done);resolve();};
  const timer=setTimeout(done,ms);wake=done;signal.addEventListener('abort',done,{once:true});
 });};
 try{while(!signal.aborted){
  try{
   const config=await readAutoSyncConfig(home,id);
   if(!config?.enabled){say({status:'disabled'});break;}
   if(!config.readingOnly||config.mode!=='safe')throw Error('Live reading requires an enabled safe reading pair; no mode was changed.');
   if(generation!==config.generation){close();generation=config.generation;dirty=true;nextSlow=0;retryAt=0;}
   const fingerprint=JSON.stringify(networkInterfaces());if(fingerprint!==interfaces){interfaces=fingerprint;retryAt=0;}
   const network=await syncNetworkAllowed(home);
   if(!network.allowed){close();dirty=true;say({status:'waiting-network',detail:network.reason});await wait(5000);continue;}
   if(Date.now()<retryAt){await wait(Math.min(5000,retryAt-Date.now()));continue;}
   if(!channel||channel.isClosed()){
    close();channel=await openReadingStream(home,id,config.peerId,mark);
    closeWatch=await watchReadingFiles(home,id,mark);dirty=true;nextPoll=0;
   }
   if(dirty||Date.now()>=nextPoll){
    dirty=false;const started=Date.now();
    const result=await withLiveReadingSlot<Awaited<ReturnType<typeof autoSyncCycle>>>(home,()=>signal.aborted?Promise.resolve({status:'disabled' as const,networkContacted:false}):autoSyncCycle(home,id,{runner:channel!.runner,checkNow:true,fastOnly:true}));
    if(result.status==='busy'){dirty=true;say({status:'busy',scope:'TeX/comments',detail:result.note});await wait(2000);continue;}
    if(result.status==='disabled')break;
    say({status:result.status,scope:'TeX/comments',milliseconds:Date.now()-started,...('detail' in result?{detail:result.detail}:{})});
    if(result.status==='unavailable')throw Error('detail' in result?result.detail:'Reading connection unavailable.');
    failures=0;nextPoll=Date.now()+5000;
   }
   // Notebook/figure work is bounded and less frequent. It uses the existing bulk
   // slot, and cannot force a text pass to wait on ANOTHER project's bulk worker.
   if(!options.fastOnly&&!dirty&&Date.now()>=nextSlow){
    const result=await autoSyncCycle(home,id,{runner:channel.runner,checkNow:true});
    say({status:result.status,scope:'notebooks/figures',...('detail' in result?{detail:result.detail}:{})});
    nextSlow=Date.now()+(result.status==='busy'?30000:180000);
   }
   await wait(dirty?300:Math.min(1000,Math.max(10,nextPoll-Date.now())));
  }catch(error){
   // Another writer's live lease is ordinary contention. Never steal it or kill
   // its process; hold this connection and try after a short pause.
   const detail=(error as Error).message;
   if(/already running for this project/.test(detail)){await wait(500);continue;}
   close();dirty=true;failures=Math.min(5,failures+1);retryAt=Date.now()+Math.min(60000,2000*2**(failures-1));
   say({status:'waiting-connection',detail,retrySeconds:Math.round((retryAt-Date.now())/1000)});await wait(1000);
  }
 }}finally{close();}
}
