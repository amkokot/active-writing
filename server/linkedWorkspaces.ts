// A local project-chooser shortcut to an independent, completed reading home.
// Source, ownership and sync state remain in that home; nothing is re-imported.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {syncHash,safeSyncId} from './syncProtocol.ts';
import {getProject,registry} from './projects.ts';
import {validateLaunchWorkspace,launch,appUrl} from '../scripts/desktopLauncher.mjs';
import {readingPort,openReadingWorkspace} from '../scripts/readingWorkspaceLauncher.mjs';
const file='.paperfocus/linked-workspaces.json';
interface Link {projectId:string;folder:string;createdAt:string}
async function saved(control:string){
 let raw:Buffer;try{raw=await readFile(await guardedTarget(control,file));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {raw:Buffer.alloc(0),links:[] as Link[]};throw e;}
 if(raw.length>40000)throw Error('Linked workspace index is too large.');
 const value=JSON.parse(raw.toString());
 if(value.version!==1||!Array.isArray(value.links)||value.links.length>64||value.links.some((p:Link)=>!safeSyncId(p.projectId)||typeof p.folder!=='string'||!p.folder||typeof p.createdAt!=='string')||new Set(value.links.map((p:Link)=>p.projectId)).size!==value.links.length)throw Error('Invalid linked workspace index; preserved.');
 return {raw,links:value.links as Link[]};
}
async function checked(control:string,link:Link){
 // Validate all ordinary directory components before resolving a nested home.
 const registry=await guardedTarget(control,link.folder+'/.paperfocus/projects.json');
 const home=await realpath(path.dirname(path.dirname(registry)));
 validateLaunchWorkspace(home);
 const {project}=await getProject(home,link.projectId);
 return {home,project};
}
export async function linkedWorkspaces(control:string){
 const current=await realpath(control),origin=await linkedControl(current);control=origin;
 const result=[];
 for(const link of (await saved(control)).links){const {home,project}=await checked(control,link);if(home===current)continue;result.push({projectId:project.id,name:project.name,mainFile:project.mainFile,folder:link.folder,kind:'reading',url:`http://127.0.0.1:${readingPort(home)}/?awProject=${encodeURIComponent(project.id)}`});}
 if(current!==control){
  const included=new Set(result.map(p=>p.projectId));
  for(const project of (await registry(control)).projects)if(!included.has(project.id))result.push({projectId:project.id,name:project.name,mainFile:project.mainFile,folder:project.folder,kind:'project',url:appUrl+'?awProject='+encodeURIComponent(project.id)});
 }
 return result;
}
/** Only a catalogue entry explicitly naming this completed clone permits a shared chooser. */
async function linkedControl(home:string){
 try{await readFile(await guardedTarget(home,'.paperfocus/device-sync/clone-ready.json'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return home;throw e;}
 let parent=path.dirname(home);
 for(let depth=0;depth<7;depth++){
  for(const link of (await saved(parent)).links){
   const child=path.resolve(parent,link.folder);
   if(child!==home)continue;
   if((await checked(parent,link)).home===home)return parent;
  }
  const next=path.dirname(parent);if(next===parent)break;parent=next;
 }
 return home;
}
export async function registerLinkedWorkspace(control:string,home:string,projectId:string){
 control=await realpath(control);home=await realpath(home);
 const folder=path.relative(control,home).split(path.sep).join('/');
 const link={projectId,folder,createdAt:new Date().toISOString()};await checked(control,link);
 const previous=await saved(control),existing=previous.links.find(p=>p.projectId===projectId);
 if(existing){if(existing.folder!==folder)throw Error('A different linked home already owns this project; preserved.');return {registered:true,alreadyPresent:true};}
 await saveGuardedFile(control,file,previous.raw.length?syncHash(previous.raw):'',Buffer.from(JSON.stringify({version:1,links:[link,...previous.links]})+'\n'),40000);
 return {registered:true,alreadyPresent:false};
}
export async function openLinkedWorkspace(control:string,projectId:string){
 const current=await realpath(control);control=await linkedControl(current);
 const link=(await saved(control)).links.find(p=>p.projectId===projectId);
 if(!link){
  if(current===control||!(await registry(control)).projects.some(p=>p.id===projectId))throw Error('Choose a registered linked reading copy.');
  await launch({workspace:control,browser:false});return {workspace:control,url:appUrl+'?awProject='+encodeURIComponent(projectId)};
 }
 const {home}=await checked(control,link);
 const opened=await openReadingWorkspace({workspace:home,browser:false});
 return {...opened,url:opened.url+'?awProject='+encodeURIComponent(projectId)};
}
