import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { safeLink } from "../references";
import { windowStateCache } from "../windowCache";
import type { parseReadingPosition, ReadingPosition } from "../readingPosition";
import { PdfTextLayer } from "./PdfTextLayer";

export type PdfScrollTo = (page: number, y?: number, x?: number) => void;
interface Props {
  document: PDFDocumentProxy; pages: number[]; scale: number; active: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  navigator: RefObject<PdfScrollTo | undefined>;
  initialPage: number; recoveryKey: string; url: string;
  resume?: ReturnType<typeof parseReadingPosition>;
  onPage: (page: number) => void;
  onPosition?: (position: ReadingPosition) => void;
  onDestination: (destination: string | unknown[]) => void;
  onSourcePosition?: (page: number, x: number, y: number) => void;
}

/** Stable page slots make every page scrollable; only nearby slots own canvases. */
export function ContinuousPdfPages(props: Props) {
  const { document, pages, scale, active, scrollRef, navigator } = props;
  const [sizes, setSizes] = useState<{ page: number; width: number; height: number }[]>([]);
  const [nearby, setNearby] = useState<Set<number>>(new Set());
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const live = useRef(props); live.current = props;
  const pending = useRef<{ page: number; y?: number; x?: number } | undefined>(undefined);
  const initialized = useRef(false);
  const anchor = useRef<{ page: number; y: number; x: number } | undefined>(undefined);
  const previousScale = useRef(scale);
  const locate = (page: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
  const position = () => {
    const pane = scrollRef.current; if (!pane || !sizes.length) return;
    const line = pane.getBoundingClientRect().top + 2;
    const slots = Array.from(pane.querySelectorAll<HTMLElement>("[data-pdf-page]"));
    const slot = slots.find(item => item.getBoundingClientRect().bottom > line) ?? slots.at(-1);
    if (!slot) return;
    const page = Number(slot.dataset.pdfPage);
    const offset = slot.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    return { page, y: (pane.scrollTop - offset) / scale, x: pane.scrollLeft / scale };
  };
  const scrollTo: PdfScrollTo = (page, y = 0, x) => {
    const slot = locate(page), pane = scrollRef.current;
    if (!slot || !pane) { pending.current = { page, y, x }; return; }
    const offset = slot.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    pane.scrollTop = Math.max(0, offset + y * scale);
    if (x !== undefined) pane.scrollLeft = Math.max(0, x * scale - pane.clientWidth / 2);
    live.current.onPage(page);
  };

  // Keep selected text mounted when its page scrolls outside the canvas overscan.
  useEffect(() => {
    const update = () => {
      const selection = window.getSelection(), retained = new Set<number>();
      if (selection && !selection.isCollapsed) {
        for (const layer of scrollRef.current?.querySelectorAll<HTMLElement>(".pdf-text-layer") ?? []) {
          if (!layer.childNodes.length) continue;
          for (let i = 0; i < selection.rangeCount; i++) {
            if (selection.getRangeAt(i).intersectsNode(layer)) {
              retained.add(Number(layer.closest<HTMLElement>("[data-pdf-page]")?.dataset.pdfPage)); break;
            }
          }
        }
      }
      setSelectedPages(previous => previous.size === retained.size && [...previous].every(page => retained.has(page)) ? previous : retained);
    };
    setSelectedPages(new Set());
    window.document.addEventListener("selectionchange", update);
    return () => window.document.removeEventListener("selectionchange", update);
  }, [document, scrollRef]);

  useEffect(() => {
    let cancelled = false;
    setSizes([]); setError(""); initialized.current = false;
    void (async () => {
      const result: typeof sizes = [];
      // Bound simultaneous metadata requests even for long documents.
      for (let i = 0; i < pages.length; i += 8) {
        const batch = await Promise.all(pages.slice(i, i + 8).map(async number => {
          const viewport = (await document.getPage(number)).getViewport({ scale: 1 });
          return { page: number, width: viewport.width, height: viewport.height };
        }));
        if (cancelled) return;
        result.push(...batch);
      }
      if (!cancelled) setSizes(result);
    })().catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [document, JSON.stringify(pages)]);

  useLayoutEffect(() => {
    navigator.current = scrollTo;
    if (!sizes.length) return;
    if (!initialized.current) {
      initialized.current = true;
      const resume = live.current.resume;
      scrollTo(pending.current?.page ?? resume?.page ?? live.current.initialPage,
        pending.current?.y ?? (resume ? resume.top / (resume.scale ?? scale) : 0), pending.current?.x);
      if (resume && scrollRef.current) scrollRef.current.scrollLeft = resume.left * scale / (resume.scale ?? scale);
      pending.current = undefined;
    } else if (pending.current) {
      const target = pending.current; pending.current = undefined; scrollTo(target.page, target.y, target.x);
    } else if (previousScale.current !== scale && anchor.current) {
      scrollTo(anchor.current.page, anchor.current.y);
      if (scrollRef.current) scrollRef.current.scrollLeft = anchor.current.x * scale;
    }
    previousScale.current = scale;
  }, [sizes, scale]);

  useEffect(() => {
    const pane = scrollRef.current; if (!pane || !sizes.length) return;
    const observer = new IntersectionObserver(entries => {
      setNearby(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (entry.isIntersecting) next.add(page); else next.delete(page);
        }
        return next;
      });
    }, { root: pane, rootMargin: "100% 0px" });
    pane.querySelectorAll("[data-pdf-page]").forEach(slot => observer.observe(slot));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer); const at = position(); if (!at || !active) return;
      try {
        const value = JSON.stringify({ revision: live.current.url, page: at.page, top: Math.max(0, at.y * scale), left: pane.scrollLeft, scale });
        windowStateCache().writeSnapshot(live.current.recoveryKey, value, value);
      } catch { /* Reading position is optional, never an authority for drafts. */ }
    };
    const scrolled = () => {
      anchor.current = position();
      if (anchor.current) {
        live.current.onPage(anchor.current.page);
        live.current.onPosition?.({ revision: live.current.url, page: anchor.current.page,
          top: Math.max(0, anchor.current.y * scale), left: pane.scrollLeft, scale });
      }
      clearTimeout(timer); timer = setTimeout(save, 300);
    };
    const visibility = () => { if (window.document.visibilityState === "hidden") save(); };
    pane.addEventListener("scroll", scrolled, { passive: true }); window.addEventListener("pagehide", save); window.document.addEventListener("visibilitychange", visibility);
    scrolled();
    return () => { save(); observer.disconnect(); pane.removeEventListener("scroll", scrolled); window.removeEventListener("pagehide", save); window.document.removeEventListener("visibilitychange", visibility); clearTimeout(timer); };
  }, [sizes, scale, active]);

  return <div className="pdf-canvas-scroll pdf-continuous-scroll" ref={scrollRef} tabIndex={0} aria-label="PDF preview · continuous pages · Ctrl/⌘ scroll to zoom">
    {error ? <p role="alert">Unable to lay out PDF pages: {error}</p> : !sizes.length ? <p>Preparing PDF pages…</p> :
      <div className="pdf-page-stack">{sizes.map(size => <div key={size.page} data-pdf-page={size.page} className="pdf-page-surface pdf-page-slot"
        style={{ width: size.width * scale, height: size.height * scale }} aria-label={`PDF page ${size.page}`}>
        {active && (nearby.has(size.page) || selectedPages.has(size.page)) && <ContinuousPdfCanvas document={document} pageNumber={size.page} scale={scale}
          onDestination={props.onDestination} onSourcePosition={props.onSourcePosition} />}
      </div>)}</div>}
  </div>;
}

function ContinuousPdfCanvas({ document, pageNumber, scale, onDestination, onSourcePosition }: Pick<Props, "document" | "scale" | "onDestination" | "onSourcePosition"> & { pageNumber: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [links, setLinks] = useState<{ id: string; url?: string; dest?: string | unknown[]; left: number; top: number; width: number; height: number }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false, task: RenderTask | undefined;
    setLinks([]); setError("");
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale }), canvas = canvasRef.current, context = canvas.getContext("2d");
      if (!context) return;
      const outputScale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      await task.promise;
      if (cancelled) return;
      const annotations = await page.getAnnotations();
      if (cancelled) return;
      setLinks(annotations.filter(item => item.subtype === "Link" && (safeLink(item.url) || item.dest)).map(item => {
        const a = viewport.convertToViewportPoint(item.rect[0], item.rect[1]), b = viewport.convertToViewportPoint(item.rect[2], item.rect[3]);
        return { id: item.id, url: safeLink(item.url), dest: item.dest, left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
      }));
    })().catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError(String(reason)); });
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber, scale]);
  return <>
    {error && <p role="alert">Page {pageNumber}: {error}</p>}
    <canvas ref={canvasRef} aria-label={`Rendered PDF page ${pageNumber}`}
      onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onSourcePosition?.(pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale); }} />
    <PdfTextLayer document={document} pageNumber={pageNumber} scale={scale} onSourcePosition={onSourcePosition} />
    <div className="pdf-link-layer">{links.map(link => link.url
      ? <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" style={link} aria-label={`PDF external link on page ${pageNumber}: ${link.url}`} />
      : <button key={link.id} style={link} title="Jump to referenced location" aria-label={`PDF reference on page ${pageNumber}`} onClick={() => onDestination(link.dest!)} />)}</div>
  </>;
}
