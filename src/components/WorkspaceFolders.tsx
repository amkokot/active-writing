import { useEffect, useId, useRef, useState } from "react";
import { Copy, FolderOpen, House, Link2 } from "lucide-react";
import { useDismissibleLayer } from "../useDismissibleLayer";
import { workspaceNote, type WorkspaceFolders as Folders } from "../workspaceFolders";
import { PortableAwDownload } from "./PortableAwDownload";
import { DeviceSyncPreparation } from "./DeviceSyncPreparation";

export function WorkspaceFolders({ projectId, onSaveDrafts }: { projectId?: string; onSaveDrafts?: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<Folders>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [opening, setOpening] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismissibleLayer(open, root, () => setOpen(false), "button");
  const current = folders && (folders.paper?.id ?? undefined) === projectId ? folders : undefined;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setFolders(undefined); setError(""); setNotice("");
    void (async () => {
      const response = await fetch(`/api/paperfocus/workspace-folders${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Folders are unavailable.");
      if (!controller.signal.aborted) setFolders(data);
    })().catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [open, projectId]);

  async function copy(text: string, label: string) {
    setNotice(""); setError("");
    try { await navigator.clipboard.writeText(text); setNotice(`${label} copied.`); }
    catch { setError("Clipboard unavailable. Select and copy the path below."); }
  }
  async function reveal(target: "home" | "paper" | "data") {
    setOpening(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/paperfocus/workspace-folders/open", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, target }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The folder could not be opened.");
      setNotice("Opened in File Explorer.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setOpening(false); }
  }
  function folder(label: string, value: Folders["home"], target: "home" | "paper" | "data") {
    return <section className="workspace-folder-card" key={target}>
      <strong>{label}</strong><code tabIndex={0}>{value.path}</code>
      <div><button disabled={opening || !current?.canOpen} onClick={() => void reveal(target)}><FolderOpen size={13} /> Open</button>
        <button onClick={() => void copy(value.path, `${label} path`)}><Copy size={13} /> Copy path</button>
        <button onClick={() => void copy(value.link, `${label} link`)} title="Local file link; supported clients only"><Link2 size={13} /> Copy link</button></div>
    </section>;
  }
  return <div className="workspace-folders" ref={root}>
    <button className="folder-access-trigger" type="button" aria-label="Workspace folders" title="Workspace paths · open folders or copy a chat workspace path" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><House size={17} /></button>
    {open && <div id={id} className="workspace-folders-panel" aria-label="Workspace folders">
      <header><strong>Workspace folders</strong><small>Choose this folder in your other app.</small></header>
      {current ? <>{current.paper && folder("Paper repository", current.paper, "paper")}{current.data && folder("Aw files · this paper", current.data, "data")}{folder("Aw home", current.home, "home")}
        <button className="workspace-note-copy" onClick={() => void copy(workspaceNote(current), "Workspace note")}><Copy size={13} /> Copy workspace note for a chat</button>
        <small>Paths set the workspace; links work only in clients that allow local files. Nothing is connected or sent automatically.</small>
      </> : !error && <p role="status">Finding folders…</p>}
      {notice && <p role="status" className="workspace-folder-notice">{notice}</p>}
      {error && <p role="alert" className="workspace-folder-error">{error}</p>}
      <PortableAwDownload />
      <DeviceSyncPreparation projectId={projectId} onSaveDrafts={onSaveDrafts} />
    </div>}
  </div>;
}
