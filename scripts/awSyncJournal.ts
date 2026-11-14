// One local watcher process per machine. Continues offline; never contacts SSH.
import path from 'node:path';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {constants,setPriority} from 'node:os';
import {startChangeJournal} from '../server/syncChangeJournal.ts';
import {readSyncBytes} from '../server/deviceSync.ts';
import {safeSyncId} from '../server/syncProtocol.ts';
import {getProject} from '../server/projects.ts';

const args=process.argv.slice(2),command=args.shift();
if(!['start','stop'].includes(command??'')||args.length!==2||args[0]!=='--config'||!path.isAbsolute(args[1]))throw Error('Use start|stop --config ABSOLUTE_CONFIG_PATH');
const configFile=args[1],stopFile=configFile+'.stop.json';
if(command==='stop'){
 const temp=stopFile+'.'+randomUUID()+'.part';await writeFile(temp,JSON.stringify({id:randomUUID(),at:Date.now()}),{flag:'wx',mode:0o600});await rename(temp,stopFile);
 console.log('Requested graceful journal stop. No source or research job was stopped.');
}else{
 try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
 let stopping=false;process.on('SIGINT',()=>{stopping=true;});process.on('SIGTERM',()=>{stopping=true;});
 const initialStop=await readFile(stopFile,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
 const active=new Map<string,Awaited<ReturnType<typeof startChangeJournal>>>(),retry=new Map<string,number>(),messages=new Map<string,string>();let nextRootCheck=0;
 const report=(key:string,message:string)=>{if(messages.get(key)!==message){console.log(JSON.stringify({at:new Date().toISOString(),key,message}));messages.set(key,message);}};
 try{while(!stopping){
  const stop=await readFile(stopFile,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});if(stop!==initialStop)break;
  try{
   const config=JSON.parse((await readSyncBytes(configFile,40000)).toString());
   if(config.version!==1||!Array.isArray(config.projects)||config.projects.length>32)throw Error('Invalid bounded journal configuration.');
   const desired=new Map<string,{workspace:string;projectId:string}>();
   for(const p of config.projects){if(!p||!path.isAbsolute(p.workspace)||!safeSyncId(p.projectId)||Object.keys(p).some(k=>!['workspace','projectId'].includes(k)))throw Error('Invalid journal scope.');const key=path.resolve(p.workspace)+'|'+p.projectId;if(desired.has(key))throw Error('Duplicate journal scope.');desired.set(key,p);}
   for(const [key,handle] of active)if(!desired.has(key)){await handle.close();active.delete(key);report(key,'Stopped removed scope');}
   const checkRoots=Date.now()>=nextRootCheck;if(checkRoots)nextRootCheck=Date.now()+60000;
   for(const [key,p] of desired){const current=active.get(key);
    if(current&&(!current.isHealthy()||checkRoots&&(await getProject(p.workspace,p.projectId)).root!==current.root)){await current.close();active.delete(key);retry.set(key,Date.now()+60000);report(key,'Watcher needs recovery; full snapshots remain available');}
    if(active.has(key)||Date.now()<(retry.get(key)??0))continue;
    try{const handle=await startChangeJournal(p.workspace,p.projectId);active.set(key,handle);retry.delete(key);report(key,'Watching locally; no network or initial content scan');}
    catch(error){retry.set(key,Date.now()+60000);report(key,(error as Error).message);}
   }
  }catch(error){report('configuration',(error as Error).message);}
  // No periodic project traversal, hash pass or network discovery here.
  for(let n=0;n<10&&!stopping;n++)await new Promise(r=>setTimeout(r,500));
 }}finally{for(const handle of active.values())await handle.close();}
}
