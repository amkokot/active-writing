import { useEffect, useState } from "react";
import type { ProjectDocument } from "./types";
import { subscribeWindowMessages } from "./windowMessages";
import { manuscriptPurpose } from "./manuscripts";

export function useSourceMonitor(document?: ProjectDocument) {
  const [status, setStatus] = useState<{ projectId: string; revision?: string; rootFile?: string; engine?: string; purpose?: string; overviewTarget?: string; error?: string }>();
  useEffect(() => {
    setStatus(undefined);
    if (!document) return;
    const projectId = document.project.id;
    let cancelled = false; let running = false; let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (cancelled || running) return;
      if (window.document.visibilityState === "hidden") { timer = setTimeout(poll, 12_000); return; }
      running = true;
      try {
        const response = await fetch(`/api/paperfocus/source-status?projectId=${encodeURIComponent(projectId)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Source checking is temporarily unavailable.");
        if (!cancelled && result.projectId === projectId) {
          failures = 0;
          setStatus((previous) => previous?.projectId === projectId && previous.revision === result.revision && previous.rootFile === result.rootFile && previous.engine === result.engine && previous.purpose === result.purpose && previous.overviewTarget === result.overviewTarget && !previous.error
            ? previous : { projectId, revision: result.revision, rootFile: result.rootFile, engine: result.engine, purpose: result.purpose, overviewTarget: result.overviewTarget });
        }
      } catch (error) {
        if (!cancelled && ++failures >= 2) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus((previous) => previous?.projectId === projectId && previous.error === message ? previous : { projectId, error: message });
        }
      } finally { running = false; if (!cancelled) timer = setTimeout(poll, Math.min(60_000, 3_000 * Math.max(1, failures))); }
    }
    const onFocus = () => { clearTimeout(timer); void poll(); };
    const onVisible = () => { if (window.document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus); window.document.addEventListener("visibilitychange", onVisible);
    const unsubscribe = subscribeWindowMessages(message => { if (message.projectId === projectId && message.kind === "source") onFocus(); });
    void poll();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", onFocus); window.document.removeEventListener("visibilitychange", onVisible); };
  }, [document?.project.id, document?.project.mainFile, document?.project.engine, document?.revision, document && manuscriptPurpose(document.project), document?.project.manuscriptOverviewTargets?.[document.project.mainFile]]);
  return { changed: Boolean(document && status?.projectId === document.project.id && status.revision && (status.revision !== document.revision || status.rootFile !== document.project.mainFile || status.engine !== document.project.engine || status.purpose !== undefined && status.purpose !== manuscriptPurpose(document.project) || status.overviewTarget !== undefined && status.overviewTarget !== (document.project.manuscriptOverviewTargets?.[document.project.mainFile] ?? ""))), revision: status?.projectId === document?.project.id ? status?.revision : undefined, error: status?.projectId === document?.project.id ? status?.error : undefined };
}
