import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {AlertTriangle,X} from 'lucide-react';
import {syncAttention,syncSourceComparison} from '../syncAttention';

/** Local saved status only. Never probes SSH or starts synchronization. */
export function SyncAttentionNotice({projectId,onReview,onAttention}:{projectId?:string;onReview:()=>void;onAttention:(active:boolean)=>void}){
 const [issue,setIssue]=useState<ReturnType<typeof syncAttention>>(),[dismissed,setDismissed]=useState('');
 const [reviews,setReviews]=useState<Array<{id:string;key:string}>>([]),[comparison,setComparison]=useState<{id:string;key:string;localText:string;remoteText:string;baseText?:string}>(),[comparing,setComparing]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [fullFile,setFullFile]=useState(false),preview=comparison?syncSourceComparison(comparison.localText,comparison.remoteText):undefined;
 useEffect(()=>{
  if(!projectId){setIssue(undefined);onAttention(false);return;}
  let disposed=false,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const storageKey=`aw-sync-notice:${projectId}`;
  try{setDismissed(sessionStorage.getItem(storageKey)??'');}catch{setDismissed('');}
  setIssue(undefined);onAttention(false);setReviews([]);setComparison(undefined);setComparing(false);setMessage('');
  async function refresh(){
   if(disposed||document.hidden)return;
   controller?.abort();controller=new AbortController();
   try{
    const response=await fetch(`/api/paperfocus/device-sync/attention?projectId=${encodeURIComponent(projectId!)}`,{signal:controller.signal});
    if(!response.ok)return;const value=await response.json();if(disposed)return;
    const attention=syncAttention(value.automatic??{},value.pendingSyncs??[]),next=attention&&{...attention,key:JSON.stringify([attention.key,(value.sourceReviews??[]).map((r:{id:string})=>r.id)])};setIssue(next);onAttention(!!next);
    setReviews(Array.isArray(value.sourceReviews)?value.sourceReviews:[]);
    if(!next&&['aligned','synced'].includes(value.automatic?.state?.status)){setDismissed('');try{sessionStorage.removeItem(storageKey);}catch{/* private session */}}
   }catch{/* An old/offline local service is not a failed remote sync. */}
   finally{if(!disposed)timer=setTimeout(()=>void refresh(),30000);}
  }
  const visibility=()=>{if(!document.hidden){clearTimeout(timer);void refresh();}};
  document.addEventListener('visibilitychange',visibility);void refresh();
  return()=>{disposed=true;controller?.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
 },[projectId,onAttention]);
 async function openComparison(id:string){
  setComparing(true);setBusy(true);setMessage('');setFullFile(false);try{
   const r=await fetch(`/api/paperfocus/device-sync/source-review?projectId=${encodeURIComponent(projectId!)}&reviewId=${encodeURIComponent(id)}`),value=await r.json();if(!r.ok)throw Error(value.error??'Could not read the saved comparison.');setComparison(value);
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 async function choose(choice:'local'|'remote'){
  if(!comparison)return;setBusy(true);setMessage('');try{
   const r=await fetch('/api/paperfocus/device-sync/source-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,reviewId:comparison.id,choice})}),value=await r.json();if(!r.ok)throw Error(value.error??'The saved versions changed.');setMessage(value.detail);setReviews(old=>old.filter(x=>x.id!==comparison.id));
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 if((!issue||issue.key===dismissed)&&!comparing)return null;
 return createPortal(<aside className={`sync-attention-notice maintenance-${issue?.severity??'attention'}`} aria-label={issue?.title??'Sync needs attention'}>
  <AlertTriangle size={16}/><div><strong role="status">{issue?.title??'Saved source versions'}</strong><p>{issue?.detail}</p>
   {reviews.length>0&&<button type="button" disabled={busy} onClick={()=>void openComparison(reviews[0].id)}>Compare revisions{reviews.length>1?` · ${reviews.length}`:''}</button>}
   <button type="button" onClick={onReview}>Sync details…</button>
   {comparing&&<section className="sync-source-comparison" aria-label="Compare saved source versions">
    <div className="source-refresh-heading"><strong>{comparison?.key.replace(/^source\//,'')??'Loading comparison…'}</strong><button className="icon-control" aria-label="Close source comparison" onClick={()=>setComparing(false)}><X size={15}/></button></div>
    {reviews.length>1&&<select aria-label="File to compare" value={comparison?.id??reviews[0].id} onChange={e=>void openComparison(e.target.value)}>{reviews.map(r=><option key={r.id} value={r.id}>{r.key.replace(/^source\//,'')}</option>)}</select>}
    <p>Both changed the same text. Your saved file is unchanged. Save any unfinished edits before choosing a whole-file version, or copy only the wording you want into the editor.</p>
    {preview?.excerpt&&<button onClick={()=>setFullFile(value=>!value)}>{fullFile?'Show changed region':'Show full file'}</button>}
    {comparison&&<div className="source-conflict-versions">
     <label>This copy{!fullFile&&preview?.excerpt&&<small> · lines {preview.firstLine}–{preview.localLastLine}</small>}<textarea readOnly rows={10} value={fullFile?comparison.localText:preview?.local??comparison.localText}/><button disabled={busy} onClick={()=>void choose('local')}>Keep this saved version</button></label>
     <label>Other copy{!fullFile&&preview?.excerpt&&<small> · lines {preview.firstLine}–{preview.remoteLastLine}</small>}<textarea readOnly rows={10} value={fullFile?comparison.remoteText:preview?.remote??comparison.remoteText}/><button disabled={busy} onClick={()=>void choose('remote')}>Use this saved version</button></label>
    </div>}
    {comparison?.baseText!==undefined&&<details><summary>Before these edits</summary><textarea aria-label="Common saved source" readOnly rows={6} value={comparison.baseText}/></details>}
    {message&&<p role="status">{message}</p>}
   </section>}
  </div>
  <button type="button" className="icon-control" aria-label="Dismiss sync notice" onClick={()=>{setComparing(false);if(issue){setDismissed(issue.key);try{sessionStorage.setItem(`aw-sync-notice:${projectId}`,issue.key);}catch{/* Keep dismissal for this mount. */}}}}><X size={14}/></button>
 </aside>,document.body);
}
