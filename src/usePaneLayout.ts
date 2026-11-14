import { useEffect, useRef, useState, type RefObject } from "react";
import { readingAnchorAdjustment, readingPaneVisible } from "./editorGeometry.ts";

/** F11 changes the browser viewport without necessarily entering DOM fullscreen. */
export function useViewportRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let frame = 0;
    const changed = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; setRevision(value => value + 1); }); };
    window.addEventListener("resize", changed);
    document.addEventListener("fullscreenchange", changed);
    window.visualViewport?.addEventListener("resize", changed);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", changed); document.removeEventListener("fullscreenchange", changed); window.visualViewport?.removeEventListener("resize", changed); };
  }, []);
  return revision;
}

/** Preserve the first visible block when a reading/editor pane changes size.
 * Keep native caret/selection intact and never treat a layout resize as work.
 */
export function useReadingLayout(ref: RefObject<HTMLElement | null>) {
  const binding = useRef<{pane: HTMLElement; close: () => void} | undefined>(undefined);
  useEffect(() => () => { binding.current?.close(); binding.current = undefined; }, []);
  useEffect(() => {
    // Typing rerenders this component. Keep the current pane's observer/anchor:
    // scanning every paragraph and forcing layout on each key is unnecessary.
    if (binding.current?.pane === ref.current) return;
    binding.current?.close(); binding.current = undefined;
    const pane = ref.current; if (!pane) return;
    binding.current = { pane, close: bindReadingLayout(pane) };
  }); // Rebind conditional panes, not unchanged panes on every keystroke.
}

/** One binding per mounted pane; exported for layout lifecycle regressions. */
export function bindReadingLayout(pane: HTMLElement) {
    let width = pane.clientWidth, height = pane.clientHeight, frame = 0, scrollFrame = 0;
    let hidden = !readingPaneVisible(pane);
    let anchor: { element: HTMLElement; offset: number; scrolled: boolean } | undefined;
    const capture = () => {
      if (!readingPaneVisible(pane)) return;
      const top = pane.getBoundingClientRect().top;
      const element = [...pane.querySelectorAll<HTMLElement>("[data-paragraph-id], [data-preview-paragraph], [data-notebook-entry]")]
        .find(item => item.getBoundingClientRect().bottom > top + 8 && item.getBoundingClientRect().top < top + pane.clientHeight);
      anchor = element ? { element, offset: element.getBoundingClientRect().top - top, scrolled: pane.scrollTop > 0 } : undefined;
    };
    const changed = () => {
      cancelAnimationFrame(scrollFrame); scrollFrame = 0;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!readingPaneVisible(pane)) { hidden = true; return; }
        if (!hidden && width === pane.clientWidth && height === pane.clientHeight) return;
        hidden = false;
        width = pane.clientWidth; height = pane.clientHeight;
        if (anchor?.scrolled && anchor.element.isConnected && pane.contains(anchor.element)) {
          const offset = anchor.element.getBoundingClientRect().top - pane.getBoundingClientRect().top;
          pane.scrollTop += readingAnchorAdjustment(anchor.offset, offset);
        }
        capture();
      });
    };
    const scrolled = () => {
      if (!readingPaneVisible(pane)) { hidden = true; return; }
      // A resize-induced scroll must not replace the pre-resize anchor.
      if (hidden || width !== pane.clientWidth || height !== pane.clientHeight) changed();
      else if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        if (!readingPaneVisible(pane)) { hidden = true; return; }
        if (hidden || width !== pane.clientWidth || height !== pane.clientHeight) changed();
        else capture();
      });
    };
    const observer = new ResizeObserver(changed);
    observer.observe(pane); capture();
    pane.addEventListener("scroll", scrolled, { passive: true });
    window.addEventListener("resize", changed); document.addEventListener("fullscreenchange", changed);
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(scrollFrame); observer.disconnect(); pane.removeEventListener("scroll", scrolled); window.removeEventListener("resize", changed); document.removeEventListener("fullscreenchange", changed); };
}
