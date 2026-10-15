import { useEffect } from "react";
import { useStableEvent } from "./useStableEvent";
import { subscribeWindowMessages } from "./windowMessages";

/** Notifications carry no paper content; guarded disk stores remain the authority. */
export function useSharedStorePoll(projectId: string | undefined, kind: "notebook" | "workbench", ready: boolean, read: () => Promise<void>) {
  const poll = useStableEvent(read);
  useEffect(() => {
    if (!projectId || !ready) return;
    let cancelled = false, running = false, failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (cancelled || running) return;
      clearTimeout(timer);
      if (window.document.visibilityState === "hidden") { timer = setTimeout(check, 30_000); return; }
      running = true;
      try { await poll(); failures = 0; } catch { failures++; /* Own drafts are never replaced on a failed read. */ }
      finally { running = false; if (!cancelled) timer = setTimeout(check, Math.min(60_000, 12_000 * Math.max(1, failures))); }
    };
    const wake = () => { if (!cancelled) void check(); };
    const unsubscribe = subscribeWindowMessages(message => { if (message.projectId === projectId && message.kind === kind) wake(); });
    window.addEventListener("focus", wake); window.document.addEventListener("visibilitychange", wake);
    timer = setTimeout(check, 12_000);
    return () => { cancelled = true; clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", wake); window.document.removeEventListener("visibilitychange", wake); };
  }, [projectId, kind, ready, poll]);
}
