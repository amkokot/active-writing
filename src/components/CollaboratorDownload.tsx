import { useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "../types";
import { pdfDownloadName } from "../pdfLinks";

export function CollaboratorDownload({ projectId, entryId, blocked, onSave, notebookRevision, compact, roots = [], purposes = {} }: { projectId: string; entryId?: string; blocked: boolean; onSave: () => Promise<ProjectDocument>; notebookRevision: () => number; compact?: boolean; roots?: ProjectDocument["rootFiles"]; purposes?: ProjectDocument["project"]["manuscriptPurposes"] }) {
  const [format, setFormat] = useState<"pdf" | "html" | "zip" | "web" | "overview">("pdf"), [currentOnly, setCurrentOnly] = useState(false), [omitNotebook, setOmitNotebook] = useState(false);
  const [overviewFile, setOverviewFile] = useState(""), [noteFiles, setNoteFiles] = useState<string[]>([]), [repositoryUrl, setRepositoryUrl] = useState("");
  const [includeFiled, setIncludeFiled] = useState(false), [includeSource, setIncludeSource] = useState(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (blocked || busy) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try {
      const saved = await onSave();
      if (request.signal.aborted) return;
      if (saved.project.id !== projectId) throw new Error("The project changed. Open its sharing menu again.");
      const reader = format === "web" || format === "overview";
      const response = await fetch("/api/paperfocus/share.zip", { method: "POST", signal: request.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, mainFile: saved.project.mainFile, revision: saved.revision, notebookRevision: notebookRevision(), format, ...(omitNotebook ? { includeNotebook: false } : currentOnly && entryId ? { entryId } : {}), includeFiled, includeSource, ...(reader ? { ...(overviewFile ? { overviewFile } : {}), noteFiles: format === "web" ? noteFiles : [], ...(repositoryUrl.trim() ? { repositoryUrl: repositoryUrl.trim() } : {}) } : {}) }) });
      const extension = format === "overview" ? "pdf" : format === "web" ? "zip" : format;
      const mime = extension === "pdf" ? "application/pdf" : extension === "html" ? "text/html" : "application/zip";
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith(mime)) {
        const message = response.headers.get("Content-Type")?.includes("application/json") ? (await response.json()).error : undefined;
        throw new Error(message ?? "Sharing downloads need the updated Aw server. Restart after experiments finish.");
      }
      const blob = await response.blob(); if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = window.document.createElement("a");
      link.href = url; link.download = pdfDownloadName("", `${saved.project.name} — ${format === "web" ? "reader" : format === "overview" ? "overview" : "shared"}`, "main.tex").replace(/\.pdf$/, `.${extension}`);
      window.document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <details className={`pdf-download collaborator-download ${compact ? "is-compact" : ""}`}><summary>{compact ? "Share…" : "Share manuscript & notebook…"}</summary>
    <form onSubmit={event => { event.preventDefault(); void download(); }}>
      <label>Format<select aria-label="Sharing format" disabled={busy} value={format} onChange={event => { const next = event.target.value as typeof format; setFormat(next); setOmitNotebook(next === "web" || next === "overview"); }}><option value="pdf">Manuscript & notebook PDF</option><option value="overview">Overview PDF · ready to email</option><option value="web">Private reader ZIP · for hosting</option><option value="zip">Editable bundle · ZIP</option><option value="html">HTML · download and open in a browser</option></select></label>
      {(format === "web" || format === "overview") && <>
        <label>Overview<select aria-label="Shared overview" disabled={busy} value={overviewFile} onChange={event => setOverviewFile(event.target.value)}><option value="">Current Overview, or a simple index</option>{roots.filter(file => purposes[file] === "overview").map(file => <option key={file} value={file}>{file}</option>)}</select></label>
        {format === "web" && <details><summary>Include research notes</summary>{roots.filter(file => purposes[file] !== "overview").map(file => <label className="share-checkbox" key={file}><input type="checkbox" checked={noteFiles.includes(file)} disabled={busy || !noteFiles.includes(file) && noteFiles.length >= 8} onChange={event => setNoteFiles(previous => event.target.checked ? [...previous, file] : previous.filter(value => value !== file))} />{file}</label>)}</details>}
        <label>Repository link · optional<input aria-label="Shared repository link" type="url" placeholder="https://github.com/owner/project" disabled={busy} value={repositoryUrl} onChange={event => setRepositoryUrl(event.target.value)} /></label>
      </>}
      <label>Conversations<select aria-label="Conversations to share" disabled={busy} value={omitNotebook ? "none" : currentOnly && entryId ? "current" : "all"} onChange={event => { setOmitNotebook(event.target.value === "none"); setCurrentOnly(event.target.value === "current"); }}><option value="none">None · reading material only</option><option value="all">This manuscript’s conversations</option>{entryId && <option value="current">Current conversation</option>}</select></label>
      <label className="share-checkbox"><input type="checkbox" checked={includeFiled} disabled={busy} onChange={event => setIncludeFiled(event.target.checked)} />Include filed and hidden notes</label>
      {format === "zip" && <label className="share-checkbox"><input type="checkbox" checked={includeSource} disabled={busy} onChange={event => setIncludeSource(event.target.checked)} />Include project source files</label>}
      <small>{format === "web" ? "A curated aw/ folder for the paper repository, including an overview PDF. Requires the separate code-protected reader host; ordinary GitHub Pages is not private. No live Aw records or source checkout are copied." : format === "overview" ? "A short PDF from the selected Overview. Local/project links are removed; the optional repository link remains. Without an Overview, this is a resource index." : format === "pdf" ? "One PDF with equations, saved figures and expanded conversations. A reading copy, not exact LaTeX typesetting." : format === "html" ? "Download and open in a browser. Email previews may show source text instead." : "Send this ZIP. Extract it and open START_HERE.html; Markdown and Jupyter copies are included."} Only saved work is included. Review private text before forwarding. Nothing is uploaded.</small>
      <button disabled={busy || blocked} type="submit">{busy ? "Preparing…" : blocked ? "Waiting for notes to save…" : "Download sharing copy"}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}
