import {useState} from 'react';
import {Copy,FolderOpen} from 'lucide-react';
export function FileLocationButton({projectId,file,copy=false,iconOnly=false,disabled=false}:{projectId:string;file:string;copy?:boolean;iconOnly?:boolean;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const label=copy?'Copy full path':'Show in folder',Icon=copy?Copy:FolderOpen;
 async function act(){setBusy(true);setNotice('');try{
  const r=await fetch('/api/paperfocus/workspace-folders/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,target:'file',file,copy})});const v=await r.json();if(!r.ok)throw Error(v.error??'Could not find this file.');
  if(copy||!v.canOpen){await navigator.clipboard.writeText(v.path);setNotice('Full path copied.');}
 }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
 return <span className="file-location-control"><button type="button" className={iconOnly?'icon-button':'secondary-button'} disabled={disabled||busy} aria-label={`${label}: ${file}`} title={`${label}: ${file}`} onClick={()=>void act()}><Icon size={13}/>{!iconOnly&&label}</button>{notice&&<small role="status">{notice}</small>}</span>;
}
