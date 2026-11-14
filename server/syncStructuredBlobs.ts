import {readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {guardedTarget} from './guardedFile.ts';
import {verifyBlob,verifyStoredBlob,fingerprint} from './syncBlobs.ts';
import {canonicalHash,syncHash,syncLimits,type SyncRecord} from './syncProtocol.ts';
import {validateExperimentNotebook} from '../src/experiments.ts';
export async function notebookSemanticHash(file:string){
 if((await lstat(file)).size>syncLimits.fileBytes)throw new Error('Notebook exceeds its structured record bound.');
 const bytes=await readFile(file),notebook=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));validateExperimentNotebook(notebook);
 return {sha256:syncHash(bytes),semanticHash:canonicalHash(notebook)};
}
export async function verifyExternalRecord(home:string,record:SyncRecord){
 const file=await verifyBlob(home,record);if(record.kind!=='experiment')return file;
 const stamp=fingerprint(await lstat(file)),cache=await guardedTarget(home,`.paperfocus/device-sync/blob-checks/${record.sha256}.notebook.json`,true);
 try{const saved=JSON.parse(await readFile(cache,'utf8'));if(saved.fingerprint===stamp&&saved.semanticHash===record.semanticHash)return file;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const actual=await notebookSemanticHash(file);if(actual.sha256!==record.sha256||actual.semanticHash!==record.semanticHash)throw new Error('Notebook semantic reference does not match its actual evidence.');
 const temp=cache+'.'+randomUUID()+'.part';await writeFile(temp,JSON.stringify({...actual,fingerprint:stamp}),{flag:'wx',mode:0o600});await rename(temp,cache);return file;
}
export async function verifyExternalAvailability(home:string,record:SyncRecord,projectId?:string){if(record.kind==='experiment')await verifyExternalRecord(home,record);else await verifyStoredBlob(home,record,projectId);}
