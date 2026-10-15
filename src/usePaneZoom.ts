import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { clampPaneZoom, loadPaneZoom, paneZoomKey, savePaneZoom, wheelPaneZoom } from "./paneZoom";

export function useStoredPaneZoom(key: string) {
  const [zoom, setZoom] = useState(() => {
    try { return loadPaneZoom(key, window.sessionStorage.getItem(`active-writing.zoom.${key}`) !== null ? window.sessionStorage : window.localStorage); } catch { return 1; }
  });
  useEffect(() => { try { savePaneZoom(key, zoom, window.sessionStorage); savePaneZoom(key, zoom, window.localStorage); } catch { /* Optional preference storage. */ } }, [key, zoom]);
  useEffect(() => {
    const receive = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.key === key && typeof detail.zoom === "number" && Number.isFinite(detail.zoom)) setZoom(clampPaneZoom(detail.zoom)); };
    window.addEventListener("active-writing-pane-zoom", receive);
    return () => window.removeEventListener("active-writing-pane-zoom", receive);
  }, [key]);
  const updateZoom = useCallback((value: number) => {
    const next = clampPaneZoom(value); setZoom(next);
    // Same-window views/settings share this preference; other windows stay independent.
    try { savePaneZoom(key, next, window.sessionStorage); savePaneZoom(key, next, window.localStorage); } catch { /* Optional storage. */ }
    window.dispatchEvent(new CustomEvent("active-writing-pane-zoom", { detail: { key, zoom: next } }));
  }, [key]);
  return [zoom, updateZoom] as const;
}

/** Native non-passive listeners stop browser zoom; ordinary scrolling is untouched. */
export function usePaneZoomGestures(ref: RefObject<HTMLElement | null>, zoom: number, onZoom: (zoom: number) => void, anchorContent = true) {
  const live = useRef({ zoom, onZoom });
  const anchor = useRef<{ x: number; y: number; localX: number; localY: number } | undefined>(undefined);
  useLayoutEffect(() => {
    live.current = { zoom, onZoom };
    const scroll = ref.current, point = anchor.current;
    const content = scroll?.querySelector<HTMLElement>(".pane-zoom-content");
    if (point && scroll && content) {
      const rect = content.getBoundingClientRect();
      scroll.scrollLeft += rect.left + point.localX * zoom - point.x;
      scroll.scrollTop += rect.top + point.localY * zoom - point.y;
      anchor.current = undefined;
    }
  }, [zoom, onZoom, ref]);
  useEffect(() => {
    const scroll = ref.current; if (!scroll) return;
    let frame = 0, queued = live.current.zoom;
    const change = (next: number, x: number, y: number) => {
      const bounded = clampPaneZoom(next);
      if (!frame && bounded === live.current.zoom) { anchor.current = undefined; return; }
      if (anchorContent) {
        const content = scroll.querySelector<HTMLElement>(".pane-zoom-content");
        if (content) {
          const rect = content.getBoundingClientRect();
          anchor.current = { x, y, localX: (x - rect.left) / live.current.zoom, localY: (y - rect.top) / live.current.zoom };
        }
      }
      queued = bounded;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (queued === live.current.zoom) anchor.current = undefined;
        else live.current.onZoom(queued);
      });
    };
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || !Number.isFinite(event.deltaY)) return;
      event.preventDefault(); event.stopPropagation();
      change(wheelPaneZoom(frame ? queued : live.current.zoom, event.deltaY, event.deltaMode), event.clientX, event.clientY);
    };
    const key = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      const action = paneZoomKey(event.key); if (!action) return;
      event.preventDefault(); event.stopPropagation();
      const rect = scroll.getBoundingClientRect();
      const current = frame ? queued : live.current.zoom;
      change(action === "reset" ? 1 : current * (action === "in" ? 1.1 : 1 / 1.1), rect.left + rect.width / 2, rect.top + rect.height / 2);
    };
    scroll.addEventListener("wheel", wheel, { passive: false });
    scroll.addEventListener("keydown", key);
    return () => { cancelAnimationFrame(frame); scroll.removeEventListener("wheel", wheel); scroll.removeEventListener("keydown", key); };
  }); // Rebind when conditional content (empty editor / reading view / PDF) mounts.
}
