import {spawnOwnedSsh} from './ownedProcess.ts';
import {BlobReader,readBlobs,sendBlobs,validateBlobList,writeBytes,missingBlobRefs} from './syncBlobWire.ts';
import type {BlobRef} from './syncBlobs.ts';
import type {SshPeerOptions} from './syncSsh.ts';
export async function transferSshBlobs(home:string,projectId:string,peer:SshPeerOptions,refs:BlobRef[],direction:'read'|'write',budgetBytes=1024**3){
 validateBlobList(refs);if(!refs.length)return {files:0,bytes:0};
 if(!Number.isSafeInteger(budgetBytes)||budgetBytes<0||budgetBytes>128*1024**3||refs.reduce((n,r)=>n+r.bytes,0)>budgetBytes)throw new Error('Bulk transfer exceeds the approved per-direction budget (default 1 GB). Stage a deliberately budgeted batch first; nothing was sent.');
 if(direction==='read'){refs=await missingBlobRefs(home,refs);if(!refs.length)return {files:0,bytes:0};}
 const tool=peer.tool.replace(/awSync\.ts$/,'awSyncBlob.ts');if(tool===peer.tool)throw new Error('Unknown bulk tool location.');
 const q=(s:string)=>"'"+s.replaceAll("'","'\"'\"'")+"'";
 if(peer.platform!=='posix')throw new Error('Streaming SSH bulk transport currently requires a POSIX receiver; no fallback or unguarded copy.');
 const command=`exec node ${q(tool)} --workspace ${q(peer.workspace)}`;
 const child=await spawnOwnedSsh(['-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12','--',peer.host,command]);
 let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4000);});
 const exited=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Bulk SSH failed: '+stderr)));});
 // Avoid unhandled rejection while the other stream is still settling.
 exited.catch(()=>{});child.stdin.on('error',()=>{});
 let idle:ReturnType<typeof setTimeout>;const reset=()=>{clearTimeout(idle);idle=setTimeout(()=>child.kill(),120000);};reset();child.stdout.on('readable',reset);child.stdin.on('drain',reset);
 try{
  await writeBytes(child.stdin,Buffer.from(JSON.stringify({version:1,projectId,expectedDeviceId:peer.deviceId,action:direction,refs})+'\n'));
  if(direction==='write'){await sendBlobs(home,refs,child.stdin);child.stdin.end();let response='';for await(const chunk of child.stdout){response+=chunk.toString();if(response.length>10000)throw new Error('Oversized bulk acknowledgment.');}await exited;const ack=JSON.parse(response);if(ack.version!==1||ack.liveImport!==false||ack.stored!==refs.length)throw new Error('Invalid bulk acknowledgment.');}
  else{child.stdin.end();await readBlobs(home,refs,new BlobReader(child.stdout));await exited;}
  return {files:refs.length,bytes:refs.reduce((n,r)=>n+r.bytes,0)};
 }catch(e){child.kill();await exited.catch(()=>{});throw e;}finally{clearTimeout(idle!);}
}
