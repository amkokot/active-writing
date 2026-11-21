import { cellText, type ExperimentCell } from './experiments.ts';

export interface NotebookFolder { path:string; name:string; count:number; children:NotebookFolder[] }
export const cellFolder=(cell:ExperimentCell)=>cell.metadata.paperfocus?.folder?.trim().split('/').map(s=>s.trim()).filter(Boolean).join('/') ?? '';
export function withinNotebookFolder(value:string,folder:string){return !folder || value===folder || value.startsWith(folder+'/');}
/** Folder membership is display metadata: no ownership, order or evidence changes. */
export function notebookFolders(cells:ExperimentCell[]){
 const roots:NotebookFolder[]=[];
 for(const cell of cells){const parts=cellFolder(cell).split('/').filter(Boolean);let children=roots,prefix='';
  for(const part of parts){prefix=prefix?prefix+'/'+part:part;let node=children.find(n=>n.path===prefix);if(!node){node={path:prefix,name:part,count:0,children:[]};children.push(node);}node.count++;children=node.children;}
 }
 const sort=(nodes:NotebookFolder[])=>{nodes.sort((a,b)=>a.name==='Start here'?-1:b.name==='Start here'?1:a.name.localeCompare(b.name));for(const n of nodes)sort(n.children);};sort(roots);return roots;
}
export function notebookCellMatches(cell:ExperimentCell,folder:string,query:string){
 if(!withinNotebookFolder(cellFolder(cell),folder))return false;
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);if(!terms.length)return true;
 const text=(cell.metadata.paperfocus?.title+' '+cellFolder(cell)+' '+cellText(cell)).toLocaleLowerCase();return terms.every(term=>text.includes(term));
}
