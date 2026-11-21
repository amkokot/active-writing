import { useRef } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import type { NotebookFolder } from '../notebookFolders';

export function NotebookFolders({folders,selected,query,count,onSelect,onQuery}:{folders:NotebookFolder[];selected:string;query:string;count:number;onSelect:(path:string)=>void;onQuery:(query:string)=>void}){
 const menu=useRef<HTMLDetailsElement>(null);
 function choose(path:string){onSelect(path);if(menu.current)menu.current.open=false;}
 function rows(nodes:NotebookFolder[]):React.ReactNode{return nodes.map(node=><div key={node.path} className="notebook-folder-row">
  {node.children.length?<details open={selected===node.path || selected.startsWith(node.path+'/')}><summary><button aria-pressed={selected===node.path} onClick={event=>{event.preventDefault();choose(node.path);}}>{node.name}<small>{node.count}</small></button></summary><div>{rows(node.children)}</div></details>:<button aria-pressed={selected===node.path} onClick={()=>choose(node.path)}>{node.name}<small>{node.count}</small></button>}
 </div>);}
 return <nav className="notebook-folder-browser" aria-label="Notebook folders">
  <details ref={menu}><summary><FolderOpen size={14}/><span>{selected || 'All notes'}</span><span aria-hidden="true">▾</span></summary><div className="notebook-folder-menu"><button aria-pressed={!selected} onClick={()=>choose('')}>All notes</button>{rows(folders)}</div></details>
  <label><Search size={13}/><input aria-label="Search notebook notes" placeholder="Search notes…" value={query} onChange={event=>onQuery(event.target.value)}/></label>
  {query && <button aria-label="Clear notebook search" onClick={()=>onQuery('')}>×</button>}<small>{count} notes</small>
 </nav>;
}
