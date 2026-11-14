// Streaming immutable evidence. Content is never executed, extracted or loaded
// wholesale; live destinations still require byte fences and the normal locks.
import {createHash,randomUUID} from 'node:crypto';
import {lstat,link,unlink,readFile,rename} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {guardedTarget} from './guardedFile.ts';
import {withRecordLock} from './recordLock.ts';
import {replaceFile} from './atomicFile.ts';
import {verifyColdAvailability,coldFilePath,coldAliasForTarget,saveColdAlias} from './syncColdRefs.ts';

export const blobLimits={fileBytes:8*1024**3,totalBytes:128*1024**3,records:50000,chunkBytes:256*1024};
export interface BlobRef {sha256:string;bytes:number}
const digest=/^[a-f0-9]{64}$/;
export function checkBlob(ref:BlobRef) {if(!ref||!digest.test(ref.sha256)||!Number.isSafeInteger(ref.bytes)||ref.bytes<0||ref.bytes>blobLimits.fileBytes)throw new Error('Invalid bulk evidence reference.');}
export const fingerprint=(s:Awaited<ReturnType<typeof lstat>>)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.birthtimeMs].join(':');
async function stat(file:string) {const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>blobLimits.fileBytes)throw new Error('Linked, non-file or oversized bulk evidence.');return s;}
export async function streamedHash(file:string) {
 const before=await stat(file),hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(file,{highWaterMark:blobLimits.chunkBytes})){bytes+=chunk.length;hash.update(chunk);if(bytes>blobLimits.fileBytes)throw new Error('Bulk evidence grew beyond its limit.');}
 if(bytes!==before.size||fingerprint(await stat(file))!==fingerprint(before))throw new Error(`Evidence changed while hashing (${file}); saved work was not replaced.`);
 return {sha256:hash.digest('hex'),bytes,fingerprint:fingerprint(before)};
}
export async function blobPath(home:string,ref:BlobRef,create=false) {checkBlob(ref);return guardedTarget(home,`.paperfocus/device-sync/blobs/${ref.sha256}.blob`,create);}
/** NFS may publish a final hard-link ctime just after a blob is installed. Retry
 * one small immutable-cache observation only; every pass retains all stability
 * checks and the expected content hash. Live source hashing is never retried. */
export async function stableImmutableBlob(file:string,ref:BlobRef,hash=streamedHash){
 let actual;
 try{actual=await hash(file);}catch(error){
  if(ref.bytes>16*1024**2||!(error instanceof Error)||!error.message.startsWith('Evidence changed while hashing'))throw error;
  actual=await hash(file);
 }
 if(actual.sha256!==ref.sha256||actual.bytes!==ref.bytes)throw new Error('Bulk blob checksum changed; no availability claimed.');
 return actual;
}
// Fingerprints are a read optimization only. Incoming content and live writes
// are always hashed. A changed inode/ctime/size/mtime forces re-verification.
export async function verifyBlob(home:string,ref:BlobRef) {
 const file=await blobPath(home,ref),s=await stat(file);if(s.size!==ref.bytes)throw new Error('Bulk blob size changed.');
 const receipt=await guardedTarget(home,`.paperfocus/device-sync/blob-checks/${ref.sha256}.json`,true);
 try{const saved=JSON.parse(await readFile(receipt,'utf8'));if(saved.sha256===ref.sha256&&saved.fingerprint===fingerprint(s))return file;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const actual=await stableImmutableBlob(file,ref);
 const temp=receipt+'.'+randomUUID()+'.part';await (await import('node:fs/promises')).writeFile(temp,JSON.stringify(actual),{flag:'wx',mode:0o600});await rename(temp,receipt);return file;
}
export async function verifyStoredBlob(home:string,ref:BlobRef,projectId?:string){try{return {local:true as const,file:await verifyBlob(home,ref)};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {local:false as const,claim:await verifyColdAvailability(home,ref,projectId)};}}
export async function receiveBlob(home:string,ref:BlobRef,input:AsyncIterable<Uint8Array>) {
 checkBlob(ref);const target=await blobPath(home,ref,true);
 return withRecordLock(target,async()=>{
  // Consume/verify even a duplicate incoming stream; never acknowledge corrupt input.
  const temp=target+'.'+randomUUID()+'.part',hash=createHash('sha256');let count=0;
  const sink=createWriteStream(temp,{flags:'wx',mode:0o600,highWaterMark:blobLimits.chunkBytes});
  const meter=new Transform({transform(chunk,_encoding,done){count+=chunk.length;hash.update(chunk);done(count>ref.bytes?new Error('Incoming blob exceeds declared size.'):null,chunk);}});
  await pipeline(input,meter,sink);
  if(count!==ref.bytes||hash.digest('hex')!==ref.sha256)throw new Error('Incomplete or corrupt bulk evidence; partial file retained, no blob published.');
  try{await link(temp,target);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await verifyBlob(home,ref);}
  await unlink(temp);await verifyBlob(home,ref);return ref;
 });
}
export async function captureBlob(home:string,file:string,cached?:BlobRef&{fingerprint:string}) {
 const s=await stat(file);
 if(cached&&cached.fingerprint===fingerprint(s)){await verifyBlob(home,cached);return cached;}
 // A bounded streaming pass to hash, followed by a guarded streaming copy only
 // for genuinely new content. Unchanged files do not get copied every cycle.
 const ref=await streamedHash(file);
 try{await verifyBlob(home,ref);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;await receiveBlob(home,ref,createReadStream(file,{highWaterMark:blobLimits.chunkBytes}));}
 if(fingerprint(await stat(file))!==ref.fingerprint)throw new Error('Live evidence changed during capture.');return ref;
}
export async function materializeBlob(home:string,root:string,name:string,ref:BlobRef,expectedHash:string) {
 const availability=await verifyStoredBlob(home,ref),target=await guardedTarget(root,name,true);
 if(!availability.local){const c=availability.claim;if(await coldFilePath(home,c.projectId,c.record.path)!==target)throw new Error('Desktop artifact target does not match its verified owner.');return withRecordLock(target,async()=>{let actual='';try{actual=(await streamedHash(target)).sha256;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;actual=(await coldAliasForTarget(home,root,name))?.record.sha256??'';}if(actual!==expectedHash)throw new Error('Desktop-backed destination changed; both variants retained.');try{await lstat(target);throw new Error('A local copy exists. Fetch the updated artifact before replacing it.');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await saveColdAlias(home,c.projectId,c.record,c.peerId);return ref.sha256;});}
 const source=availability.file;
 await guardedTarget(root,name+'.aw-lock');
 const current=async()=>{try{return (await streamedHash(await guardedTarget(root,name))).sha256;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return (await coldAliasForTarget(home,root,name))?.record.sha256??'';throw e;}};
 return withRecordLock(target,async()=>{
  if(await current()!==expectedHash)throw new Error('Bulk destination changed; both variants retained.');
  const temp=path.join(path.dirname(target),'.aw-save-'+randomUUID()+'.tmp');
  await pipeline(createReadStream(source,{highWaterMark:blobLimits.chunkBytes}),createWriteStream(temp,{flags:'wx',mode:0o600}));
  if((await streamedHash(temp)).sha256!==ref.sha256)throw new Error('Prepared evidence checksum changed.');
  await guardedTarget(root,name);if(await current()!==expectedHash)throw new Error('Bulk destination changed during preparation.');
  if(expectedHash===''){await link(temp,target);await unlink(temp);}else await replaceFile(temp,target);
  if(await current()!==ref.sha256)throw new Error('Bulk destination changed while confirming.');return ref.sha256;
 });
}
export async function guardedBulkHash(root:string,name:string){try{return (await streamedHash(await guardedTarget(root,name))).sha256;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return '';throw e;}}
