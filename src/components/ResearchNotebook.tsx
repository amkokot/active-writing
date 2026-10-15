import { FileText, ArrowRight, ExternalLink, GripVertical, MoreHorizontal, Pin, Plus, Sparkles } from "lucide-react";
import { orderedNotebookEntries } from "../notebookCatalogue";
import { manuscriptPurpose, manuscriptVersionLabel } from "../manuscripts";
import { LazyDisclosure } from "../lazyDisclosure";
import { notebookTitle, proposalReplacement } from "../notebook";
import { notebookExcerpt } from "../selectionPassages";
import type { NotebookEntry, ProjectDocument, ReferenceRequest, StudyFocus, StudyTurn } from "../types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { StudyWorkspace } from "./StudyWorkspace";
import { ExperimentWorkspace } from "./ExperimentWorkspace";
import { useStableEvent } from "../useStableEvent";
import { useReadingLayout } from "../usePaneLayout";
import { useSavedReadingPosition } from "../useSavedReadingPosition";
import type { WindowRequest } from "../windowWorkspace";
import { phaseNeighbours, researchPhases } from "../notebook";

interface Props {
  shareControl?: React.ReactNode;
  entry?: NotebookEntry;
  entries: NotebookEntry[];
  allEntries: NotebookEntry[];
  onTransfer: (ids: string[], target: string, mode: "move" | "copy") => Promise<void>;
  collapsedIds: string[];
  onToggle: (entry: NotebookEntry, open: boolean) => void;
  onNavigatePhase: (entry: NotebookEntry) => Promise<void>;
  sourceFor: (entry: NotebookEntry) => string | undefined;
  active?: boolean;
  document: ProjectDocument;
  currentSource?: string;
  trustedExperiments: boolean;
  onTrustExperiments: (trusted: boolean) => void;
  saving: boolean;
  pending: boolean;
  error?: string;
  onRecover: () => void;
  onNew: () => void;
  onPatch: (id: string, patch: Partial<NotebookEntry>) => void;
  onReorder:(id:string,targetId:string,before?:boolean)=>void;
  onFile:(id:string,filed:boolean,folder?:string)=>void;
  onReturn: (entry: NotebookEntry) => void;
  passageHrefFor: (entry: NotebookEntry) => string | undefined;
  evidenceTarget?: WindowRequest;
  onApply: (entry: NotebookEntry) => void;
  onRefreshSource: (entry: NotebookEntry) => void;
  onHandoff: (entry: NotebookEntry, packet: string, turn?: StudyTurn) => Promise<string>;
  onImportReply: (taskId: string, reply: string) => boolean;
  onFinishWithoutImport: (taskId: string) => void;
  onFinishTask?: (taskId: string) => void;
  onReopenTask: (taskId: string) => void;
  onLocalStudy: (entry: NotebookEntry, turn: StudyTurn) => void;
  dispatching: boolean;
  onContinue: () => void;
  onReference: (request: ReferenceRequest) => void;
}

export function ResearchNotebook(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConversationRef = useRef<HTMLElement>(null);
  useReadingLayout(scrollRef);
  const { entry, entries, collapsedIds, onToggle, sourceFor, saving, pending, error, onRecover, onNew, onPatch,onReorder,onFile } = props;
  useSavedReadingPosition(scrollRef,{key:`notebook:${props.document.project.id}:${entry?.id ?? "catalogue"}`,revision:props.document.project.mainFile});
  const catalogue=orderedNotebookEntries(entries),visible=catalogue.filter(item=>!item.filed || item.id === entry?.id || item.id === props.evidenceTarget?.notebookId),filed=catalogue.filter(item=>item.filed && item.id !== entry?.id && item.id !== props.evidenceTarget?.notebookId);
  const [phaseBusy, setPhaseBusy] = useState(false);
  const [phaseError, setPhaseError] = useState("");
  const phases = researchPhases(props.allEntries, props.document.project.id);
  const selectedPhase = phases.find(item => item.id === entry?.id);
  const phaseLinks = selectedPhase ? phaseNeighbours(selectedPhase, props.allEntries, props.document.project.id) : undefined;
  async function goToPhase(target: NotebookEntry) {
    if (phaseBusy) return;
    setPhaseBusy(true); setPhaseError("");
    try { await props.onNavigatePhase(target); }
    catch (reason) { setPhaseError((reason as Error).message); }
    finally { setPhaseBusy(false); }
  }
  function phaseNavigation(item: NotebookEntry) {
    const { previous, next } = phaseNeighbours(item, props.allEntries, props.document.project.id);
    if (!previous && !next.length) return null;
    return <nav className="phase-navigation" aria-label={`Research phases for ${notebookTitle(item)}`}>
      {previous && <button disabled={phaseBusy} title={notebookTitle(previous)} onClick={() => void goToPhase(previous)}>← Previous phase</button>}
      {item.filed && <small>Archived phase</small>}
      {next.length === 1 && <button disabled={phaseBusy} title={notebookTitle(next[0])} onClick={() => void goToPhase(next[0])}>Next phase →</button>}
      {next.length > 1 && <select aria-label="Choose next research phase" disabled={phaseBusy} value="" onChange={event => { const target = next.find(candidate => candidate.id === event.target.value); if (target) void goToPhase(target); }}><option value="">Next phase…</option>{next.map(candidate => <option key={candidate.id} value={candidate.id}>{notebookTitle(candidate)}</option>)}</select>}
    </nav>;
  }
  const folders=[...new Set(filed.map(item=>item.folder?.trim() || "Later"))];
  const experimentPins = visible.filter((item) => item.pinned && item.pinMode === "experiments" && item.id !== entry?.id);
  const pinIds = new Set(experimentPins.map((item) => item.id));
  const ordered = visible.filter(item=>!pinIds.has(item.id));
  // Only an intentional conversation change brings its heading into view.
  // New replies, autosaves and experiment output never steal the user's scroll.
  useLayoutEffect(() => {
    const pane = scrollRef.current, card = activeConversationRef.current;
    if (!pane || !card) return;
    const bounds = pane.getBoundingClientRect(), heading = card.querySelector(".conversation-heading")?.getBoundingClientRect();
    if (heading && (heading.top < bounds.top || heading.bottom > bounds.bottom)) pane.scrollTop += heading.top - bounds.top;
  }, [entry?.id]);
  function conversation(item: NotebookEntry) {
    const open = Boolean(item.pinned || item.id === props.evidenceTarget?.notebookId && props.evidenceTarget.cellId || item.id === entry?.id && !collapsedIds.includes(item.id));
    const turns = item.study?.turns ?? [], waiting = turns.some((turn) => turn.status === "queued" && !turn.closed);
    const title = notebookTitle(item);
    const index=visible.findIndex(saved=>saved.id===item.id);
    return <article className={`notebook-conversation ${open ? "is-open" : ""} ${item.pinned ? "is-pinned" : ""}`} key={item.id} data-notebook-entry={item.id} ref={item.id === entry?.id ? activeConversationRef : undefined}
      onDragOver={event=>{if(event.dataTransfer.types.includes("application/x-aw-conversation"))event.preventDefault();}}
      onDrop={event=>{const id=event.dataTransfer.getData("application/x-aw-conversation");if(id){event.preventDefault();onReorder(id,item.id);}}}>
      <header className="conversation-heading">
        <button className="catalogue-drag-handle" draggable aria-label={`Reorder conversation: ${title}`} title="Drag to reorder · up/down also in the menu" onDragStart={event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("application/x-aw-conversation",item.id);}}><GripVertical size={13}/></button>
        <button className="conversation-toggle" aria-expanded={open} aria-controls={`conversation-${item.id}`} onClick={() => onToggle(item, !open)} aria-label={`${open ? item.pinned ? "Unpin and collapse" : "Collapse" : "Open"} conversation: ${title}`}><span className="conversation-chevron">{open ? "▾" : "▸"}</span><span><strong>{title}</strong><small>{waiting ? "Waiting for a response" : `${turns.length} ${turns.length === 1 ? "request" : "requests"}`} · {item.source?.nodeTitle ?? "Independent question"}{item.status !== "open" ? ` · ${item.status}` : ""}</small>{!open && item.question && <span className="conversation-snippet">{item.question}</span>}</span></button>
        <PassageLink entry={item} href={props.passageHrefFor(item)} onReturn={props.onReturn} />
        <button className="conversation-pin" aria-label={`${item.pinned ? "Unpin" : "Pin"} conversation: ${title}`} aria-pressed={Boolean(item.pinned)} title={item.pinned ? "Unpin conversation" : "Keep this conversation open"} onClick={() => onPatch(item.id, { pinned: !item.pinned, pinMode: "conversation" })}><Pin size={14} /></button>
        <details className="conversation-organize"><summary aria-label={`Organize conversation: ${title}`} title="Move or file away"><MoreHorizontal size={14}/></summary><div>
          <button disabled={index===0} onClick={()=>onReorder(item.id,visible[index-1].id)}>Move up</button>
          <button disabled={index===visible.length-1} onClick={()=>onReorder(item.id,visible[index+1].id,false)}>Move down</button>
          <label>Folder<input aria-label={`Folder for ${title}`} maxLength={100} value={item.folder ?? ""} placeholder="Later" onChange={event=>onPatch(item.id,{folder:event.target.value})}/></label>
          <button onClick={()=>onFile(item.id,true)}>File away</button>
          <NotebookTransfer {...props} ids={[item.id]} />
          <small>Notes, replies and experiments stay saved. Waiting work stays in the queue.</small>
        </div></details>
      </header>
      {phaseNavigation(item)}
      {open && <div id={`conversation-${item.id}`}><NotebookConversation {...props} entry={item} active={item.id === entry?.id} currentSource={sourceFor(item)} /></div>}
    </article>;
  }
  return <section className="research-notebook-pane">
    <div className="research-notebook" ref={scrollRef}>
    {phases.length > 0 && <nav className="notebook-phase-toolbar" aria-label="Research phase navigation">
      <label>Research phase<select aria-label="Research phase" value={selectedPhase?.id ?? ""} disabled={phaseBusy} onChange={event => { const target = phases.find(item => item.id === event.target.value); if (target) void goToPhase(target); }}>
        {!selectedPhase && <option value="">Choose a saved research phase…</option>}
        {[...phases].reverse().map(item => <option key={item.id} value={item.id}>{notebookTitle(item)}{item.filed ? " · archived" : ""}</option>)}
      </select></label>
      <div className="notebook-phase-steps">
        <button disabled={phaseBusy || !phaseLinks?.previous} title={phaseLinks?.previous ? notebookTitle(phaseLinks.previous) : "No earlier linked phase"} onClick={() => phaseLinks?.previous && void goToPhase(phaseLinks.previous)}>← Previous phase</button>
        {phaseLinks && phaseLinks.next.length > 1 ? <select aria-label="Next research phase" disabled={phaseBusy} value="" onChange={event => { const target = phaseLinks.next.find(item => item.id === event.target.value); if (target) void goToPhase(target); }}><option value="">Next phase…</option>{phaseLinks.next.map(item => <option key={item.id} value={item.id}>{notebookTitle(item)}</option>)}</select>
          : <button disabled={phaseBusy || !phaseLinks?.next.length} title={phaseLinks?.next[0] ? notebookTitle(phaseLinks.next[0]) : "No later linked phase"} onClick={() => phaseLinks?.next[0] && void goToPhase(phaseLinks.next[0])}>Next phase →</button>}
      </div>
      <small>{phaseBusy ? "Saving before switching…" : selectedPhase?.filed ? "Viewing an archive; its evidence stays preserved." : "Choose any saved phase, including archives. No experiments run."}</small>
    </nav>}
    <header className="notebook-heading"><span>Notebook · {visible.length} research {visible.length === 1 ? "item" : "items"}</span><small>{error ? "Draft kept · saving paused" : saving || pending ? "Saving locally…" : "Saved locally"}</small>{props.shareControl}<NotebookTransfer {...props} /><button onClick={onNew}><Plus size={14} /> Question</button></header>
    {props.evidenceTarget && !entries.some(item => item.id === props.evidenceTarget!.notebookId) && <p role="status">The linked conversation is no longer available. The catalogue is shown; no other conversation is presented as the linked evidence.</p>}
    {error && <div className="notebook-error" role="alert">{error} Your draft is kept in this browser. <button onClick={onRecover}>Reload saved work</button></div>}
    {phaseError && <p className="notebook-error" role="alert">Phase navigation stopped: {phaseError} Your current work stays open.</p>}
    {!entries.length && <div className="notebook-empty"><Sparkles size={24} /><h2>A place to work out an idea</h2><p>Ask from your manuscript or start a question here. Everything saves automatically. Pin work to keep it open.</p><button className="primary-button" onClick={onNew}>Start a question</button><a href="http://127.0.0.1:4317/" target="_blank" rel="noreferrer">Open Problem Lab <ExternalLink size={13} /></a></div>}
    <div className={`notebook-layout ${experimentPins.length ? "has-pins" : ""}`}><div className="notebook-conversations">{ordered.map(conversation)}</div>{experimentPins.length > 0 && <aside className="notebook-pinned-experiments" aria-label="Pinned experiments">{experimentPins.map(conversation)}</aside>}</div>
    {filed.length>0 && <details className="notebook-filed"><summary>Filed away · {filed.length}</summary>{folders.map(folder=><details key={folder}><summary>{folder} · {filed.filter(item=>(item.folder?.trim() || "Later")===folder).length}</summary>{filed.filter(item=>(item.folder?.trim() || "Later")===folder).map(item=><div className="filed-conversation" key={item.id}><div className="filed-conversation-actions"><PassageLink entry={item} href={props.passageHrefFor(item)} onReturn={props.onReturn} /><NotebookTransfer {...props} ids={[item.id]} /><button onClick={()=>onFile(item.id,false)} aria-label={`Restore conversation: ${notebookTitle(item)}`}>Restore</button></div><LazyDisclosure summary={notebookTitle(item)}>{phaseNavigation(item)}<NotebookConversation {...props} entry={item} active={false} currentSource={sourceFor(item)}/></LazyDisclosure></div>)}</details>)}</details>}
    </div>
  </section>;
}

function NotebookTransfer(props: Props & { ids?: string[] }) {
  const [target, setTarget] = useState(props.ids ? "" : props.document.project.mainFile);
  const [source, setSource] = useState(props.document.project.mainFile);
  const [selected, setSelected] = useState("all");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const candidates = props.allEntries.filter(entry => !entry.recoveryKey && (entry.manuscriptFile ?? entry.source?.rootFile ?? props.document.project.mainFile) === source);
  const ids = props.ids ?? (selected === "all" ? candidates.map(entry => entry.id) : candidates.filter(entry => entry.id === selected).map(entry => entry.id));
  const roots = props.document.rootFiles;
  async function transfer(mode: "move" | "copy") {
    setBusy(true); setMessage("");
    try { await props.onTransfer(ids, target, mode); setMessage(`${mode === "move" ? "Moved" : "Copied"} to ${target}.`); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <details className="notebook-transfer"><summary>{props.ids ? "Move / copy to version" : "Move / copy notebook"}</summary><div>
    {!props.ids && <><label>From<select aria-label="Notebook source version" value={source} onChange={event => { setSource(event.target.value); setSelected("all"); }}>{roots.map(file => <option key={file} value={file}>{file} · {manuscriptVersionLabel(props.document.project, file)}</option>)}</select></label>
      <label>Contents<select aria-label="Conversations to transfer" value={selected} onChange={event => setSelected(event.target.value)}><option value="all">All conversations ({candidates.length})</option>{candidates.map(entry => <option key={entry.id} value={entry.id}>{notebookTitle(entry)}</option>)}</select></label></>}
    <label>To<select aria-label="Notebook destination version" value={target} onChange={event => setTarget(event.target.value)}><option value="">Choose version</option>{roots.map(file => <option key={file} value={file}>{file} · {manuscriptVersionLabel(props.document.project, file)}</option>)}</select></label>
    <button disabled={busy || !target || !ids.length} onClick={() => void transfer("copy")}>Copy</button><button disabled={busy || !target || !ids.length} onClick={() => void transfer("move")}>Move</button>
    <small>Saved notes and experiments travel together. Passage links keep their original source. Copy keeps both; Move changes where the conversation is filed. Finish waiting requests first.</small>
    {message && <p role="status">{message}</p>}
  </div></details>;
}

/** A real link keeps the browser's right-click and modifier-click actions. */
function PassageLink({ entry, href, onReturn }: { entry: NotebookEntry; href?: string; onReturn: Props["onReturn"] }) {
  if (!entry.source) return null;
  const label = `Go to manuscript passage: ${notebookTitle(entry)}`;
  const content = <><FileText size={13} /><span>Passage</span></>;
  const title = `${entry.source.nodeTitle} · ${entry.source.file ?? "source"}`;
  return href ? <a className="conversation-passage" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={`${title} · right-click to open in a new tab`} onClick={event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onReturn(entry);
  }}>{content}</a> : <button className="conversation-passage" aria-label={label} title={`${title} · new-tab link unavailable until this passage is saved and located`} onClick={() => onReturn(entry)}>{content}</button>;
}

function NotebookConversation({ entry, active, onToggle, document, currentSource, trustedExperiments, onTrustExperiments, onPatch, onApply, onRefreshSource, onHandoff, onImportReply, onFinishWithoutImport, onFinishTask, onReopenTask, onLocalStudy, dispatching, onContinue, onReference, evidenceTarget, passageHrefFor }: Props) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selection, setSelection] = useState<StudyFocus>();
  useEffect(() => { setSelection(undefined); setReviewOpen(false); }, [entry?.id]);
  const guard = entry ? proposalReplacement(entry, currentSource) : undefined;
  const experimentOnly = !active && entry?.pinMode === "experiments";
  const patch = (value: Partial<NotebookEntry>) => entry && onPatch(entry.id, value);
  const patchExperimentContext = useStableEvent((experimentContext: string) => { if ((entry?.experimentContext ?? "") !== experimentContext) patch({ experimentContext }); });
  const excerpt = entry?.source && <blockquote onMouseUp={(event) => { const selected = window.getSelection(); if (selected?.toString().trim() && selected.anchorNode && selected.focusNode && event.currentTarget.contains(selected.anchorNode) && event.currentTarget.contains(selected.focusNode)) setSelection({ text: selected.toString(), origin: "Linked passage" }); }}>{notebookExcerpt(entry.source)}</blockquote>;
  function captureText(event: React.SyntheticEvent<HTMLTextAreaElement>, origin: string) { const target = event.currentTarget; if (target.selectionEnd > target.selectionStart) setSelection({ text: target.value.slice(target.selectionStart, target.selectionEnd), origin }); }
  function exportNotebook() {
    if (!entry) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a"); link.href = href; link.download = "research-entry.json"; link.click(); URL.revokeObjectURL(href);
  }
  return entry && <div className="notebook-page" key={entry.id}>
      {entry.recoveryKey && <small>Recovered draft · uses the original experiments. Old requests stay in History and aren't sent again.</small>}
      {entry.source && !experimentOnly && <div className="notebook-source"><details><summary>Linked {entry.source.passages ? `${entry.source.passages.length} blocks` : "passage"} · {entry.source.file}</summary>{excerpt}<small>Saved passage{entry.source.returnAnchor && currentSource !== entry.source.paragraphText ? " · edited since capture; refresh before replacing" : currentSource !== entry.source.paragraphText ? " · source has changed" : ""}</small></details></div>}
      {!active && <button className="conversation-work-on" onClick={() => onToggle(entry, true)}>Continue this conversation</button>}
      {!experimentOnly && <StudyWorkspace key={entry.id} entry={entry} document={document} showComposer={active} selection={selection} onSelection={setSelection} onClearSelection={() => setSelection(undefined)} onPatch={patch} onHandoff={onHandoff} onImportReply={onImportReply} onFinishWithoutImport={onFinishWithoutImport} onFinishTask={onFinishTask} onReopenTask={onReopenTask} onLocalStudy={onLocalStudy} dispatching={dispatching} onContinue={onContinue} onReference={onReference} />}
      <ExperimentWorkspace key={`experiments:${document.project.id}:${entry.experimentNotebookId ?? entry.id}`} compact={experimentOnly && entry.id !== evidenceTarget?.notebookId} projectId={document.project.id} manuscriptFile={entry.manuscriptFile ?? entry.source?.rootFile ?? document.project.mainFile} purpose={manuscriptPurpose(document.project, entry.manuscriptFile ?? entry.source?.rootFile ?? document.project.mainFile)} entryId={entry.id} notebookId={entry.experimentNotebookId ?? entry.id} trusted={trustedExperiments} onTrust={onTrustExperiments} onContext={patchExperimentContext} onPin={() => patch({ pinned: true, pinMode: entry.pinned && entry.pinMode !== "experiments" ? "conversation" : "experiments" })} linkTarget={entry.id === evidenceTarget?.notebookId ? evidenceTarget : undefined} passageHref={passageHrefFor(entry)} />
      <details className="notebook-entry-tools"><summary>Notes & manuscript tools</summary>
      {entry.continuedFrom && <p className="notebook-applied">Continued from {entry.continuedFrom.manuscriptFile}. Notes and experiments are independent copies; earlier evidence remains at its original owner. <a href={`?${new URLSearchParams({ awProject: document.project.id, awPanel: "notebook", awNotebook: entry.continuedFrom.entryId })}`} target="_blank" rel="noopener noreferrer">Earlier notebook</a></p>}
      <details className="notebook-notes"><summary>Notes & title{entry.notes ? " · saved" : ""}</summary><label>Conversation title<input aria-label="Question title" value={entry.title} onChange={(event) => patch({ title: event.target.value })} /></label><textarea aria-label="Working notes" placeholder="Approaches, calculations, failed checks…" value={entry.notes} onChange={(event) => patch({ notes: event.target.value })} onSelect={(event) => captureText(event, "Working notes")} rows={4} /></details>
      {entry.source && <section className="notebook-proposal"><button aria-expanded={reviewOpen} onClick={() => setReviewOpen((open) => !open)}><ArrowRight size={14} /> Change this passage</button>{entry.appliedChanges.length > 0 && <p className="notebook-applied">Your last change is kept in Details.</p>}{reviewOpen && <><label>Proposed LaTeX replacement<textarea aria-label="Proposed manuscript text" value={entry.proposal} onChange={(event) => patch({ proposal: event.target.value })} placeholder="Replace the linked excerpt, not the whole paper" rows={4} /></label><div className="notebook-diff"><div><small>Saved passage</small><pre>{notebookExcerpt(entry.source)}</pre></div><div><small>Proposed</small><pre>{entry.proposal || "No proposed text yet"}</pre></div></div>{guard?.error && <p className="notebook-guard">{guard.error}</p>}<button className="primary-button" disabled={Boolean(guard?.error)} onClick={() => onApply(entry)}>Apply & return to passage</button><small>Only this passage changes. Check the mathematics separately.</small></>}</section>}
      <details className="notebook-details"><summary>Details</summary><label>State<select value={entry.status} onChange={(event) => patch({ status: event.target.value as NotebookEntry["status"] })}><option value="open">Open question</option><option value="parked">Parked</option><option value="integrated">Brought into manuscript</option></select></label><p>Source: {entry.source?.file ?? "No linked passage"}<br />Saved version: {entry.source?.revision ?? "—"}</p>{entry.source && <><pre>{currentSource ?? "Passage not found in this paper"}</pre><button disabled={currentSource === undefined} onClick={() => onRefreshSource(entry)}>Use the current paragraph</button><small>Notes and proposed text are kept. Check the new passage before applying.</small></>}<button onClick={exportNotebook}>Export entry</button>{entry.handoffs.map((handoff) => <details key={handoff.id}><summary>Saved prompt · {new Date(handoff.createdAt).toLocaleString()}</summary><textarea readOnly aria-label="Saved prompt" value={handoff.packet} rows={8} /></details>)}{entry.appliedChanges.map((change, index) => <details key={index}><summary>Applied change · {new Date(change.createdAt).toLocaleString()}</summary><pre>{change.before}</pre><pre>{change.after}</pre></details>)}</details>
      </details>
  </div>;
}
