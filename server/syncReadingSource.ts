// Private reading-lane baselines and human choices. Never a publication approval.
import path from 'node:path';
import {lstat,readdir} from 'node:fs/promises';
import {privateSyncPath,readSyncBytes} from './deviceSync.ts';
import {canonical,syncHash,safeSyncPath} from './syncProtocol.ts';
import {saveImmutableSyncArtifact} from './syncStaging.ts';
import {saveGuardedFile,guardedTarget} from './guardedFile.ts';
import {getProject} from './projects.ts';
import {readWorkbench} from './workbenchStore.ts';
import {syncLockedFiles} from './syncReconcile.ts';
import {syncRecord,type SyncSnapshot} from './syncProtocol.ts';
import {textMergeLimits} from './syncText.ts';
const hash=/^[a-f0-9]{64}$/;
export const mergeableReadingSource=(key:string)=>safeSyncPath(key)&&/^source\/.+\.(tex|bib|md|txt)$/i.test(key);
export function sourceText(data:Buffer){
 if(data.length>textMergeLimits.bytes)throw Error('Source exceeds the bounded automatic text-merge size.');
 const text=new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(data);
 if(/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text))throw Error('Source is not ordinary UTF-8 text.');return text;
}
export async function rememberReadingSource(home:string,id:string,digest:string,data:Buffer){
 if(!hash.test(digest)||syncHash(data)!==digest)throw Error('Source baseline checksum changed.');
 sourceText(data);await saveImmutableSyncArtifact(await privateSyncPath(home,`reading/${id}/source-bases/${digest}.txt`,true),data,textMergeLimits.bytes);
}
export async function readingSourceBase(home:string,id:string,digest:string){
 if(!hash.test(digest))return;
 for(const relative of [`reading/${id}/source-bases/${digest}.txt`,`blobs/${digest}.blob`])try{
  const data=await readSyncBytes(await privateSyncPath(home,relative),textMergeLimits.bytes);
  if(syncHash(data)!==digest)throw Error('Source baseline checksum changed.');return sourceText(data);
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
}
export async function hasReadingSourceBase(home:string,id:string,digest:string){
 if(!hash.test(digest))return false;
 try{return (await lstat(await privateSyncPath(home,`reading/${id}/source-bases/${digest}.txt`))).isFile();}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return false;}
}
interface ReviewBody{version:1;projectId:string;peerId:string;key:string;binding:string;baseHash:string;localHash:string;remoteHash:string;baseText?:string;localText:string;remoteText:string;reason:string}
export interface ReadingSourceReview extends ReviewBody{id:string}
async function pointer(home:string,id:string,key:string){return privateSyncPath(home,`reading/${id}/source-reviews/current/${syncHash(key)}.json`,true);}
async function optional(file:string,max:number){try{return await readSyncBytes(file,max);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
async function index(home:string,id:string,key:string){const file=await pointer(home,id,key),raw=await optional(file,4000);return {file,raw,value:raw?JSON.parse(raw.toString()):undefined};}
function validateReview(review:ReadingSourceReview,id:string){
 const {id:reviewId,...body}=review;
 if(body.version!==1||body.projectId!==id||!mergeableReadingSource(body.key)||![reviewId,body.peerId,body.binding,body.localHash,body.remoteHash].every(x=>hash.test(x))||body.baseHash!==''&&!hash.test(body.baseHash)||syncHash(canonical(body))!==reviewId)throw Error('Invalid saved source comparison.');
 if(sourceText(Buffer.from(body.localText))!==body.localText||syncHash(body.localText)!==body.localHash||sourceText(Buffer.from(body.remoteText))!==body.remoteText||syncHash(body.remoteText)!==body.remoteHash||body.baseText!==undefined&&syncHash(body.baseText)!==body.baseHash)throw Error('Saved comparison text checksum changed.');
}
export async function saveReadingSourceReview(home:string,id:string,body:ReviewBody){
 const review:ReadingSourceReview={...body,id:syncHash(canonical(body))};validateReview(review,id);
 await saveImmutableSyncArtifact(await privateSyncPath(home,`reading/${id}/source-reviews/saved/${review.id}.json`,true),Buffer.from(JSON.stringify(review)+'\n'),2_000_000);
 const p=await index(home,id,body.key);
 if(p.value?.reviewId!==review.id||p.value?.active!==true)await saveGuardedFile(path.dirname(p.file),path.basename(p.file),p.raw?syncHash(p.raw):'',Buffer.from(JSON.stringify({version:1,key:body.key,reviewId:review.id,active:true,at:new Date().toISOString()})),4000);
 return review;
}
export async function readReadingSourceReview(home:string,id:string,reviewId:string){
 await getProject(home,id);if(!hash.test(reviewId))throw Error('Use an exact source comparison.');
 const value=JSON.parse((await readSyncBytes(await privateSyncPath(home,`reading/${id}/source-reviews/saved/${reviewId}.json`),2_000_000)).toString());validateReview(value,id);if(value.id!==reviewId)throw Error('Source comparison identity changed.');return value as ReadingSourceReview;
}
export async function clearReadingSourceReview(home:string,id:string,key:string){
 if(!mergeableReadingSource(key))return;
 const p=await index(home,id,key);if(p.value?.active)await saveGuardedFile(path.dirname(p.file),path.basename(p.file),syncHash(p.raw!),Buffer.from(JSON.stringify({...p.value,active:false})),4000);
}
export async function listReadingSourceReviews(home:string,id:string){
 await getProject(home,id);const folder=path.dirname(await pointer(home,id,'source/__index__.tex'));
 const entries=await readdir(folder,{withFileTypes:true});if(entries.length>5000)throw Error('Source comparison index exceeds its bounded file count.');
 const active=[];for(const e of entries){if(!/^[a-f0-9]{64}\.json$/.test(e.name))continue;
  const value=JSON.parse((await readSyncBytes(await guardedTarget(folder,e.name),4000)).toString());
  if(value.active&&mergeableReadingSource(value.key)&&hash.test(value.reviewId))active.push({id:value.reviewId,key:value.key,at:value.at});}
 return active.sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,20);
}
export async function readingSourceChoice(home:string,id:string,review:ReadingSourceReview){
 const raw=await optional(await privateSyncPath(home,`reading/${id}/source-reviews/choices/${review.id}.json`),4000);if(!raw)return;
 const value=JSON.parse(raw.toString());if(value.version!==1||value.reviewId!==review.id||!['local','remote'].includes(value.choice))throw Error('Invalid saved source choice.');return value.choice as 'local'|'remote';
}
export async function chooseReadingSource(home:string,id:string,reviewId:string,choice:'local'|'remote'){
 if(!['local','remote'].includes(choice))throw Error('Choose one of the two saved versions.');
 const review=await readReadingSourceReview(home,id,reviewId),{project,root}=await getProject(home,id),p=await index(home,id,review.key);
 if(!p.value?.active||p.value.reviewId!==reviewId)throw Error('This comparison is no longer current. Refresh its saved versions.');
 const wb=await readWorkbench(home,id),locks=syncLockedFiles([{records:[syncRecord('data/workbench.json','review',Buffer.from(JSON.stringify(wb)))]} as SyncSnapshot]);
 if(Object.values(project.manuscriptPurposes??{}).includes('publication')||locks.unknown||locks.files.has(review.key))throw Error('Publication/locked text stays in its writing workflow.');
 if(syncHash(await readSyncBytes(await guardedTarget(root,review.key.slice(7)),textMergeLimits.bytes))!==review.localHash)throw Error('Your saved text changed. Wait for a fresh comparison before choosing.');
 const file=await privateSyncPath(home,`reading/${id}/source-reviews/choices/${reviewId}.json`,true),old=await optional(file,4000);
 await saveGuardedFile(path.dirname(file),path.basename(file),old?syncHash(old):'',Buffer.from(JSON.stringify({version:1,reviewId,choice,at:new Date().toISOString()})),4000);
 return {queued:true,sourceEdited:false,detail:'Choice saved. Sync rechecks both exact versions before copying it; comments remain open.'};
}

