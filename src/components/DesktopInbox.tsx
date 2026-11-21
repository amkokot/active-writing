import {useEffect,useState} from 'react';
import {FolderOpen,Upload} from 'lucide-react';
interface InboxState {configured:boolean;inbox?:string;recovery?:string;destination?:string;configHash?:string;files?:{path:string;bytes:number}[];issues?:string[];totalBytes?:number;job?:{status:string;total:number;detail?:string;results:{path:string;status:string;detail?:string;remotePath?:string}[]}}
export function DesktopInbox(){
 const [state,setState]=useState<InboxState>(),[open,setOpen]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function action(action:string){setBusy(true);setError('');try{const r=await fetch('/api/paperfocus/desktop-inbox',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,configHash:state?.configHash})}),v=await r.json();if(!r.ok)throw Error(v.error||'Transfer could not start.');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function refresh(){try{const r=await fetch('/api/paperfocus/desktop-inbox');if(r.status===404){setState({configured:false});return;}const v=await r.json();if(!r.ok)throw Error(v.error);setState(v);}catch(e){setError((e as Error).message);}}
 useEffect(()=>{void refresh();},[]);
 useEffect(()=>{if(!open)return;const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},state?.job?.status==='sending'?1500:10000);return()=>clearInterval(timer);},[open,state?.job?.status]);
 if(!state?.configured)return error?<small role="alert">{error}</small>:null;
 const sending=state.job?.status==='sending',count=state.files?.length??0,done=state.job?.results.filter(r=>r.status==='sent').length??0;
 return <details className="desktop-transfer-inbox" open={open} onToggle={e=>{if(e.target===e.currentTarget)setOpen(e.currentTarget.open);}}><summary><Upload size={14}/>Send files to desktop{count?` · ${count}`:''}</summary>
  <p>Put finished files in <strong>Desktop inbox</strong>, then send them here.</p>
  <div className="desktop-inbox-actions"><button type="button" onClick={()=>void action('open-inbox')} disabled={busy}><FolderOpen size={13}/>Open inbox</button><button type="button" onClick={()=>void action('send')} disabled={busy||sending||!count}>{sending?`Sending · ${done}/${state.job?.total}`:'Send to desktop'}</button><button type="button" aria-label="Refresh pending desktop files" onClick={()=>void refresh()}>↻</button></div>
  <small>{count?`${count} ready · ${((state.totalBytes??0)/1024**2).toFixed(1)} MB`:state.issues?.length?'Files in the inbox need attention before sending.':'No pending files in the inbox.'}</small>
  {!!state.issues?.length&&<p role="alert">{state.issues.join(' ')}</p>}
  {state.job?.status==='complete'&&<p role="status">Sent and verified · {done} files. Inbox refreshed.</p>}
  {state.job?.status==='needs-attention'&&<p role="alert">Some files still need attention. {state.job.detail}{state.job.results.filter(r=>r.status==='pending').map(r=><span key={r.path}>{r.path}: {r.detail}</span>)}</p>}
  {open&&<ul>{state.files?.slice(0,12).map(f=><li key={f.path} title={f.path}>{f.path}</li>)}{count>12&&<li>and {count-12} more</li>}</ul>}
  {error&&<p role="alert">{error}</p>}
  <details><summary>Paths & recovery</summary><small>Inbox</small><code>{state.inbox}</code><small>Desktop destination</small><code>{state.destination}</code><small>Verified files leave the inbox. Local recovery copies stay in Sent; failures remain pending. Nothing runs on the desktop. The campus/VPN gate still applies.</small><button type="button" onClick={()=>void action('open-sent')}>Open Sent recovery</button></details>
 </details>;
}
