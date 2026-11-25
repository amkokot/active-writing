import {cellText, type ExperimentNotebook} from './experiments.ts';
export const writeupFolder='Current writeups',writeupCellId='aw-current-writeups';
export function hasWriteupList(entry:{readingListCellId?:string;folder?:string;recoveryKey?:string}){return !entry.recoveryKey&&Boolean(entry.readingListCellId||entry.folder===writeupFolder);}
export interface WriteupLink {title:string;file:string;updatedAt?:string;pinned?:boolean}
export interface CurrentWriteup {id:string;person:string;title:string;file:string;brief?:string;related?:WriteupLink[];current?:boolean;updatedAt?:string;pinned?:boolean}
export interface WriteupList {version:1;items:CurrentWriteup[]}
const text=(s:unknown,max:number)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\x00-\x1f]/.test(s);
export function writeupFile(s:unknown):s is string{return text(s,240)&&/\.tex$/i.test(s as string)&&!(s as string).split('/').some(s=>!s||s==='.'||s==='..')&&!/[\\:<>"|?*#]/.test(s as string);}
export function parseWriteups(source:string):WriteupList{
 if(source.length>256000)throw Error('The reading list is too large.');
 const v=JSON.parse(source);
 if(v?.version!==1||!Array.isArray(v.items)||v.items.length>128||new Set(v.items.map((r:CurrentWriteup)=>r?.id)).size!==v.items.length)throw Error('Use one version-1 list with up to 128 distinct reports.');
 const metadata=(r:WriteupLink)=> (r.pinned===undefined||typeof r.pinned==='boolean')&&(r.updatedAt===undefined||typeof r.updatedAt==='string'&&/^\d{4}-\d{2}-\d{2}(?:T[^ ]+Z)?$/.test(r.updatedAt)&&Number.isFinite(Date.parse(r.updatedAt)));
 for(const r of v.items){
  if(r.current!==undefined&&typeof r.current!=='boolean'||!metadata(r)||r.related?.some((l:WriteupLink)=>!metadata(l)))throw Error('Use a valid report date and a true/false pin.');
  if(!text(r.id,64)||!/^[-\w]+$/.test(r.id)||!text(r.person,100)||!text(r.title,200)||!writeupFile(r.file)||r.brief!==undefined&&!writeupFile(r.brief)||r.related!==undefined&&(!Array.isArray(r.related)||r.related.length>64||r.related.some((l:WriteupLink)=>!text(l?.title,200)||!writeupFile(l.file))))throw Error('Each candidate needs a name, title and project-local TeX writeup.');
 }
 return v;
}
/** Replace only this navigation cell after checking the exact source the editor read. */
export function replaceWriteups(notebook:ExperimentNotebook,expected:string,source:string,cellId=writeupCellId){
 parseWriteups(source);const target=notebook.cells.find(c=>c.id===cellId);
 if(!target||!['raw','markdown'].includes(target.cell_type)||cellText(target)!==expected)throw Error('The reading list changed. Reload it before saving; your proposed links are kept.');
 const next=structuredClone(notebook);next.cells.find(c=>c.id===cellId)!.source=source;return next;
}

export interface ProfessorReport extends WriteupLink {current:boolean}
export function professorWriteups(list:WriteupList){
 const groups=new Map<string,Map<string,ProfessorReport>>();
 for(const item of list.items){
  let reports=groups.get(item.person);if(!reports){reports=new Map();groups.set(item.person,reports);}
  for(const report of [{title:item.title,file:item.file,updatedAt:item.updatedAt,pinned:item.pinned,current:item.current!==false},...(item.brief?[{title:'Brief: '+item.title,file:item.brief,current:false}]:[]),...(item.related??[]).map(r=>({...r,current:false}))]){
   const old=reports.get(report.file);
   reports.set(report.file,old?{...old,current:old.current||report.current,pinned:old.pinned||report.pinned,updatedAt:[old.updatedAt,report.updatedAt].filter((x):x is string=>Boolean(x)).sort().at(-1)}:report);
  }
 }
 return [...groups].map(([person,reports])=>({person,reports:[...reports.values()].sort((a,b)=>(Date.parse(b.updatedAt??'')||0)-(Date.parse(a.updatedAt??'')||0)||Number(b.current)-Number(a.current))}));
}
export function pinProfessorReport(list:WriteupList,person:string,file:string,pinned:boolean):WriteupList{
 return {...list,items:list.items.map(item=>item.person!==person?item:{...item,...(item.file===file?{pinned}:{}),related:[...(item.related??[]).map(r=>r.file===file?{...r,pinned}:r),...(item.brief===file&&!item.related?.some(r=>r.file===file)?[{file,title:'Brief: '+item.title,pinned}]:[])]})};
}
