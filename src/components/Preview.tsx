import { lazy, Suspense, useLayoutEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import type { CompileResult, Lens, ManuscriptNode, Paragraph, PreviewLocation, ThemeLens, ReferenceRequest, ProjectDocument } from "../types";
import { themePassages, visiblePreviewNodes, sourceOrderedBlocks } from "../workspaceTools";
import { restrictNodesToParagraphs, windowScrollStep } from "../manuscriptView";
import { manuscriptHeadingTag, sectionHeadingLevel } from "../headingHierarchy";
import { usePaneZoomGestures, useStoredPaneZoom } from "../usePaneZoom";
import { PaneZoomIndicator } from "./PaneZoomIndicator";
import { useReadingLayout } from "../usePaneLayout";
import { useSavedReadingPosition } from "../useSavedReadingPosition";
import { linkedProofTitle } from "../proofLinks";
import { manuscriptContents } from "../latexStructure";
import { useSectionEdges, type SectionNavigation } from "../useSectionEdges";

const PdfViewer = lazy(() =>
  import("./PdfViewer").then((module) => ({ default: module.PdfViewer })),
);
const RenderedPassage = lazy(() => import("./RenderedPassage"));

interface PreviewProps {
  figureProject?: ProjectDocument;
  recoveryIdentity?: { key: string; revision: string };
  sectionNavigation?: SectionNavigation;
  active?: boolean;
  darkPdf?: boolean;
  format: "pdf" | "reading";
  controlsTarget: HTMLElement | null;
  lens: Lens;
  focusedNodeId?: string;
  paragraphIds?: string[];
  blockWindowNavigation?: { before: number; after: number; blocked: boolean; onMove: (direction: -1 | 1) => void };
  hiddenNodeIds: string[];
  nodes: ManuscriptNode[];
  paragraphs: Paragraph[];
  paragraphEdits: Record<string, string>;
  theme?: ThemeLens;
  compileResult?: CompileResult;
  compiling: boolean;
  jumpTarget?: PreviewLocation;
  onSyncToSource?: (paragraphId: string) => void;
  onReference?: (request: ReferenceRequest) => void;
  onNavigateNode?: (nodeId: string) => void;
  onPdfSourcePosition?: (page: number, x: number, y: number) => void;
}

export function Preview({
  figureProject,
  recoveryIdentity,
  sectionNavigation,
  active = true,
  darkPdf = false,
  format,
  controlsTarget,
  lens,
  focusedNodeId,
  paragraphIds,
  blockWindowNavigation,
  hiddenNodeIds,
  nodes,
  paragraphs,
  paragraphEdits,
  theme,
  compileResult,
  compiling,
  jumpTarget,
  onSyncToSource,
  onReference,
  onNavigateNode,
  onPdfSourcePosition,
}: PreviewProps) {
  const quickReading = format !== "pdf" || !compileResult?.success;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionWheel = useSectionEdges(sectionNavigation);
  useSavedReadingPosition(scrollRef,recoveryIdentity,quickReading && active);
  const [zoom, setZoom] = useStoredPaneZoom("preview");
  usePaneZoomGestures(scrollRef, zoom, setZoom);
  useReadingLayout(scrollRef);
  const wheelIntent = useRef({ amount: 0, at: 0, lastAdvance: 0 });
  const paragraphMap = useMemo(() => new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])), [paragraphs]);
  const contents = useMemo(() => manuscriptContents(nodes, paragraphs, paragraphEdits), [nodes, paragraphs, paragraphEdits]);
  const figureContext = useMemo(() => figureProject ? { projectId: figureProject.project.id, revision: figureProject.revision, files: figureProject.files } : undefined, [figureProject]);
  const followContents = (id: string) => {
    const heading = contents.find(item => item.id === id); if (!heading) return;
    if (heading.paragraphId) onSyncToSource?.(heading.paragraphId);
    else if (heading.nodeId) onNavigateNode?.(heading.nodeId);
  };
  const proofKinds = new Set(["theorem", "lemma", "corollary", "proof"]);
  const previewNodes = useMemo(() => {
    const visible=restrictNodesToParagraphs(visiblePreviewNodes(nodes, lens, focusedNodeId, hiddenNodeIds), paragraphIds);
    return paragraphIds || focusedNodeId && nodes.find(n=>n.id===focusedNodeId)?.environment ? visible : sourceOrderedBlocks(visible,paragraphs);
  }, [nodes, paragraphs, lens, focusedNodeId, hiddenNodeIds, paragraphIds]);
  const compiledWindowIds = paragraphIds?.filter(id => !paragraphMap.get(id)?.emptySource);
  const priorView = compileResult?.mode === "focus" && (!compileResult.scope || compileResult.scope.focusNodeId !== focusedNodeId || (compileResult.scope.lens ?? "paper") !== lens || JSON.stringify([...(compileResult.scope.hiddenNodeIds ?? [])].sort()) !== JSON.stringify([...hiddenNodeIds].sort()) || JSON.stringify(compileResult.scope.paragraphIds) !== JSON.stringify(compiledWindowIds));
  // Navigation only changes the reading window and the "Older PDF" status.
  // The caller selects PDF only after an explicit successful compile, not when
  // restoring a cached build. Keep its saved URL/page/zoom until then.
  useLayoutEffect(() => {
    if (!quickReading || !jumpTarget || !jumpTarget.paragraphId && !jumpTarget.edge) return;
    const pane = scrollRef.current;
    const target = jumpTarget.paragraphId ? pane?.querySelector<HTMLElement>(`[data-preview-paragraph="${CSS.escape(jumpTarget.paragraphId)}"]`) : undefined;
    if (!pane || !target && !jumpTarget.edge) return;
    const align = () => {
      if (jumpTarget.edge) { pane.scrollTo({top: jumpTarget.edge === "end" ? pane.scrollHeight : 0, behavior: "instant"}); return; }
      const rect = target!.getBoundingClientRect(), frame = pane.getBoundingClientRect();
      pane.scrollTo({ top: Math.max(0, pane.scrollTop + rect.top - frame.top - (rect.height < pane.clientHeight ? (pane.clientHeight - rect.height) / 2 : 20)), behavior: "instant" });
    };
    align();
    // Lazy math/prose can grow after the first paint. Briefly retain the anchor,
    // but stop as soon as the reader scrolls, selects or types in this pane.
    const observer = new ResizeObserver(align);
    const page = pane.querySelector('.preview-page'); if (page) observer.observe(page);
    const stop = () => observer.disconnect();
    for (const name of ["wheel", "pointerdown", "keydown", "touchmove"]) pane.addEventListener(name, stop, { passive: true });
    const timer = setTimeout(stop, 1500);
    return () => {
      clearTimeout(timer); observer.disconnect();
      for (const name of ["wheel", "pointerdown", "keydown", "touchmove"]) pane.removeEventListener(name, stop);
    };
  }, [jumpTarget?.sequence, quickReading, active]);
  const partialView = compileResult?.mode === "focus" && compileResult.diagnostics?.some(item => item.code === "focus_source_snippets");
  const statusDetail = compiling ? "Compiling LaTeX" : compileResult?.stale ? "Edits are not in this PDF" : compileResult?.success
    ? quickReading ? "Quick reading · approximate; cached PDF available" : compileResult.originalPages ? "Original pages · complete page layout" : compileResult.mode === "full" ? "Full document PDF ready" : priorView ? "PDF from a previous focused view" : partialView ? "Focused PDF ready; unfinished snippets have placeholders" : "Focused PDF ready"
    : compileResult ? "LaTeX compilation failed" : "Quick reading · approximate, not a typeset PDF";
  const compileStatus = compiling ? (
    <span className="compile-state is-running"><LoaderCircle className="spin" size={14} /> Compiling…</span>
  ) : compileResult?.success && !compileResult.stale ? (
    <span className={`compile-state is-success ${compileResult.mode === "full" ? "is-full" : ""}`}>
      <CheckCircle2 size={14} />
      {quickReading ? "Quick reading" : compileResult.originalPages ? "Original pages" : compileResult.mode === "full" ? "Full PDF" : priorView ? "Older PDF" : partialView ? "Partial PDF" : "Excerpt PDF"}
    </span>
  ) : compileResult?.stale ? (
    <span className="compile-state is-running"><TriangleAlert size={14} /> Needs update</span>
  ) : compileResult ? (
    <span className="compile-state is-error"><TriangleAlert size={14} /> Failed</span>
  ) : (
    <span className="compile-state">Quick reading</span>
  );

  // PDF tools live in the main LaTeX menu. The viewer stays mounted when that
  // menu closes, preserving its page, zoom and loaded document.
  const renderControls = (pdfControls?: ReactNode) => controlsTarget ? createPortal(
      <div className="preview-options-panel">
        <span className="preview-compile-bar" role="status" aria-label={statusDetail}>{compileStatus}</span>
        {pdfControls}
        <p className="preview-status-detail">{statusDetail}{compileResult?.success && !quickReading ? ` · ${(compileResult.durationMs / 1000).toFixed(1)}s` : ""}</p>
        {priorView && compileResult?.success && !quickReading && <p>This PDF is from another view. Scope changes update it automatically; other view changes may require Compile.</p>}
        {compileResult?.viewNote && !quickReading && <p>{compileResult.viewNote}</p>}
        <p>Ctrl/⌘-click source to find it here. Double-click a preview passage to find its source. PDF links need an up-to-date compile.</p>
        <details className="compile-log is-compact preview-details">
          <summary>Build details</summary>
          <p>{compileResult?.success && !quickReading ? `Paper typography · ${compileResult.mode === "full" ? "complete document" : "focused excerpt; pagination and float positions may differ"}. Editor appearance doesn't change this PDF.` : "Quick reading is approximate. Compile to see custom LaTeX commands and page layout."}</p>
          {compileResult && <pre>{compileResult.log}</pre>}
        </details>
      </div>
    , controlsTarget) : null;

  return (
    <section className="preview-pane" aria-label="LaTeX preview">
      {compileResult?.success && compileResult.pdfUrl && !quickReading ? (
        <Suspense fallback={<>{renderControls()}<div className="pdf-loading"><LoaderCircle className="spin" size={20} /> Loading PDF renderer</div></>}>
          <PdfViewer continuous active={active} darkDisplay={darkPdf} zoomFactor={zoom} onZoomFactorChange={setZoom} visiblePages={compileResult.originalPages} jumpTarget={jumpTarget} onSourcePosition={onPdfSourcePosition} url={compileResult.pdfUrl}
            readingIdentity={JSON.stringify([figureProject?.project.id, compileResult.mainFile, compileResult.engine, compileResult.mode, compileResult.scope, compileResult.originalPages])}
            unavailableDestinations={compileResult.unavailablePdfDestinations} renderControls={renderControls} />
        </Suspense>
      ) : (
        <>
        {renderControls()}
        <div className="preview-canvas" ref={scrollRef} tabIndex={0} aria-label="Reading preview · Ctrl/⌘ scroll to zoom" onWheel={event => {
          sectionWheel(event);
          if (!blockWindowNavigation) return;
          const scroll = event.currentTarget;
          const step = windowScrollStep(wheelIntent.current, { deltaY: event.deltaY, deltaMode: event.deltaMode, now: performance.now(),
            scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, before: blockWindowNavigation.before, after: blockWindowNavigation.after,
            blocked: blockWindowNavigation.blocked || event.ctrlKey || event.metaKey || !window.getSelection()?.isCollapsed });
          wheelIntent.current = step.intent; if (step.direction) blockWindowNavigation.onMove(step.direction);
        }}>
          {compileResult && !compileResult.success && (
            <details className="compile-log" open>
              <summary>LaTeX diagnostics</summary>
              <pre>{compileResult.log}</pre>
            </details>
          )}
          <article className="preview-page pane-zoom-content" style={{ zoom }}>
            {sectionNavigation?.previous && <button className="section-edge-link" disabled={sectionNavigation.blocked} title="Pause at the top, then scroll farther upward" onClick={() => sectionNavigation.onMove(-1)}>↑ {sectionNavigation.previous}</button>}
            {lens === "themes" && theme ? (
              <>
                <h2>Theme: {theme.name}</h2>
                {themePassages(paragraphs, theme.matches.filter((match) => !match.excluded).map((match) => match.paragraphId)).map((paragraph) => <div key={paragraph.id} data-preview-paragraph={paragraph.id} className={jumpTarget?.paragraphId === paragraph.id ? "preview-source-target" : undefined} title="Double-click to find this passage in the source" onDoubleClick={event => { if (!(event.target as HTMLElement).closest("a,button")) onSyncToSource?.(paragraph.id); }}>{paragraph.renderIssue ? <div className="unrendered-passage"><p>{paragraphEdits[paragraph.id] ?? paragraph.text}</p>{paragraph.renderIssue && <small>{paragraph.renderIssue} · Source saved.</small>}</div> : <Suspense fallback={<p>Rendering passage…</p>}><RenderedPassage text={paragraphEdits[paragraph.id] ?? paragraph.text} figureContext={figureContext} contents={contents} onHeading={followContents} onReference={onReference ? token => onReference({ token, paragraphId: paragraph.id }) : undefined} /></Suspense>}</div>)}
              </>
            ) : (
              previewNodes.map((node) => {
                const Heading = manuscriptHeadingTag(node);
                return <section key={paragraphIds ? node.paragraphIds[0] : "renderKey" in node ? node.renderKey as string : node.id} className={proofKinds.has(node.kind) ? "preview-proof" : ""} data-heading-level={sectionHeadingLevel(node)}>
                  {!("continued" in node && node.continued) && <Heading className="preview-heading">{node.number ? `${node.number} ` : ""}{focusedNodeId && node.proofFor?.includes(focusedNodeId) ? linkedProofTitle(node, nodes) : node.title}</Heading>}
                  {focusedNodeId && node.proofFor?.includes(focusedNodeId) && <small className="source-file-badge">Linked proof · {paragraphMap.get(node.paragraphIds[0])?.file ?? node.sourceInsertion?.file}</small>}
                  {node.paragraphIds.map((paragraphId) => {
                    const paragraph = paragraphMap.get(paragraphId);
                    return paragraph ? <div key={paragraphId} data-preview-paragraph={paragraphId} className={jumpTarget?.paragraphId === paragraphId ? "preview-source-target" : undefined} title="Double-click to find this passage in the source" onDoubleClick={event => { if ((event.target as HTMLElement).closest("a,button")) return; onSyncToSource?.(paragraphId); }}>{paragraph.renderIssue ? <div className="unrendered-passage"><p>{paragraphEdits[paragraphId] ?? paragraph.text}</p>{paragraph.renderIssue && <small>{paragraph.renderIssue} · Source saved.</small>}</div> : <Suspense fallback={<p>Rendering passage…</p>}><RenderedPassage text={paragraphEdits[paragraphId] ?? paragraph.text} figureContext={figureContext} contents={contents} onHeading={followContents} onReference={onReference ? token => onReference({ token, paragraphId: paragraphId }) : undefined} /></Suspense>}</div> : null;
                  })}
                </section>;
              })
            )}
            {sectionNavigation?.next && <button className="section-edge-link" disabled={sectionNavigation.blocked} title="Pause at the bottom, then scroll farther downward" onClick={() => sectionNavigation.onMove(1)}>↓ {sectionNavigation.next}</button>}
          </article>
          <p className="preview-note">{compileResult?.success && compileResult.pdfUrl ? "Choose LaTeX PDF in Preview to return to the saved layout. Switching doesn't compile." : "Compile this view or the full paper to see the typeset PDF."}</p>
        </div>
        </>
      )}
      <PaneZoomIndicator zoom={zoom} label="preview" onReset={() => setZoom(1)} />
    </section>
  );
}
