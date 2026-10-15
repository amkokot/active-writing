import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BookmarkPlus, CircleHelp, Focus, Link2, MessageSquareText, Scan, Sparkles, WandSparkles } from "lucide-react";
import { referenceTokens, sourceReferenceSummary, expandSourceReference } from "../references";
import { deleteSourceText, editableCaret, editableText, editableRangeAt, restoreEditableCaret, splitEditCaret } from "../editableText";
import { chunkAtOffset, hasTrailingLineBreak, joinChunkAtStart, removeEmptyChunk, sourceChunks } from "../sourceChunks";
import { clipSelectedChunks } from "../selectionPassages";
import { highlightActionsPosition, arrowBlockDirection, blockActionsBottom } from "../editorGeometry";
import type { ChunkAction } from "../sourceChunks";
import type { QueuedPassage } from "../queueEntries";
import { completeTypedEnvironment, type BlockTypes, type BlockTypeControl, type EnvironmentFields } from "../environmentEditing";
import { useStableEvent } from "../useStableEvent";
import { manuscriptHeadingTag, sectionHeadingLevel } from "../headingHierarchy";
import { usePaneZoomGestures, useStoredPaneZoom } from "../usePaneZoom";
import { PaneZoomIndicator } from "./PaneZoomIndicator";
import { SourceLineNumbers } from "./SourceLineNumbers";
import { ReelScrollbar } from "./ReelScrollbar";
import { SourceCommand, type SourceCommandEditing } from "./SourceCommand";
import { useSectionEdges, type SectionNavigation } from "../useSectionEdges";
import { useReadingLayout } from "../usePaneLayout";
import { reelOpacity } from "../blockReel";
import { useBlockReel, type ReelWindow } from "../useBlockReel";
import { visiblePreviewNodes, sourceOrderedBlocks } from "../workspaceTools";
import { linkedProofTitle } from "../proofLinks";
import { anchoredScrollTop, captureSourceViewport, type SourceJumpTarget, type SourceViewportPosition } from "../sourceViewport";
import { WritingMarker } from "./WritingMarker";
import { BlockCommentsButton } from "./BlockCommentsButton";
import { sourceCommandId } from "../taskSource";
import type { WritingMarker as Marker } from "../writing";
import type {
  Lens,
  ManuscriptNode,
  Paragraph,
  PendingSelection,
  RewriteSession,
  ReferenceRequest,
} from "../types";

interface ManuscriptProps {
  blockCommentCounts?: Record<string, number>;
  onOpenBlockComments?: (id: string) => void;
  writingMarkers?: Record<string, Marker>;
  onWritingReview?: (id: string) => void;
  explicitBlocks?:boolean;
  onOpenSourceCommand?:(command:{file:string;start:number})=>void;
  commandEditing?: SourceCommandEditing;
  sectionNavigation?: SectionNavigation;
  lens: Lens;
  nodes: ManuscriptNode[];
  paragraphs: Paragraph[];
  activeNodeId: string;
  focusedNodeId?: string;
  hiddenNodeIds: string[];
  paragraphEdits: Record<string, string>;
  rewriteSessions: RewriteSession[];
  pendingSelection?: PendingSelection;
  commentHighlight?: Pick<PendingSelection, "paragraphId" | "start" | "end" | "text">;
  readOnly?: boolean;
  onSelectNode: (nodeId: string) => void;
  onParagraphEdit: (paragraphId: string, text: string) => void;
  onJoinParagraphs?: (previousId: string, currentId: string, previousText: string, currentText: string) => void;
  onUndoParagraphJoin?: (paragraphId: string) => void;
  onParagraphFocus: (paragraphId: string, nodeId: string) => void;
  onSelection: (selection?: PendingSelection) => void;
  onBeginRewrite: () => void;
  onOpenRewrite: (id: string) => void;
  onCreateTheme: () => void;
  onExplore: () => void;
  onComment: () => void;
  onReviewLater: () => void;
  onChunkAction: (action: ChunkAction, selection: PendingSelection) => void;
  hasBlockContext?: (paragraphId: string, text: string, start: number, end: number) => boolean;
  isQueued?: (selection: QueuedPassage) => boolean;
  blockTypes?: BlockTypes;
  onReference: (request: ReferenceRequest) => void;
  jumpTarget?: SourceJumpTarget;
  positionReader?: RefObject<(() => SourceViewportPosition | undefined) | undefined>;
  onViewportExit?: (position: SourceViewportPosition) => void;
  blockWindow?: ReelWindow;
  onWindowFocus?: (paragraphId: string) => void;
  onWindowNavigate?: (paragraphId: string) => void;
  onSyncToPreview?: (paragraphId: string) => void;
  turbo?: ReelWindow & { activeId: string; checked: boolean; waiting: boolean; autoCheck: boolean; atEnd: boolean };
  onTurboFocus?: (paragraphId: string) => void;
  onTurboScroll?: (paragraphId: string) => void;
}

const proofKinds = new Set(["theorem", "lemma", "corollary", "proof"]);

function TypeSelect({ control, editable, choose }: { control: BlockTypeControl; editable: boolean; choose: (value:string)=>void }) {
  return <select className="block-type-select" aria-label="Block type" title={control.enabled ? control.title : "Edit this incomplete or cross-file wrapper in Source"} value={control.environment ?? ""} disabled={!editable || !control.enabled} onChange={event=>choose(event.target.value)}>
    <option value="">Text</option>{control.environment && !control.options.some(o=>o.name===control.environment) && <option value={control.environment}>{control.environment}</option>}
    {control.options.map(o=><option value={o.name} key={o.name}>{o.title}{o.name !== o.title.toLowerCase() ? ` (${o.name})` : ""}</option>)}
  </select>;
}
function EnvironmentHeadingTools({ node, paragraph, text, control, editable }: { node: ManuscriptNode; paragraph: Paragraph; text:string; control:BlockTypeControl; editable:boolean }) {
  const label = control.labels?.find(l=>l.nodeId===node.id)?.key ?? "";
  const [draft,setDraft]=useState<EnvironmentFields>();
  const detailsRef=useRef<HTMLDetailsElement>(null);
  const fields=draft ?? {description:node.environmentTitle ?? "",label};
  useEffect(()=>{ if(draft && draft.description === (node.environmentTitle ?? "") && draft.label === label){setDraft(undefined);if(detailsRef.current)detailsRef.current.open=false;} },[draft,node.environmentTitle,label]);
  const selection=()=>({paragraphId:paragraph.id,nodeId:node.id,start:0,end:text.length,text});
  return <div className="environment-heading-tools">
    <TypeSelect control={control} editable={editable} choose={environment=>control.onChange(selection(),environment,environment ? draft : undefined)} />
    <details ref={detailsRef}><summary>{node.environmentTitle || label ? "Name & label" : "+ Name / label"}</summary><div className="environment-fields">
      <label>Description<input aria-label="Environment description" value={fields.description} maxLength={500} placeholder="e.g. Stability bound" disabled={!editable || !control.enabled} onChange={event=>setDraft({...fields,description:event.target.value})} /></label>
      <label>Reference label<input aria-label="Environment reference label" value={fields.label} maxLength={150} placeholder="e.g. thm:stability" disabled={!editable || !control.enabled} onChange={event=>setDraft({...fields,label:event.target.value})} /></label>
      <small>Saved as [description] and \label&#123;key&#125; in the original file.{label && fields.label !== label ? " Existing references are not renamed automatically." : ""}</small>
      <button disabled={!draft || !editable || !control.enabled} onClick={()=>control.onChange(selection(),node.environment!,fields)}>Apply heading</button>
    </div></details>
  </div>;
}

interface BlockProps {
  blockCommentCounts?: ManuscriptProps["blockCommentCounts"]; onOpenBlockComments?: ManuscriptProps["onOpenBlockComments"];
  writingMarkers?: ManuscriptProps["writingMarkers"]; onWritingReview?: ManuscriptProps["onWritingReview"];
  explicitBlocks:boolean;onOpenSourceCommand?:ManuscriptProps["onOpenSourceCommand"];
  commandEditing?: SourceCommandEditing;
  node: ManuscriptNode; paragraphs: Paragraph[]; edits: Record<string, string>;
  drafts: Map<string, RewriteSession[]>; active: boolean; highlightedId?: string;
  turbo: boolean; editable: boolean; stateLabel?: string; showHeading?: boolean; linkedProof?: boolean; headingTitle?: string;
  onSelect: (id: string) => void; onEdit: ManuscriptProps["onParagraphEdit"];
  onReference: ManuscriptProps["onReference"]; onFocus: ManuscriptProps["onParagraphFocus"];
  onOpenDraft: (id: string) => void; onTurboFocus: (id: string) => void;
  onChunkAction: ManuscriptProps["onChunkAction"];
  hasBlockContext?: ManuscriptProps["hasBlockContext"];
  isQueued?: ManuscriptProps["isQueued"];
  blockTypes?: BlockTypes;
}

const ManuscriptBlock = memo(function ManuscriptBlock({ blockCommentCounts, onOpenBlockComments, writingMarkers, onWritingReview, explicitBlocks,onOpenSourceCommand,commandEditing,node, paragraphs, edits, drafts, active, highlightedId, turbo, editable, stateLabel, showHeading = true, linkedProof = false, headingTitle, onSelect, onEdit, onReference, onFocus, onOpenDraft, onTurboFocus, onChunkAction, hasBlockContext, isQueued, blockTypes }: BlockProps) {
  const Heading = manuscriptHeadingTag(node);
  const typeControl = useMemo(() => blockTypes ? { ...blockTypes, environment: node.environment, enabled: !node.environment || !!node.canChangeEnvironment,
    title: node.environment ? `Type for the whole ${node.environment} environment · all its blocks` : "Wrap just this block in a declared LaTeX environment" } : undefined, [blockTypes, node.environment, node.canChangeEnvironment]);
  return <section className={`manuscript-node kind-${node.kind} ${linkedProof ? "is-linked-proof" : ""} ${active ? "is-active" : ""} ${turbo ? stateLabel ? "turbo-active" : "turbo-context" : ""}`} data-node-id={node.id} data-heading-level={sectionHeadingLevel(node)}>
    {showHeading && !!blockCommentCounts?.[sourceCommandId(node.id, "opening")] && <div className="heading-comments-anchor"><BlockCommentsButton blockId={sourceCommandId(node.id, "opening")} count={blockCommentCounts[sourceCommandId(node.id, "opening")]} onOpen={onOpenBlockComments} /></div>}
    {showHeading && <div className="manuscript-heading-row">{explicitBlocks ? <Heading className="manuscript-heading" onClick={() => onSelect(node.id)}>{node.number && <span>{node.number} </span>}{headingTitle ?? node.title}</Heading> : node.sourceOpening ? <SourceCommand nodeId={node.id} command={node.sourceOpening} editable={editable} editing={commandEditing}/> : null}{node.environment && paragraphs[0] && typeControl && <EnvironmentHeadingTools node={node} paragraph={paragraphs[0]} text={edits[paragraphs[0].id] ?? paragraphs[0].text} control={typeControl} editable={editable} />}</div>}
    {turbo && (stateLabel ? <div className="turbo-paragraph-state">{stateLabel}</div> : <button className="turbo-context-focus" aria-label="Focus this paragraph" title="Focus this paragraph · no check" onClick={() => onTurboFocus(paragraphs[0].id)}><Focus size={13} /></button>)}
    {showHeading && paragraphs[0]?.file && <small className="source-file-badge" title="Edits are saved back to this original source file">{linkedProof ? "Linked proof · " : ""}{paragraphs[0].file}</small>}
    {paragraphs.map((paragraph) => <ManuscriptParagraph key={paragraph.id} paragraph={paragraph} text={edits[paragraph.id] ?? paragraph.text} editable={editable}
      writingMarker={writingMarkers?.[paragraph.id]} onWritingReview={onWritingReview}
      commentCount={blockCommentCounts?.[paragraph.id]} onOpenBlockComments={onOpenBlockComments}
      highlighted={highlightedId === paragraph.id} draftCount={drafts.get(paragraph.id)?.length ?? 0} draftId={drafts.get(paragraph.id)?.[0]?.id}
      onEdit={onEdit} onReference={onReference} onFocus={onFocus} onOpenDraft={onOpenDraft} onChunkAction={onChunkAction} hasBlockContext={hasBlockContext} isQueued={isQueued} typeControl={typeControl} />)}
    {!explicitBlocks && node.sourceClosing && (node.sourceLastParagraphId ? paragraphs.at(-1)?.id===node.sourceLastParagraphId : !node.paragraphIds.length) && <SourceCommand nodeId={node.id} closing command={node.sourceClosing} editable={editable} editing={commandEditing}/>}
  </section>;
}, (before, after) => {
  if (before.blockCommentCounts !== after.blockCommentCounts || before.onOpenBlockComments !== after.onOpenBlockComments) return false;
  if (before.writingMarkers !== after.writingMarkers || before.onWritingReview !== after.onWritingReview) return false;
  if (before.commandEditing !== after.commandEditing) return false;
  if(before.explicitBlocks!==after.explicitBlocks || before.onOpenSourceCommand!==after.onOpenSourceCommand || before.node.sourceLastParagraphId!==after.node.sourceLastParagraphId || before.node.sourceOpening?.text!==after.node.sourceOpening?.text || before.node.sourceOpening?.start!==after.node.sourceOpening?.start || before.node.sourceClosing?.text!==after.node.sourceClosing?.text || before.node.sourceClosing?.start!==after.node.sourceClosing?.start)return false;
  if (before.active !== after.active || before.turbo !== after.turbo || before.editable !== after.editable || before.stateLabel !== after.stateLabel || before.showHeading !== after.showHeading || before.linkedProof !== after.linkedProof || before.headingTitle !== after.headingTitle
    || before.node.id !== after.node.id || before.node.kind !== after.node.kind || before.node.depth !== after.node.depth || before.node.title !== after.node.title || before.node.number !== after.node.number || before.node.environment !== after.node.environment
    || before.onSelect !== after.onSelect || before.onEdit !== after.onEdit || before.onReference !== after.onReference || before.onFocus !== after.onFocus || before.onOpenDraft !== after.onOpenDraft || before.onTurboFocus !== after.onTurboFocus || before.onChunkAction !== after.onChunkAction || before.hasBlockContext !== after.hasBlockContext
    || before.isQueued !== after.isQueued || before.blockTypes !== after.blockTypes || before.node.canChangeEnvironment !== after.node.canChangeEnvironment || before.paragraphs.length !== after.paragraphs.length) return false;
  return before.paragraphs.every((p, index) => {
    const next = after.paragraphs[index];
    const oldDrafts = before.drafts.get(p.id); const newDrafts = after.drafts.get(next.id);
    return p.id === next.id && p.nodeId === next.nodeId && p.file === next.file && p.sourceLine === next.sourceLine && p.kind === next.kind && p.renderIssue === next.renderIssue && p.emptySource === next.emptySource
      && (before.edits[p.id] ?? p.text) === (after.edits[next.id] ?? next.text)
      && (before.highlightedId === p.id) === (after.highlightedId === next.id)
      && (oldDrafts?.length ?? 0) === (newDrafts?.length ?? 0) && oldDrafts?.[0]?.id === newDrafts?.[0]?.id;
  });
});

const ManuscriptParagraph = memo(function ManuscriptParagraph({ commentCount, onOpenBlockComments, writingMarker, onWritingReview, paragraph, text, editable, highlighted, draftCount, draftId, onEdit, onReference, onFocus, onOpenDraft, onChunkAction, hasBlockContext, isQueued, typeControl }: {
  commentCount?: number; onOpenBlockComments?: ManuscriptProps["onOpenBlockComments"];
  writingMarker?: Marker; onWritingReview?: ManuscriptProps["onWritingReview"];
  paragraph: Paragraph; text: string; editable: boolean; highlighted: boolean; draftCount: number; draftId?: string;
  onEdit: ManuscriptProps["onParagraphEdit"]; onReference: ManuscriptProps["onReference"]; onFocus: ManuscriptProps["onParagraphFocus"]; onOpenDraft: (id: string) => void;
  onChunkAction: ManuscriptProps["onChunkAction"];
  hasBlockContext?: ManuscriptProps["hasBlockContext"];
  isQueued?: ManuscriptProps["isQueued"];
  typeControl?: BlockTypeControl;
}) {
  const tokens = useMemo(() => referenceTokens(text), [text]);
  return <div className={`paragraph-wrap ${commentCount ? "has-block-comments" : ""} ${paragraph.kind ? `is-${paragraph.kind}` : ""} ${highlighted ? "reference-target" : ""}`}>
    <BlockCommentsButton blockId={paragraph.id} count={commentCount} onOpen={onOpenBlockComments} />
    <SourceParagraph paragraph={paragraph} text={text} editable={editable} onEdit={onEdit} onReference={onReference} onFocus={onFocus} onChunkAction={onChunkAction} hasBlockContext={hasBlockContext} isQueued={isQueued} typeControl={typeControl} />
    <WritingMarker marker={writingMarker} onOpen={onWritingReview} />
    {paragraph.renderIssue && <small className="source-snippet-note">{paragraph.renderIssue} · Editing remains available.</small>}
    {tokens.length > 0 && <button className="paragraph-references" title="Browse references in this paragraph" aria-label="Browse paragraph references" onClick={() => onReference({ token: { ...tokens[0], keys: [...new Set(tokens.filter((item) => item.kind === tokens[0].kind).flatMap((item) => item.keys))] }, paragraphId: paragraph.id, inspect: true })}><Link2 size={13} /></button>}
    {draftCount > 0 && <button className="paragraph-draft" onClick={() => draftId && onOpenDraft(draftId)} aria-label={`Open ${draftCount} saved rewrite draft${draftCount > 1 ? "s" : ""}`}>{draftCount} rewrite draft{draftCount > 1 ? "s" : ""}</button>}
  </div>;
});

function textOffset(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return editableText(range.cloneContents()).length;
}

/** Reel blocks have separate wrappers; source neighbors still belong to the
 * same section/environment and file. Never cross those editing boundaries. */
function sourceSiblings(root: HTMLElement) {
  const scope = root.closest(".manuscript-page, [data-source-surface]") ?? root.closest(".manuscript-node");
  return [...(scope?.querySelectorAll<HTMLElement>("p.source-chunks[data-paragraph-id]") ?? [])]
    .filter(p => p.dataset.nodeId === root.dataset.nodeId && p.dataset.sourceFile === root.dataset.sourceFile)
    .filter(p => !p.closest('[data-reel-held="true"]'));
}

export function SourceParagraph({ paragraph, text, editable, onEdit, onReference, onFocus, onChunkAction, hasBlockContext, isQueued, typeControl }: { paragraph: Paragraph; text: string; editable: boolean; onEdit: (id: string, text: string) => void; onReference: (request: ReferenceRequest) => void; onFocus: (paragraphId: string, nodeId: string) => void; onChunkAction?: ManuscriptProps["onChunkAction"]; hasBlockContext?: ManuscriptProps["hasBlockContext"]; isQueued?: ManuscriptProps["isQueued"]; typeControl?: BlockTypeControl }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(false);
  const [removedBlank, setRemovedBlank] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const paragraphRef = useRef<HTMLParagraphElement>(null);
  const diskText = useRef(paragraph.text);
  const emittedText = useRef(text);
  const history = useRef({ entries: [{ text, caret: text.length }], index: 0 });
  const expandedReferences = useRef(new Set<string>());
  const [activeChunk, setActiveChunk] = useState({ start: 0, end: text.length, bottom: 0 });
  const chunksFor = (value: string) => sourceChunks(value, Boolean(typeControl?.environment));
  useEffect(() => {
    if (!selected) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && !shellRef.current?.contains(event.target)) {
        setSelected(false); expandedReferences.current.clear();
        paragraphRef.current?.querySelectorAll<HTMLElement>(".source-reference[data-compact-label]").forEach(link => { delete link.dataset.referenceExpanded; link.setAttribute("aria-expanded", "false"); link.contentEditable = "false"; });
      }
    };
    window.addEventListener("pointerdown", close); window.addEventListener("focusin", close);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("focusin", close); };
  }, [selected]);
  const pickChunk = (element?: HTMLElement | null) => {
    const root = paragraphRef.current; if (!root) return;
    const chunks = chunksFor(editableText(root));
    const chunk = element ? chunks[Number(element.dataset.chunkIndex)] : chunkAtOffset(chunks, editableCaret(root) ?? 0);
    if (!chunk) return;
    const span = element ?? root.querySelector<HTMLElement>(`[data-chunk-index="${chunks.indexOf(chunk)}"]`);
    root.querySelectorAll<HTMLElement>(":scope > .source-chunk").forEach(c => { c.dataset.active = String(c === span); });
    const shell = shellRef.current;
    // offsetTop can refer to a different positioned ancestor. Measure relative
    // to the actual control host, removing pane zoom from viewport coordinates.
    const frame = shell?.getBoundingClientRect(), box = (span ?? root).getBoundingClientRect();
    const bottom = frame && shell ? blockActionsBottom(box.bottom, frame.top, frame.width, shell.offsetWidth) : root.offsetHeight;
    setActiveChunk(previous => previous.start === chunk.start && previous.end === chunk.end && previous.bottom === bottom ? previous : { start: chunk.start, end: chunk.end, bottom });
  };
  const repositionChunk = useStableEvent(() => pickChunk(paragraphRef.current?.querySelector<HTMLElement>(".source-chunk[data-active=true]")));
  useEffect(() => {
    if (!selected || !paragraphRef.current) return;
    let frame = 0;
    const changed = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(repositionChunk); };
    const observer = new ResizeObserver(changed); observer.observe(paragraphRef.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [selected, repositionChunk]);
  const paint = (value: string, decorate = false, caret?: number) => {
    const root = paragraphRef.current; if (!root) return;
    const fragment = window.document.createDocumentFragment();
    const appendText = (span: HTMLElement, value: string) => {
      // Keep one Enter as one line break, including at the end of a block. A
      // final placeholder BR is visual only and is excluded by editableText.
      value.split("\n").forEach((line, index) => {
        if (index) { const br = window.document.createElement("br"); br.dataset.sourceBreak = "true"; span.append(br); }
        span.append(window.document.createTextNode(line));
      });
    };
    chunksFor(value).forEach((chunk, index) => {
      const span = window.document.createElement("span"); span.className = "source-chunk"; span.dataset.chunkIndex = String(index); span.dataset.empty = String(!chunk.text.trim());
      let cursor = 0;
      if (decorate) for (const token of referenceTokens(chunk.text)) {
        appendText(span, chunk.text.slice(cursor, token.start));
        const link = window.document.createElement("span"); link.className = "source-reference"; link.setAttribute("role", "link"); link.tabIndex = 0; link.contentEditable = "false";
        const compact = sourceReferenceSummary(token);
        link.textContent = token.raw;
        if (compact) {
          link.dataset.compactLabel = compact; link.setAttribute("role", "button"); link.setAttribute("aria-expanded", "false");
          link.setAttribute("aria-label", `${compact}. Expand full LaTeX reference.`);
          if (caret !== undefined && caret > chunk.start + token.start && caret <= chunk.start + token.end) expandedReferences.current.add(token.raw);
          if (expandedReferences.current.has(token.raw)) expandSourceReference(link, editable);
        } else if (editing) link.contentEditable = "inherit";
        link.title = compact ? "Click … to expand. Leave this passage to fold again. Ctrl/Cmd-click or right-click to follow." : "Ctrl/Cmd-click or right-click to follow. Plain click edits the exact LaTeX.";
        span.append(link); cursor = token.end;
      }
      appendText(span, chunk.text.slice(cursor));
      if (chunk.text.endsWith("\n")) { const placeholder = window.document.createElement("br"); placeholder.dataset.editorPlaceholder = "true"; span.append(placeholder); }
      fragment.append(span);
      if (chunk.separator) fragment.append(window.document.createTextNode(chunk.separator));
    });
    root.replaceChildren(fragment);
  };
  const normalizeChunks = (expected?: string, expectedCaret?: number) => {
    const root = paragraphRef.current; if (!root) return;
    const live = editableText(root), value = expected ?? live, caret = expectedCaret ?? editableCaret(root), chunks = chunksFor(value);
    const spans = [...root.querySelectorAll<HTMLElement>(":scope > .source-chunk")];
    if (live !== value || spans.length !== chunks.length || spans.some((span, i) => editableText(span) !== chunks[i].text)) { paint(value, true, caret); if (caret !== undefined) restoreEditableCaret(root, caret); }
    else spans.forEach((span, i) => { span.dataset.empty = String(!chunks[i].text.trim()); });
    const h = history.current;
    if (h.entries[h.index].text !== value) {
      h.entries = [...h.entries.slice(0, h.index + 1), { text: value, caret: caret ?? value.length }];
      while (h.entries.length > 100 || h.entries.length > 1 && h.entries.reduce((n, e) => n + e.text.length, 0) > 1000000) h.entries.shift();
      h.index = h.entries.length - 1;
    }
    if (emittedText.current !== value) { delete root.dataset.savedEmptyTail; emittedText.current = value; onEdit(paragraph.id, value); }
    pickChunk();
  };
  const insert = (value: string) => {
    const root = paragraphRef.current, selection = window.getSelection(); if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0); if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const before = editableText(root), start = textOffset(root, range.startContainer, range.startOffset), end = textOffset(root, range.endContainer, range.endOffset);
    history.current.entries[history.current.index].caret = start;
    // Use the exact requested edit, not Chromium's paragraph/placeholder rules.
    normalizeChunks(before.slice(0, start) + value + before.slice(end), start + value.length);
  };
  const undo = (redo: boolean) => {
    const h = history.current, index = h.index + (redo ? 1 : -1), root = paragraphRef.current;
    if (!root || index < 0 || index >= h.entries.length) return false;
    h.index = index; const entry = h.entries[index]; paint(entry.text); emittedText.current = entry.text; delete root.dataset.savedEmptyTail;
    onEdit(paragraph.id, entry.text); restoreEditableCaret(root, entry.caret); pickChunk();
    return true;
  };
  const run = (action: ChunkAction) => {
    const root = paragraphRef.current; if (!root || !onChunkAction) return;
    const value = editableText(root), chunk = chunkAtOffset(chunksFor(value), activeChunk.start), rect = root.getBoundingClientRect();
    if (!chunk.text.trim()) return;
    const menu = root.parentElement?.querySelector("details"); if (menu) menu.open = false;
    onChunkAction(action, { paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: chunk.start, end: chunk.end, text: chunk.text, x: rect.left + rect.width / 2, y: rect.bottom });
  };
  useEffect(() => { if (text.trim()) setRemovedBlank(false); }, [text]);
  useEffect(() => {
    const root = paragraphRef.current; if (!root || !editable) return;
    const removeNeighbor = (event: Event) => {
      // Autosave has already separated this blank from its preceding editor.
      // Put the separator in that editor's undo history before removing it.
      const value = editableText(root), h = history.current;
      h.entries = [...h.entries.slice(0, h.index + 1), { text: value + "\n\n", caret: value.length + 2 }];
      h.index = h.entries.length - 1;
      normalizeChunks(value, value.length); event.preventDefault();
    };
    root.addEventListener("aw-remove-empty-neighbor", removeNeighbor);
    return () => root.removeEventListener("aw-remove-empty-neighbor", removeNeighbor);
  }, [paragraph.id, editable]);
  const removeSavedBlank = (root: HTMLElement, value: string) => {
    if (value.trim() || paragraph.emptySource) return false;
    const siblings = sourceSiblings(root);
    const index = siblings.indexOf(root), target = siblings[index - 1];
    // Never cross a section, theorem/proof container, file or hidden/read-only
    // context. A lone section retains its empty writing surface.
    if (!target?.isContentEditable || target.dataset.sourceFile !== paragraph.file || !target.getClientRects().length) return false;
    if (hasBlockContext?.(paragraph.id, value, 0, value.length)) return true;
    const accepted = !target.dispatchEvent(new CustomEvent("aw-remove-empty-neighbor", { cancelable: true }));
    if (!accepted) return false;
    setRemovedBlank(true); setSelected(false); onEdit(paragraph.id, "");
    target.focus({ preventScroll: true }); restoreEditableCaret(target, editableText(target).length);
    return true;
  };
  // The browser owns editable children. React must not reconcile reference spans
  // that typing/pasting can remove; decorate only when the paragraph isn't active.
  useLayoutEffect(() => {
    const sourceChanged = diskText.current !== paragraph.text; diskText.current = paragraph.text;
    const element = paragraphRef.current;
    if (!element) return;
    // Focus can be restored before React commits the onFocus state update (and
    // mount effects can replay in development). Never redecorate an active caret.
    if (editing || window.document.activeElement === element) {
      const current = editableText(element);
      // A blank new box survives a save that trims parsed trailing whitespace.
      if (current.trimEnd() === text.trimEnd() && hasTrailingLineBreak(current)) {
        if (text === paragraph.text) element.dataset.savedEmptyTail = "true";
        return;
      }
      // An acknowledged structural save can split this source paragraph. Do not
      // leave its former whole text in the live editor to be re-emitted on blur.
      // Newer unsaved typing has priority and is never replaced by disk text.
      if (sourceChanged && text === paragraph.text && current === emittedText.current && current !== text) {
        const selection = window.getSelection();
        const caret = selection?.focusNode && element.contains(selection.focusNode) ? textOffset(element, selection.focusNode, selection.focusOffset) : current.length;
        const split = splitEditCaret(current, text, caret);
        paint(text); emittedText.current = text;
        history.current = { entries: [{ text, caret: Math.min(caret, text.length) }], index: 0 };
        queueMicrotask(() => {
          if (!element.isConnected || window.document.activeElement !== element) return;
          const siblings = sourceSiblings(element);
          const start = siblings.indexOf(element);
          const exact = split && split.parts.every((part, i) => siblings[start + i] && editableText(siblings[start + i]) === part);
          const target = exact ? siblings[start + split.index] : element;
          target.focus(); restoreEditableCaret(target, exact ? split.offset : caret);
        });
      }
      return;
    }
    const current = editableText(element);
    const keepBlank = current.trimEnd() === text.trimEnd() && hasTrailingLineBreak(current);
    const selection = window.getSelection();
    if (!sourceChanged && current === text && (element.dataset.crossBlockSelection === "true" || element.matches('[data-source-selected="true"]') || element.querySelector('[data-source-selected="true"]') || selection && !selection.isCollapsed && selection.rangeCount && selection.getRangeAt(0).intersectsNode(element))) return;
    if (keepBlank && text === paragraph.text) element.dataset.savedEmptyTail = "true";
    else delete element.dataset.savedEmptyTail;
    paint(keepBlank ? current : text, true);
    emittedText.current = keepBlank ? current : text;
    if (history.current.entries[history.current.index].text !== emittedText.current) history.current = { entries: [{ text: emittedText.current, caret: emittedText.current.length }], index: 0 };
  }, [text, paragraph.text, editing]);
  const follow = (element: HTMLElement, inspect = false) => {
    const source = element.closest("p");
    const current = source ? editableText(source) : text;
    const token = referenceTokens(current).find((item) => item.raw === element.textContent);
    onEdit(paragraph.id, current);
    if (token) onReference({ token, paragraphId: paragraph.id, inspect });
  };
  const referenceElement = (target: EventTarget) => target instanceof HTMLElement ? target.closest<HTMLElement>(".source-reference") : null;
  const expandReference = (link: HTMLElement) => {
    if (!link.dataset.compactLabel) return;
    expandedReferences.current.add(link.textContent ?? ""); expandSourceReference(link, editable); pickChunk();
  };
  return <div className={`source-editor-shell${selected ? " is-chunk-selected" : ""}`} hidden={removedBlank} ref={shellRef} onPointerDownCapture={event => { if ((event.target as HTMLElement).closest(".source-chunks")) setSelected(true); }}>{typeControl && !typeControl.environment && <div className="source-block-heading"><TypeSelect control={typeControl} editable={editable} choose={environment=>{
    const root=paragraphRef.current; if(!root)return;
    const value=editableText(root),chunk=chunkAtOffset(chunksFor(value),activeChunk.start);
    typeControl.onChange({paragraphId:paragraph.id,nodeId:paragraph.nodeId,start:chunk.start,end:chunk.end,text:chunk.text},environment);
  }} /></div>}<p className="source-chunks" ref={paragraphRef} data-paragraph-id={paragraph.id} data-node-id={paragraph.nodeId} data-source-file={paragraph.file} data-placeholder={paragraph.emptySource ? "Write here…" : undefined} aria-label={paragraph.emptySource ? "Write in this empty section" : "Edit manuscript text"} role={editable ? "textbox" : undefined} aria-multiline={editable ? true : undefined} contentEditable={editable} suppressContentEditableWarning
    onDragStart={event => event.preventDefault()} onDrop={event => event.preventDefault()}
    onPaste={event => { if (editable && !event.defaultPrevented) { event.preventDefault(); insert(event.clipboardData.getData("text/plain")); } }}
    onCopy={event => {
      const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0), root = event.currentTarget;
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
      event.preventDefault(); event.clipboardData.setData("text/plain", editableText(range.cloneContents()));
    }}
    onMouseDown={(event) => { const link = referenceElement(event.target); if (link && (event.ctrlKey || event.metaKey || event.button === 2)) { event.preventDefault(); follow(link, event.button === 2); } else if (link && event.button === 0) { if (link.dataset.compactLabel && link.dataset.referenceExpanded !== "true") { event.preventDefault(); expandReference(link); } else if (editable) link.contentEditable = "inherit"; } }}
    onContextMenu={(event) => { const link = referenceElement(event.target); if (link) { event.preventDefault(); follow(link, true); } }}
    onClick={event => { setSelected(true); const span = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".source-chunk") : null; pickChunk(span); }}
    onKeyDown={(event) => {
      if(event.defaultPrevented)return;
      const link = referenceElement(event.target);
      if (link?.dataset.compactLabel && ["Enter", " "].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); expandReference(link); paragraphRef.current?.focus({ preventScroll: true }); return; }
      if(editable && /^Arrow(Left|Right|Up|Down)$/.test(event.key) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing){
        const root=event.currentTarget,caret=editableCaret(root),selection=window.getSelection();
        if(caret!==undefined && selection?.isCollapsed){
          const length=editableText(root).length,rect=selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined,box=root.getBoundingClientRect(),line=parseFloat(getComputedStyle(root).lineHeight)||20;
          const direction=arrowBlockDirection(event.key,caret,length,caret===0 || !!rect?.height && rect.top<box.top+line*.7,caret===length || !!rect?.height && rect.bottom>box.bottom-line*.7);
          if(direction){
            const siblings=[...(root.closest(".manuscript-page, [data-source-surface]")?.querySelectorAll<HTMLElement>('p.source-chunks[data-paragraph-id]') ?? [])].filter(p=>p.isContentEditable && p.getClientRects().length && !p.closest('[data-reel-held="true"]'));
            const target=siblings[siblings.indexOf(root)+direction];
            if(target){
              let offset=direction<0?editableText(target).length:0;
              if((event.key==="ArrowUp" || event.key==="ArrowDown") && rect?.height){
                const bounds=target.getBoundingClientRect(),targetLine=parseFloat(getComputedStyle(target).lineHeight)||line;
                const point=root.ownerDocument.caretRangeFromPoint(Math.max(bounds.left+1,Math.min(bounds.right-1,rect.left)),direction<0?bounds.bottom-targetLine/2:bounds.top+targetLine/2);
                if(point && target.contains(point.startContainer))offset=textOffset(target,point.startContainer,point.startOffset);
              }
              event.preventDefault();target.focus();restoreEditableCaret(target,offset);return;
            }
          }
        }
      }
      if (link && event.key === "Enter") { event.preventDefault(); follow(link); return; }
      if (editable && (event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault(); const redo = event.shiftKey || event.key.toLowerCase() === "y";
        if (!undo(redo) && !redo) event.currentTarget.dispatchEvent(new CustomEvent("aw-undo-paragraph-join", { bubbles: true }));
        return;
      }
      if (editable && ["Backspace", "Delete"].includes(event.key) && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const root = event.currentTarget, value = editableText(root), caret = editableCaret(root);
        const removal = event.key === "Backspace" && caret !== undefined ? removeEmptyChunk(value, caret, Boolean(typeControl?.environment)) : undefined;
        if (removal) {
          event.preventDefault();
          if (!hasBlockContext?.(paragraph.id, value, removal.start, removal.end)) { history.current.entries[history.current.index].caret = caret!; normalizeChunks(removal.text, removal.caret); }
          return;
        }
        const join = event.key === "Backspace" && caret !== undefined ? joinChunkAtStart(value, caret, Boolean(typeControl?.environment)) : undefined;
        if (join) { event.preventDefault(); history.current.entries[history.current.index].caret = caret!; normalizeChunks(join.text, join.caret); return; }
        const selection = window.getSelection();
        if (event.key === "Backspace" && caret !== undefined && !value.trim() && removeSavedBlank(root, value)) { event.preventDefault(); return; }
        if (selection?.rangeCount) {
          const range = selection.getRangeAt(0);
          if (root.contains(range.startContainer) && root.contains(range.endContainer)) {
            event.preventDefault();
            const start = textOffset(root, range.startContainer, range.startOffset), end = textOffset(root, range.endContainer, range.endOffset);
            const deleted = deleteSourceText(value, start, end, event.key === "Backspace" ? "backward" : "forward");
            history.current.entries[history.current.index].caret = start;
            normalizeChunks(deleted.text, deleted.caret);
            return;
          }
        }
      }
      if (editable && event.key === "Enter" && !event.nativeEvent.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); insert("\n");
      }
    }}
    onKeyUp={() => pickChunk()}
    onFocus={(event) => { if (event.target === event.currentTarget) { setEditing(true); setSelected(true); event.currentTarget.querySelectorAll<HTMLElement>(".source-reference").forEach((link) => { if (!link.dataset.compactLabel || link.dataset.referenceExpanded === "true") link.contentEditable = "inherit"; }); normalizeChunks(); } onFocus(paragraph.id, paragraph.nodeId); pickChunk(); }} onInput={() => {
      const root=paragraphRef.current,caret=root && editableCaret(root);
      const completed=root && caret != null && !typeControl?.environment && completeTypedEnvironment(editableText(root),caret,typeControl?.options ?? []);
      if(completed) normalizeChunks(completed.text,completed.caret); else normalizeChunks();
    }}
    onBlur={(event) => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return; const current = editableText(event.currentTarget); if (current !== emittedText.current) onEdit(paragraph.id, current); expandedReferences.current.clear(); setEditing(false); }} />
    <SourceLineNumbers target={paragraphRef} text={text} start={paragraph.sourceLine} />
    {onChunkAction && selected && <div className="chunk-controls" aria-label="Block actions" onMouseDown={event => { if (!(event.target instanceof HTMLSelectElement)) event.preventDefault(); }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setSelected(false); paragraphRef.current?.focus(); } }}>
      <button title="Show in preview · Ctrl/Cmd-click source also works" aria-label="Show this block in preview" data-sync-preview={paragraph.id}><Scan size={12} /></button>
      <button title="Focus this block" aria-label="Focus this block" onClick={() => run("focus")}><Focus size={12} /></button>
      <button title="Ask about this block" aria-label="Ask about this block" onClick={() => run("ask")}><CircleHelp size={12} /></button>
      <button title="Rephrase this block" aria-label="Rephrase this block" disabled={!editable} onClick={() => run("rewrite")}><WandSparkles size={12} /></button>
      <button title="Comment on this block" aria-label="Comment on this block" onClick={() => run("comment")}><MessageSquareText size={12} /></button>
      <button title="Toggle this block in the queue · notes stay open" aria-label="Return to this block later" aria-pressed={!!isQueued?.({ paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: activeChunk.start, end: activeChunk.end, text: text.slice(activeChunk.start, activeChunk.end) })} onClick={() => run("later")}><BookmarkPlus size={12} /></button>
    </div>}
  </div>;
}

export function Manuscript({
  blockCommentCounts,
  onOpenBlockComments,
  writingMarkers, onWritingReview,
  explicitBlocks = false,
  onOpenSourceCommand,
  commandEditing,
  sectionNavigation,
  lens,
  nodes,
  paragraphs,
  activeNodeId,
  focusedNodeId,
  hiddenNodeIds,
  paragraphEdits,
  rewriteSessions,
  pendingSelection,
  commentHighlight,
  readOnly = false,
  onSelectNode,
  onParagraphEdit,
  onJoinParagraphs,
  onUndoParagraphJoin,
  onParagraphFocus,
  onSelection,
  onBeginRewrite,
  onOpenRewrite,
  onCreateTheme,
  onExplore,
  onComment,
  onReviewLater,
  onChunkAction,
  hasBlockContext,
  isQueued,
  blockTypes,
  onReference,
  jumpTarget,
  positionReader,
  blockWindow,
  onWindowFocus,
  onSyncToPreview,
  onWindowNavigate,
  onViewportExit,
  turbo,
  onTurboFocus,
  onTurboScroll,
}: ManuscriptProps) {
  const openSourceCommand=useStableEvent((command:{file:string;start:number})=>onOpenSourceCommand?.(command));
  const editorRef = useRef<HTMLDivElement>(null);
  const undoParagraphJoin = useStableEvent((id: string) => onUndoParagraphJoin?.(id));
  useEffect(() => {
    const root = editorRef.current; if (!root) return;
    const undo = (event: Event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("p.source-chunks[data-paragraph-id]") : null;
      if (target && root.contains(target) && target.isContentEditable) undoParagraphJoin(target.dataset.paragraphId!);
    };
    root.addEventListener("aw-undo-paragraph-join", undo);
    return () => root.removeEventListener("aw-undo-paragraph-join", undo);
  }, [undoParagraphJoin, paragraphs.length]);
  const dragSelection = useRef<{ paragraphId:string; offset:number; crossed?:boolean; endId?:string; endOffset?:number } | undefined>(undefined);
  const [selectionDragging, setSelectionDragging] = useState(false);
  // Native Selection is clipped to one contenteditable host in Chromium.
  // Keep an exact document Range and paint it without changing editor contents.
  const crossBlockRange = useRef<Range | undefined>(undefined);
  const crossBlockEndpoint = useRef<Range | undefined>(undefined);
  const selectedSource = useRef<Array<HTMLElement | HTMLTextAreaElement> | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useStoredPaneZoom("editor");
  usePaneZoomGestures(scrollRef, zoom, setZoom);
  useReadingLayout(scrollRef);
  const sourceWindow = turbo ?? blockWindow;
  const sectionWheel = useSectionEdges(sectionNavigation);
  const reel = useBlockReel(scrollRef, sourceWindow, Boolean(pendingSelection) || readOnly, jumpTarget?.sequence, zoom, turbo ? onTurboScroll : onWindowFocus);
  const rememberViewport = useStableEvent((position: SourceViewportPosition) => onViewportExit?.(position));
  useLayoutEffect(() => {
    if (!positionReader) return;
    positionReader.current = () => captureSourceViewport(scrollRef.current);
    return () => {
      const position = captureSourceViewport(scrollRef.current);
      if (position) rememberViewport(position);
      positionReader.current = undefined;
    };
  }, [positionReader, rememberViewport]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const paragraphMap = useMemo(
    () => new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph])),
    [paragraphs],
  );
  const draftsByParagraph = useMemo(() => {
    const grouped = new Map<string, RewriteSession[]>();
    for (const session of rewriteSessions) if (["draft", "stale"].includes(session.status)) {
      const group = grouped.get(session.paragraphId) ?? []; group.push(session); grouped.set(session.paragraphId, group);
    }
    for (const group of grouped.values()) group.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return grouped;
  }, [rewriteSessions]);
  const selectNode = useStableEvent(onSelectNode); const editParagraph = useStableEvent(onParagraphEdit);
  const followReference = useStableEvent(onReference); const focusParagraph = useStableEvent((id: string, nodeId: string) => {
    onParagraphFocus(id, nodeId);
    if (blockWindow && !pendingSelection && !readOnly) onWindowFocus?.(id);
  });
  const openDraft = useStableEvent(onOpenRewrite); const focusTurbo = useStableEvent((id: string) => { if (!turbo?.blocked && !readOnly) onTurboFocus?.(id); });
  const chunkAction = useStableEvent((action: ChunkAction, selection: PendingSelection) => onChunkAction(action, pendingSelection?.spans?.some(span => span.paragraphId === selection.paragraphId) ? pendingSelection : selection));
  const blockContext = useStableEvent((id: string, text: string, start: number, end: number) => hasBlockContext?.(id, text, start, end) ?? false);
  const revealHeldEditor = useStableEvent((target: EventTarget | null) => {
    const held = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-reel-held="true"]') : null;
    if (held?.dataset.reelParagraph && sourceWindow && !sourceWindow.blocked && !pendingSelection && !readOnly) {
      reel.reveal();
      if (turbo) onTurboFocus?.(held.dataset.reelParagraph); else onWindowFocus?.(held.dataset.reelParagraph);
    }
  });

  const visibleNodes = useMemo(() => visiblePreviewNodes(nodes, lens, focusedNodeId, hiddenNodeIds), [focusedNodeId, hiddenNodeIds, lens, nodes]);

  useLayoutEffect(() => {
    if (!jumpTarget) return;
    if (jumpTarget.edge && scrollRef.current) {
      scrollRef.current.scrollTo({top: jumpTarget.edge === "end" ? scrollRef.current.scrollHeight : 0, behavior: "instant"}); return;
    }
    const target = jumpTarget.command ? editorRef.current?.querySelector(`[data-source-command-id="${CSS.escape(sourceCommandId(jumpTarget.nodeId, jumpTarget.command))}"]`) : jumpTarget.paragraphId
      ? editorRef.current?.querySelector(`[data-paragraph-id="${CSS.escape(jumpTarget.paragraphId)}"]`)
      : editorRef.current?.querySelector(`[data-node-id="${CSS.escape(jumpTarget.nodeId)}"]`);
    const scroll = editorRef.current?.closest<HTMLElement>(".manuscript-scroll");
    if (target && scroll) {
      if (jumpTarget.flash) {
        const marked = target as HTMLElement;
        delete marked.dataset.sourceFlash;
        void marked.offsetWidth; // Restart the flash for repeated navigation to the same passage.
        marked.dataset.sourceFlash = "true";
      }
      const rectangle = target.getBoundingClientRect();
      const frame = scroll.getBoundingClientRect();
      if (jumpTarget.viewportOffset !== undefined) {
        // Restore after reel initialization, before paint. Scope changes aren't navigation.
        scroll.scrollTo({ top: anchoredScrollTop(scroll.scrollTop, rectangle.top, frame.top, jumpTarget.viewportOffset), behavior: "instant" });
      } else scroll.scrollTo({ top: scroll.scrollTop + rectangle.top - frame.top - (rectangle.height < scroll.clientHeight ? (scroll.clientHeight - rectangle.height) / 2 : 20), behavior: "smooth" });
      if (jumpTarget.flash) {
        const timer = setTimeout(() => { delete (target as HTMLElement).dataset.sourceFlash; }, 650);
        return () => { clearTimeout(timer); delete (target as HTMLElement).dataset.sourceFlash; };
      }
    }
  }, [jumpTarget]);

  const clearCrossSelection = () => {
    selectedSource.current = undefined;
    editorRef.current?.querySelectorAll<HTMLElement>("[data-source-selected]").forEach(element => delete element.dataset.sourceSelected);
    crossBlockRange.current=undefined;
    crossBlockEndpoint.current=undefined;
    CSS.highlights?.delete("aw-selection");
    editorRef.current?.querySelectorAll<HTMLElement>("[data-cross-block-selection]").forEach(p=>delete p.dataset.crossBlockSelection);
    editorRef.current?.querySelectorAll<HTMLElement>("[data-has-text-selection]").forEach(p=>delete p.dataset.hasTextSelection);
  };
  const handleSelection = () => {
    editorRef.current?.querySelectorAll<HTMLElement>("[data-has-text-selection]").forEach(p=>delete p.dataset.hasTextSelection);
    const selection = window.getSelection();
    if (!crossBlockRange.current && (!selection || selection.isCollapsed || selection.rangeCount === 0)) {
      onSelection(undefined);
      return;
    }
    const range = crossBlockRange.current ?? selection!.getRangeAt(0);
    const editor = editorRef.current;
    if (!editor?.contains(range.startContainer) || !editor.contains(range.endContainer)) { onSelection(undefined); return; }
    const selectedElements = [...editor.querySelectorAll<HTMLElement>("p[data-paragraph-id]")].filter(p => p.getClientRects().length && range.intersectsNode(p));
    const spans = selectedElements.flatMap(p => {
      const whole = document.createRange(); whole.selectNodeContents(p);
      const clipped = range.cloneRange();
      if (range.compareBoundaryPoints(Range.START_TO_START, whole) < 0) clipped.setStart(p, 0);
      if (range.compareBoundaryPoints(Range.END_TO_END, whole) > 0) clipped.setEnd(p, p.childNodes.length);
      return clipSelectedChunks({ id: p.dataset.paragraphId!, nodeId: p.dataset.nodeId!, text: editableText(p) }, textOffset(p, clipped.startContainer, clipped.startOffset), textOffset(p, clipped.endContainer, clipped.endOffset));
    });
    if (!spans.length) { onSelection(undefined); return; }
    for (const span of spans) { const element = editor.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(span.paragraphId)}"]`); if (element) element.dataset.hasTextSelection = "true"; }
    const first = spans[0];
    const endpoint=crossBlockEndpoint.current?.cloneRange() ?? range.cloneRange();
    if (!crossBlockRange.current && selection?.focusNode && editor.contains(selection.focusNode)) {
      endpoint.setStart(selection.focusNode, selection.focusOffset); endpoint.collapse(true);
    } else if (!crossBlockEndpoint.current) endpoint.collapse(false);
    const rect=[...endpoint.getClientRects()].find(rect=>rect.height>0) ?? [...range.getClientRects()].filter(rect=>rect.height>0).at(-1) ?? range.getBoundingClientRect();
    const frame=scrollRef.current?.getBoundingClientRect();
    const pane={left:Math.max(0,frame?.left ?? 0),right:Math.min(window.innerWidth,frame?.right ?? window.innerWidth),top:Math.max(0,frame?.top ?? 0),bottom:Math.min(window.innerHeight,frame?.bottom ?? window.innerHeight)};
    const toolbar=editor.parentElement?.querySelector<HTMLElement>(".selected-block-actions");
    const position=highlightActionsPosition(rect,pane,toolbar?.offsetWidth || 220,toolbar?.offsetHeight || 28);
    onSelection({
      ...first, text: spans.map(span => span.text).join("\n\n"),
      ...(spans.length > 1 ? { spans } : {}),
      ...position,
    });
  };
  const pointAt = (x:number,y:number) => {
    const api=document as Document & {caretRangeFromPoint?: (x:number,y:number)=>Range|null; caretPositionFromPoint?: (x:number,y:number)=>{offsetNode:Node;offset:number}|null};
    const caret=api.caretRangeFromPoint?.(x,y), position=caret ? {node:caret.startContainer,offset:caret.startOffset} : (()=>{ const p=api.caretPositionFromPoint?.(x,y);return p ? {node:p.offsetNode,offset:p.offset} : undefined; })();
    const element=position?.node instanceof Element ? position.node : position?.node.parentElement;
    const root=element?.closest<HTMLElement>("p[data-paragraph-id]");
    if(!root || !position || !editorRef.current?.contains(root)) return undefined;
    return {root,offset:textOffset(root,position.node,position.offset)};
  };
  const extendSelection = (startId:string,startOffset:number,end:HTMLElement,endOffset:number) => {
    const start=editorRef.current?.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(startId)}"]`);
    if(!start || !editorRef.current?.contains(end))return;
    const a=editableRangeAt(start,startOffset),b=editableRangeAt(end,endOffset);
    const range=document.createRange(),forward=a.compareBoundaryPoints(Range.START_TO_START,b)<=0;
    range.setStart(forward?a.startContainer:b.startContainer,forward?a.startOffset:b.startOffset);
    range.setEnd(forward?b.startContainer:a.startContainer,forward?b.startOffset:a.startOffset);
    clearCrossSelection(); crossBlockRange.current=range; crossBlockEndpoint.current=b;
    if(typeof Highlight!=="undefined") CSS.highlights?.set("aw-selection",new Highlight(range));
    editorRef.current?.querySelectorAll<HTMLElement>("p[data-paragraph-id]").forEach(p=>{if(range.intersectsNode(p))p.dataset.crossBlockSelection="true";});
    window.getSelection()?.removeAllRanges();
    handleSelection();
  };

  const selectSource = (target: EventTarget | null, blockOnly: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;
    const element = target instanceof HTMLElement ? target : undefined;
    // Other controls keep their ordinary text-selection shortcuts.
    if (element?.closest("input,select,textarea:not(.literal-source-command)")) return;
    clearCrossSelection();
    if (blockOnly && element instanceof HTMLTextAreaElement) { element.select(); return true; }
    const paragraph = element?.closest<HTMLElement>("p[data-paragraph-id]");
    const block = paragraph?.querySelector<HTMLElement>('.source-chunk[data-active="true"]') ?? paragraph;
    const units = blockOnly ? block ? [block] : [] : [...editor.querySelectorAll<HTMLElement>("p[data-paragraph-id],textarea.literal-source-command")]
      .filter(unit => unit.getClientRects().length && !unit.closest('[data-reel-held="true"]'));
    if (!units.length) return;
    selectedSource.current = units;
    const ranges = units.filter(unit => !(unit instanceof HTMLTextAreaElement)).map(unit => {
      const range = document.createRange(); range.selectNodeContents(unit); return range;
    });
    // Keyboard selection must not expand folded references or reflow the pane.
    units.forEach(unit => { unit.dataset.sourceSelected = "true"; });
    if (typeof Highlight !== "undefined") CSS.highlights?.set("aw-selection", new Highlight(...ranges));
    // Keep existing multi-block tools and safe non-destructive selection behavior.
    if (ranges.length) {
      const range = document.createRange(); range.setStart(ranges[0].startContainer, ranges[0].startOffset);
      range.setEnd(ranges.at(-1)!.endContainer, ranges.at(-1)!.endOffset); crossBlockRange.current = range;
    }
    window.getSelection()?.removeAllRanges();
    reel.pause(); handleSelection();
    return true;
  };

  useEffect(()=>()=>{CSS.highlights?.delete("aw-selection");},[]);

  const selectionChanged = useStableEvent(handleSelection);
  useEffect(() => {
    let frame = 0;
    const finish = () => {
      dragSelection.current = undefined;
      setSelectionDragging(false);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(selectionChanged);
    };
    // A drag can finish outside this pane or after the window loses focus.
    window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish); window.addEventListener("blur", finish);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); window.removeEventListener("blur", finish); };
  }, [selectionChanged]);
  const highlightVisible=Boolean(pendingSelection),highlightCount=pendingSelection?.spans?.length ?? 1;
  // Measure after mounting / adding the block-count label, before paint. The
  // fallback width mustn't let a wider multi-block toolbar spill into the rail.
  useLayoutEffect(()=>{if(highlightVisible)selectionChanged();},[highlightVisible,highlightCount,selectionChanged]);
  const clearCrossSelectionStable=useStableEvent(clearCrossSelection);
  useEffect(()=>{if(!pendingSelection)clearCrossSelectionStable();},[pendingSelection,clearCrossSelectionStable]);
  useEffect(() => {
    let frame = 0;
    const onSelectionChange = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(selectionChanged); };
    document.addEventListener("selectionchange", onSelectionChange);
    scrollRef.current?.addEventListener("scroll", onSelectionChange);
    window.addEventListener("resize", onSelectionChange);
    document.addEventListener("fullscreenchange", onSelectionChange);
    const scroller = scrollRef.current;
    return () => { cancelAnimationFrame(frame); document.removeEventListener("selectionchange", onSelectionChange); scroller?.removeEventListener("scroll", onSelectionChange); window.removeEventListener("resize", onSelectionChange); document.removeEventListener("fullscreenchange", onSelectionChange); };
  }, [selectionChanged]);

  const blocks = sourceWindow ? reel.mounted.flatMap(paragraph => {
    const node = nodeMap.get(paragraph.nodeId);
    return node ? [{ ...node, paragraphIds: [paragraph.id] }] : [];
  }) : focusedNodeId && nodeMap.get(focusedNodeId)?.environment ? visibleNodes : sourceOrderedBlocks(visibleNodes,paragraphs);
  const mountedBlockIds = blocks.map(block => block.paragraphIds.join(",")).join(";");
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || !commentHighlight) return;
    let marked: HTMLElement | undefined, frame = 0;
    const clear = () => {
      CSS.highlights?.delete("aw-review-comment");
      if (marked) delete marked.dataset.reviewCommentHighlight;
      marked = undefined;
    };
    const paint = () => {
      clear();
      const command = editor.querySelector<HTMLTextAreaElement>(`textarea[data-source-command-id="${CSS.escape(commentHighlight.paragraphId)}"]`);
      if (command) {
        const { start, end } = commentHighlight;
        if (command.value.slice(start, end) === commentHighlight.text) { marked = command; command.dataset.reviewCommentHighlight = "block"; }
        return;
      }
      const host = editor.querySelector<HTMLElement>(`p.source-chunks[data-paragraph-id="${CSS.escape(commentHighlight.paragraphId)}"]`);
      if (!host || host.closest('[data-reel-held="true"]')) return;
      const text = editableText(host), { start, end } = commentHighlight;
      if (start < 0 || end <= start || end > text.length || text.slice(start, end) !== commentHighlight.text) return;
      marked = host;
      if (typeof Highlight !== "undefined" && CSS.highlights) {
        const range = editableRangeAt(host, start), tail = editableRangeAt(host, end);
        range.setEnd(tail.startContainer, tail.startOffset);
        CSS.highlights.set("aw-review-comment", new Highlight(range));
        host.dataset.reviewCommentHighlight = "exact";
      } else host.dataset.reviewCommentHighlight = "block";
    };
    paint();
    // Editor decorations/reel remounts can replace text nodes without changing
    // the saved quote. Repaint a separate Range, never the native Selection:
    // focus and typing remain in the comment field.
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(paint); });
    observer.observe(editor, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clear(); };
  }, [commentHighlight?.paragraphId, commentHighlight?.start, commentHighlight?.end, commentHighlight?.text, mountedBlockIds, paragraphEdits]);

  if (blocks.length === 0) {
    return (
      <div className="empty-editor">
        <Scan size={28} />
        <strong>No visible content</strong>
        <span>Clear focus or restore a hidden section from the outline.</span>
      </div>
    );
  }

  return (
    <div className="manuscript-zoom-pane">
    <div ref={scrollRef} tabIndex={0} aria-label="Manuscript editor · Ctrl/⌘ A selects visible source · Ctrl/⌘ Shift A selects a block · Ctrl/⌘ scroll to zoom" className={`manuscript-scroll ${explicitBlocks ? "explicit-source-blocks" : "plain-block-source"} ${turbo ? "turbo-scroll" : ""} ${sourceWindow ? "block-reel" : ""}`} onScroll={reel.scroll} onPointerDownCapture={event => {
      // Shift-click bridges separate editable hosts where native drag selection
      // otherwise stops at a block boundary. No manuscript text is changed.
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (event.target.closest("textarea.literal-source-command")) { clearCrossSelection(); onSelection(undefined); return; }
      if(!event.target.closest("p[data-paragraph-id]"))return;
      const point=pointAt(event.clientX,event.clientY); if(!point) {dragSelection.current=undefined;return;}
      setSelectionDragging(true);
      const end = point.root, selected = window.getSelection();
      const anchorNode=crossBlockRange.current?.startContainer ?? selected?.anchorNode;
      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
      const start = anchorElement?.closest<HTMLElement>("p[data-paragraph-id]");
      if (!event.shiftKey || !start || !editorRef.current?.contains(start)) { clearCrossSelection();dragSelection.current={paragraphId:end.dataset.paragraphId!,offset:point.offset};return; }
      event.preventDefault();
      const offset=textOffset(start,anchorNode!,crossBlockRange.current?.startOffset ?? selected!.anchorOffset);
      dragSelection.current={paragraphId:start.dataset.paragraphId!,offset,crossed:true,endId:end.dataset.paragraphId!,endOffset:point.offset};
      extendSelection(start.dataset.paragraphId!,offset,end,point.offset);
    }} onPointerMoveCapture={event=>{
      const anchor=dragSelection.current; if(!anchor || !(event.buttons&1))return;
      const point=pointAt(event.clientX,event.clientY); if(!point || !anchor.crossed && point.root.dataset.paragraphId===anchor.paragraphId)return;
      event.preventDefault(); anchor.crossed=true;anchor.endId=point.root.dataset.paragraphId;anchor.endOffset=point.offset;
      extendSelection(anchor.paragraphId,anchor.offset,point.root,point.offset);
    }} onPointerUpCapture={()=>{
      const anchor=dragSelection.current;dragSelection.current=undefined;
      const end=anchor?.endId && editorRef.current?.querySelector<HTMLElement>(`p[data-paragraph-id="${CSS.escape(anchor.endId)}"]`);
      if(anchor?.crossed && end) extendSelection(anchor.paragraphId,anchor.offset,end,anchor.endOffset!);
    }} onPointerCancel={()=>{dragSelection.current=undefined;}} onPointerDown={event => { if (event.target === event.currentTarget) reel.intent(); }} onPointerMove={event => { if (event.buttons && event.target === event.currentTarget) reel.intent(); }} onTouchMove={event => { if (event.touches.length === 1) reel.intent(); }} onKeyDownCapture={event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a" && selectSource(event.target, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); return; }
      if(event.key==="Escape" && (crossBlockRange.current || selectedSource.current)){clearCrossSelection();onSelection(undefined);}
      else if((crossBlockRange.current || selectedSource.current) && !event.ctrlKey && !event.metaKey && (event.key.length===1 || ["Enter","Backspace","Delete"].includes(event.key)))event.preventDefault();
      if (!event.defaultPrevented && !readOnly && onJoinParagraphs && event.key === "Backspace" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing) {
        const root = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("p.source-chunks[data-paragraph-id]") : null;
        if (root?.isContentEditable && editableCaret(root) === 0 && editableText(root).trim()) {
          const siblings = [...(editorRef.current?.querySelectorAll<HTMLElement>("p.source-chunks[data-paragraph-id]") ?? [])].filter(p => p.getClientRects().length && !p.closest('[data-reel-held="true"]'));
          const previous = siblings[siblings.indexOf(root) - 1];
          if (previous?.isContentEditable && previous.dataset.nodeId === root.dataset.nodeId && previous.dataset.sourceFile === root.dataset.sourceFile) {
            event.preventDefault(); onJoinParagraphs(previous.dataset.paragraphId!, root.dataset.paragraphId!, editableText(previous), editableText(root));
          }
        }
      }
      if (!["Control", "Shift", "Alt", "Meta"].includes(event.key)) revealHeldEditor(event.target);
    }} onCopy={event=>{if(selectedSource.current){event.preventDefault();event.clipboardData.setData("text/plain",selectedSource.current.map(unit=>unit instanceof HTMLTextAreaElement ? unit.value : editableText(unit)).join("\n\n"));}else if(crossBlockRange.current && pendingSelection){event.preventDefault();event.clipboardData.setData("text/plain",pendingSelection.text);}}}
    onCut={event=>{if(crossBlockRange.current || selectedSource.current)event.preventDefault();}}
    onBeforeInputCapture={event => {if(crossBlockRange.current || selectedSource.current){event.preventDefault();return;}revealHeldEditor(event.target);}} onPasteCapture={event => {if(crossBlockRange.current || selectedSource.current){event.preventDefault();return;}revealHeldEditor(event.target);}} onKeyDown={event => {
      if (event.target === event.currentTarget && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) reel.intent();
    }} onClick={event => {
      const sync = (event.target as HTMLElement).closest<HTMLElement>("[data-sync-preview]");
      if (sync?.dataset.syncPreview) { event.preventDefault(); onSyncToPreview?.(sync.dataset.syncPreview); return; }
      if (!event.ctrlKey && !event.metaKey) return;
      const paragraph = (event.target as HTMLElement).closest<HTMLElement>("p[data-paragraph-id]");
      if (paragraph?.dataset.paragraphId) { event.preventDefault(); onSyncToPreview?.(paragraph.dataset.paragraphId); }
    }} onWheel={(event) => {
      sectionWheel(event);
      if (event.ctrlKey || event.metaKey) reel.pause();
      else if (sourceWindow) reel.intent();
    }}>
      <div className="manuscript-page manuscript pane-zoom-content" style={{ zoom }} ref={editorRef} onMouseUp={handleSelection}>
      {sectionNavigation?.previous && <button className="section-edge-link" disabled={sectionNavigation.blocked} title="Pause at the top, then scroll farther upward" onClick={() => sectionNavigation.onMove(-1)}>↑ {sectionNavigation.previous}</button>}
      {sourceWindow && <div className="block-window-gap reel-spacer">{reel.range?.start ? <span>{reel.range.start} earlier blocks out of view</span> : <span>Start of visible paper</span>}</div>}
      {blocks.map((node) => {
        const nodeParagraphs = node.paragraphIds
          .map((paragraphId) => paragraphMap.get(paragraphId))
          .filter((paragraph): paragraph is Paragraph => Boolean(paragraph));
        const reelIndex = sourceWindow?.available.findIndex(p => p.id === nodeParagraphs[0]?.id) ?? -1;
        const held = Boolean(sourceWindow && reel.range && (reelIndex < reel.range.start || reelIndex >= reel.range.end));
        const distanceFromCore = sourceWindow ? Math.max(0, sourceWindow.before - reelIndex, reelIndex - sourceWindow.before - sourceWindow.paragraphs.length + 1) : 0;
        return (
          <div key={turbo || blockWindow ? nodeParagraphs[0]?.id : "renderKey" in node ? node.renderKey as string : node.id} className={sourceWindow ? "reel-block" : "manuscript-block-shell"} data-reel-paragraph={sourceWindow ? nodeParagraphs[0]?.id : undefined} data-reel-held={held ? "true" : undefined}
            data-reel-focus={sourceWindow ? String(sourceWindow.paragraphs.some(p => p.id === nodeParagraphs[0]?.id)) : undefined}
            style={sourceWindow ? { opacity: reelOpacity(distanceFromCore, 0) } : undefined}>
          <ManuscriptBlock explicitBlocks={explicitBlocks} onOpenSourceCommand={openSourceCommand} commandEditing={commandEditing} node={node} paragraphs={nodeParagraphs} edits={paragraphEdits} drafts={draftsByParagraph}
            blockCommentCounts={blockCommentCounts} onOpenBlockComments={onOpenBlockComments}
            writingMarkers={writingMarkers} onWritingReview={onWritingReview}
            linkedProof={Boolean(!sourceWindow && focusedNodeId && node.proofFor?.includes(focusedNodeId))}
            headingTitle={!sourceWindow && focusedNodeId && node.proofFor?.includes(focusedNodeId) ? linkedProofTitle(node, nodes) : undefined}
            showHeading={sourceWindow ? reelIndex === 0 || sourceWindow.available[reelIndex - 1]?.nodeId !== node.id : !("continued" in node && node.continued)}
            active={activeNodeId === node.id} highlightedId={jumpTarget?.paragraphId} turbo={Boolean(turbo)} editable={!readOnly && (!turbo || nodeParagraphs[0]?.id === turbo.activeId)}
            stateLabel={turbo && nodeParagraphs[0]?.id === turbo.activeId ? turbo.waiting ? "Linked work open — not checked yet" : turbo.checked ? "Wording checked" : "Active paragraph · wording only" : undefined}
            onSelect={selectNode} onEdit={editParagraph} onReference={followReference} onFocus={focusParagraph} onOpenDraft={openDraft} onTurboFocus={focusTurbo} onChunkAction={chunkAction} hasBlockContext={blockContext} isQueued={isQueued} blockTypes={blockTypes} />
          </div>
        );
      })}
        {sourceWindow && <div className="block-window-gap reel-spacer">{sourceWindow.available.length > (reel.range?.end ?? 0) ? <span>{sourceWindow.available.length - reel.range!.end} later blocks out of view</span> : <span>End of visible paper</span>}</div>}
        {sectionNavigation?.next && <button className="section-edge-link" disabled={sectionNavigation.blocked} title="Pause at the bottom, then scroll farther downward" onClick={() => sectionNavigation.onMove(1)}>↓ {sectionNavigation.next}</button>}
      </div>
        {pendingSelection && !selectionDragging && (
          <div className="selection-actions selected-block-actions" role="group" aria-label="Highlight actions" style={{ left: pendingSelection.x, top: pendingSelection.y, maxWidth: scrollRef.current ? Math.max(24,scrollRef.current.clientWidth-16) : undefined }} onMouseDown={event => event.preventDefault()}>
            {pendingSelection.spans && <small title="Actions and copy use the exact highlighted text. Click one block to resume typing.">{pendingSelection.spans.length} blocks</small>}
            <button title="Show highlighted text in preview" aria-label="Show highlighted text in preview" onClick={() => onSyncToPreview?.(pendingSelection.paragraphId)}><Scan size={12} /></button>
            <button title="Focus highlighted blocks" aria-label="Focus highlighted blocks" onClick={() => onChunkAction("focus", pendingSelection)}><Focus size={12} /></button>
            <button title="Ask about highlighted blocks" aria-label="Ask about highlighted blocks" onClick={() => onChunkAction("ask", pendingSelection)}><CircleHelp size={12} /></button>
            <button title="Rephrase highlighted blocks" aria-label="Rephrase highlighted blocks" disabled={readOnly} onClick={onBeginRewrite}><WandSparkles size={12} /></button>
            {!turbo && <button title="Find related passages" aria-label="Find related passages" onClick={onCreateTheme}><Sparkles size={12} /></button>}
            <button title="Open highlighted blocks in the notebook" aria-label="Open highlighted blocks in the notebook" onClick={onExplore}><Scan size={12} /></button>
            <button title="Comment on highlighted blocks" aria-label="Comment on highlighted blocks" onClick={onComment}><MessageSquareText size={12} /></button>
            <button aria-label="Return to highlighted blocks later" aria-pressed={(pendingSelection.spans ?? [pendingSelection]).every(span => !!isQueued?.(span))} title="Toggle highlighted blocks in the queue · notes stay open" onClick={onReviewLater}><BookmarkPlus size={12} /></button>
          </div>
        )}
    </div>
    {sourceWindow && <ReelScrollbar index={sourceWindow.index} total={sourceWindow.available.length} visible={sourceWindow.paragraphs.length} disabled={readOnly || sourceWindow.blocked || Boolean(pendingSelection)} onNavigate={index => {
      const target = sourceWindow.available[index]; if (target) { reel.reveal(); (turbo ? onTurboFocus : onWindowNavigate)?.(target.id); }
    }} />}
    <PaneZoomIndicator zoom={zoom} label="editor" onReset={() => setZoom(1)} />
    </div>
  );
}
