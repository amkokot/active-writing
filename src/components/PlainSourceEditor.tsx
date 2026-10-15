import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useStableEvent } from "../useStableEvent";
import { initialWindowRequest, windowStateCache } from "../windowCache";
import { useSavedReadingPosition } from "../useSavedReadingPosition";
import type { ProjectDocument } from "../types";
import { usePaneZoomGestures, useStoredPaneZoom } from "../usePaneZoom";
import { textareaCaretTop } from "../textareaViewport";
import { SourceLineNumbers } from "./SourceLineNumbers";
interface SourceFile {file:string;source:string;revision:string;mainFile:string;positions:Array<{paragraphId:string;nodeId?:string;start:number;end:number}>}
interface Props {document:ProjectDocument;file:string;onFile:(file:string)=>Promise<void>;onSaved:(document:ProjectDocument)=>void;flushRef:MutableRefObject<(()=>Promise<void>)|undefined>;jump?:{paragraphId?:string;nodeId?:string;sequence:number;sourceOffset?:number};preamble?:boolean;onFocus:(paragraphId:string,nodeId:string)=>void;onSyncToPreview?:(paragraphId:string)=>void;readOnly?:boolean;onClose:()=>Promise<void>}
export function PlainSourceEditor({document:paper,file,onFile,onSaved,flushRef,jump,preamble,onFocus,onSyncToPreview,readOnly,onClose}:Props){
  const [text,setText]=useState(""),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState<string>();
  const [keptDrafts,setKeptDrafts]=useState<Array<{at:string;text:string}>>([]);
  const [incomingConflict,setIncomingConflict]=useState<string>();
  const baseline=useRef<SourceFile|undefined>(undefined),draft=useRef(""),running=useRef<Promise<void>|undefined>(undefined),input=useRef<HTMLTextAreaElement>(null);
  const registration=useRef(0);
  const [zoom,setZoom]=useStoredPaneZoom("editor");
  usePaneZoomGestures(input,zoom,setZoom,false);
  const cacheKey=`active-writing.raw.v2.${paper.project.id}.${file}`;
  useSavedReadingPosition(input,{key:`raw:${paper.project.id}:${file}`,revision:paper.revision},loaded);
  const saved=useStableEvent(onSaved);
  useEffect(()=>{try{const copies=JSON.parse(localStorage.getItem(`${cacheKey}.kept`)||"[]");if(Array.isArray(copies))setKeptDrafts(copies.filter(copy=>typeof copy.at==="string" && typeof copy.text==="string"));}catch{ /* leave unknown recovery untouched */ }},[cacheKey]);
  function keep(value:string){try{if(baseline.current)windowStateCache().writeSnapshot(cacheKey,JSON.stringify({...baseline.current,draft:value}),JSON.stringify({...baseline.current,draft:baseline.current.source}));}catch{setError("Browser storage is full. Keep this editor open and copy your draft before leaving.");}}
  const flush=useStableEvent(async(retry=false)=>{
    if(running.current)await running.current;
    const before=baseline.current;if(!before || draft.current===before.source)return;
    if(error && !retry)throw new Error(error);
    const value=draft.current;
    const operation=(async()=>{
      setSaving(true);
      try{
        const id=`raw:${file}`,response=await fetch("/api/paperfocus/document",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:paper.project.id,mainFile:before.mainFile,revision:before.revision,paragraphEdits:{[id]:value},sourceRanges:[{paragraphId:id,file,start:0,end:before.source.length,text:before.source}]})});
        const result=await response.json();if(!response.ok)throw new Error(result.error || "Source could not be saved. Your draft is kept.");
        baseline.current={...before,source:value,revision:result.document.revision};keep(draft.current);saved(result.document);
        if(draft.current===value){try{windowStateCache().clearOwn(cacheKey);}catch{ /* retain recovery if storage is unavailable */ }}
      }catch(reason){setError((reason as Error).message);throw reason;}finally{setSaving(false);}
    })();running.current=operation;try{await operation;}finally{running.current=undefined;}
    if(draft.current!==baseline.current?.source)await flush(retry);
  });
  async function loadSavedFile(){
    try{
      if(running.current)await running.current.catch(()=>undefined);
      const responses=await Promise.all([fetch(`/api/paperfocus/document?projectId=${encodeURIComponent(paper.project.id)}&sourceFile=${encodeURIComponent(file)}`),fetch(`/api/paperfocus/document?projectId=${encodeURIComponent(paper.project.id)}`)]);
      const incoming=await responses[0].json() as SourceFile & {error?:string},document=await responses[1].json() as ProjectDocument;
      if(!responses.every(response=>response.ok) || typeof incoming.source!=="string")throw new Error(incoming.error || "The saved file could not be opened. Your draft is kept.");
      if(document.revision!==incoming.revision || document.project.id!==paper.project.id || document.project.mainFile!==incoming.mainFile)throw new Error("Files changed while opening. Try again; your draft is kept.");
      const previous=JSON.parse(localStorage.getItem(`${cacheKey}.kept`)||"[]");
      if(!Array.isArray(previous) || previous.some(copy=>typeof copy.at!=="string" || typeof copy.text!=="string"))throw new Error("A saved draft collection could not be read. Copy your draft before replacing it.");
      const copies=[...previous,{at:new Date().toISOString(),text:draft.current}];
      // Keep a recoverable copy before replacing the editor, including on quota failure.
      localStorage.setItem(`${cacheKey}.kept`,JSON.stringify(copies));windowStateCache().clearOwn(cacheKey);
      setKeptDrafts(copies);baseline.current=incoming;draft.current=incoming.source;setText(incoming.source);setLoaded(true);setError(undefined);setIncomingConflict(undefined);saved(document);
    }catch(reason){setError((reason as Error).message);}
  }
  useEffect(()=>{const owner=++registration.current;flushRef.current=flush;return()=>{void flush().catch(()=>undefined).finally(()=>{if(registration.current===owner && flushRef.current===flush)flushRef.current=undefined;});};},[flush,flushRef]);
  useEffect(()=>{
    let cancelled=false;
    void fetch(`/api/paperfocus/document?projectId=${encodeURIComponent(paper.project.id)}&sourceFile=${encodeURIComponent(file)}`).then(async response=>{
      const incoming=await response.json() as SourceFile & {error?:string};if(!response.ok || typeof incoming.source!=="string")throw new Error(incoming.error || "Restart Aw to load the plain-source editor.");
      if(cancelled)return;
      const old=baseline.current;
      if(old && draft.current!==old.source){if(incoming.source===old.source){baseline.current=incoming;return;}setIncomingConflict(incoming.source);setError("This file changed in another editor. Your draft is kept; compare the saved text before replacing it.");return;}
      let recovered:{draft:string;source:string;revision:string}|undefined;try{const cached=JSON.parse(windowStateCache().read(cacheKey,Boolean(initialWindowRequest))||"null");if(cached && typeof cached.draft==="string" && typeof cached.source==="string" && typeof cached.revision==="string" && cached.mainFile===incoming.mainFile && cached.file===file && cached.draft!==cached.source)recovered=cached;}catch{ /* ignore invalid recovery, never erase it */ }
      baseline.current=recovered && recovered.source!==incoming.source?{...incoming,source:recovered.source,revision:recovered.revision}:incoming;
      draft.current=recovered?.draft ?? incoming.source;setText(draft.current);setLoaded(true);
      if(recovered && recovered.source!==incoming.source){setIncomingConflict(incoming.source);setError("The file changed outside this editor. Your recovered draft is kept. Copy it before opening the updated file.");}
    }).catch(reason=>{if(!cancelled)setError((reason as Error).message);});
    return()=>{cancelled=true;};
  },[paper.project.id,paper.revision,file,cacheKey]);
  useEffect(()=>{if(!loaded || error || readOnly || draft.current===baseline.current?.source)return;const timer=setTimeout(()=>{void flush().catch(()=>undefined);},650);return()=>clearTimeout(timer);},[text,loaded,error,readOnly,flush]);
  useEffect(()=>{
    if(!loaded || !input.current || draft.current!==baseline.current?.source)return;
    const position=preamble?0:jump?.sourceOffset ?? baseline.current?.positions.find(p=>jump?.paragraphId?p.paragraphId===jump.paragraphId:p.nodeId===jump?.nodeId)?.start;
    if(position===undefined)return;
    const editor=input.current;editor.focus();editor.setSelectionRange(position,position);
    editor.scrollTop=Math.max(0,textareaCaretTop(editor,position)-40);
  },[jump?.sequence,preamble,loaded]);
  return <div className="plain-source-editor">
    <div className="plain-source-heading"><select aria-label="Source file" value={file} onChange={event=>{void onFile(event.target.value);}}>{paper.files.filter(f=>f.endsWith(".tex")).map(f=><option key={f}>{f}</option>)}</select><small>{saving?"Saving…":error?"Draft kept":loaded?"Saved locally":"Opening source…"}</small><button onClick={()=>{void onClose();}}>Return to manuscript</button><button disabled={!loaded || draft.current!==baseline.current?.source} onClick={()=>{
      const caret=input.current?.selectionStart ?? 0, positions=baseline.current?.positions ?? [];
      const position=positions.find(p=>caret>=p.start && caret<=p.end) ?? positions.filter(p=>p.start<=caret).at(-1) ?? positions[0];
      if(position)onSyncToPreview?.(position.paragraphId);
    }}>Show in preview</button></div>
    {error && <div className="plain-source-error" role="alert">{error} <button onClick={()=>{setError(undefined);void flush(true).catch(()=>undefined);}}>Retry save</button><button onClick={()=>{void navigator.clipboard.writeText(draft.current);}}>Copy draft</button><button onClick={()=>{void loadSavedFile();}}>Keep draft & load saved file</button></div>}
    {incomingConflict!==undefined && <details className="plain-source-error" open><summary>Saved text from the other editor</summary><textarea aria-label="Incoming LaTeX source" readOnly rows={5} value={incomingConflict}/><small>Your editable draft remains below. Neither version was overwritten.</small></details>}
    {!!keptDrafts.length && <details className="plain-source-error"><summary>Kept drafts ({keptDrafts.length})</summary>{keptDrafts.map((copy,i)=><div key={`${copy.at}:${i}`}><small>{new Date(copy.at).toLocaleString()}</small><button onClick={()=>{void navigator.clipboard.writeText(copy.text);}}>Copy</button><pre>{copy.text}</pre></div>)}</details>}
    <div className="plain-source-input"><SourceLineNumbers target={input} text={text} start={loaded?1:undefined}/><textarea ref={input} aria-label="Plain LaTeX source" wrap="soft" style={{fontSize:15*zoom}} spellCheck={false} readOnly={!loaded || readOnly} value={text} onChange={event=>{draft.current=event.target.value;setText(draft.current);keep(draft.current);}} onSelect={()=>{if(draft.current!==baseline.current?.source)return;const caret=input.current?.selectionStart,position=baseline.current?.positions.find(p=>caret!==undefined && caret>=p.start && caret<=p.end);if(position?.nodeId)onFocus(position.paragraphId,position.nodeId);}}/></div>
  </div>;
}
