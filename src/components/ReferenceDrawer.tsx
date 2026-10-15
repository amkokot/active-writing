import { lazy, Suspense, useEffect, useState } from "react";
import { Download, ExternalLink, FileUp, Link2, LoaderCircle, MapPin, X } from "lucide-react";
import type { DocumentLabel, ProjectDocument, ReferenceCopy, ReferenceRequest } from "../types";
import { safeLink } from "../references";

const PdfViewer = lazy(() => import("./PdfViewer").then((module) => ({ default: module.PdfViewer })));
interface Props { document: ProjectDocument; request: ReferenceRequest; onClose: () => void; onJump: (label: DocumentLabel) => void }

export function ReferenceDrawer({ document, request, onClose, onJump }: Props) {
  const [key, setKey] = useState(request.token.keys[0] ?? "");
  const [locator, setLocator] = useState(request.token.locator ?? "");
  const [copies, setCopies] = useState<Record<string, ReferenceCopy>>({});
  const [pdfFiles, setPdfFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [page, setPage] = useState(1);
  const [initialPage, setInitialPage] = useState(1);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const entry = document.citations?.find((item) => item.key === key);
  const copy = copies[key];
  const labels = document.labels?.filter((label) => label.key === key) ?? [];
  const projectId = document.project.id;

  useEffect(() => {
    let cancelled = false;
    setCopies({}); setPdfFiles([]); setError(undefined);
    void fetch(`/api/paperfocus/references?projectId=${encodeURIComponent(projectId)}`)
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then((result) => { if (!cancelled) { setCopies(result.copies); setPdfFiles(result.pdfFiles); } })
      .catch((reason) => { if (!cancelled) setError(String(reason.message ?? reason)); });
    return () => { cancelled = true; };
  }, [projectId]);
  useEffect(() => { setKey(request.token.keys[0] ?? ""); setLocator(request.token.locator ?? ""); setError(undefined); setMessage(undefined); }, [request]);
  useEffect(() => { setInitialPage(copy?.pages[locator.trim()] ?? 1); }, [key, copy?.filename, copies, locator]);
  useEffect(() => { setDetailsExpanded(!copy); }, [key, Boolean(copy)]);

  async function action(payload: Record<string, unknown>) {
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      const response = await fetch("/api/paperfocus/references", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, key, ...payload }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setCopies((previous) => ({ ...previous, [key]: result.copy }));
      if (payload.action === "location") setMessage(`Remembered page ${page}${locator ? ` for ${locator}` : " as the starting page"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  async function attachLocal(file: File) {
    setBusy(true); setError(undefined); setMessage(undefined);
    try {
      if (file.size > 40_000_000) throw new Error("Choose a PDF smaller than 40 MB.");
      const params = new URLSearchParams({ projectId, key, name: file.name });
      const response = await fetch(`/api/paperfocus/references/upload?${params}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setCopies((previous) => ({ ...previous, [key]: result.copy }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const links = [{ label: "arXiv", url: entry?.arxivId ? `https://arxiv.org/abs/${entry.arxivId}` : undefined },
    { label: "DOI", url: entry?.doi ? safeLink(`https://doi.org/${entry.doi}`) : undefined }, { label: "Publisher / source", url: safeLink(entry?.url) }];
  return <section className="reference-drawer" aria-label="References">
    <header><span><Link2 size={16} /> References</span><div className="reference-header-actions">{copy && request.token.kind === "citation" && <button className="reference-details-toggle" aria-expanded={detailsExpanded} onClick={() => setDetailsExpanded((value) => !value)}>{detailsExpanded ? "Hide paper details" : "Paper details"}</button>}<button aria-label="Close references" onClick={onClose}><X size={17} /></button></div></header>
    <div className="reference-details">
      {(!copy || detailsExpanded) && <p className="reference-hint">Ctrl/Cmd-click or right-click a LaTeX reference. Source commands stay editable and unchanged.</p>}
      {request.token.keys.length > 1 && <label>Choose {request.token.kind === "citation" ? "citation" : "reference"}<select aria-label="Choose reference" disabled={busy} value={key} onChange={(event) => { setKey(event.target.value); setMessage(undefined); }}>
        {request.token.keys.map((item) => <option key={item} value={item}>{item}{request.token.kind === "citation" ? ` · ${document.citations?.find((citation) => citation.key === item)?.title ?? "No bibliography entry"}` : ""}</option>)}
      </select></label>}
      {request.token.kind === "label" ? <>
        <h2>{key}</h2>
        {labels.length > 1 && <p className="reference-warning">This label is defined more than once. Choose the intended target and fix the duplicate in the source.</p>}
        {labels.length ? labels.map((label, index) => <button className="reference-target-button" key={`${label.file}:${label.line}:${index}`} onClick={() => onJump(label)}><strong>{document.nodes.find((node) => node.id === label.nodeId)?.title ?? key}</strong><small>{label.file}:{label.line}</small><span>Go to source →</span></button>) : <p>No label found in this paper's included files. Check its spelling or reload after an edit.</p>}
      </> : request.token.kind === "url" ? <>
        <h2>External link</h2>{safeLink(key) ? <a className="reference-external" href={safeLink(key)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> {key}</a> : <p>This URL is not a supported web or email link.</p>}
      </> : <>
        {copy && !detailsExpanded && <div className="reference-compact-summary"><small>{key}</small><p title={entry?.title}>{entry?.title ?? "Cited paper"}</p></div>}
        {(!copy || detailsExpanded) && <>
        <small className="reference-key">{key}</small><h2>{entry?.title ?? "Cited paper"}</h2>
        {entry?.author && <p className="reference-author">{entry.author.replace(/[{}]/g, "")} {entry.year && `· ${entry.year}`}</p>}
        {!entry && <p>No .bib entry was found for this key. You can still attach its PDF locally.</p>}
        <div className="reference-actions">{links.filter((link) => link.url).map((link) => <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{link.label}</a>)}</div>
        <div className="reference-actions">
          <label className={`reference-upload ${busy ? "is-disabled" : ""}`}><FileUp size={14} />{copy ? "Replace local PDF" : "Attach local PDF"}<input aria-label="Attach cited paper PDF" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void attachLocal(file); event.target.value = ""; }} /></label>
          {entry?.arxivId && <button disabled={busy} onClick={() => void action({ action: "arxiv", arxivId: entry.arxivId })}><Download size={14} />{copy ? "Refresh from arXiv" : "Fetch arXiv PDF"}</button>}
        </div>
        {!copy && pdfFiles.length > 0 && <div className="reference-project-file"><select aria-label="Choose project PDF" disabled={busy} value={selectedFile} onChange={(event) => setSelectedFile(event.target.value)}><option value="">Or choose a PDF already in this project…</option>{pdfFiles.map((file) => <option key={file}>{file}</option>)}</select><button disabled={busy || !selectedFile} onClick={() => void action({ action: "attach", file: selectedFile })}>Attach</button></div>}
        <p className="reference-privacy">PDF copies and saved locations stay in the local, Git-ignored cache. Fetching from arXiv sends only its public paper ID.</p>
        </>}
        {!copy && <label>Result or passage<input aria-label="Cited result or passage" placeholder="Theorem 2.3, Section 4, or a distinctive phrase" value={locator} onChange={(event) => setLocator(event.target.value)} /></label>}
        {copy && Object.keys(copy.pages).some(Boolean) && <label className="reference-saved-locations">Saved locations<select aria-label="Saved reference locations" value={Object.hasOwn(copy.pages, locator) ? locator : ""} onChange={(event) => { if (event.target.value) setLocator(event.target.value); }}><option value="">Choose a saved result…</option>{Object.entries(copy.pages).filter(([name]) => name).map(([name, page]) => <option key={name} value={name}>{name} · page {page}</option>)}</select></label>}
        {copy && <div className="reference-location"><span>{copy.name}</span><button disabled={busy} onClick={() => void action({ action: "location", locator, page })}><MapPin size={13} /> Remember page {page}</button></div>}
      </>}
      {busy && <p role="status"><LoaderCircle className="spin" size={13} /> Working locally…</p>}
      {error && <p className="reference-warning" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
    {request.token.kind === "citation" && copy && <Suspense fallback={<div className="pdf-loading">Loading cited paper…</div>}><PdfViewer key={key} url={`/api/paperfocus/references/pdf?projectId=${encodeURIComponent(projectId)}&key=${encodeURIComponent(key)}&v=${copy.filename}`} initialPage={initialPage} initialSearch={locator} onPageChange={setPage} onSearchChange={setLocator} alwaysShowSearch /></Suspense>}
  </section>;
}
