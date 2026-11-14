/** Local-helper receipts are inert evidence, not executable requests or decisions. */
import type { NotebookStore } from "../src/types.ts";
import type { SyncRecord } from "./syncProtocol.ts";
const keys=(value:any,allowed:string[])=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>allowed.includes(k));
export function assistanceArtifactPath(name:string){return /^data\/research\/(?:delegate-request-[a-f0-9-]{36}\.json|local-assistance\/[a-f0-9]{64}(?:-[a-f0-9]{32}\.attempt)?\.json)$/.test(name);}
export function validateAssistanceArtifact(record:SyncRecord,project:string,catalogues:NotebookStore[]){
 if(record.kind!=='record' || record.external || record.bytes>300000 || !assistanceArtifactPath(record.path))throw Error('Not a bounded local-assistance artifact');
 const value=JSON.parse(Buffer.from(record.data,'base64').toString()),receipt=record.path.includes('/local-assistance/'),packet=receipt?value.request:value;
 if(!keys(packet,['version','task','instruction','context','owner']) || packet.version!==1 || !['extract','logs','tests','review','rewrite'].includes(packet.task)
  || typeof packet.instruction!=='string' || packet.instruction.length>2000 || !keys(packet.owner,['project','entry','notebook']) || packet.owner.project!==project
  || !catalogues.some(c=>c.entries.some(e=>e.id===packet.owner.entry && (e.experimentNotebookId??e.id)===packet.owner.notebook)))throw Error('Assistance packet owner/schema changed; preserve it for review');
 if(!Array.isArray(packet.context) || !packet.context.length || packet.context.length>12 || packet.context.some((c:any)=>!keys(c,['id','text']) || typeof c.id!=='string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(c.id) || typeof c.text!=='string')
  || packet.context.reduce((n:number,c:any)=>n+c.text.length,0)>14000 || new Set(packet.context.map((c:any)=>c.id)).size!==packet.context.length)throw Error('Unbounded assistance excerpts');
 if(receipt){
  if(!keys(value,['key','request','model','modelDigest','backend','status','createdAt','capacityBefore','executedSuggestions','raw','elapsedSeconds','answer','error'])
   || !/^[a-f0-9]{64}$/.test(value.key) || !record.path.split('/').at(-1)!.startsWith(value.key) || value.model!=='qwen3:8b'
   || !/^[a-f0-9]{64}$/.test(value.modelDigest) || value.backend!=='desktop-loopback' || value.executedSuggestions!==false || !['proposal','failed'].includes(value.status)
   || typeof value.createdAt!=='string' || !Number.isFinite(Date.parse(value.createdAt)))throw Error('Invalid local-only receipt provenance');
  if(value.status==='proposal'){
   const a=value.answer,ids=new Set(packet.context.map((c:any)=>c.id));
   if(!keys(a,['summary','findings','checks']) || typeof a.summary!=='string' || !Array.isArray(a.findings) || a.findings.length>30 || a.findings.some((f:any)=>!keys(f,['source','detail']) || !ids.has(f.source) || typeof f.detail!=='string') || !Array.isArray(a.checks) || a.checks.length>30 || a.checks.some((c:any)=>typeof c!=='string'))throw Error('Malformed helper answer');
  }
 }
}
