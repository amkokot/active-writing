import {useEffect,useRef,useState} from 'react';
import {Pin} from 'lucide-react';
import {cellText,type ExperimentStore,type ExperimentCell} from '../experiments';
import {parseWriteups,replaceWriteups,writeupCellId,hasWriteupList,professorWriteups,pinProfessorReport,type CurrentWriteup,type WriteupList} from '../currentWriteups';
import {manuscriptLink} from '../manuscripts';
import type {NotebookEntry,ProjectDocument} from '../types';

async function request<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const v=await r.json();if(!r.ok)throw Error(v.error||'The reading list could not be loaded.');return v;}
export function CurrentWriteups({document,entries,onRead}:{document:ProjectDocument;entries:NotebookEntry[];onRead:(file:string)=>Promise<void>}){
 const owners=entries.filter(hasWriteupList),owner=owners.length===1?owners[0]:undefined;
 const readingCell=owner?.readingListCellId??writeupCellId;
 const key=owner?`${owner.id}:${owner.experimentNotebookId??owner.id}:${readingCell}`:'';
 const [source,setSource]=useState(''),[draft,setDraft]=useState<WriteupList>(),[error,setError]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
 const [person,setPerson]=useState(''),[query,setQuery]=useState(''),[showUnavailable,setShowUnavailable]=useState(false);
 const editingRef=useRef(false);editingRef.current=editing;
 useEffect(()=>{
  let stopped=false,loading=false;setSource('');setError('');setEditing(false);setPerson('');setQuery('');
  async function load(){if(!owner||loading)return;loading=true;try{const q=new URLSearchParams({projectId:document.project.id,entryId:owner.id,owner:owner.experimentNotebookId??owner.id,cellId:readingCell});const s=await request<{cell:ExperimentCell}>('/api/paperfocus/research/cell?'+q);const raw=cellText(s.cell);parseWriteups(raw);if(!stopped&&!editingRef.current){setSource(raw);setError('');}}catch(e){if(!stopped)setError((e as Error).message);}finally{loading=false;}}
  void load();const refresh=()=>{if(globalThis.document.visibilityState==='visible'&&!editingRef.current)void load();};const timer=setInterval(refresh,30000);globalThis.document.addEventListener('visibilitychange',refresh);
  return()=>{stopped=true;clearInterval(timer);globalThis.document.removeEventListener('visibilitychange',refresh);};
 },[document.project.id,key]);
 if(!owners.length)return null;
 let list:WriteupList|undefined;try{if(source)list=parseWriteups(source);}catch{/* A saved error stays visible. */}
 const roots=document.rootFiles;
 function link(file:string,label:string,primary=false){return roots.includes(file)?<a className={primary?'writeup-read':''} href={manuscriptLink(location.href,document.project.id,file)} title={file} onClick={event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();setBusy(true);setError('');void onRead(file).catch(e=>setError((e as Error).message)).finally(()=>setBusy(false));}}>{label}</a>:<span className="writeup-missing">{label} · file unavailable</span>;}
 function update(index:number,change:Partial<CurrentWriteup>){setDraft(old=>old&&({...old,items:old.items.map((r,i)=>i===index?{...r,...change}:r)}));}
 async function save(nextList=draft){if(!owner||!nextList)return;setBusy(true);try{
  const notebookId=owner.experimentNotebookId??owner.id,q=new URLSearchParams({projectId:document.project.id,notebookId}),s=await request<ExperimentStore>('/api/paperfocus/experiments?'+q),nextSource=JSON.stringify(nextList,null,2),next=replaceWriteups(s.notebook,source,nextSource,readingCell);
  await request('/api/paperfocus/experiments',{projectId:document.project.id,notebookId,revision:s.revision,notebook:next});setSource(nextSource);setEditing(false);setError('');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section id="current-writeups" className="current-writeups" aria-label="Current collaboration writeups">
  <header><div><h2>Current writeups</h2><small>Reports by professor, newest first. Pin the ones you want to keep close.</small></div>{list&&<button disabled={busy} onClick={()=>{setDraft(list);setEditing(!editing);}}> {editing?'Cancel':'Edit links'}</button>}</header>
  {owners.length>1?<p role="alert">More than one notebook owns the current-writeup list. Keep one current list; the saved lists are preserved.</p>:!source&&!error?<p>Loading reading links…</p>:null}
  {error&&<p role="alert">{error}</p>}
  {list&&!editing&&<>
   <div className="writeup-filters"><label>Professor<select aria-label="Writeup professor" value={person} onChange={e=>setPerson(e.target.value)}><option value="">Everyone</option>{professorWriteups(list).map(g=><option key={g.person}>{g.person}</option>)}</select></label><input aria-label="Find a report" placeholder="Find a report..." value={query} onChange={e=>setQuery(e.target.value)}/><label><input type="checkbox" checked={showUnavailable} onChange={e=>setShowUnavailable(e.target.checked)}/>Show unavailable reports</label></div>
   <div className="professor-writeups">{professorWriteups(list).filter(g=>(!person||person===g.person)&&(showUnavailable||g.reports.some(r=>roots.includes(r.file)))).map(group=>{
    const reports=group.reports.filter(r=>(showUnavailable||roots.includes(r.file))&&(r.title+' '+r.file).toLowerCase().includes(query.toLowerCase())),pinned=reports.filter(r=>r.pinned),recent=reports.filter(r=>!r.pinned);
    function row(r:typeof reports[number]){return <article key={r.file}><div>{link(r.file,r.title)}<small>{r.updatedAt&&<time dateTime={r.updatedAt}>{r.updatedAt.slice(0,10)} / </time>}{r.current?'Current writeup':r.file}</small></div><button className="writeup-pin" aria-label={`${r.pinned?'Unpin':'Pin'} ${r.title} for ${group.person}`} aria-pressed={Boolean(r.pinned)} disabled={busy} title={r.pinned?'Unpin report':'Pin for '+group.person} onClick={()=>void save(pinProfessorReport(list!,group.person,r.file,!r.pinned))}><Pin size={13}/></button></article>;}
    return <section className="professor-writeup-group" key={group.person}><header><h3>{group.person}</h3><small>{reports.length} reports</small></header>{pinned.length>0&&<div className="professor-pins" aria-label={`Pinned reports for ${group.person}`}><small>Pinned</small>{pinned.map(row)}</div>}{recent.slice(0,3).map(row)}{recent.length>3&&<details open={Boolean(query)||undefined}><summary>{recent.length-3} more reports</summary>{recent.slice(3).map(row)}</details>}{!reports.length&&<small>No matching reports.</small>}</section>;
   })}</div>
  </>}
  {editing&&draft&&<div className="writeup-link-editor">{draft.items.map((item,i)=><fieldset key={item.id}><legend>{item.person}</legend><label>Title<input value={item.title} maxLength={200} onChange={e=>update(i,{title:e.target.value})}/></label><label>Current writeup<select value={item.file} onChange={e=>update(i,{file:e.target.value})}>{!roots.includes(item.file)&&<option value={item.file}>{item.file} · unavailable</option>}{roots.map(file=><option key={file}>{file}</option>)}</select></label><label>Brief<select value={item.brief??''} onChange={e=>update(i,{brief:e.target.value||undefined})}><option value="">None</option>{item.brief&&!roots.includes(item.brief)&&<option>{item.brief}</option>}{roots.map(file=><option key={file}>{file}</option>)}</select></label></fieldset>)}<button disabled={busy} onClick={()=>void save()}>Save links</button><small>Changes the reading list only. Source, notebook evidence and review status stay unchanged.</small></div>}
 </section>;
}
