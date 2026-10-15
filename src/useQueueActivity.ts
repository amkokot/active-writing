import { useEffect, type Dispatch, type SetStateAction } from "react";
import { touchQueueActivity } from "./attention";
import type { AppState } from "./types";

/** Wait for both task stores, so a returning-project reset includes notebook work. */
export function useQueueActivity(projectId: string | undefined, ready: boolean, setState: Dispatch<SetStateAction<AppState>>) {
  useEffect(() => {
    if (!projectId || !ready) return;
    const touch = (event?: Event) => {
      if (document.visibilityState !== "visible" || event && !event.isTrusted) return;
      setState(current => touchQueueActivity(current));
    };
    touch();
    const visibility = () => { if (document.visibilityState === "visible") touch(); };
    for (const name of ["pointerdown", "keydown", "wheel"]) document.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", touch);
    return () => {
      for (const name of ["pointerdown", "keydown", "wheel"]) document.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", touch);
    };
  }, [projectId, ready, setState]);
}
