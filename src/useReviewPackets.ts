import { useEffect } from "react";
import type { AppState } from "./types";
import type { Dispatch, SetStateAction } from "react";
import { fingerprint } from "./rewrite";

/** File-only postprocessing after a valid import; never starts an assistant or resolves a comment. */
export function useReviewPackets(projectId: string | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>) {
  const tasks = state.attentionTasks.filter(t => t.review?.kind === "request" && t.ticket && t.status === "ready" && t.reply?.trim() && !t.review.completedPath);
  const key = tasks.map(t => `${t.id}:${fingerprint(t.reply!)}`).sort().join(",");
  useEffect(() => {
    if (!projectId || !key) return;
    let cancelled = false;
    void Promise.all(tasks.map(async task => {
      try {
        const response = await fetch("/api/paperfocus/review/annotated", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, id: task.id, reply: task.reply }) });
        const result = await response.json();
        if (cancelled) return;
        setState(current => ({ ...current, attentionTasks: current.attentionTasks.map(t => t.id === task.id && t.reply === task.reply && t.review?.kind === "request" ? { ...t, review: { ...t.review, ...(response.ok ? { completedPath: result.path } : {}) }, error: response.ok ? undefined : result.error } : t) }));
      } catch { /* Saved replies/comments remain available even if their text packet couldn't be written. */ }
    }));
    return () => { cancelled = true; };
  }, [projectId, key, setState]);
}
