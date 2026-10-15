import { useEffect, useState } from "react";
import { subscribeWindowMessages } from "./windowMessages";
import type { ProjectQueueCatalogue } from "./projectQueue";

export function useProjectQueue(projectId: string | undefined, enabled: boolean) {
  const [data, setData] = useState<ProjectQueueCatalogue & { projectId?: string; loading: boolean; error?: string }>({ tasks: [], errors: [], loading: false });
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false, busy = false;
    const controller = new AbortController();
    setData(current => ({ ...current, loading: true, error: undefined }));
    async function refresh() {
      if (cancelled || busy || window.document.hidden) return;
      busy = true;
      try {
        const response = await fetch(`/api/paperfocus/project-queue?excludeProjectId=${encodeURIComponent(projectId!)}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Other projects could not be checked.");
        if (!cancelled) setData({ ...result, projectId, loading: false });
      } catch (error) { if (!cancelled) setData(current => ({ ...current, projectId, loading: false, error: error instanceof Error ? error.message : String(error) })); }
      finally { busy = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus); window.document.addEventListener("visibilitychange", focus);
    const unsubscribe = subscribeWindowMessages(message => { if (message.projectId !== projectId && ["workbench", "notebook"].includes(message.kind)) void refresh(); });
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); window.removeEventListener("focus", focus); window.document.removeEventListener("visibilitychange", focus); unsubscribe(); };
  }, [projectId, enabled]);
  return { tasks: enabled ? data.tasks.filter(task => task.projectId !== projectId) : [], loading: enabled && (data.projectId !== projectId || data.loading), error: enabled ? data.error ?? (data.errors.length ? `${data.errors.length} ${data.errors.length === 1 ? "project" : "projects"} could not be checked.` : undefined) : undefined };
}
