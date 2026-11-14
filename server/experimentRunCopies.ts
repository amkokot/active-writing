// Preserve exact execution provenance when a notebook is copied. Never rerun or
// remap execution IDs; notebook lineage records the original owner.
import {projectDataPath} from './projectStorage.ts';
import {guardedTarget} from './guardedFile.ts';
import {readSyncBytes} from './deviceSync.ts';
import {saveImmutableSyncArtifact} from './syncStaging.ts';
import {readExperiments} from './experiments.ts';
import {validateSyncJson} from './syncProtocol.ts';
import type {ExperimentStore} from '../src/experiments.ts';

export async function copyExperimentRuns(home:string,id:string,owner:string,snapshot:ExperimentStore,targetOwner:string){
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(owner)||!/^[A-Za-z0-9_-]{1,64}$/.test(targetOwner)||owner===targetOwner)throw Error('Choose distinct existing notebook identities.');
 if((await readExperiments(home,id,owner)).revision!==snapshot.revision)throw Error('Original notebook changed; run evidence preserved.');
 const records=new Map<string,Buffer>();let bytes=0;
 for(const cell of snapshot.notebook.cells){
  const run=cell.metadata?.paperfocus?.runId;if(!run)continue;
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(run)||records.size>=200&&!records.has(run))throw Error('Copied notebook run bundle exceeds its identity limit.');
  if(records.has(run))continue;
  const raw=await readSyncBytes(await guardedTarget(projectDataPath(home,id),`experiments/${owner}/runs/${run}.json`),16*1024**2);
  const value=JSON.parse(raw.toString());validateSyncJson(value);
  if(value.id!==run||value.cellId!==cell.id||['working','queued'].includes(value.status))throw Error('Copied run provenance does not match its settled cell.');
  if((bytes+=raw.length)>32*1024**2)throw Error('Copied run evidence exceeds its bounded size.');
  records.set(run,raw);
 }
 if((await readExperiments(home,id,owner)).revision!==snapshot.revision)throw Error('Original notebook changed during evidence preparation.');
 for(const [run,raw] of records)await saveImmutableSyncArtifact(await guardedTarget(projectDataPath(home,id),`experiments/${targetOwner}/runs/${run}.json`,true),raw,16*1024**2);
 return {records:records.size,bytes};
}
