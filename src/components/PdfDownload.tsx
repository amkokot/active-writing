import { useEffect, useRef, useState } from "react";
import type { CompileResult } from "../types";
import { compiledPdfDownloadUrl, pdfDownloadName } from "../pdfLinks";

export function PdfDownload({ result, projectId, projectName, mainFile, stale }: { result?: CompileResult; projectId: string; projectName: string; mainFile: string; stale: boolean }) {
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const url = result?.success && (!result.mainFile || result.mainFile === mainFile) ? compiledPdfDownloadUrl(result.pdfUrl, projectId, window.location.origin) : undefined;
  const suggested = pdfDownloadName("", projectName, result?.mainFile ?? mainFile, result?.mode === "focus");
  async function download() {
    if (!url || busy) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/pdf")) throw new Error("PDF unavailable. Compile it again before downloading.");
      const blob = await response.blob();
      if (request.signal.aborted) return;
      if (!blob.size) throw new Error("The compiled PDF is empty. Compile it again.");
      const objectUrl = URL.createObjectURL(blob), link = window.document.createElement("a");
      link.href = objectUrl; link.download = pdfDownloadName(name, projectName, result?.mainFile ?? mainFile, result?.mode === "focus");
      window.document.body.append(link); link.click(); link.remove();
      // Allow the browser to consume the download before releasing its bytes.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) setBusy(false); }
  }
  if (!url) return <button disabled><strong>Download PDF</strong><small>Compile a PDF first</small></button>;
  return <details className="pdf-download"><summary>Download PDF…</summary>
    <form onSubmit={event => { event.preventDefault(); void download(); }}>
      <label>Filename (optional)<input aria-label="PDF filename (optional)" placeholder={suggested} value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={busy} /></label>
      <button type="submit" disabled={busy}>{busy ? "Preparing…" : "Download"}</button>
      <small>{result?.mode === "focus" ? "Focused build, not the full paper." : "Complete compiled PDF, including pages hidden in this view."} {stale && "Saved PDF predates current edits; compile first to include them."}</small>
      {error && <p role="alert">{error}</p>}
    </form>
  </details>;
}
