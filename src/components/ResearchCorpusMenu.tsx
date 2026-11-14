import {useRef,useState} from 'react';
import {ListFilter} from 'lucide-react';
import {useDismissibleLayer} from '../useDismissibleLayer';
import type {CorpusAction,CorpusSnapshot} from '../researchCorpus';
import type {ProjectDocument} from '../types';

export function ResearchCorpusMenu({projectId,onSave,notebookRevision}:{projectId:string;onSave:()=>Promise<ProjectDocument>;notebookRevision:()=>number}){
 const [open,setOpen]=useState(false),[snapshot,setSnapshot]=useState<CorpusSnapshot>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState('');
 const root=useRef<HTMLDetailsElement>(null);useDismissibleLayer(open,root,()=>setOpen(false),'summary');
 async function load(){setBusy(true);setError('');try{const r=await fetch(`/api/paperfocus/corpus?projectId=${encodeURIComponent(projectId)}`);const value=await r.json();if(!r.ok||!value)throw Error(value?.error??'Research-list settings need the updated Aw server.');setSnapshot(value);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function change(action:CorpusAction){if(!snapshot)return;setBusy(true);setError('');try{const r=await fetch('/api/paperfocus/corpus',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,revision:snapshot.revision,change:action})});const value=await r.json();if(!r.ok)throw Error(value.error);setSnapshot(value);setName('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function download(format:'overview'|'web'|'html'){
  setBusy(true);setError('');try{
   const saved=await onSave();if(saved.project.id!==projectId)throw Error('The project changed. Open its research list again.');
   const r=await fetch('/api/paperfocus/share.zip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,mainFile:saved.project.mainFile,revision:saved.revision,notebookRevision:notebookRevision(),corpusRevision:snapshot?.revision,format,overviewFile:saved.project.mainFile,includeNotebook:false,includeSource:false})});
   if(!r.ok)throw Error((await r.json()).error??'The sharing copy could not be prepared.');
   const blob=await r.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`research-overview-${snapshot?.corpus.activeProfile??'selected'}.${format==='overview'?'pdf':format==='web'?'zip':'html'}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 const c=snapshot?.corpus,p=c?.profiles[c.activeProfile];
 return <details className="research-corpus-menu" ref={root} open={open} onToggle={event=>{const next=event.currentTarget.open;setOpen(next);if(next&&!open)void load();}}>
  <summary title="Show or hide projects in a sharing copy" aria-label="Show or hide projects"><ListFilter size={14}/> Show / hide</summary>
  <div className="research-corpus-panel">
   {c&&p&&<>
    <label>Audience<select aria-label="Research-list audience" value={c.activeProfile} disabled={busy} onChange={event=>void change({action:'profile',profile:event.target.value})}>{Object.entries(c.profiles).map(([id,v])=><option key={id} value={id}>{v.name}</option>)}</select></label>
    <small>{c.entries.length-p.hidden.length} of {c.entries.length} projects included</small>
    <div className="research-corpus-entries">{c.entries.map(e=><label key={e.key}><input type="checkbox" checked={!p.hidden.includes(e.key)} disabled={busy} onChange={event=>void change({action:'visibility',key:e.key,visible:event.target.checked})}/><span>{e.title}</span></label>)}</div>
    <details><summary>New audience…</summary><form onSubmit={event=>{event.preventDefault();const profile=name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');if(profile)void change({action:'profile',profile,name:name.trim()});}}><label>Name<input value={name} maxLength={80} disabled={busy} onChange={event=>setName(event.target.value)} placeholder="For a collaborator"/></label><button disabled={busy||!name.trim()}>Copy current selection</button></form></details>
    <div className="research-corpus-downloads"><button disabled={busy} onClick={()=>void download('overview')}>PDF</button><button disabled={busy} onClick={()=>void download('web')}>Reader ZIP</button><button disabled={busy} onClick={()=>void download('html')}>HTML</button></div>
    <small>Compile and downloads include only checked projects. Compile again after changing the selection. The source stays complete. Hosted pages change when republished.</small>
   </>}
   {busy&&<small role="status">Saving or preparing…</small>}{error&&<p role="alert">{error}</p>}
  </div>
 </details>;
}
