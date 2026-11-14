// Small reading-navigation metadata; never manuscript wording or publication policy.
import path from 'node:path';
import {parseProject} from './projects.ts';
import type {PaperProject} from '../src/types.ts';
import {readSyncBytes} from './deviceSync.ts';
import {guardedTarget,saveGuardedFile} from './guardedFile.ts';
import {canonical,safeSyncPath,syncHash} from './syncProtocol.ts';

export interface ReadingPins {version:1;overview:string|null;notes:string|null;overviewTarget:string|null}
export function validateReadingPins(value:ReadingPins):ReadingPins {
 if(!value||value.version!==1||Object.keys(value).sort().join(',')!=='notes,overview,overviewTarget,version')throw Error('Invalid reading document pins.');
 for(const file of [value.overview,value.notes,value.overviewTarget])if(file!==null&&(typeof file!=='string'||file.length>490||!safeSyncPath('source/'+file)||!/\.tex$/i.test(file)))throw Error('Invalid reading document filename.');
 if(value.overview&&value.overview===value.notes||value.overviewTarget&&(!value.overview||value.overviewTarget===value.overview))throw Error('Incompatible reading document roles.');
 return value;
}
export function readingPins(project:PaperProject):ReadingPins {
 const overview=project.manuscriptPins?.overview??null,notes=project.manuscriptPins?.notes??null;
 const value=validateReadingPins({version:1,overview,notes,overviewTarget:overview?project.manuscriptOverviewTargets?.[overview]??null:null});
 for(const file of [overview,notes,value.overviewTarget])if(file&&project.manuscriptPurposes?.[file]==='publication')throw Error('Publication document pins stay protected.');
 return value;
}
export function mergeReadingPins(base:ReadingPins|undefined,left:ReadingPins,right:ReadingPins):ReadingPins {
 validateReadingPins(left);validateReadingPins(right);if(base)validateReadingPins(base);
 const result:ReadingPins={version:1,overview:null,notes:null,overviewTarget:null};
 for(const key of ['overview','notes','overviewTarget'] as const){
  const l=left[key],r=right[key],b=base?.[key];
  if(l===r)result[key]=l;
  else if(base&&l===b)result[key]=r;
  else if(base&&r===b)result[key]=l;
  else if(!base&&l===null)result[key]=r;
  else if(!base&&r===null)result[key]=l;
  else throw Error('Conflicting reading document choices: '+key+'. Both choices are preserved.');
 }
 return validateReadingPins(result);
}
export async function applyReadingPins(home:string,id:string,value:ReadingPins,expectedDigest:string){
 validateReadingPins(value);
 const folder=path.join(home,'.paperfocus'),file=await guardedTarget(folder,'projects.json'),raw=await readSyncBytes(file,2*1024**2),catalogue=JSON.parse(raw.toString());
 const project:PaperProject|undefined=catalogue.projects?.find((p:PaperProject)=>p.id===id);
 if(!project||syncHash(canonical(readingPins(project)))!==expectedDigest)throw Error('Reading document pins changed; retry with current choices.');
 const doc=await parseProject(home,id);
 for(const name of [value.overview,value.notes,value.overviewTarget])if(name){
  if(!doc.rootFiles.includes(name))throw Error('Pinned source changed or has not arrived yet; retry after source sync.');
  if(project.manuscriptPurposes?.[name]==='publication')throw Error('Publication purpose stays protected.');
 }
 project.manuscriptPins={...project.manuscriptPins};project.manuscriptPurposes={...project.manuscriptPurposes};
 for(const role of ['overview','notes'] as const){const name=value[role];if(name){project.manuscriptPins[role]=name;project.manuscriptPurposes[name]=role;}else delete project.manuscriptPins[role];}
 if(value.overview){project.manuscriptOverviewTargets={...project.manuscriptOverviewTargets};if(value.overviewTarget)project.manuscriptOverviewTargets[value.overview]=value.overviewTarget;else delete project.manuscriptOverviewTargets[value.overview];}
 // Keep mainFile, publication pins, all other projects and every saved record.
 await saveGuardedFile(folder,'projects.json',syncHash(raw),Buffer.from(JSON.stringify(catalogue,null,2)),2*1024**2);
}
