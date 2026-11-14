import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from '../server/projectFiles.ts';
import {projectStorage} from '../server/projectStorage.ts';
import {getProject} from '../server/projects.ts';

test('one journal supervisor watches two scopes offline and stops gracefully without research execution',async()=>{
 const parent=path.join(process.cwd(),'.paperfocus/trials');await mkdir(parent,{recursive:true});const home=await mkdtemp(path.join(parent,'journal-process-'));
 const projects=[];for(let n=0;n<2;n++){const p=await createPaperProject(home,'Journal process '+n);await projectStorage(home,p.id);projects.push({workspace:home,projectId:p.id});}
 const config=path.join(home,'journal-config.json');await writeFile(config,JSON.stringify({version:1,projects}));
 const tool=path.resolve('scripts/awSyncJournal.ts'),child=spawn(process.execPath,[tool,'start','--config',config],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let diagnostics='';child.stdout.on('data',b=>{diagnostics+=b;});child.stderr.on('data',b=>{diagnostics+=b;});const stopped=new Promise(resolve=>child.on('close',resolve));
 const owner=async p=>{try{return JSON.parse(await readFile(path.join(home,'.paperfocus/device-sync/change-journal',p.projectId,'owner.json'),'utf8'));}catch{return undefined;}};
 const wait=async predicate=>{const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+diagnostics);};
 try{
  await wait(async()=>{const states=await Promise.all(projects.map(owner));return states.every(s=>s?.valid&&s.pid===child.pid);});
  for(const p of projects)await writeFile(path.join((await getProject(home,p.projectId)).root,'offline.tex'),'Local offline edit');
  await wait(async()=>{const states=await Promise.all(projects.map(owner));return states.every(s=>s.seq>0);});
 }finally{
  const result=spawnSync(process.execPath,[tool,'stop','--config',config],{windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
  const code=await Promise.race([stopped,new Promise(resolve=>setTimeout(()=>resolve('timeout'),12000))]);assert.equal(code,0,diagnostics);
 }
 for(const p of projects){const state=await owner(p);assert.equal(state.valid,false);assert.equal(state.pid,0);}
});

test('journal startup is hidden, single-instance, low-priority and has no network condition',async()=>{
 const installer=await readFile('scripts/installSyncJournal.ps1','utf8'),tool=await readFile('scripts/awSyncJournal.ts','utf8');
 assert.match(installer,/System32\/wscript.exe/);assert.match(installer,/MultipleInstances IgnoreNew/);
 assert.doesNotMatch(installer,/-RunOnlyIfNetworkAvailable|-WakeToRun/);assert.match(installer,/DisallowStartIfOnBatteries=\$false/);
 assert.match(tool,/PRIORITY_BELOW_NORMAL/);assert.doesNotMatch(tool,/execFile|runSshMessage|allow-python|captureBulkRecords/);
});
