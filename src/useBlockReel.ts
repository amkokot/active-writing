import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Paragraph } from "./types";
import { reelCandidate, reelRange } from "./blockReel";
import { useStableEvent } from "./useStableEvent";

export interface ReelWindow {
  activeId?: string; index: number; radius: number; available: Paragraph[];
  paragraphs: Paragraph[]; before: number; after: number; blocked: boolean;
}

/** A bounded strip with keyed editors, not a full-document hidden DOM. */
export function useBlockReel(ref: RefObject<HTMLDivElement | null>, window: ReelWindow | undefined,
  blocked: boolean, jumpSequence: number | undefined, zoom: number, onFocus?: (id: string) => void) {
  const [protectedId, setProtectedId] = useState<string>();
  const range = window ? reelRange(window.available.length, window.before, window.paragraphs.length) : undefined;
  const mounted = useMemo(() => {
    if (!window || !range) return [];
    const items = window.available.slice(range.start, range.end);
    const protectedBlock = window.available.find(p => p.id === protectedId);
    // A focused offscreen editor stays keyed and hidden until focus leaves it.
    // It does not enlarge the contiguous buffer or the compile selection.
    if (protectedBlock && !items.some(p => p.id === protectedId)) items.push(protectedBlock);
    return items;
  }, [window?.available, range?.start, range?.end, protectedId]);
  const anchor = useRef<{ id: string; offset: number } | undefined>(undefined);
  const previous = useRef<{ enabled: boolean; key: string }>({ enabled: false, key: "" });
  const manualUntil = useRef(0);
  const frame = useRef(0);
  const promoting = useRef<string | undefined>(undefined);
  const key = `${range?.start}:${range?.end}:${mounted.map(p => p.id).join(",")}`;
  const focus = useStableEvent((id: string) => {
    if (!window || blocked || window.blocked || !globalThis.window.getSelection()?.isCollapsed || id === window.activeId || promoting.current === id) return;
    promoting.current = id; onFocus?.(id);
  });
  const capture = useStableEvent((promote: boolean) => {
    const pane = ref.current; if (!pane || !window) return;
    const paneTop = pane.getBoundingClientRect().top;
    const boxes = [...pane.querySelectorAll<HTMLElement>('[data-reel-paragraph]:not([data-reel-held="true"])')]
      .map(element => ({ id: element.dataset.reelParagraph!, top: element.getBoundingClientRect().top - paneTop, bottom: element.getBoundingClientRect().bottom - paneTop }));
    const id = reelCandidate(boxes, pane.clientHeight / 2);
    const box = boxes.find(item => item.id === id);
    if (box) anchor.current = { id: box.id, offset: box.top };
    if (promote && id && performance.now() < manualUntil.current) focus(id);
  });
  useLayoutEffect(() => {
    const pane = ref.current; if (!window || !pane) return;
    const size = () => pane.style.setProperty("--reel-pane-height", `${pane.clientHeight / zoom}px`);
    size(); const observer = new ResizeObserver(size); observer.observe(pane);
    return () => { observer.disconnect(); pane.style.removeProperty("--reel-pane-height"); };
  }, [Boolean(window), zoom, ref]);
  useLayoutEffect(() => {
    const pane = ref.current;
    if (!pane || !window) { previous.current.enabled = false; anchor.current = undefined; return; }
    if (!previous.current.enabled) {
      const target = pane.querySelector<HTMLElement>(`[data-reel-paragraph="${CSS.escape(window.activeId ?? "")}"]`);
      if (target) pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top + target.getBoundingClientRect().height / 2 - pane.clientHeight / 2;
    } else if (previous.current.key !== key && anchor.current) {
      const target = pane.querySelector<HTMLElement>(`[data-reel-paragraph="${CSS.escape(anchor.current.id)}"]`);
      if (target) pane.scrollTop += target.getBoundingClientRect().top - pane.getBoundingClientRect().top - anchor.current.offset;
    }
    previous.current = { enabled: true, key }; promoting.current = undefined;
    capture(false);
  }, [key, window?.activeId, Boolean(window), capture]);
  useLayoutEffect(() => { manualUntil.current = 0; }, [jumpSequence]);
  useEffect(() => {
    if (!window) { setProtectedId(undefined); return; }
    const changed = () => {
      const editor = document.activeElement?.closest<HTMLElement>('[data-paragraph-id]');
      setProtectedId(editor && ref.current?.contains(editor) ? editor.dataset.paragraphId : undefined);
    };
    document.addEventListener("focusin", changed); changed();
    return () => document.removeEventListener("focusin", changed);
  }, [Boolean(window), ref]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return { mounted, range,
    reveal: () => { manualUntil.current = 0; anchor.current = undefined; previous.current.enabled = false; },
    pause: () => { manualUntil.current = 0; },
    intent: () => { manualUntil.current = performance.now() + 1000; },
    scroll: () => {
      if (!window || frame.current) return;
      frame.current = requestAnimationFrame(() => { frame.current = 0; capture(true); });
    },
  };
}
