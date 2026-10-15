import { useEffect, useRef, useState } from "react";
import type { ProjectDocument } from "../types";
import { pdfDownloadName } from "../pdfLinks";

export function SourceZipDownload({ projectId, onSave }: { projectId: string; onSave: () => Promise<ProjectDocument> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      const saved = await onSave();
      if (request.signal.aborted) return;
      if (saved.project.id !== projectId) throw new Error("The project changed. Open its download menu again.");
      const response = await fetch(`/api/paperfocus/source.zip?projectId=${encodeURIComponent(projectId)}`, { signal: request.signal });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/zip")) {
        const message = response.headers.get("Content-Type")?.includes("application/json") ? (await response.json()).error : undefined;
        throw new Error(message ?? "Source ZIP export needs the updated Aw server. Restart after experiments finish.");
      }
      const blob = await response.blob();
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = window.document.createElement("a");
      link.href = url; link.download = pdfDownloadName("", saved.project.name, "main.tex").replace(/\.pdf$/i, ".zip");
      window.document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <div className="source-zip-download"><button disabled={busy} onClick={() => void download()}><strong>{busy ? "Preparing ZIP…" : "Download source ZIP"}</strong><small>Project files · no Aw notes or build files</small></button>{error && <small role="alert">{error}</small>}</div>;
}
