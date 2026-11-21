import {cellText, type ExperimentNotebook} from './experiments.ts';
export const writeupFolder='Current writeups',writeupCellId='aw-current-writeups';
export function hasWriteupList(entry:{readingListCellId?:string;folder?:string;recoveryKey?:string}){return !entry.recoveryKey&&Boolean(entry.readingListCellId||entry.folder===writeupFolder);}
export interface WriteupLink {title:string;file:string}
export interface CurrentWriteup {id:string;person:string;title:string;file:string;brief?:string;related?:WriteupLink[]}
export interface WriteupList {version:1;items:CurrentWriteup[]}
const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\x00-\x1f]/.test(s);
export function writeupFile(s:unknown):s is string{return text(s,240)&&/\.tex$/i.test(s as string)&&!(s as string).split('/').some(s=>!s||s==='.'||s==='..')&&!/[\\:<>"|?*#]/.test(s as string);}
export function parseWriteups(source:string):WriteupList{
 if(source.length>40000)throw Error('The reading list is too large.');
 const v=JSON.parse(source);
 if(v?.version!==1||!Array.isArray(v.items)||v.items.length>32||new Set(v.items.map((r:CurrentWriteup)=>r?.id)).size!==v.items.length)throw Error('Use one version-1 list with up to 32 distinct candidates.');
 for(const r of v.items){
  if(!text(r.id,64)||!/^[-\w]+$/.test(r.id)||!text(r.person,100)||!text(r.title,200)||!writeupFile(r.file)||r.brief!==undefined&&!writeupFile(r.brief)||r.related!==undefined&&(!Array.isArray(r.related)||r.related.length>8||r.related.some((l:WriteupLink)=>!text(l?.title,100)||!writeupFile(l.file))))throw Error('Each candidate needs a name, title and project-local TeX writeup.');
 }
 return v;
}
/** Replace only this navigation cell after checking the exact source the editor read. */
export function replaceWriteups(notebook:ExperimentNotebook,expected:string,source:string,cellId=writeupCellId){
 parseWriteups(source);const target=notebook.cells.find(c=>c.id===cellId);
 if(!target||!['raw','markdown'].includes(target.cell_type)||cellText(target)!==expected)throw Error('The reading list changed. Reload it before saving; your proposed links are kept.');
 const next=structuredClone(notebook);next.cells.find(c=>c.id===cellId)!.source=source;return next;
}
