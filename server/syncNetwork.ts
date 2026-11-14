import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createConnection} from 'node:net';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {syncHash} from './syncProtocol.ts';
export interface SyncNetworkPolicy {version:1;profiles:string[];vpnDescriptions:string[];host:string;port:number}
export interface NetworkObservation {profiles:string[];vpnDescriptions:string[]}
let memo:{key:string;at:number;result:{allowed:boolean;reason:string}}|undefined;
function validate(p:SyncNetworkPolicy){if(p?.version!==1||!Array.isArray(p.profiles)||!Array.isArray(p.vpnDescriptions)||[...p.profiles,...p.vpnDescriptions].some(s=>typeof s!=='string'||!s.trim()||s.length>120)||p.profiles.length>12||p.vpnDescriptions.length>12||!/^[-a-zA-Z0-9.]{1,253}$/.test(p.host)||!Number.isInteger(p.port)||p.port<1||p.port>65535)throw new Error('Invalid sync network policy.');}
export async function readSyncNetworkPolicy(home:string){try{const file=await guardedTarget(home,'.paperfocus/device-sync/network.json');const raw=await readFile(file,'utf8');if(raw.length>10000)throw new Error('Network settings too large.');const p=JSON.parse(raw);validate(p);return p as SyncNetworkPolicy;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}}
export async function configureSyncNetwork(home:string,p:SyncNetworkPolicy){validate(p);const name='.paperfocus/device-sync/network.json';let old='';try{old=syncHash(await readFile(await guardedTarget(home,name)));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await saveGuardedFile(home,name,old,Buffer.from(JSON.stringify(p)));memo=undefined;return p;}
export function eligibleSyncNetwork(p:SyncNetworkPolicy,o:NetworkObservation){return o.profiles.some(s=>p.profiles.some(v=>v.toLowerCase()===s.toLowerCase()))||o.vpnDescriptions.some(s=>p.vpnDescriptions.some(v=>s.toLowerCase().includes(v.toLowerCase())));}
async function observe():Promise<NetworkObservation>{
 if(process.platform!=='win32')return {profiles:[],vpnDescriptions:[]};
 const script="$ErrorActionPreference='Stop';$ips=@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' });$ids=@($ips.InterfaceIndex);$profiles=@(Get-NetConnectionProfile | Where-Object { $ids -contains $_.InterfaceIndex } | ForEach-Object Name);$adapters=@(Get-NetAdapter -IncludeHidden | Where-Object { $_.Status -eq 'Up' -and $ids -contains $_.ifIndex } | ForEach-Object InterfaceDescription);@{profiles=$profiles;vpnDescriptions=$adapters}|ConvertTo-Json -Compress";
 const r=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:30000,maxBuffer:16000});return JSON.parse(r.stdout);
}
async function reachable(host:string,port:number){return new Promise<boolean>(resolve=>{const s=createConnection({host,port});let done=false;const finish=(ok:boolean)=>{if(done)return;done=true;s.destroy();resolve(ok);};s.setTimeout(5000,()=>finish(false));s.once('connect',()=>finish(true));s.once('error',()=>finish(false));});}
const pendingObservations=new Map<string,Promise<{allowed:boolean;reason:string}>>();
export async function syncNetworkAllowed(home:string,runtime:{refresh?:boolean;observe?:()=>Promise<NetworkObservation>;reachable?:(host:string,port:number)=>Promise<boolean>}={}){
 if(runtime.observe||runtime.reachable||runtime.refresh)return observeSyncNetwork(home,runtime);
 const pending=pendingObservations.get(home);if(pending)return pending;
 const operation=observeSyncNetwork(home,runtime);pendingObservations.set(home,operation);
 try{return await operation;}finally{if(pendingObservations.get(home)===operation)pendingObservations.delete(home);}
}
async function observeSyncNetwork(home:string,runtime:{refresh?:boolean;observe?:()=>Promise<NetworkObservation>;reachable?:(host:string,port:number)=>Promise<boolean>}={}){
 const p=await readSyncNetworkPolicy(home);if(!p)return {allowed:true,reason:'No network restriction configured.'};
 const key=syncHash(JSON.stringify([home,p,networkInterfaces()]));if(!runtime.refresh&&!runtime.observe&&memo?.key===key&&Date.now()-memo.at<30000)return memo.result;
 const cacheName='.paperfocus/device-sync/network-observation.json';let cacheHash='';if(!runtime.refresh&&!runtime.observe)try{const raw=await readFile(await guardedTarget(home,cacheName));if(raw.length<16000){cacheHash=syncHash(raw);const c=JSON.parse(raw.toString());if(c.key===key&&Number.isFinite(c.at)&&c.at<=Date.now()&&Date.now()-c.at<30000&&typeof c.result?.allowed==='boolean'&&typeof c.result.reason==='string'&&c.result.reason.length<400)return c.result as {allowed:boolean;reason:string};}}catch{/* A cache never grants connection scope or blocks a fresh observation. */}
 let result:{allowed:boolean;reason:string};
 try{const o=await (runtime.observe??observe)();result=!eligibleSyncNetwork(p,o)?{allowed:false,reason:'Waiting for campus Wi-Fi or the university VPN. No SSH or file scan started.'}:await (runtime.reachable??reachable)(p.host,p.port)?{allowed:true,reason:'University network and SSH entry point are available.'}:{allowed:false,reason:'University network detected; the SSH entry point is unavailable. No SSH or file scan started.'};}
 catch{result={allowed:false,reason:'Network status unavailable. Sync is waiting; no SSH or file scan started.'};}
 if(!runtime.observe){memo={key,at:Date.now(),result};try{await saveGuardedFile(home,cacheName,cacheHash,Buffer.from(JSON.stringify(memo)));}catch{/* A concurrent observation may win; do not retry or change research. */}}return result;
}
export async function requireSyncNetwork(home:string){const s=await syncNetworkAllowed(home);if(!s.allowed)throw new Error(s.reason);}
