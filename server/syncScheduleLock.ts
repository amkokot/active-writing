// Scheduling coordination is recoverable; manuscript/record locks are not.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat,mkdtemp,writeFile,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {acquireRecordLock,RecordLocked} from './recordLock.ts';

let executable:Promise<string>|undefined;
function host(){
 if(!executable)executable=(async()=>{
  const source=fileURLToPath(new URL('../scripts/SyncCoordinatorHost.cs',import.meta.url));
  if((await lstat(source)).isSymbolicLink())throw Error('Scheduling host source is linked.');
  const folder=await mkdtemp(path.join(tmpdir(),'aw-schedule-')),copy=path.join(folder,'SyncCoordinatorHost.cs'),out=path.join(folder,'SyncCoordinatorHost.exe');
  await writeFile(copy,await readFile(source),{flag:'wx'});
  await promisify(execFile)(path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/target:exe','/out:'+out,copy],{windowsHide:true,timeout:30000,maxBuffer:16000});
  return out;
 })().catch(error=>{executable=undefined;throw error;});
 return executable;
}

/** A kernel-backed mutex, also held while inspecting a legacy dead scheduling marker. */
export async function acquireScheduleLease(target:string,waitMs=0):Promise<()=>Promise<void>>{
 const parentName=path.basename(path.dirname(target)),global=['coordinator','reading-coordinator'].includes(path.basename(target))&&parentName==='auto';
 const cycle=path.basename(target)==='cycle'&&/^[A-Za-z0-9_-]{1,128}$/.test(parentName)&&path.basename(path.dirname(path.dirname(target)))==='auto';
 if((!global&&!cycle)||!Number.isInteger(waitMs)||waitMs<0||waitMs>2000)throw Error('Only Aw scheduling slots may use this lease.');
 const parent=await realpath(path.dirname(target)),canonical=path.join(parent,path.basename(target));
 const key=createHash('sha256').update(process.platform==='win32'?canonical.toLowerCase():canonical).digest('hex');
 const file=canonical+'.os-lease';
 if(process.platform!=='win32'){
  try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw Error('Scheduling lease path is linked.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 const child=process.platform==='win32'
  ?spawn(await host(),[String(process.pid),key,String(waitMs)],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  :spawn('/usr/bin/flock',['-w',String(waitMs/1000),'-E','73',file,'/bin/sh','-c','printf "AW_SCHEDULE_HELD\\n"; cat >/dev/null'],{stdio:['pipe','pipe','pipe']});
 child.stdin.on('error',()=>{});child.stderr.resume();
 let exited=false;
 const ended=new Promise<void>(resolve=>{child.once('close',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
 try{await new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{child.stdin.end();child.kill();reject(Error('Scheduling lease did not answer.'));},10000);
  let output='';
  const finish=(error?:Error)=>{clearTimeout(timer);error?reject(error):resolve();};
  child.once('error',()=>finish(Error('Scheduling lease could not start.')));
  child.once('close',code=>finish(code===73?new RecordLocked('Another sync owns the scheduling slot.'):Error('Scheduling lease ended.')));
  child.stdout.on('data',(data:Buffer)=>{output+=data.toString();if(output==='AW_SCHEDULE_HELD\n'||output==='AW_SCHEDULE_HELD\r\n')finish();else if(output.length>100)finish(Error('Unexpected scheduling lease output.'));});
 });}catch(error){child.stdin.end();if(!exited)child.kill();await ended;throw error;}
 return async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill(),5000);try{await ended;}finally{clearTimeout(timer);}};
}

/** Start-time evidence is used only under the exclusive scheduling lease. A live
 * reused PID is not the owner if it started strictly after the marker existed.
 * Unknown/access-denied evidence stays held; generic record locks never use this. */
export async function schedulingOwnerGone(owner:{pid:number;createdAt:string},probeStart?:(pid:number)=>Promise<number>):Promise<boolean>{
 try{process.kill(owner.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return true;}
 const created=Date.parse(owner.createdAt);
 if(!Number.isSafeInteger(owner.pid)||owner.pid<1||!Number.isFinite(created))return false;
 try{
  if(!probeStart && process.platform!=='win32')return false;
  const started=probeStart?await probeStart(owner.pid):Number((await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$ErrorActionPreference='Stop'; [Console]::Write(([DateTimeOffset](Get-Process -Id ${owner.pid}).StartTime.ToUniversalTime()).ToUnixTimeMilliseconds())`],{windowsHide:true,timeout:5000,maxBuffer:1000})).stdout.trim());
  // Allow a margin for timestamp precision. Ambiguous same-time starts stay held.
  return Number.isFinite(started)&&started>created+1000&&started<=Date.now()+1000;
 }catch{return false;}
}

/** Only a dead/replaced process's scheduling marker can be archived. Never touches stores,
 * journals or any protected/unfinished merge decision. Cycle markers schedule
 * access only; the existing pending-operation and per-record guards still apply. */
export async function acquireSyncSchedule(target:string,waitMs=0):Promise<()=>Promise<void>>{
 const releaseLease=await acquireScheduleLease(target,waitMs);
 try{
  let release:()=>Promise<void>;
  try{release=await acquireRecordLock(target,0);}catch(error){
   if(!(error instanceof RecordLocked))throw error;
   const file=target+'.aw-lock',info=await lstat(file),raw=await readFile(file);
   if(info.isSymbolicLink()||!info.isFile()||raw.length>2000)throw new RecordLocked('Invalid scheduling owner; manual inspection required.');
   const owner=JSON.parse(raw.toString());
   if(Object.keys(owner).sort().join(',')!=='createdAt,pid,token'||!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||!/^[a-f0-9-]{36}$/.test(owner.token)||!Number.isFinite(Date.parse(owner.createdAt)))throw new RecordLocked('Invalid scheduling owner; manual inspection required.');
   if(!await schedulingOwnerGone(owner))throw new RecordLocked('Scheduling owner is still running or its identity is unknown.');
   if(!(await readFile(file)).equals(raw))throw new RecordLocked('Scheduling marker changed; preserved.');
   const archive=target+'.recovered-'+randomUUID()+'.json';await rename(file,archive);
   if(!(await readFile(archive)).equals(raw))throw Error('Scheduling recovery changed; inspect preserved marker.');
   release=await acquireRecordLock(target,0);
  }
  return async()=>{try{await release();}finally{await releaseLease();}};
 }catch(error){await releaseLease();throw error;}
}
