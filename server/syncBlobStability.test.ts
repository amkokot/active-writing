import test from 'node:test';
import assert from 'node:assert/strict';
import {stableImmutableBlob} from './syncBlobs.ts';
import {missingBlobRefs} from './syncBlobWire.ts';
const ref={sha256:'a'.repeat(64),bytes:50};
test('small immutable blob retries one changing-metadata observation and validates fresh bytes',async()=>{
 let calls=0;const value=await stableImmutableBlob('/fixture',ref,async()=>{if(++calls===1)throw Error('Evidence changed while hashing (/fixture); saved work was not replaced.');return {...ref,fingerprint:'stable'};});
 assert.equal(calls,2);assert.equal(value.sha256,ref.sha256);
});
test('bulk catch-up requests only absent blobs and retains input order',async()=>{
 const refs=[ref,{sha256:'b'.repeat(64),bytes:25},{sha256:'c'.repeat(64),bytes:10}];
 const seen:string[]=[];
 const missing=await missingBlobRefs('/cache',refs,async(home,item)=>{seen.push(item.sha256);assert.equal(home,'/cache');if(item!==ref)throw Object.assign(Error('missing'),{code:'ENOENT'});return '/verified';});
 assert.deepEqual(seen,refs.map(r=>r.sha256));assert.deepEqual(missing,refs.slice(1));
 assert.deepEqual(await missingBlobRefs('/cache',refs,async()=>'/verified'),[]);
});
test('bulk cache filtering never hides corruption, access failures or malformed batches',async()=>{
 for(const code of ['EACCES','EDQUOT',undefined])await assert.rejects(missingBlobRefs('/cache',[ref],async()=>{throw Object.assign(Error('preserved error'),{code});}),/preserved error/);
 let called=false;await assert.rejects(missingBlobRefs('/cache',[ref,ref],async()=>{called=true;return '/verified';}),/Duplicate/);assert.equal(called,false);
});
test('unstable, corrupted and large immutable blobs remain guarded',async()=>{
 let calls=0;await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>{calls++;throw Error('Evidence changed while hashing');}));assert.equal(calls,2);
 await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>({...ref,sha256:'b'.repeat(64),fingerprint:'stable'})),/checksum/);
 calls=0;await assert.rejects(stableImmutableBlob('/fixture',{...ref,bytes:20*1024**2},async()=>{calls++;throw Error('Evidence changed while hashing');}));assert.equal(calls,1);
 await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>{throw Error('permission denied');}),/permission/);
});
