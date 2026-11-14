import test from 'node:test';
import assert from 'node:assert/strict';
import {stableImmutableBlob} from './syncBlobs.ts';
const ref={sha256:'a'.repeat(64),bytes:50};
test('small immutable blob retries one changing-metadata observation and validates fresh bytes',async()=>{
 let calls=0;const value=await stableImmutableBlob('/fixture',ref,async()=>{if(++calls===1)throw Error('Evidence changed while hashing (/fixture); saved work was not replaced.');return {...ref,fingerprint:'stable'};});
 assert.equal(calls,2);assert.equal(value.sha256,ref.sha256);
});
test('unstable, corrupted and large immutable blobs remain guarded',async()=>{
 let calls=0;await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>{calls++;throw Error('Evidence changed while hashing');}));assert.equal(calls,2);
 await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>({...ref,sha256:'b'.repeat(64),fingerprint:'stable'})),/checksum/);
 calls=0;await assert.rejects(stableImmutableBlob('/fixture',{...ref,bytes:20*1024**2},async()=>{calls++;throw Error('Evidence changed while hashing');}));assert.equal(calls,1);
 await assert.rejects(stableImmutableBlob('/fixture',ref,async()=>{throw Error('permission denied');}),/permission/);
});
