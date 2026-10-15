import { useRef, useState } from "react";
import { Check, ChevronDown, FileText, Plus } from "lucide-react";
import { useDismissibleLayer } from "../useDismissibleLayer";
import { manuscriptPurpose, manuscriptVersionLabel, nextManuscriptVersion, type ManuscriptKind } from "../manuscripts";
import type { ManuscriptNode, ManuscriptPurpose, ProjectDocument } from "../types";

export function ManuscriptSwitcher({ document, disabled, onSelect, onCreate, onVersion, onPurpose, section, onSectionFile }: {
  document: ProjectDocument; disabled: boolean; onSelect: (file: string) => Promise<unknown>;
  onCreate: (file: string, title: string, kind: ManuscriptKind) => Promise<unknown>;
  onVersion: (file: string, fresh: boolean) => Promise<unknown>;
  onPurpose: (purpose: ManuscriptPurpose, targetFile?: string) => Promise<unknown>;
  section?: ManuscriptNode; onSectionFile: (file: string, title: string, nodeId?: string) => Promise<unknown>;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const [kind, setKind] = useState<ManuscriptKind>("notes"), [file, setFile] = useState("research-notes.tex"), [title, setTitle] = useState("Research notes");
  const [sectionForm, setSectionForm] = useState(false), [moveSection, setMoveSection] = useState(false), [sectionFile, setSectionFile] = useState("sections/new-section.tex"), [sectionTitle, setSectionTitle] = useState("New section");
  const [versioning, setVersioning] = useState(false), [versionFile, setVersionFile] = useState(nextManuscriptVersion(document.project).file), [fresh, setFresh] = useState(false);
  useDismissibleLayer(open, root, () => setOpen(false), "summary");
  const roots = [...new Set([document.project.mainFile, ...document.rootFiles])].sort((a, b) => {
    const va = document.project.manuscriptVersions?.find(v => v.file === a), vb = document.project.manuscriptVersions?.find(v => v.file === b);
    return (va?.family ?? a).localeCompare(vb?.family ?? b) || (va?.number ?? 1) - (vb?.number ?? 1);
  });
  async function perform(action: () => Promise<unknown>) {
    setError("");
    try { await action(); setOpen(false); setCreating(false); setSectionForm(false); setVersioning(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  return <details ref={root} className="manuscript-switcher" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary aria-label="Switch manuscript" title={`Manuscript · ${document.project.mainFile}`}><FileText size={14} /><span>{document.project.mainFile} {manuscriptVersionLabel(document.project, document.project.mainFile)}</span><ChevronDown size={11} /></summary>
    <div className="manuscript-switcher-panel" aria-label="Manuscripts in this project" aria-busy={disabled}>
      <strong>Manuscripts</strong><small>{document.project.name}</small>
      <label>Writing purpose<select aria-label="Manuscript writing purpose" disabled={disabled} value={manuscriptPurpose(document.project)} onChange={event => { const purpose = event.target.value as ManuscriptPurpose; void perform(() => onPurpose(purpose)); }}><option value="notes">Research notes</option><option value="overview">Overview</option><option value="publication">Publication draft</option></select></label>
      <small>{manuscriptPurpose(document.project) === "overview" ? "A short, clear introduction for collaborators. Link to the main manuscript for detail." : manuscriptPurpose(document.project) === "notes" ? "Full explanations welcome. Small-step review is optional." : "Small writing steps, human review, and settled wording locks."} Changing purpose does not clear existing reviews.</small>
      {manuscriptPurpose(document.project) === "overview" && <>
        <label>Main manuscript<select aria-label="Overview main manuscript" disabled={disabled} value={document.project.manuscriptOverviewTargets?.[document.project.mainFile] ?? ""} onChange={event => { const file = event.target.value; void perform(() => onPurpose("overview", file)); }}><option value="">Choose manuscript</option>{roots.filter(file => file !== document.project.mainFile).map(file => <option key={file} value={file}>{file}</option>)}</select></label>
        {document.project.manuscriptOverviewTargets?.[document.project.mainFile] && <button disabled={disabled} onClick={() => void perform(() => onSelect(document.project.manuscriptOverviewTargets![document.project.mainFile]))}>Open main manuscript</button>}
        <small>This link opens the manuscript in Aw. For a shared copy, add its arXiv, repository or PDF link to the overview text.</small>
      </>}
      {roots.map(path => { const version = document.project.manuscriptVersions?.find(item => item.file === path); return <button key={path} disabled={disabled} title={version ? `${version.previousFile ? `From ${version.previousFile} · ` : ""}${new Date(version.createdAt).toLocaleString()}` : path} aria-pressed={path === document.project.mainFile} onClick={() => { void perform(() => onSelect(path)); }}><FileText size={14} /><span>{path}{version && <small> · v.{version.number} · {new Date(version.createdAt).toLocaleDateString()}</small>}</span>{path === document.project.mainFile && <Check size={14} />}</button>; })}
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
      {error && <p role="alert">{error}</p>}
      <small>Each version keeps its notebook and reading position. The selected compilation root applies to this project in all windows.</small>
    </div>
  </details>;
}
