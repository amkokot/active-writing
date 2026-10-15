import { useEffect, useRef, useState } from "react";
import { TextLayer, type PDFDocumentProxy } from "pdfjs-dist";

/** Native, selectable text aligned with the same CSS-pixel viewport as the canvas. */
export function PdfTextLayer({ document, pageNumber, scale, onSourcePosition }: {
  document: PDFDocumentProxy; pageNumber: number; scale: number;
  onSourcePosition?: (page: number, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false, layer: TextLayer | undefined;
    container.replaceChildren(); setError(false);
    void (async () => {
      const page = await document.getPage(pageNumber);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      container.style.setProperty("--total-scale-factor", String(viewport.scale * viewport.userUnit));
      layer = new TextLayer({ container, viewport, textContentSource: page.streamTextContent() });
      await layer.render();
    })().catch(reason => { if (!cancelled && reason?.name !== "AbortException") setError(true); });
    return () => { cancelled = true; layer?.cancel(); container.replaceChildren(); };
  }, [document, pageNumber, scale]);
  return <>
    <div className="pdf-text-layer" ref={containerRef} onDoubleClick={event => {
      const rect = event.currentTarget.closest(".pdf-page-surface")?.getBoundingClientRect();
      if (rect) onSourcePosition?.(pageNumber, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
    }} />
    {error && <small className="pdf-text-selection-error" role="status">Text selection unavailable on this page.</small>}
  </>;
}
