import { useEffect, type RefObject } from "react";
import { parseReadingPosition, readingPositionKey } from "./readingPosition";
import { windowStateCache } from "./windowCache";
import { readingPaneVisible } from "./editorGeometry";

/** Cheap, window-local view checkpoints. Never write manuscript/notebook files. */
export function useSavedReadingPosition(ref: RefObject<HTMLElement | null>, identity?: { key: string; revision: string }, enabled = true) {
  useEffect(() => {
    const pane = ref.current; if (!pane || !identity || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = readingPositionKey(identity.key);
    let pending: ReturnType<typeof parseReadingPosition>;
    let visiblePosition: {top:number;left:number} | undefined;
    try { const saved = parseReadingPosition(windowStateCache().read(key)); if (saved?.revision === identity.revision) pending = saved; } catch { /* optional recovery */ }
    const save = () => {
      clearTimeout(timer);
      if (pending) return;
      if (pane.isConnected && readingPaneVisible(pane)) visiblePosition = { top: pane.scrollTop, left: pane.scrollLeft };
      if (!visiblePosition) return;
      try { const value = JSON.stringify({ ...visiblePosition, revision: identity.revision }); windowStateCache().writeSnapshot(key, value, value); } catch { /* Work saves independently. */ }
    };
    const restore = () => {
      if (!pending || !readingPaneVisible(pane)) return;
      // Lazy math/conversations may not have their final height yet.
      if (pending.top > pane.scrollHeight - pane.clientHeight + 2) return;
      pane.scrollTop = pending.top; pane.scrollLeft = pending.left; pending = undefined;
      visiblePosition = { top: pane.scrollTop, left: pane.scrollLeft };
    };
    const observer = new MutationObserver(restore); observer.observe(pane, { childList: true, subtree: true });
    const size = new ResizeObserver(restore); size.observe(pane);
    const stop = () => { pending = undefined; observer.disconnect(); size.disconnect(); };
    const expire = setTimeout(() => { if (pending && readingPaneVisible(pane)) { pane.scrollTop = pending.top; pane.scrollLeft = pending.left; } stop(); }, 1800);
    restore();
    if (!pending && readingPaneVisible(pane)) visiblePosition = { top: pane.scrollTop, left: pane.scrollLeft };
    const scrolled = () => { if (!pending && readingPaneVisible(pane)) { visiblePosition = { top: pane.scrollTop, left: pane.scrollLeft }; clearTimeout(timer); timer = setTimeout(save, 300); } };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    pane.addEventListener("scroll", scrolled, { passive: true });
    for (const event of ["wheel", "pointerdown", "keydown", "touchmove"]) pane.addEventListener(event, stop, { passive: true });
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { save(); clearTimeout(expire); stop(); pane.removeEventListener("scroll", scrolled); for (const event of ["wheel", "pointerdown", "keydown", "touchmove"]) pane.removeEventListener(event, stop); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, [ref, identity?.key, identity?.revision, enabled]);
}
