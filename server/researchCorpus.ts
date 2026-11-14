// Audience selections are private metadata; exports omit hidden source, not CSS.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { getProject } from './projects.ts';
import { projectDataPath,projectStorage } from './projectStorage.ts';
import {createPaperProject} from './projectFiles.ts';
import { guardedTarget, saveGuardedFile } from './guardedFile.ts';
import { syncHash } from './syncProtocol.ts';
import type { ProjectDocument } from '../src/types.ts';
import type { ResearchCorpus, CorpusAction, CorpusSnapshot } from '../src/researchCorpus.ts';
import {corpusTypography} from './corpusPresentation.ts';

const keyPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validateCorpus(value:ResearchCorpus):ResearchCorpus {
 if(!value||value.version!==1||value.mainFile!=='main.tex'||!Array.isArray(value.entries)||value.entries.length>100||!value.profiles||typeof value.profiles!=='object'||Array.isArray(value.profiles))throw Error('Invalid research list.');
 const keys=new Set<string>();
 for(const e of value.entries){
  if(!e||!keyPattern.test(e.key)||e.key.length>64||keys.has(e.key)||e.file!==`projects/${e.key}.tex`||typeof e.title!=='string'||!e.title.trim()||e.title.length>160)throw Error('Invalid or duplicate research entry.');
  keys.add(e.key);
 }
 const profiles=Object.entries(value.profiles);
 if(!profiles.length||profiles.length>40||!Object.hasOwn(value.profiles,value.activeProfile))throw Error('Choose a saved audience.');
 for(const [id,p] of profiles)if(!keyPattern.test(id)||id.length>64||!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>80||!Array.isArray(p.hidden)||p.hidden.some(k=>!keys.has(k))||new Set(p.hidden).size!==p.hidden.length)throw Error('Invalid audience selection.');
 return value;
}
export function changeCorpus(value:ResearchCorpus,action:CorpusAction):ResearchCorpus {
 const next=structuredClone(validateCorpus(value));
 if(action?.action==='visibility'){
  if(typeof action.visible!=='boolean'||!next.entries.some(e=>e.key===action.key))throw Error('Choose a research entry.');
  const p=next.profiles[next.activeProfile];p.hidden=action.visible?p.hidden.filter(k=>k!==action.key):[...new Set([...p.hidden,action.key])];
 }else if(action?.action==='profile'){
  if(!keyPattern.test(action.profile)||action.profile.length>64)throw Error('Use a short audience name with letters, numbers and hyphens.');
  if(!Object.hasOwn(next.profiles,action.profile))next.profiles[action.profile]={name:action.name?.trim()||action.profile,hidden:[...next.profiles[next.activeProfile].hidden]};
  next.activeProfile=action.profile;
 }else throw Error('Choose Show, Hide or an audience.');
 return validateCorpus(next);
}
export async function readCorpus(home:string,id:string):Promise<CorpusSnapshot|undefined>{
 const {project}=await getProject(home,id),root=projectDataPath(home,id);
 try{const bytes=await readFile(await guardedTarget(root,'corpus.json'));if(bytes.length>150000)throw Error('Research list is too large.');return {corpus:validateCorpus(JSON.parse(bytes.toString('utf8'))),revision:syncHash(bytes)};}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'&&!project.researchCorpus)return;throw error;}
}
// Private compiler entry point: the original file is still TeX's input (and
// SyncTeX's source), while the audience overrides apply at begin{document}.
export function corpusCompileSource(value:ResearchCorpus,mainPath:string):string {
 validateCorpus(value);
 let depth=0;
 for(const c of mainPath){if(c==='{')depth++;if(c==='}'&&--depth<0)throw Error('The research-list source path cannot be compiled safely.');}
 if(depth||/[%\r\n]/.test(mainPath))throw Error('The research-list source path cannot be compiled safely.');
 const hidden=new Set(value.profiles[value.activeProfile].hidden);
 return '\\AtBeginDocument{'+value.entries.filter(e=>hidden.has(e.key)).map(e=>`\\hideproject{${e.key}}`).join('')+'}\n'
  +`\\input{\\detokenize{${mainPath.replaceAll('\\','/')}}}\n`;
}
export interface CorpusSeed {name:string;entries:Array<{key:string;title:string;summary:string;overviewUrl?:string;projectId?:string;hidden?:boolean}>}
export async function createResearchCorpus(home:string,seed:CorpusSeed){
 if(!seed||!Array.isArray(seed.entries)||!seed.entries.length)throw Error('Provide the research summaries first.');
 const corpus:ResearchCorpus={version:1,mainFile:'main.tex',activeProfile:'all',entries:seed.entries.map(e=>({key:e.key,title:e.title,file:`projects/${e.key}.tex`,...(e.projectId?{projectId:e.projectId}:{})})),profiles:{all:{name:'Current selection',hidden:seed.entries.filter(e=>e.hidden).map(e=>e.key)}}};validateCorpus(corpus);
 const tex=(s:string)=>s.replace(/[\\{}%$&#_^~]/g,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','$':'\\$','&':'\\&','#':'\\#','_':'\\_','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[c]!));
 const fragments=seed.entries.map(e=>{
  if(typeof e.summary!=='string'||!e.summary.trim()||e.summary.length>1800)throw Error('Keep each research summary short.');
  let link='';if(e.overviewUrl){const u=new URL(e.overviewUrl);if(u.protocol!=='https:'||u.username||u.password||['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.searchParams.has('awProject')||/[{}\\\s%]/.test(e.overviewUrl))throw Error('Use an ordinary hosted HTTPS overview link, without local paths.');link=`\\href{${e.overviewUrl}}{Overview}`;}
  return {path:`projects/${e.key}.tex`,text:`\\paragraph{${link?`\\href{${e.overviewUrl}}{${tex(e.title)}}`:tex(e.title)}}\n${tex(e.summary.trim())}\n`};
 });
 const source=String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{hyperref}
\hypersetup{colorlinks=true,urlcolor=blue}
${corpusTypography}
\newcommand{\hideproject}[1]{\expandafter\def\csname awvisible#1\endcsname{0}}
\newcommand{\showproject}[1]{\expandafter\def\csname awvisible#1\endcsname{1}}
\newcommand{\researchproject}[1]{\ifcsname awvisible#1\endcsname\else\showproject{#1}\fi\ifnum\csname awvisible#1\endcsname=1\relax\awcountproject\input{projects/#1.tex}\fi}
% Put \hideproject{KEY} or \showproject{KEY} here, before begin{document}.
\begin{document}
\begin{researchlist}
`+'\n'+seed.entries.map(e=>`\\researchproject{${e.key}}`).join('\n')+'\n\\end{researchlist}\n\\end{document}\n';
 const uploads=[{path:'main.tex',text:source},...fragments].map(f=>({path:f.path,data:Buffer.from(f.text).toString('base64')}));
 const project=await createPaperProject(home,seed.name,uploads),storage=await projectStorage(home,project.id);
 await saveGuardedFile(storage.folder,'corpus.json','',Buffer.from(JSON.stringify(corpus,null,2)+'\n'),150000);
 const registryRoot=path.join(home,'.paperfocus'),file=await guardedTarget(registryRoot,'projects.json'),raw=await readFile(file),registry=JSON.parse(raw.toString());
 const entry=registry.projects.find((p:{id:string})=>p.id===project.id);if(!entry)throw Error('The new project disappeared. Preserve its prepared files.');
 entry.researchCorpus=true;entry.manuscriptPurposes={...entry.manuscriptPurposes,'main.tex':'overview'};entry.manuscriptPins={...entry.manuscriptPins,overview:'main.tex'};
 await saveGuardedFile(registryRoot,'projects.json',syncHash(raw),Buffer.from(JSON.stringify(registry,null,2)));
 const catalogueBytes=await readFile(await guardedTarget(storage.folder,'project.json')),catalogue=JSON.parse(catalogueBytes.toString());
 catalogue.categories={...catalogue.categories,researchList:'corpus.json'};
 await saveGuardedFile(storage.folder,'project.json',syncHash(catalogueBytes),Buffer.from(JSON.stringify(catalogue,null,2)));
 return {project:{...project,researchCorpus:true},dataHome:storage.folder,sourceRoot:storage.paperRoot};
}
export async function saveCorpus(home:string,id:string,revision:string,action:CorpusAction){
 const current=await readCorpus(home,id);if(!current||current.revision!==revision)throw Error('The research list changed. Reopen it before saving.');
 const corpus=changeCorpus(current.corpus,action),bytes=Buffer.from(JSON.stringify(corpus,null,2)+'\n');
 const next=await saveGuardedFile(projectDataPath(home,id),'corpus.json',revision,bytes,150000);
 return {corpus,revision:next};
}
export function corpusDocument<T extends ProjectDocument>(document:T,value:ResearchCorpus):T {
 validateCorpus(value);
 if(document.project.mainFile!==value.mainFile)throw Error('Share the research list from its main Overview.');
 const hidden=new Set(value.profiles[value.activeProfile].hidden),files=new Set([value.mainFile,...value.entries.filter(e=>!hidden.has(e.key)).map(e=>e.file)]);
 const known=new Set([value.mainFile,...value.entries.map(e=>e.file)]);
 // Fail closed on unlisted includes instead of accidentally exporting another note.
 if(document.paragraphs.some(p=>!p.file||!known.has(p.file))||document.sourceFiles?.some(f=>!known.has(f)))throw Error('The research list includes an unlisted source. Add it to the list before sharing.');
 const paragraphs=document.paragraphs.filter(p=>files.has(p.file!)),ids=new Set(paragraphs.map(p=>p.id)),nodes=new Set(paragraphs.map(p=>p.nodeId));
 return {...document,paragraphs,nodes:document.nodes.filter(n=>nodes.has(n.id)).map(n=>({...n,number:undefined,paragraphIds:n.paragraphIds.filter(id=>ids.has(id))})),files:document.files.filter(f=>files.has(f)),sourceFiles:document.sourceFiles?.filter(f=>files.has(f))};
}
