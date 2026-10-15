import { memo, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, LoaderCircle, Search, ZoomIn, ZoomOut } from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { safeLink } from "../references";
import { unavailablePdfDestination } from "../pdfLinks";
import { renderProfiling } from "../renderProfile";
import { usePaneZoomGestures, useStoredPaneZoom } from "../usePaneZoom";
import { clampPaneZoom } from "../paneZoom";
import type { PreviewLocation } from "../types";
import { useViewportRevision } from "../usePaneLayout";
import { pdfFitScale, resizedPdfPosition } from "../editorGeometry";
import { compiledPdfResume, parseReadingPosition, readingPositionKey, type ReadingPosition } from "../readingPosition";
import { windowStateCache } from "../windowCache";
import { ContinuousPdfPages } from "./ContinuousPdfPages";
import type { PdfScrollTo } from "./ContinuousPdfPages";
import { PdfTextLayer } from "./PdfTextLayer";

GlobalWorkerOptions.workerSrc = pdfWorker;

interface PdfViewerProps {
  continuous?: boolean;
  active?: boolean;
  darkDisplay?: boolean;
  zoomFactor?: number;
  onZoomFactorChange?: (zoom: number) => void;
  url: string;
  readingIdentity?: string;
  initialPage?: number;
  initialSearch?: string;
  onPageChange?: (page: number) => void;
  onSearchChange?: (query: string) => void;
  alwaysShowSearch?: boolean;
  unavailableDestinations?: string[];
  renderControls?: (controls?: ReactNode) => ReactNode;
  visiblePages?: number[];
  jumpTarget?: PreviewLocation;
  onSourcePosition?: (page: number, x: number, y: number) => void;
}

interface PdfLink { id: string; url?: string; dest?: string | unknown[]; left: number; top: number; width: number; height: number }
interface SearchMatch { page: number; snippet: string }
const textCache = new Map<string, string[]>();
const normalize = (value: string) => value.normalize("NFKC").replace(/-\s+/g, "").replace(/\s+/g, " ").toLowerCase();

function PdfViewerView({ continuous = false, active = true, darkDisplay = false, zoomFactor, onZoomFactorChange, url, readingIdentity, initialPage = 1, initialSearch = "", onPageChange, onSearchChange, alwaysShowSearch = false, unavailableDestinations, renderControls, visiblePages, jumpTarget, onSourcePosition }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRevision = useViewportRevision();
  const scrollRef = useRef<HTMLDivElement>(null);
  const continuousNavigator = useRef<PdfScrollTo | undefined>(undefined);
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const liveDocument = useRef<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [fitScale, setFitScale] = useState(0.55);
  const [readerZoom, setReaderZoom] = useStoredPaneZoom("pdf-reader");
  const zoom = zoomFactor ?? readerZoom;
  const setZoom = onZoomFactorChange ?? setReaderZoom;
  usePaneZoomGestures(scrollRef, zoom, setZoom, false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [history, setHistory] = useState<number[]>([]);
  const [notice, setNotice] = useState<string>();
  const [searchOpen, setSearchOpen] = useState(Boolean(initialSearch) || alwaysShowSearch);
  const [query, setQuery] = useState(initialSearch);
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>();
  const searchEpoch = useRef(0);
  const destinationTop = useRef<number | undefined>(undefined);
  const pageJump = useRef<PreviewLocation | undefined>(undefined);
  const recoveryPosition = useRef<ReturnType<typeof parseReadingPosition>>(undefined);
  const lastReadingPosition = useRef<{ identity: string; position: ReadingPosition } | undefined>(undefined);
  const recoveryKey = readingPositionKey(`${continuous ? "pdf-continuous" : "pdf"}:${url}`);
  const selectedPages = visiblePages?.filter(page => Number.isInteger(page) && page >= 1 && (!document || page <= document.numPages));
  // Retain the completed canvas when a tool temporarily covers the preview.
  // Only an exact document/page/scale match is reusable; interrupted paints are not.
  const drawnPage = useRef<{ document: PDFDocumentProxy; page: number; scale: number; outputScale: number } | undefined>(undefined);
  const positionedPage = useRef<{ document: PDFDocumentProxy; page: number; scale: number; zoom: number; width: number; height: number } | undefined>(undefined);
  const navigate = (page: number) => {
    if (!document) return;
    const target = Math.min(document.numPages, Math.max(1, page));
    if (target !== pageNumber) setHistory((previous) => [...previous.slice(-30), pageNumber]);
    setPageNumber(target); setNotice(undefined);
    if (continuous) continuousNavigator.current?.(target);
  };

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url });
    liveDocument.current = null;
    drawnPage.current = undefined;
    positionedPage.current = undefined;
    setLoading(true);
    setError(undefined);
    setDocument(undefined); setLinks([]); setHistory([]); setMatches(undefined); setSearching(false); searchEpoch.current++;
    try { recoveryPosition.current = parseReadingPosition(windowStateCache().read(recoveryKey)); } catch { recoveryPosition.current = undefined; }
    const carried = compiledPdfResume(lastReadingPosition.current, readingIdentity, url);
    if (carried) recoveryPosition.current = carried;
    if (initialPage !== 1 || initialSearch || jumpTarget?.page || recoveryPosition.current?.revision !== url) recoveryPosition.current = undefined;
    const resumePage = recoveryPosition.current?.page;
    const firstPage = resumePage && (!selectedPages?.length || selectedPages.includes(resumePage)) ? resumePage : selectedPages?.[0] ?? initialPage;
    if (resumePage && firstPage !== resumePage) recoveryPosition.current = undefined;
    setPageNumber(firstPage);
    task.promise
      .then((nextDocument) => {
        if (!cancelled) {
          const page = Math.min(nextDocument.numPages, Math.max(1, firstPage));
          if (page !== firstPage && recoveryPosition.current) recoveryPosition.current = { ...recoveryPosition.current, page };
          liveDocument.current = nextDocument; setDocument(nextDocument); setPageNumber(page);
          if (renderProfiling) console.debug("[Active Writing PDF]", JSON.stringify({ event: "loaded", pages: nextDocument.numPages }));
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      liveDocument.current = null;
      searchEpoch.current++;
      void task.destroy();
    };
  }, [url, readingIdentity]);

  useEffect(() => {
    const pane = scrollRef.current; if (continuous || !pane || !active || !document) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer); const drawn = drawnPage.current;
      if (!drawn || drawn.document !== document || drawn.page !== pageNumber || recoveryPosition.current) return;
      try { const value = JSON.stringify({ revision: url, page: pageNumber, top: pane.scrollTop, left: pane.scrollLeft, scale: drawn.scale }); windowStateCache().writeSnapshot(recoveryKey, value, value); } catch { /* Optional reading preference. */ }
    };
    const scrolled = () => { clearTimeout(timer); timer = setTimeout(save, 300); };
    const visibility = () => { if (window.document.visibilityState === "hidden") save(); };
    pane.addEventListener("scroll", scrolled, { passive: true }); window.addEventListener("pagehide", save); window.document.addEventListener("visibilitychange", visibility);
    return () => { save(); pane.removeEventListener("scroll", scrolled); window.removeEventListener("pagehide", save); window.document.removeEventListener("visibilitychange", visibility); };
  }, [url, document, pageNumber, active]);

  useEffect(() => { setQuery(initialSearch); setMatches(undefined); setSearchOpen(Boolean(initialSearch) || alwaysShowSearch); }, [initialSearch, alwaysShowSearch]);
  useEffect(() => { if (document) onPageChange?.(pageNumber); }, [document, pageNumber, onPageChange]);
  useEffect(() => { if (document) navigate(initialPage); }, [initialPage]);
  useEffect(() => { if (selectedPages?.length && !selectedPages.includes(pageNumber)) navigate(selectedPages[0]); }, [JSON.stringify(selectedPages)]);
  useEffect(() => {
    if (!jumpTarget?.page || !document) return;
    if (continuous) {
      recoveryPosition.current = undefined;
      navigate(jumpTarget.page);
      continuousNavigator.current?.(jumpTarget.page, Math.max(0, (jumpTarget.y ?? 0) - 60 / scale), jumpTarget.x);
      return;
    }
    recoveryPosition.current = undefined;
    pageJump.current = jumpTarget;
    navigate(jumpTarget.page);
    if (jumpTarget.page === pageNumber && scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, (jumpTarget.y ?? 0) * scale - 60);
      scrollRef.current.scrollLeft = Math.max(0, (jumpTarget.x ?? 0) * scale - scrollRef.current.clientWidth / 2);
      pageJump.current = undefined;
    }
  }, [jumpTarget?.sequence, document]);

  useEffect(() => {
    if (!active || !document || !scrollRef.current) return;
    let cancelled = false;
    const scroll = scrollRef.current;
    const updateFit = async () => {
      if (cancelled || liveDocument.current !== document) return;
      try {
        const page = await document.getPage(continuous ? selectedPages?.[0] ?? 1 : pageNumber);
        if (cancelled || liveDocument.current !== document) return;
        const natural = page.getViewport({ scale: 1 });
        setFitScale(pdfFitScale(scroll.clientWidth, natural.width));
      } catch (reason: unknown) {
        if (!cancelled && liveDocument.current === document) setError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    const observer = new ResizeObserver(() => void updateFit());
    observer.observe(scroll);
    void updateFit();
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [active, document, pageNumber, viewportRevision]);

  const scale = fitScale * zoom;

  useEffect(() => {
    if (continuous || !active || !document || !canvasRef.current) return;
    const outputScale = Math.min(window.devicePixelRatio || 1, 2);
    const drawn = drawnPage.current;
    if (drawn?.document === document && drawn.page === pageNumber && drawn.scale === scale && drawn.outputScale === outputScale) {
      // Height-only fullscreen changes reuse the canvas, but the stored pane
      // dimensions still need refreshing for the next width/zoom change.
      const previous = positionedPage.current;
      const scroll = scrollRef.current;
      // A width change may still be waiting for updateFit(). Keep its old
      // dimensions until the new scale positions the canvas.
      if (previous && scroll && previous.width === scroll.clientWidth) {
        positionedPage.current = { ...previous, width: scroll.clientWidth, height: scroll.clientHeight };
      }
      if (renderProfiling) console.debug("[Active Writing PDF]", JSON.stringify({ event: "reused", page: pageNumber }));
      return;
    }
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    const previous = positionedPage.current;
    const scrollPosition = previous?.document === document && previous.page === pageNumber && scrollRef.current
      ? { top: scrollRef.current.scrollTop, left: scrollRef.current.scrollLeft, width: previous.width, height: previous.height, scale: previous.scale,
          keepCenter: previous.zoom !== zoom || scrollRef.current.scrollTop > 0 || scrollRef.current.scrollLeft > 0 } : undefined;
    const render = async () => {
      if (cancelled || liveDocument.current !== document) return;
      const page = await document.getPage(pageNumber);
      if (cancelled || liveDocument.current !== document || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      setLinks([]);
      drawnPage.current = undefined;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      // Position immediately, not after painting: repeated pinch events can
      // cancel intermediate renders, but must not send the reader to page top.
      positionedPage.current = { document, page: pageNumber, scale, zoom, width: scrollRef.current?.clientWidth ?? 0, height: scrollRef.current?.clientHeight ?? 0 };
      if (scrollRef.current) {
        const scroll = scrollRef.current;
        if (pageJump.current?.page === pageNumber) {
          scroll.scrollTop = Math.max(0, (pageJump.current.y ?? 0) * scale - 60);
          scroll.scrollLeft = Math.max(0, (pageJump.current.x ?? 0) * scale - scroll.clientWidth / 2);
          pageJump.current = undefined;
        } else if (recoveryPosition.current?.page === pageNumber) {
          const cached = recoveryPosition.current;
          const ratio = scale / (cached.scale ?? scale);
          scroll.scrollTop = cached.top * ratio; scroll.scrollLeft = cached.left * ratio;
          recoveryPosition.current = undefined;
        } else if (destinationTop.current !== undefined) scroll.scrollTop = Math.max(0, viewport.convertToViewportPoint(0, destinationTop.current)[1] - 25);
        else if (scrollPosition?.keepCenter) {
          const next = resizedPdfPosition(scrollPosition, scale, scroll.clientWidth, scroll.clientHeight);
          scroll.scrollTop = next.top; scroll.scrollLeft = next.left;
        } else scroll.scrollTop = 0;
        destinationTop.current = undefined;
      }
      renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      await renderTask.promise;
      if (cancelled || liveDocument.current !== document) return;
      const annotations = await page.getAnnotations();
      if (cancelled || liveDocument.current !== document) return;
      setLinks(annotations.filter((item) => item.subtype === "Link" && (safeLink(item.url) || item.dest)).map((item) => {
        const rect = [...viewport.convertToViewportPoint(item.rect[0], item.rect[1]), ...viewport.convertToViewportPoint(item.rect[2], item.rect[3])];
        return { id: item.id, url: safeLink(item.url), dest: item.dest,
          left: Math.min(rect[0], rect[2]), top: Math.min(rect[1], rect[3]), width: Math.abs(rect[2] - rect[0]), height: Math.abs(rect[3] - rect[1]) };
      }));
      drawnPage.current = { document, page: pageNumber, scale, outputScale };
      if (renderProfiling) console.debug("[Active Writing PDF]", JSON.stringify({ event: "painted", page: pageNumber }));
    };
    void render().catch((reason: unknown) => {
      if (!cancelled && reason instanceof Error && reason.name !== "RenderingCancelledException") {
        setError(reason.message);
      }
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [active, document, pageNumber, scale, viewportRevision]);

  async function followDestination(destination: string | unknown[]) {
    if (!document) return;
    if (unavailablePdfDestination(destination, unavailableDestinations)) {
      setNotice("The cited result isn't in this PDF. Open its source or compile the full paper; page 1 isn't the target.");
      return;
    }
    try {
      const explicit = typeof destination === "string" ? await document.getDestination(destination) : destination;
      if (!explicit) { setNotice("This target isn't in this PDF. Compile the full paper to include it."); return; }
      const ref = explicit[0];
      const index = typeof ref === "number" ? ref : await document.getPageIndex(ref as { num: number; gen: number });
      const position = explicit[1] as { name?: string } | undefined;
      const top = position?.name === "XYZ" ? explicit[3] : position?.name === "FitH" ? explicit[2] : undefined;
      if (continuous) {
        const page = await document.getPage(index + 1);
        navigate(index + 1);
        const y = typeof top === "number" ? Math.max(0, page.getViewport({ scale: 1 }).convertToViewportPoint(0, top)[1] - 25 / scale) : 0;
        continuousNavigator.current?.(index + 1, y);
        return;
      }
      if (typeof top === "number") destinationTop.current = top;
      navigate(index + 1);
      if (index + 1 === pageNumber && typeof top === "number") {
        const page = await document.getPage(pageNumber);
        if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, page.getViewport({ scale }).convertToViewportPoint(0, top)[1] - 25);
        destinationTop.current = undefined;
      }
    } catch { setNotice("This PDF link has no usable destination. Try the full document or its source reference."); }
  }

  async function searchPdf() {
    if (!document || !query.trim()) return;
    const epoch = ++searchEpoch.current;
    const needle = normalize(query.trim());
    setSearching(true); setMatches(undefined); setNotice(undefined);
    try {
      let texts = textCache.get(url);
      if (!texts) {
        texts = [];
        for (let page = 1; page <= Math.min(document.numPages, 500); page++) {
          const content = await (await document.getPage(page)).getTextContent();
          if (epoch !== searchEpoch.current) return;
          texts.push(normalize(content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("")));
        }
        if (textCache.size >= 3) textCache.delete(textCache.keys().next().value!);
        textCache.set(url, texts);
      }
      const found = texts.flatMap((text, index) => {
        const at = text.indexOf(needle);
        return at < 0 ? [] : [{ page: index + 1, snippet: text.slice(Math.max(0, at - 45), at + needle.length + 100) }];
      });
      if (epoch === searchEpoch.current) {
        setMatches(found);
        if (document.numPages > 500) setNotice("Searched the first 500 pages. You can also enter a page number.");
      }
    } catch { if (epoch === searchEpoch.current) setNotice("Text search failed. Scanned PDFs may need a manually chosen page."); }
    finally { if (epoch === searchEpoch.current) setSearching(false); }
  }

  if (loading) {
    return <>{renderControls?.()}<div className="pdf-loading"><LoaderCircle className="spin" size={20} /> Loading PDF</div></>;
  }

  if (error || !document) {
    return <>{renderControls?.()}<div className="pdf-error" role="alert">Unable to render PDF: {error ?? "Unknown error"}</div></>;
  }

  const pagination = <>
        <button aria-label="Back to previous PDF location" disabled={!history.length} onClick={() => { const target = history.at(-1)!; setPageNumber(target); if (continuous) continuousNavigator.current?.(target); setHistory((previous) => previous.slice(0, -1)); }}><ArrowLeft size={14} /></button>
        <button
          aria-label="Previous page"
          disabled={selectedPages?.length ? selectedPages.indexOf(pageNumber) <= 0 : pageNumber <= 1}
          onClick={() => navigate(selectedPages?.length ? selectedPages[Math.max(0, selectedPages.indexOf(pageNumber) - 1)] : pageNumber - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <label className="pdf-page-input">Page <input aria-label="PDF page number" key={`${url}:${pageNumber}`} type="number" min={1} max={document.numPages} defaultValue={pageNumber} onBlur={(event) => { const page = Number(event.target.value) || 1; navigate(selectedPages?.length && !selectedPages.includes(page) ? selectedPages[0] : page); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> {selectedPages?.length ? `· ${selectedPages.length} selected` : `of ${document.numPages}`}</label>
        <button
          aria-label="Next page"
          disabled={selectedPages?.length ? selectedPages.indexOf(pageNumber) >= selectedPages.length - 1 : pageNumber >= document.numPages}
          onClick={() => navigate(selectedPages?.length ? selectedPages[Math.min(selectedPages.length - 1, selectedPages.indexOf(pageNumber) + 1)] : pageNumber + 1)}
        >
          <ChevronRight size={15} />
        </button>
  </>;
  const controls = <>
      <div className="pdf-controls">
        {!renderControls && pagination}
        <span className="pdf-control-spacer" />
        <button aria-label="Search PDF text" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}><Search size={14} /></button>
        <button
          aria-label="Zoom out"
          onClick={() => setZoom(clampPaneZoom(zoom / 1.1))}
        >
          <ZoomOut size={14} />
        </button>
        <button className="pdf-fit-button" aria-label="Fit PDF to width" onClick={() => setZoom(1)}>
          {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
        </button>
        <button
          aria-label="Zoom in"
          onClick={() => setZoom(clampPaneZoom(zoom * 1.1))}
        >
          <ZoomIn size={14} />
        </button>
      </div>
      {searchOpen && <div className="pdf-search">
        <form onSubmit={(event) => { event.preventDefault(); void searchPdf(); }}><input aria-label="Find result in PDF" placeholder="Theorem 2.3, a heading, or a phrase" value={query} onChange={(event) => { setQuery(event.target.value); onSearchChange?.(event.target.value); }} /><button disabled={searching || !query.trim()}>{searching ? "Searching…" : "Find"}</button></form>
        {matches && <div className="pdf-search-results">{matches.length ? <><small>{matches.length} matching page{matches.length === 1 ? "" : "s"}. Mentions may not be the result itself—check the page.</small>{matches.map((match) => <button key={match.page} onClick={() => navigate(match.page)}><strong>Page {match.page}</strong><span>…{match.snippet}…</span></button>)}</> : <small>No matching text. Try fewer words, or choose a page manually.</small>}</div>}
      </div>}
  </>;

  return (
    <div className={`pdf-viewer${darkDisplay ? " dark-pdf-display" : ""}`}>
      {renderControls ? renderControls(controls) : controls}
      {renderControls && <nav className="pdf-controls pdf-pagination" aria-label="PDF page navigation">
        {pagination}
        <small>{continuous ? "Scroll through all pages" : "One page at a time · use the arrows for more pages"}</small>
      </nav>}
      {notice && <p className="pdf-link-notice" role="status">{notice}</p>}
      {continuous ? <ContinuousPdfPages key={url} document={document} active={active} scale={scale} scrollRef={scrollRef} navigator={continuousNavigator}
        pages={selectedPages?.length ? selectedPages : Array.from({ length: document.numPages }, (_, i) => i + 1)} initialPage={pageNumber}
        resume={recoveryPosition.current} recoveryKey={recoveryKey} url={url} onPage={setPageNumber}
        onPosition={position => { if (readingIdentity) lastReadingPosition.current = { identity: readingIdentity, position }; }}
        onDestination={destination => void followDestination(destination)} onSourcePosition={onSourcePosition} />
      : <div className="pdf-canvas-scroll" ref={scrollRef} tabIndex={0} aria-label="PDF preview · Ctrl/⌘ scroll to zoom">
        <div className="pdf-page-surface">
          <canvas ref={canvasRef} aria-label={`Rendered PDF page ${pageNumber}`} onDoubleClick={event => {
            const rect = event.currentTarget.getBoundingClientRect();
            onSourcePosition?.(pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
          }} />
          <PdfTextLayer document={document} pageNumber={pageNumber} scale={scale} onSourcePosition={onSourcePosition} />
          <div className="pdf-link-layer">{links.map((link, index) => {
            const style = { left: link.left, top: link.top, width: link.width, height: link.height };
            return link.url ? <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" style={style} title={link.url} aria-label={`PDF external link ${index + 1}: ${link.url}`} />
              : <button key={link.id} style={style} title="Jump to referenced location" aria-label={`PDF reference ${index + 1} on page ${pageNumber}`} onClick={() => void followDestination(link.dest!)} />;
          })}</div>
        </div>
      </div>}
    </div>
  );
}

export const PdfViewer = memo(PdfViewerView);
