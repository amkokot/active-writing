import type { AppState, NotebookEntry } from "./types.ts";

/** Explicit positions survive field-wise synchronization; selecting isn't sorting. */
export function orderedNotebookEntries(entries:NotebookEntry[]) {
  return entries.map((entry,index)=>({entry,index})).sort((a,b)=>{
    if(a.entry.cataloguePosition===undefined && b.entry.cataloguePosition!==undefined)return -1;
    if(b.entry.cataloguePosition===undefined && a.entry.cataloguePosition!==undefined)return 1;
    return (a.entry.cataloguePosition ?? -a.index)-(b.entry.cataloguePosition ?? -b.index) || b.index-a.index;
  }).map(item=>item.entry);
}
export function moveCatalogueItem<T extends {id:string}>(items:T[],id:string,targetId:string,before=true):T[] {
  if(id===targetId || !items.some(item=>item.id===id) || !items.some(item=>item.id===targetId))return items;
  const moving=items.find(item=>item.id===id)!,next=items.filter(item=>item.id!==id),index=next.findIndex(item=>item.id===targetId);
  next.splice(index+(before?0:1),0,moving);return next;
}
export function reorderNotebook(entries:NotebookEntry[],id:string,targetId:string,before=true) {
  const ordered=orderedNotebookEntries(entries),moved=moveCatalogueItem(ordered,id,targetId,before);
  if(moved===ordered)return entries;
  const positions=new Map(moved.map((entry,index)=>[entry.id,index]));
  return entries.map(entry=>({...entry,cataloguePosition:positions.get(entry.id)!}));
}
export function moveNotebookEntry(state:AppState,id:string,targetId:string,before=true):AppState {
  const entries=reorderNotebook(state.notebookEntries,id,targetId,before);
  if(entries===state.notebookEntries)return state;
  return {...state,activeNotebookId:state.activeNotebookId ?? orderedNotebookEntries(state.notebookEntries).find(entry=>!entry.filed)?.id,notebookEntries:entries};
}
export function fileNotebookEntry(state:AppState,id:string,filed:boolean,folder?:string):AppState {
  if(!state.notebookEntries.some(entry=>entry.id===id))return state;
  const entries=state.notebookEntries.map(entry=>entry.id===id?{...entry,filed,folder:folder?.trim() || entry.folder || "Later",updatedAt:new Date().toISOString()}:entry);
  return {...state,notebookEntries:entries,activeNotebookId:filed && state.activeNotebookId===id?orderedNotebookEntries(entries).find(entry=>!entry.filed)?.id:state.activeNotebookId};
}
