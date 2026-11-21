import {useEffect,useRef,useState} from 'react';
import {cellText,type ExperimentStore,type ExperimentCell} from '../experiments';
import {parseWriteups,replaceWriteups,writeupCellId,hasWriteupList,type CurrentWriteup,type WriteupList} from '../currentWriteups';
import {manuscriptLink} from '../manuscripts';
import type {NotebookEntry,ProjectDocument} from '../types';

async function request<T>(url:string,body?:unknown):Promise<T>{const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);const v=await r.json();if(!r.ok)throw Error(v.error||'The reading list could not be loaded.');return v;}
export function CurrentWriteups({document,entries,onRead}:{document:ProjectDocument;entries:NotebookEntry[];onRead:(file:string)=>Promise<void>}){
 const owners=entries.filter(hasWriteupList),owner=owners.length===1?owners[0]:undefined;
 const readingCell=owner?.readingListCellId??writeupCellId;
 const key=owner?`${owner.id}:${owner.experimentNotebookId??owner.id}:${readingCell}`:'';
 const [source,setSource]=useState(''),[draft,setDraft]=useState<WriteupList>(),[error,setError]=useState(''),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false);
 const editingRef=useRef(false);editingRef.current=editing;
 useEffect(()=>{
  let stopped=false,loading=false;setSource('');setError('');setEditing(false);
  async function load(){if(!owner||loading)return;loading=true;try{const q=new URLSearchParams({projectId:document.project.id,entryId:owner.id,owner:owner.experimentNotebookId??owner.id,cellId:readingCell});const s=await request<{cell:ExperimentCell}>('/api/paperfocus/research/cell?'+q);const raw=cellText(s.cell);parseWriteups(raw);if(!stopped&&!editingRef.current){setSource(raw);setError('');}}catch(e){if(!stopped)setError((e as Error).message);}finally{loading=false;}}
  void load();const refresh=()=>{if(globalThis.document.visibilityState==='visible'&&!editingRef.current)void load();};const timer=setInterval(refresh,30000);globalThis.document.addEventListener('visibilitychange',refresh);
  return()=>{stopped=true;clearInterval(timer);globalThis.document.removeEventListener('visibilitychange',refresh);};
 },[document.project.id,key]);
 if(!owners.length)return null;
 let list:WriteupList|undefined;try{if(source)list=parseWriteups(source);}catch{/* A saved error stays visible. */}
 const roots=document.rootFiles;
 function link(file:string,label:string,primary=false){return roots.includes(file)?<a className={primary?'writeup-read':''} href={manuscriptLink(location.href,document.project.id,file)} title={file} onClick={event=>{if(event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();setBusy(true);setError('');void onRead(file).catch(e=>setError((e as Error).message)).finally(()=>setBusy(false));}}>{label}</a>:<span className="writeup-missing">{label} · file unavailable</span>;}
 function update(index:number,change:Partial<CurrentWriteup>){setDraft(old=>old&&({...old,items:old.items.map((r,i)=>i===index?{...r,...change}:r)}));}
 async function save(){if(!owner||!draft)return;setBusy(true);try{
  const notebookId=owner.experimentNotebookId??owner.id,q=new URLSearchParams({projectId:document.project.id,notebookId}),s=await request<ExperimentStore>('/api/paperfocus/experiments?'+q),nextSource=JSON.stringify(draft,null,2),next=replaceWriteups(s.notebook,source,nextSource,readingCell);
  await request('/api/paperfocus/experiments',{projectId:document.project.id,notebookId,revision:s.revision,notebook:next});setSource(nextSource);setEditing(false);setError('');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section id="current-writeups" className="current-writeups" aria-label="Current collaboration writeups">
  <header><div><h2>Current writeups</h2><small>Start with the brief, or open the full note. Earlier work stays in the notebook below.</small></div>{list&&<button disabled={busy} onClick={()=>{setDraft(list);setEditing(!editing);}}> {editing?'Cancel':'Edit links'}</button>}</header>
  {owners.length>1?<p role="alert">More than one notebook owns the current-writeup list. Keep one current list; the saved lists are preserved.</p>:!source&&!error?<p>Loading reading links…</p>:null}
  {error&&<p role="alert">{error}</p>}
  {list&&!editing&&<div className="current-writeup-list">{list.items.map(item=><article key={item.id}><div><h3>{item.person}</h3><p>{item.title}</p></div><div className="current-writeup-links">{link(item.file,'Read current writeup',true)}{item.brief&&link(item.brief,'Brief')}{Boolean(item.related?.length)&&<details><summary>Supporting notes</summary>{item.related!.map(l=><span key={l.file}>{link(l.file,l.title)}</span>)}</details>}</div></article>)}</div>}
  {editing&&draft&&<div className="writeup-link-editor">{draft.items.map((item,i)=><fieldset key={item.id}><legend>{item.person}</legend><label>Title<input value={item.title} maxLength={200} onChange={e=>update(i,{title:e.target.value})}/></label><label>Current writeup<select value={item.file} onChange={e=>update(i,{file:e.target.value})}>{!roots.includes(item.file)&&<option value={item.file}>{item.file} · unavailable</option>}{roots.map(file=><option key={file}>{file}</option>)}</select></label><label>Brief<select value={item.brief??''} onChange={e=>update(i,{brief:e.target.value||undefined})}><option value="">None</option>{item.brief&&!roots.includes(item.brief)&&<option>{item.brief}</option>}{roots.map(file=><option key={file}>{file}</option>)}</select></label></fieldset>)}<button disabled={busy} onClick={()=>void save()}>Save links</button><small>Changes the reading list only. Source, notebook evidence and review status stay unchanged.</small></div>}
 </section>;
}
