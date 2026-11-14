import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createPaperProject} from './projectFiles.ts';
import {registerLinkedWorkspace,linkedWorkspaces,openLinkedWorkspace} from './linkedWorkspaces.ts';
import {desktopServer} from '../scripts/desktopServer.mjs';
import {initializeSyncDevice,captureSyncSnapshot} from './deviceSync.ts';
import {previewSyncClone,commitSyncClone} from './syncClone.ts';

async function fixture(){
 const parent=path.resolve('.paperfocus/trials');await mkdir(parent,{recursive:true});
 const control=await mkdtemp(path.join(parent,'linked-home-'));await createPaperProject(control,'Main project');
 const home=path.join(control,'reading');await mkdir(home);const project=await createPaperProject(home,'Linked reading note');
 return {control,home,project};
}
test('chooser links preserve independent homes and main registry, and listing never starts a service',async()=>{
 const f=await fixture(),registry=await readFile(path.join(f.control,'.paperfocus/projects.json'));
 assert.deepEqual(await linkedWorkspaces(f.control),[]);
 assert.equal((await registerLinkedWorkspace(f.control,f.home,f.project.id)).alreadyPresent,false);
 assert.equal((await registerLinkedWorkspace(f.control,f.home,f.project.id)).alreadyPresent,true);
 const links=await linkedWorkspaces(f.control);assert.equal(links.length,1);assert.equal(links[0].name,'Linked reading note');assert.match(links[0].url,/^http:\/\/127\.0\.0\.1:4\d{3}\//);
 assert.deepEqual(await readFile(path.join(f.control,'.paperfocus/projects.json')),registry);
 await assert.rejects(stat(path.join(f.home,'.paperfocus/launcher')),/ENOENT/);
 await assert.rejects(openLinkedWorkspace(f.control,'unknown'),/registered/);
});
test('chooser refuses out-of-home and self links',async()=>{
 const f=await fixture(),other=await fixture();
 await assert.rejects(registerLinkedWorkspace(f.control,other.home,other.project.id),/relative|ordinary|path/i);
 await assert.rejects(registerLinkedWorkspace(f.control,f.control,f.project.id),/relative|ordinary|path/i);
});
test('a registered reading clone sees sibling reading copies and ordinary projects without reimporting them',async()=>{
 const f=await fixture();await initializeSyncDevice(f.home,'Desktop');
 const other=await createPaperProject(f.home,'Other reading note');
 const homes=[];
 for(const [index,project] of [f.project,other].entries()){
  const snapshot=await captureSyncSnapshot(f.home,project.id),options={destination:path.join(f.control,'received-'+index),mainFile:project.mainFile,label:'Laptop'};
  const preview=await previewSyncClone(snapshot,options);await commitSyncClone(snapshot,options,preview.planId);
  await registerLinkedWorkspace(f.control,options.destination,project.id);homes.push(options.destination);
 }
 const root=await linkedWorkspaces(f.control),reading=await linkedWorkspaces(homes[0]);
 assert.equal(root.length,2);assert.equal(reading.filter(p=>p.kind==='reading').length,1);
 assert.equal(reading.find(p=>p.kind==='reading')?.projectId,other.id);
 assert(reading.some(p=>p.kind==='project'&&p.name==='Main project'));
 assert(!reading.some(p=>p.projectId===f.project.id));
 assert.deepEqual(await linkedWorkspaces(f.home),[],'A nearby standalone home does not inherit access just from its location');
 await assert.rejects(openLinkedWorkspace(homes[0],'not-registered'),/registered/);
});
test('chooser HTTP listing is read-only; service opening needs same-origin explicit action',async()=>{
 const f=await fixture();await registerLinkedWorkspace(f.control,f.home,f.project.id);
 const server=desktopServer(f.control);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`;
 try{
  const result=await fetch(base+'/api/paperfocus/linked-workspaces');assert.equal(result.status,200);assert.equal((await result.json()).links[0].projectId,f.project.id);
  for(const origin of ['https://foreign.example',undefined]){
   const r=await fetch(base+'/api/paperfocus/linked-workspaces',{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify({projectId:f.project.id})});assert.notEqual(r.status,200);
  }
  await assert.rejects(stat(path.join(f.home,'.paperfocus/launcher')),/ENOENT/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
