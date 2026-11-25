import {FileLocationButton} from './FileLocationButton';
import { useRef, useState } from "react";
import { Check, ChevronDown, FileText, Link, Plus, Presentation } from "lucide-react";
import { useDismissibleLayer } from "../useDismissibleLayer";
import { isPersonalNote, manuscriptDisplayLabel, manuscriptPurpose, manuscriptVersionLabel, nextManuscriptVersion, manuscriptRoles, manuscriptPurposeLabels, pinnedManuscripts, manuscriptLink, type ManuscriptKind } from "../manuscripts";
import type { ManuscriptNode, ManuscriptPurpose, ProjectDocument } from "../types";

export function ManuscriptSwitcher({ document, disabled, getSourceFile, onSelect, onCreate, onVersion, onPurpose, onPin, onPinSlides, section, onSectionFile }: {
  document: ProjectDocument; disabled: boolean; onSelect: (file: string) => Promise<unknown>;
  getSourceFile?: () => string;
  onCreate: (file: string, title: string, kind: ManuscriptKind) => Promise<unknown>;
  onVersion: (file: string, fresh: boolean) => Promise<unknown>;
  onPurpose: (purpose: ManuscriptPurpose, targetFile?: string) => Promise<unknown>;
  onPin: (purpose: ManuscriptPurpose, file: string) => Promise<unknown>;
  onPinSlides: (file: string) => Promise<unknown>;
  section?: ManuscriptNode; onSectionFile: (file: string, title: string, nodeId?: string) => Promise<unknown>;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const [kind, setKind] = useState<ManuscriptKind>("notes"), [file, setFile] = useState("research-notes.tex"), [title, setTitle] = useState("Research notes");
  const [sectionForm, setSectionForm] = useState(false), [moveSection, setMoveSection] = useState(false), [sectionFile, setSectionFile] = useState("sections/new-section.tex"), [sectionTitle, setSectionTitle] = useState("New section");
  const [versioning, setVersioning] = useState(false), [versionFile, setVersionFile] = useState(nextManuscriptVersion(document.project).file), [fresh, setFresh] = useState(false);
  const [search, setSearch] = useState(""), [copied, setCopied] = useState("");
  const [locationFile, setLocationFile] = useState(document.project.mainFile);
  useDismissibleLayer(open, root, () => setOpen(false), "summary");
  const roots = [...new Set([document.project.mainFile, ...document.rootFiles])].sort((a, b) => {
    const va = document.project.manuscriptVersions?.find(v => v.file === a), vb = document.project.manuscriptVersions?.find(v => v.file === b);
    return (va?.family ?? a).localeCompare(vb?.family ?? b) || (va?.number ?? 1) - (vb?.number ?? 1);
  });
  async function perform(action: () => Promise<unknown>, close = true) {
    setError("");
    try { await action(); if (close) { setOpen(false); setCreating(false); setSectionForm(false); setVersioning(false); } }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const pins = pinnedManuscripts(document.project, roots);
  const personalNotes = roots.filter(file => isPersonalNote(document.project, file));
  const decks=(document.slideFiles??[]).filter(file=>roots.includes(file));
  const currentDeck=decks.includes(document.project.slideDeck??'')?document.project.slideDeck:decks.length===1?decks[0]:undefined;
  const matches = roots.filter(file => `${file} ${manuscriptDisplayLabel(document.project, file)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const sourceFiles = [...new Set([document.project.mainFile, ...(document.sourceFiles ?? document.paragraphs.map(p => p.file).filter((f): f is string => Boolean(f))), locationFile])].filter(file => document.files.includes(file));
  return <details ref={root} className="manuscript-switcher" open={open} onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget === event.target && event.currentTarget.open) setLocationFile(getSourceFile?.() ?? document.project.mainFile);
  }}>
    <summary aria-label="Switch manuscript" title={`Manuscript · ${document.project.mainFile}`}><FileText size={14} /><span>{document.project.mainFile} {manuscriptVersionLabel(document.project, document.project.mainFile)}</span><ChevronDown size={11} /></summary>
    <div className="manuscript-switcher-panel" aria-label="Manuscripts in this project" aria-busy={disabled}>
      <label className="manuscript-source-location">Source file {sourceFiles.length > 1
        ? <select aria-label="Source file location" value={locationFile} onChange={event => setLocationFile(event.target.value)}>{sourceFiles.map(file => <option key={file} value={file}>{file}{file === document.project.mainFile ? " (master)" : ""}</option>)}</select>
        : <code>{locationFile}</code>}</label>
      <div className="manuscript-file-location"><FileLocationButton key={`open:${locationFile}`} projectId={document.project.id} file={locationFile} disabled={disabled}/><FileLocationButton key={`copy:${locationFile}`} projectId={document.project.id} file={locationFile} copy disabled={disabled}/></div>
      {locationFile !== document.project.mainFile && <details className="manuscript-manage"><summary>Master file · compiles the whole paper</summary><small>{document.project.mainFile}</small><div className="manuscript-file-location"><FileLocationButton projectId={document.project.id} file={document.project.mainFile} disabled={disabled}/><FileLocationButton projectId={document.project.id} file={document.project.mainFile} copy disabled={disabled}/></div></details>}
      <header className="manuscript-menu-heading"><strong>Documents</strong><small title={document.project.mainFile}>Current · {manuscriptDisplayLabel(document.project)}</small></header>
      <div className="manuscript-pins" aria-label="Pinned project documents">
        {!!decks.length && <div className="manuscript-pin-actions manuscript-slides">
          <button className="manuscript-pin-document" disabled={disabled||!currentDeck} aria-pressed={currentDeck===document.project.mainFile} title={currentDeck??'Choose a current deck below'} onClick={()=>currentDeck&&void perform(()=>onSelect(currentDeck))}><Presentation size={14}/><span><strong>Slides</strong><small>{currentDeck??'Choose a current deck'}</small></span>{currentDeck===document.project.mainFile&&<Check size={14}/>}</button>
          <details className="slide-deck-menu"><summary aria-label="Slide decks and versions" title="Decks and versions"><ChevronDown size={13}/></summary><div>
            {decks.map(file=><div className="slide-deck-row" key={file}><button disabled={disabled} aria-pressed={file===document.project.mainFile} onClick={()=>void perform(()=>onSelect(file))}><span>{file}<small>{manuscriptVersionLabel(document.project,file)||'Slide deck'}</small></span>{file===document.project.mainFile&&<Check size={13}/>}</button><button disabled={disabled} aria-label={`Pin slides ${file}`} title="Make this the current deck" onClick={()=>void perform(()=>onPinSlides(file),false)}>{file===document.project.slideDeck?'Pinned':'Pin'}</button></div>)}
            <small>Open a deck, then use New version below to make an iteration.</small>
          </div></details>
        </div>}
        {manuscriptRoles.filter(role => pins[role]).map(role => <div className="manuscript-pin-actions" key={role}>
          <button className="manuscript-pin-document" disabled={disabled} aria-pressed={pins[role] === document.project.mainFile} title={pins[role]} onClick={() => void perform(() => onSelect(pins[role]!))}><span><strong>{manuscriptPurposeLabels[role]}</strong><small>{pins[role]}</small></span>{pins[role] === document.project.mainFile && <Check size={14} />}</button>
          <button className="manuscript-copy-link" disabled={disabled} title="Copy local Aw link (not a public sharing link)" aria-label={`Copy ${manuscriptPurposeLabels[role]} Aw link`} onClick={() => { void navigator.clipboard.writeText(manuscriptLink(window.location.href, document.project.id, pins[role]!, document.revision)).then(() => setCopied(role)).catch(() => setError("Could not copy the link.")); }}>{copied === role ? <Check size={14} /> : <Link size={14} />}</button>
        </div>)}
        {!Object.values(pins).some(Boolean) && <small>Choose preferred documents in Document settings.</small>}
      </div>
      {personalNotes.length > 0 && <details className="manuscript-all"><summary>Personal notes · {personalNotes.length}</summary>
        <div className="manuscript-file-list" aria-label="Personal notes">{personalNotes.map(path => <button key={path} disabled={disabled} title={path} aria-pressed={path === document.project.mainFile} onClick={() => { void perform(() => onSelect(path)); }}><FileText size={14} /><span>{path}<small>Explanations and worked examples</small></span>{path === document.project.mainFile && <Check size={14} />}</button>)}</div>
      </details>}
      <details className="manuscript-all"><summary>All manuscripts · {roots.length}</summary>
        {roots.length > 5 && <input type="search" aria-label="Find manuscript" placeholder="Find a document…" value={search} onChange={event => setSearch(event.target.value)} />}
        <div className="manuscript-file-list">{matches.map(path => { const version = document.project.manuscriptVersions?.find(item => item.file === path); return <button key={path} disabled={disabled} title={path} aria-pressed={path === document.project.mainFile} onClick={() => { void perform(() => onSelect(path)); }}><FileText size={14} /><span>{path}<small>{manuscriptDisplayLabel(document.project, path)}{version && ` · v.${version.number}`}</small></span>{path === document.project.mainFile && <Check size={14} />}</button>; })}{!matches.length && <small>No matching documents.</small>}</div>
      </details>
      <details className="manuscript-settings"><summary>Document settings</summary>
      <label>Writing purpose<select aria-label="Manuscript writing purpose" disabled={disabled} value={manuscriptPurpose(document.project)} onChange={event => { const purpose = event.target.value as ManuscriptPurpose; void perform(() => onPurpose(purpose), false); }}><option value="notes">Research notes</option><option value="overview">Overview</option><option value="publication">Publication draft</option></select></label>
      <small>{manuscriptPurpose(document.project) === "overview" ? "A short, clear introduction for collaborators. Link to the main manuscript for detail." : manuscriptPurpose(document.project) === "notes" ? "Full explanations welcome. Small-step review is optional." : "Small writing steps, human review, and settled wording locks."} Changing purpose does not clear existing reviews.</small>
      {manuscriptPurpose(document.project) === "overview" && <>
        <label>Main manuscript<select aria-label="Overview main manuscript" disabled={disabled} value={document.project.manuscriptOverviewTargets?.[document.project.mainFile] ?? ""} onChange={event => { const file = event.target.value; void perform(() => onPurpose("overview", file), false); }}><option value="">Choose manuscript</option>{roots.filter(file => file !== document.project.mainFile).map(file => <option key={file} value={file}>{file}</option>)}</select></label>
      </>}
      <strong>Choose pinned copies</strong>{manuscriptRoles.map(role => <label key={role}>{manuscriptPurposeLabels[role]}<select aria-label={`Pinned ${manuscriptPurposeLabels[role]}`} disabled={disabled} value={document.project.manuscriptPins?.[role] ?? ""} onChange={event => { const file = event.target.value; void perform(() => onPin(role, file), false); }}><option value="">Automatic · only if unambiguous</option>{roots.filter(file => manuscriptPurpose(document.project, file) === role).map(file => <option key={file} value={file}>{file}</option>)}</select></label>)}
      {!!decks.length&&<label>Slides<select aria-label="Pinned Slides" disabled={disabled} value={document.project.slideDeck??''} onChange={event=>void perform(()=>onPinSlides(event.target.value),false)}><option value="">Automatic · only if one deck</option>{decks.map(file=><option key={file} value={file}>{file}</option>)}</select></label>}
      <small>Links open local Aw. Share a PDF or Overleaf source ZIP from Compile ▾.</small>
      </details>
      <details className="manuscript-manage"><summary>Create & organize</summary>
      <button disabled={disabled} aria-expanded={versioning} onClick={() => { setVersioning(!versioning); setCreating(false); setSectionForm(false); }}><Plus size={14} /> New version</button>
      {versioning && <form onSubmit={event => { event.preventDefault(); void perform(() => onVersion(versionFile, fresh)); }}>
        <label>Filename<input required aria-label="New version filename" disabled={disabled} value={versionFile} maxLength={240} onChange={event => setVersionFile(event.target.value)} /></label>
        <small>Copies this manuscript and its included TeX files. Continues the notebook with independent editable copies. Figures and bibliography stay shared.</small>
        <details><summary>Advanced</summary><label><input type="checkbox" checked={fresh} onChange={event => setFresh(event.target.checked)} /> Start with a fresh notebook</label></details>
        <button className="primary-button" disabled={disabled} type="submit">{disabled ? "Preparing…" : "Create & open version"}</button>
      </form>}
      <button disabled={disabled} aria-expanded={creating} onClick={() => { setCreating(!creating); setSectionForm(false); setVersioning(false); }}><Plus size={14} /> New manuscript</button>
      <button disabled={disabled} aria-expanded={sectionForm} onClick={() => { setSectionForm(!sectionForm); setCreating(false); setVersioning(false); }}>Sections & files</button>
      {sectionForm && <form onSubmit={event => { event.preventDefault(); void perform(() => onSectionFile(sectionFile, sectionTitle, moveSection ? section?.id : undefined)); }}>
        <label>Action<select aria-label="Section file action" disabled={disabled} value={moveSection ? "move" : "new"} onChange={event => setMoveSection(event.target.value === "move")}><option value="new">Create a new section file</option>{section?.sourceOpening && <option value="move">Move current section · {section.title}</option>}</select></label>
        {!moveSection && <label>Section title<input required aria-label="New section title" disabled={disabled} value={sectionTitle} maxLength={200} onChange={event => setSectionTitle(event.target.value)} /></label>}
        <label>Child filename<input required aria-label="Section filename" disabled={disabled} value={sectionFile} maxLength={240} onChange={event => setSectionFile(event.target.value)} /></label>
        <small>{moveSection ? "Moves this section and its subsections into a new file and replaces them with an input in their parent." : "Creates a child .tex file and adds an input before the parent document ends."} The parent remains the manuscript. A parent recovery copy is kept in Source changes & drafts.</small>
        <button className="primary-button" disabled={disabled || moveSection && !section?.sourceOpening} type="submit">{disabled ? "Saving…" : moveSection ? "Move section to file" : "Create & include section"}</button>
      </form>}
      {creating && <form onSubmit={event => { event.preventDefault(); void perform(() => onCreate(file, title, kind)); }}>
        <label>Start with<select aria-label="Manuscript template" disabled={disabled} value={kind} onChange={event => {
          const next = event.target.value as ManuscriptKind; setKind(next); setFile(next === "overview" ? "overview.tex" : next === "notes" ? "research-notes.tex" : "paper.tex"); setTitle(next === "overview" ? "Project overview" : next === "notes" ? "Research notes" : "Paper");
        }}><option value="notes">Informative research notes</option><option value="overview">Overview · README</option><option value="paper">Paper</option></select></label>
        <label>Title<input aria-label="New manuscript title" required maxLength={200} disabled={disabled} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Filename<input aria-label="New manuscript filename" required maxLength={100} disabled={disabled} value={file} onChange={event => setFile(event.target.value)} /></label>
        <small>Creates a separate LaTeX root in this project. Existing manuscripts and notebooks stay intact.</small>
        <button className="primary-button" disabled={disabled} type="submit">{disabled ? "Opening…" : "Create & open"}</button>
      </form>}
      </details>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
