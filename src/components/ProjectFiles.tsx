import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Copy, File, FileImage, FileText, FolderOpen, Plus, Upload, X } from "lucide-react";
import { prepareProjectUploads, projectFileCommand, projectFileKind, type ProjectFilePreview, type ProjectUpload } from "../projectFiles";
import type { ProjectDocument } from "../types";

const PdfViewer = lazy(() => import("./PdfViewer").then(module => ({ default: module.PdfViewer })));

export function FilePickerButtons({ disabled, onPick, fileLabel = "Add files", folderLabel = "Add folder" }: { disabled: boolean; onPick: (files: File[]) => void; fileLabel?: string; folderLabel?: string }) {
  const fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null);
  const picked = (input: HTMLInputElement) => { const files = [...(input.files ?? [])]; input.value = ""; if (files.length) onPick(files); };
  return <>
    <input hidden type="file" multiple ref={fileInput} onChange={event => picked(event.target)} />
    <input hidden type="file" multiple ref={input => { folderInput.current = input; input?.setAttribute("webkitdirectory", ""); }} onChange={event => picked(event.target)} />
    <button type="button" className="secondary-button" disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={13} />{fileLabel}</button>
    <button type="button" className="secondary-button" disabled={disabled} onClick={() => folderInput.current?.click()}><FolderOpen size={13} />{folderLabel}</button>
  </>;
}

interface Props {
  document: ProjectDocument;
  busy: boolean;
  onOpenFile: (file: string, raw?: boolean) => void | Promise<void>;
  onAdd: (files: ProjectUpload[], skipped: number) => Promise<void>;
  perform: (label: string, action: () => Promise<void>) => Promise<void>;
}

export function ProjectFiles({ document, busy, onOpenFile, onAdd, perform }: Props) {
  const [query, setQuery] = useState(""), [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string>(), [preview, setPreview] = useState<ProjectFilePreview>();
  const [previewError, setPreviewError] = useState<string>(), [copyNotice, setCopyNotice] = useState<string>();
  const [newFile, setNewFile] = useState<string>(), [dragging, setDragging] = useState(false);
  const [imageSize, setImageSize] = useState("");
  const commandFor = (file: string) => file === document.project.mainFile || document.rootFiles.includes(file) ? undefined : projectFileCommand(file);
  const contentUrl = (file: string) => `/api/paperfocus/files/content?projectId=${encodeURIComponent(document.project.id)}&file=${encodeURIComponent(file)}&revision=${document.revision}`;
  useEffect(() => {
    setPreview(undefined); setPreviewError(undefined); setImageSize("");
    if (!selected) return;
    const controller = new AbortController();
    void fetch(`/api/paperfocus/files?projectId=${encodeURIComponent(document.project.id)}&file=${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not preview this file."); return result as ProjectFilePreview; })
      .then(result => { if (!controller.signal.aborted) setPreview(result); })
      .catch(error => { if (!controller.signal.aborted) setPreviewError(error.message); });
    return () => controller.abort();
  }, [selected, document.project.id, document.revision]);
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyNotice("Copied."); }
    catch { setCopyNotice("Clipboard unavailable. Select and copy the path below."); }
  }
  const add = (files: File[]) => { void perform("Adding files…", async () => { const uploads = await prepareProjectUploads(files); await onAdd(uploads.files, uploads.skipped); }); };
  const files = [...document.files].sort((a, b) => a === document.project.mainFile ? -1 : b === document.project.mainFile ? 1 : a.localeCompare(b))
    .filter(file => file.toLowerCase().includes(query.trim().toLowerCase()) && (filter === "all" || (filter === "figures" ? ["image", "pdf"].includes(projectFileKind(file)) || /\.(svg|eps)$/i.test(file) : filter === "tex" ? projectFileKind(file) === "tex" : !["tex", "image", "pdf"].includes(projectFileKind(file)))));
  const command = selected ? commandFor(selected) : undefined;
  return <section className={`project-files${dragging ? " is-dragging" : ""}`} aria-label="Project files"
    onDragOver={event => { if (!busy && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); if (!busy && event.dataTransfer.files.length) add([...event.dataTransfer.files]); }}>
    <div className="project-files-toolbar"><strong>Files <small>{document.files.length}</small></strong><div>
      <button className="secondary-button" disabled={busy} onClick={() => setNewFile(newFile === undefined ? "sections/new.tex" : undefined)}><Plus size={13} />New file</button>
      <FilePickerButtons disabled={busy} onPick={add} />
    </div></div>
    {newFile !== undefined && <form className="project-new-file" onSubmit={event => { event.preventDefault(); void perform("Creating file…", async () => {
      if (!/\.(tex|bib|sty|cls|txt|md)$/i.test(newFile)) throw new Error("Choose a text file, such as sections/related.tex. Use Add files for images and PDFs.");
      await onAdd([{ path: newFile.trim(), data: btoa("\n") }], 0); setNewFile(undefined);
    }); }}><input autoFocus aria-label="New file path" placeholder="sections/related.tex" value={newFile} disabled={busy} onChange={event => setNewFile(event.target.value)} /><button className="secondary-button" disabled={busy || !newFile.trim()}>Create</button><button type="button" className="icon-button" disabled={busy} aria-label="Cancel new file" onClick={() => setNewFile(undefined)}><X size={14} /></button></form>}
    <div className="project-files-search"><input aria-label="Find a file" placeholder="Find a file…" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="File type" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All files</option><option value="tex">TeX</option><option value="figures">Figures / PDFs</option><option value="other">Other</option></select></div>
    <div className="project-file-list">{files.map(file => {
      const kind = projectFileKind(file), fileCommand = commandFor(file), name = file.split("/").at(-1), parent = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
      const Icon = kind === "image" || kind === "pdf" ? FileImage : kind === "tex" || kind === "text" ? FileText : File;
      return <div key={file} className={selected === file ? "is-selected" : ""}>
        <button className="project-file-open" disabled={busy} title={kind === "tex" ? `Edit ${file}` : `Preview ${file}`} onClick={() => { if (kind === "tex") void onOpenFile(file, true); else { setSelected(file); setCopyNotice(undefined); } }}><Icon size={15} /><span>{name}<small>{parent}{parent && file === document.project.mainFile ? " · " : ""}{file === document.project.mainFile ? "Main file" : !parent ? kind === "tex" ? "TeX source" : kind === "pdf" ? "PDF" : kind === "image" ? "Image" : "Project file" : ""}</small></span></button>
        <button className="project-file-copy icon-button" aria-label={`${fileCommand ? "Copy LaTeX command" : "Copy path"} for ${file}`} title={fileCommand ?? file} onClick={() => { setSelected(file); void copy(fileCommand ?? file); }}><Copy size={12} /></button>
      </div>;
    })}{!files.length && <p>No matching files.</p>}</div>
    <p className="repository-hint project-files-hint">Click TeX to edit; other files to preview. Drop files here to add them. Existing files stay untouched.</p>
    {selected && <div className="project-file-preview"><div className="project-file-preview-heading"><code>{selected}</code><button className="icon-button" aria-label="Close file preview" onClick={() => setSelected(undefined)}><X size={14} /></button></div>
      {previewError && <p role="alert">{previewError}</p>}
      {!preview && !previewError && <p role="status">Loading preview…</p>}
      {preview && <>
        <small>{(preview.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB{imageSize && ` · ${imageSize}`}</small>
        {preview.kind === "image" && <img src={contentUrl(selected)} alt={selected} onLoad={event => setImageSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)} onError={() => setPreviewError("This image could not be previewed.")} />}
        {preview.kind === "pdf" && <div className="project-file-preview-pdf"><Suspense fallback={<p>Opening PDF…</p>}><PdfViewer url={contentUrl(selected)} /></Suspense></div>}
        {preview.text !== undefined && <pre className="project-file-text">{preview.text}</pre>}
        {preview.truncated && <p>Preview shortened to 128 KB. The original file is unchanged.</p>}
        {preview.kind === "other" && <p>Open this file from the paper folder to inspect its contents.</p>}
        <div className="project-file-preview-actions"><button className="secondary-button" onClick={() => void copy(selected)}><Copy size={12} />Copy path</button>{command && <button className="secondary-button" onClick={() => void copy(command)}><Copy size={12} />Copy LaTeX</button>}{preview.kind === "tex" && <button className="secondary-button" disabled={busy} onClick={() => void onOpenFile(selected, true)}>Edit source</button>}</div>
        {command && <pre className="project-file-command">{command}</pre>}
      </>}
      {copyNotice && <small role="status">{copyNotice}</small>}
    </div>}
  </section>;
}
