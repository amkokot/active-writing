import {once} from 'node:events';
import {createReadStream} from 'node:fs';
import {blobLimits,checkBlob,receiveBlob,verifyBlob,type BlobRef} from './syncBlobs.ts';
import type {Writable} from 'node:stream';
export class BlobReader {
 private iterator:AsyncIterator<Uint8Array>;private pending=Buffer.alloc(0);private ended=false;
 constructor(input:AsyncIterable<Uint8Array>){this.iterator=input[Symbol.asyncIterator]();}
 private async fill(){if(this.ended)return false;const next=await this.iterator.next();if(next.done){this.ended=true;return false;}this.pending=Buffer.from(next.value);return true;}
 async line(max=16*1024**2){const parts:Buffer[]=[];let size=0;for(;;){if(!this.pending.length&&!await this.fill())throw new Error('Missing bulk header.');const index=this.pending.indexOf(10),take=index<0?this.pending.length:index;size+=take;if(size>max)throw new Error('Bulk header too large.');parts.push(this.pending.subarray(0,take));this.pending=this.pending.subarray(take+(index<0?0:1));if(index>=0)return Buffer.concat(parts).toString('utf8');}}
 async *exact(bytes:number){while(bytes){if(!this.pending.length&&!await this.fill())throw new Error('Truncated bulk stream.');const count=Math.min(bytes,this.pending.length);yield this.pending.subarray(0,count);this.pending=this.pending.subarray(count);bytes-=count;}}
 async end(){if(this.pending.length||await this.fill())throw new Error('Unexpected trailing bulk bytes.');}
}
export function validateBlobList(refs:BlobRef[]){if(!Array.isArray(refs)||refs.length>blobLimits.records)throw new Error('Invalid bulk batch.');let total=0;const seen=new Set<string>();for(const r of refs){checkBlob(r);if(seen.has(r.sha256)||(total+=r.bytes)>blobLimits.totalBytes)throw new Error('Duplicate/oversized bulk batch.');seen.add(r.sha256);}return refs;}
export async function writeBytes(out:Writable,bytes:Uint8Array){if(!out.write(bytes))await once(out,'drain');}
export async function sendBlobs(home:string,refs:BlobRef[],out:Writable){validateBlobList(refs);for(const ref of refs){const file=await verifyBlob(home,ref);for await(const chunk of createReadStream(file,{highWaterMark:blobLimits.chunkBytes}))await writeBytes(out,chunk);}}
export async function readBlobs(home:string,refs:BlobRef[],reader:BlobReader){validateBlobList(refs);for(const ref of refs)await receiveBlob(home,ref,reader.exact(ref.bytes));await reader.end();}
