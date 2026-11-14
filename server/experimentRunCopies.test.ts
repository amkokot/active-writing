import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createPaperProject} from './projectFiles.ts';
import {projectDataPath} from './projectStorage.ts';
import {readExperiments,writeExperiments} from './experiments.ts';
import {newExperimentNotebook} from '../src/experiments.ts';
import {copyExperimentRuns} from './experimentRunCopies.ts';
async function fixture(){
 const home=await mkdtemp(path.join(os.tmpdir(),'aw-run-copy-')),p=await createPaperProject(home,'Run-copy trial'),id=p.id;
 const nb={...newExperimentNotebook(),cells:[{id:'cell',cell_type:'code' as const,source:'1+1',outputs:[],execution_count:null,metadata:{paperfocus:{runId:'run'}}}]};
 const snapshot=await writeExperiments(home,id,'source','',nb),folder=path.join(projectDataPath(home,id),'experiments/source/runs');await mkdir(folder,{recursive:true});
 const raw=Buffer.from(JSON.stringify({id:'run',cellId:'cell',status:'complete',notebookId:'source',source:'1+1',outputs:[]}));await writeFile(path.join(folder,'run.json'),raw);
 return {home,id,snapshot,raw,target:path.join(projectDataPath(home,id),'experiments/target/runs/run.json'),source:path.join(folder,'run.json')};
}
test('copied notebook run evidence retains exact bytes and original execution identity',async()=>{
 const f=await fixture();assert.equal((await copyExperimentRuns(f.home,f.id,'source',f.snapshot,'target')).records,1);assert.deepEqual(await readFile(f.target),f.raw);
 await copyExperimentRuns(f.home,f.id,'source',f.snapshot,'target');assert.deepEqual(await readFile(f.target),f.raw);
});
test('copied notebook run evidence refuses changed target, foreign cell and stale source',async()=>{
 const f=await fixture();await mkdir(path.dirname(f.target),{recursive:true});await writeFile(f.target,'other saved evidence');
 await assert.rejects(copyExperimentRuns(f.home,f.id,'source',f.snapshot,'target'));assert.equal(await readFile(f.target,'utf8'),'other saved evidence');
 await writeFile(f.source,JSON.stringify({id:'run',cellId:'foreign',status:'complete'}));await assert.rejects(copyExperimentRuns(f.home,f.id,'source',f.snapshot,'other'),/provenance/);
 const nb=structuredClone(f.snapshot.notebook);nb.cells[0].source='new edit';await writeExperiments(f.home,f.id,'source',f.snapshot.revision,nb);
 await assert.rejects(copyExperimentRuns(f.home,f.id,'source',f.snapshot,'other'),/changed/);
});
