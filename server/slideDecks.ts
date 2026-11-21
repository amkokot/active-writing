// Navigation metadata only: never changes source, main file or writing purpose.
import path from 'node:path';
import type {PaperProject} from '../src/types.ts';
import {parseProject} from './projects.ts';
import {readSyncBytes} from './deviceSync.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {canonical,safeSyncPath,syncHash} from './syncProtocol.ts';

export interface SlideChoice {version:1;file:string|null}
export function validateSlideChoice(value:SlideChoice):SlideChoice{
 if(!value||value.version!==1||Object.keys(value).sort().join(',')!=='file,version'||value.file!==null&&(typeof value.file!=='string'||value.file.length>490||!safeSyncPath('source/'+value.file)||!/\.tex$/i.test(value.file)))throw Error('Invalid slide deck choice.');
 return value;
}
export function slideChoice(project:PaperProject):SlideChoice{return validateSlideChoice({version:1,file:project.slideDeck??null});}
export function mergeSlideChoice(base:SlideChoice|undefined,left:SlideChoice,right:SlideChoice):SlideChoice{
 validateSlideChoice(left);validateSlideChoice(right);if(base)validateSlideChoice(base);
 if(left.file===right.file)return left;
 if(base&&left.file===base.file)return right;
 if(base&&right.file===base.file)return left;
 if(!base&&left.file===null)return right;
 if(!base&&right.file===null)return left;
 throw Error('Conflicting slide deck choices. Both choices are preserved.');
}
export async function applySlideChoice(home:string,id:string,value:SlideChoice,expectedDigest:string){
 validateSlideChoice(value);
 const folder=path.join(home,'.paperfocus'),target=await guardedTarget(folder,'projects.json'),raw=await readSyncBytes(target,2*1024**2),catalogue=JSON.parse(raw.toString());
 const project:PaperProject|undefined=catalogue.projects?.find((p:PaperProject)=>p.id===id);
 if(!project||syncHash(canonical(slideChoice(project)))!==expectedDigest)throw Error('The pinned slide deck changed. Inspect before retrying.');
 const doc=await parseProject(home,id);
 if(value.file&&!doc.slideFiles?.includes(value.file))throw Error('Choose an existing independent Beamer deck. Its source may not have arrived yet.');
 if(value.file)project.slideDeck=value.file;else delete project.slideDeck;
 await saveGuardedFile(folder,'projects.json',syncHash(raw),Buffer.from(JSON.stringify(catalogue,null,2)),2*1024**2);
 return value;
}
export async function setSlideDeck(home:string,input:{projectId:string;mainFile:string;revision:string;file:string;expectedFile:string}){
 if(!input||typeof input.file!=='string'||typeof input.expectedFile!=='string')throw Error('Choose a slide deck.');
 const doc=await parseProject(home,input.projectId);
 if(doc.project.mainFile!==input.mainFile||doc.revision!==input.revision)throw Error('The manuscript changed. Inspect before pinning.');
 await applySlideChoice(home,input.projectId,{version:1,file:input.file||null},syncHash(canonical({version:1,file:input.expectedFile||null})));
 doc.project={...doc.project,slideDeck:input.file||undefined};return {document:doc};
}
