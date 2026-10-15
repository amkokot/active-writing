import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

export function PortableAwDownload() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (controller.current && !controller.current.signal.aborted) return;
    const request = new AbortController(); controller.current = request;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/paperfocus/export-aw.zip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: request.signal });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("application/zip")) {
        const message = response.headers.get("Content-Type")?.includes("application/json") ? (await response.json()).error : undefined;
        throw new Error(message ?? "This service needs a safe restart to export Aw. You can also run node scripts/exportAw.mjs without a service.");
      }
      const blob = await response.blob(); if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `active-writing-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (reason) { if (!request.signal.aborted) setError((reason as Error).message); }
    finally { if (!request.signal.aborted) { controller.current = undefined; setBusy(false); } }
  }
  return <details className="portable-aw-download"><summary>Export Aw</summary>
    <small>A clean copy for another computer or a friend. Includes the app, agent guides and tools, plus a fresh example. No private papers, notebooks or accounts.</small>
    <button type="button" disabled={busy} onClick={() => void download()}><Download size={13} /> {busy ? "Preparing Aw…" : "Download Aw ZIP"}</button>
    <small>Recipient needs Node.js 24+. The included setup asks before downloading app dependencies. Personal research backups are separate; see the included transfer guide.</small>
    {error && <p role="alert">{error}</p>}
  </details>;
}
