import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { safeLink } from "../references";
import { windowStateCache } from "../windowCache";
import type { parseReadingPosition, ReadingPosition } from "../readingPosition";
import { PdfTextLayer } from "./PdfTextLayer";
import { readingPaneVisible } from "../editorGeometry";
import { pdfRasterSize } from "../paneZoom";
import {initialPdfSizes,pdfPageLayout,pdfPageIndex,nearbyPdfPages,retainedPdfPages,pdfWorkQueue} from '../pdfViewport';
import {useStableEvent} from '../useStableEvent';

export type PdfScrollTo = (page: number, y?: number, x?: number) => void;
interface Props {
  document: PDFDocumentProxy; pages: number[]; scale: number; active: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  navigator: RefObject<PdfScrollTo | undefined>;
  initialPage: number; recoveryKey: string; url: string;
  resume?: ReturnType<typeof parseReadingPosition>;
  onPage: (page: number) => void;
  onPosition?: (position: ReadingPosition) => void;
  pageIdentity?: (page: number) => Pick<ReadingPosition, "sectionId" | "sectionPage">;
  onDestination: (destination: string | unknown[]) => void;
  onSourcePosition?: (page: number, x: number, y: number) => void;
}

/** Stable page slots make every page scrollable; only nearby slots own canvases. */
export function ContinuousPdfPages(props: Props) {
  const { document, pages, scale, active, scrollRef, navigator } = props;
  const [sizes, setSizes] = useState<{ page: number; width: number; height: number }[]>([]);
  const [retained, setRetained] = useState<number[]>([]);
  const work=useMemo(()=>pdfWorkQueue(),[document]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [error, setError] = useState("");
  const stackRef=useRef<HTMLDivElement>(null);
  const layout=useMemo(()=>pdfPageLayout(sizes,scale),[sizes,scale]);
  const live = useRef(props); live.current = props;
  const pending = useRef<{ page: number; y?: number; x?: number } | undefined>(undefined);
  const initialized = useRef(false);
  const anchor = useRef<{ page: number; y: number; x: number } | undefined>(undefined);
  const position = () => {
    const pane = scrollRef.current; if (!active || !pane || !sizes.length || !readingPaneVisible(pane)) return;
    const origin=(stackRef.current?.getBoundingClientRect().top??0)-pane.getBoundingClientRect().top+pane.scrollTop;
    const offset=pane.scrollTop-origin,row=layout[pdfPageIndex(layout,offset+2)];
    return row?{page:row.page,index:pdfPageIndex(layout,offset+2),y:(offset-row.top)/scale,x:pane.scrollLeft/scale}:undefined;
  };
  const scrollTo: PdfScrollTo = (page, y = 0, x) => {
    const row=layout.find(p=>p.page===page),pane = scrollRef.current;
    if (!row || !stackRef.current || !pane || !active || !readingPaneVisible(pane)) { pending.current = { page, y, x }; return; }
    const offset = stackRef.current.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop+row.top;
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
    setSizes([]); setError(""); initialized.current = false;setRetained([]);
    void (async () => {
      const result=await initialPdfSizes(pages,live.current.resume?.page??live.current.initialPage,async number=>(await document.getPage(number)).getViewport({scale:1}));
      if (!cancelled) setSizes(result);
    })().catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [document, JSON.stringify(pages)]);

  useLayoutEffect(() => {
    navigator.current = scrollTo;
    if (!active || !sizes.length || !scrollRef.current || !readingPaneVisible(scrollRef.current)) return;
    if (!initialized.current) {
      initialized.current = true;
      const resume = live.current.resume;
      scrollTo(pending.current?.page ?? resume?.page ?? live.current.initialPage,
        pending.current?.y ?? (resume ? resume.top / (resume.scale ?? scale) : 0), pending.current?.x);
      if (resume && scrollRef.current) scrollRef.current.scrollLeft = resume.left * scale / (resume.scale ?? scale);
      pending.current = undefined;
    } else if (pending.current) {
      const target = pending.current; pending.current = undefined; scrollTo(target.page, target.y, target.x);
    } else if (anchor.current) {
      scrollTo(anchor.current.page, anchor.current.y);
      if (scrollRef.current) scrollRef.current.scrollLeft = anchor.current.x * scale;
    }
  }, [sizes, scale, active]);

  useEffect(() => {
    const pane = scrollRef.current; if (!pane || !sizes.length) return;
    let frame=0,settled:ReturnType<typeof setTimeout>|undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer); const at = position() ?? anchor.current; if (!at || !active) return;
      try {
        const value = JSON.stringify({ revision: live.current.url, page: at.page, top: Math.max(0, at.y * scale), left: at.x * scale, scale, ...live.current.pageIdentity?.(at.page) });
        windowStateCache().writeSnapshot(live.current.recoveryKey, value, value);
      } catch { /* Reading position is optional, never an authority for drafts. */ }
    };
    const update = () => {
      const at = position(); if (!at) return;
      const row=layout[at.index];
      const next=nearbyPdfPages(layout,(row?.top??0)+at.y*scale,pane.clientHeight);
      setRetained(previous=>{const value=retainedPdfPages(previous,next,layout,scale,window.devicePixelRatio||1);return value.length===previous.length&&value.every((p,i)=>p===previous[i])?previous:value;});
      anchor.current = at;
      if (anchor.current) {
        live.current.onPage(anchor.current.page);
        live.current.onPosition?.({ revision: live.current.url, page: anchor.current.page,
          top: Math.max(0, anchor.current.y * scale), left: anchor.current.x * scale, scale, ...live.current.pageIdentity?.(anchor.current.page) });
      }
      clearTimeout(timer); timer = setTimeout(save, 300);
    };
    const scrolled = () => {
      // No React updates, canvas mounting or text construction during scrolling.
      // Retained pages remain visible; new pages fill after the gesture settles.
      work.pause();clearTimeout(settled);settled=setTimeout(update,150);
      if(!frame)frame=requestAnimationFrame(()=>{frame=0;const at=position();if(at)anchor.current=at;});
    };
    const visibility = () => { if (window.document.visibilityState === "hidden") save(); };
    pane.addEventListener("scroll", scrolled, { passive: true }); window.addEventListener("pagehide", save); window.document.addEventListener("visibilitychange", visibility);
    update();
    return () => { save();cancelAnimationFrame(frame);clearTimeout(settled); pane.removeEventListener("scroll", scrolled); window.removeEventListener("pagehide", save); window.document.removeEventListener("visibilitychange", visibility); clearTimeout(timer); };
  }, [sizes, scale, active]);

  const naturalSize=useStableEvent((page:number,width:number,height:number)=>setSizes(old=>{const current=old.find(s=>s.page===page);return !current||current.width===width&&current.height===height?old:old.map(s=>s.page===page?{page,width,height}:s);}));
  const destination=useStableEvent(props.onDestination),sourcePosition=useStableEvent((page:number,x:number,y:number)=>live.current.onSourcePosition?.(page,x,y));
  const mounted=new Set([...retained,...selectedPages]);
  return <div className="pdf-canvas-scroll pdf-continuous-scroll" ref={scrollRef} tabIndex={0} aria-label="PDF preview · continuous pages · Ctrl/⌘ scroll to zoom">
    {error ? <p role="alert">Unable to lay out PDF pages: {error}</p> : !sizes.length ? <p>Preparing PDF pages…</p> :
      <div className="pdf-page-stack pdf-virtual-stack" ref={stackRef} style={{height:layout.at(-1)?.bottom??0,width:Math.max(...sizes.map(s=>s.width*scale))}}>{layout.filter(size=>mounted.has(size.page)).map(size => <div key={size.page} data-pdf-page={size.page} className="pdf-page-surface pdf-page-slot"
        style={{ top:size.top,width: size.width * scale, height: size.height * scale }} aria-label={`PDF page ${size.page}`}>
        {active && <ContinuousPdfCanvas document={document} pageNumber={size.page} scale={scale} work={work}
          onNaturalSize={naturalSize} onDestination={destination} onSourcePosition={sourcePosition} />}
      </div>)}</div>}
  </div>;
}

const ContinuousPdfCanvas=memo(function ContinuousPdfCanvas({ document, pageNumber, scale, onDestination, onSourcePosition,work,onNaturalSize }: Pick<Props, "document" | "scale" | "onDestination" | "onSourcePosition"> & { pageNumber: number;work:ReturnType<typeof pdfWorkQueue>;onNaturalSize:(page:number,width:number,height:number)=>void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [links, setLinks] = useState<{ id: string; url?: string; dest?: string | unknown[]; left: number; top: number; width: number; height: number }[]>([]);
  const [error, setError] = useState("");
  const render=useRef<RenderTask|undefined>(undefined);
  const [textReady,setTextReady]=useState(false);
  useEffect(() => {
    let cancelled = false, task: RenderTask | undefined;
    let cancelContinuation: (()=>void)|undefined,cancelText:(()=>void)|undefined;
    setLinks([]); setError("");
    // Briefly defer new work so a trackpad fling does not paint every page it
    // passes. Existing completed canvases keep scrolling immediately.
    const cancelStart=work.schedule(()=>{void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;
      const natural=page.getViewport({scale:1});onNaturalSize(pageNumber,natural.width,natural.height);
      await render.current?.promise.catch(()=>{});
      if(cancelled||!canvasRef.current)return;
      const viewport = page.getViewport({ scale }), canvas = canvasRef.current, context = canvas.getContext("2d");
      if (!context) return;
      const raster = pdfRasterSize(viewport.width, viewport.height, window.devicePixelRatio || 1), outputScale = raster.scale;
      canvas.width = raster.width; canvas.height = raster.height;
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      task.onContinue=(resume:()=>void)=>{cancelContinuation=work.schedule(()=>{if(!cancelled)resume();});};
      render.current=task;
      await task.promise;
      if (cancelled) return;
      cancelText=work.schedule(()=>{if(!cancelled)setTextReady(true);});
      const annotations = await page.getAnnotations();
      if (cancelled) return;
      setLinks(annotations.filter(item => item.subtype === "Link" && (safeLink(item.url) || item.dest)).map(item => {
        const a = viewport.convertToViewportPoint(item.rect[0], item.rect[1]), b = viewport.convertToViewportPoint(item.rect[2], item.rect[3]);
        return { id: item.id, url: safeLink(item.url), dest: item.dest, left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]) };
      }));
    })().catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") setError(String(reason)); });});
    return () => { cancelled = true;cancelStart();cancelContinuation?.();cancelText?.();task?.cancel(); };
  }, [document, pageNumber, scale,work,onNaturalSize]);
  useEffect(()=>{const canvas=canvasRef.current;return()=>{const task=render.current;task?.cancel();if(canvas){canvas.width=0;canvas.height=0;}void task?.promise.catch(()=>{}).then(()=>document.getPage(pageNumber)).then(page=>page.cleanup()).catch(()=>{});};},[document,pageNumber]);
  return <>
    {error && <p role="alert">Page {pageNumber}: {error}</p>}
    <canvas ref={canvasRef} aria-label={`Rendered PDF page ${pageNumber}`}
      onDoubleClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onSourcePosition?.(pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale); }} />
    {textReady&&<PdfTextLayer document={document} pageNumber={pageNumber} scale={scale} onSourcePosition={onSourcePosition} />}
    <div className="pdf-link-layer">{links.map(link => link.url
      ? <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" style={link} aria-label={`PDF external link on page ${pageNumber}: ${link.url}`} />
      : <button key={link.id} style={link} title="Jump to referenced location" aria-label={`PDF reference on page ${pageNumber}`} onClick={() => onDestination(link.dest!)} />)}</div>
  </>;
});
