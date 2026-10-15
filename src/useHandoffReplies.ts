import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState } from "./types";
import { receiveHandoffReply, refreshHandoffTicket } from "./handoffs";

export function useHandoffReplies(projectId: string | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>) {
  const key = state.attentionTasks.filter((task) => task.ticket?.transport === "files" && ["queued", "working"].includes(task.status)).map((task) => `${task.id}:${task.ticket!.id}`).sort().join(",");
  useEffect(() => {
    if (!projectId || !key) return;
    let cancelled = false; let polling = false;
    async function poll() {
      if (polling) return;
      polling = true;
      try {
        const results = await Promise.all(key.split(",").map(async (pair) => {
          const [taskId, id] = pair.split(":");
          const response = await fetch(`/api/paperfocus/handoff/status?projectId=${encodeURIComponent(projectId!)}&id=${encodeURIComponent(id)}`);
          const result = await response.json();
          return { taskId, ...(response.ok ? result : { status: "pending", note: result.error }) };
        }));
        if (cancelled) return;
        setState((current) => results.reduce((updated: AppState, result) => {
          if (result.ticket) updated = refreshHandoffTicket(updated, result.taskId, result.ticket);
          const task = updated.attentionTasks.find((task) => task.id === result.taskId);
          if (result.status === "ready" && result.id === task?.ticket?.id && result.requestHash === task?.ticket?.requestHash) return receiveHandoffReply(updated, result.taskId, result.reply, result.replyHash);
          if (result.status === "ready") result.note = "The saved request changed; this reply was not imported. Original findings remain retained.";
          if (!task || task.status === "reviewed" || task.error === result.note) return updated;
          return { ...updated, attentionTasks: updated.attentionTasks.map((task) => task.id === result.taskId ? { ...task, error: result.note } : task) };
        }, current));
      } catch { /* Quiet retry on reconnect; no remote request is ever submitted. */ }
      finally { polling = false; }
    }
    void poll(); const timer = window.setInterval(() => void poll(), 2500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [projectId, key, setState]);
}
