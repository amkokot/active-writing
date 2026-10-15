import { useMemo, useRef, useState } from "react";
import { CornerUpLeft, Pin, Plus, Save, SquarePen, WandSparkles, X } from "lucide-react";
import type { ManuscriptNode, Paragraph, PendingSelection, ReferenceRequest, ThemeDraft, ThemeLens } from "../types";
import type { ChunkAction } from "../sourceChunks";
import type { QueuedPassage } from "../queueEntries";
import { SourceParagraph } from "./Manuscript";
import { WritingMarker } from "./WritingMarker";
import type { WritingMarker as Marker } from "../writing";
import { themeGap, themePassages } from "../workspaceTools";
import { usePaneZoomGestures, useStoredPaneZoom } from "../usePaneZoom";
import { PaneZoomIndicator } from "./PaneZoomIndicator";
import { useReadingLayout } from "../usePaneLayout";

interface ThemeWorkspaceProps {
  writingMarkers?: Record<string, Marker>;
  onWritingReview?: (id: string) => void;
  explicitBlocks?:boolean;
  readOnly?:boolean;
  onChunkAction?:(action:ChunkAction,selection:PendingSelection)=>void;
  hasBlockContext?:(paragraphId:string,text:string,start:number,end:number)=>boolean;
  isQueued?:(selection:QueuedPassage)=>boolean;
  theme: ThemeLens;
  paragraphs: Paragraph[];
  nodes: ManuscriptNode[];
  paragraphEdits: Record<string, string>;
  onExclude: (paragraphId: string) => void;
  onPin: (paragraphId: string) => void;
  onAddExisting: (paragraphId: string) => void;
  onAddDraft: (text: string) => void;
  onRemoveDraft: (draftId: string) => void;
  onComposerChange: (text: string) => void;
  onDraftEdit: (draftId: string, text: string) => void;
  onParagraphEdit: (id: string, text: string) => void;
  onParagraphFocus: (paragraphId: string, nodeId: string) => void;
  onReference: (request: ReferenceRequest) => void;
  onRewrite: (paragraphId: string) => void;
  onJumpToSource: (paragraphId: string) => void;
  onSyncToPreview?: (paragraphId: string) => void;
}

export function ThemeWorkspace({
  writingMarkers, onWritingReview,
  explicitBlocks=false,
  readOnly=false,
  onChunkAction,
  hasBlockContext,
  isQueued,
  theme,
  paragraphs,
  nodes,
  paragraphEdits,
  onExclude,
  onPin,
  onAddExisting,
  onAddDraft,
  onRemoveDraft,
  onComposerChange,
  onDraftEdit,
  onParagraphEdit,
  onParagraphFocus,
  onReference,
  onRewrite,
  onJumpToSource,
  onSyncToPreview,
}: ThemeWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useStoredPaneZoom("editor");
  usePaneZoomGestures(scrollRef, zoom, setZoom);
  useReadingLayout(scrollRef);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(Boolean(theme.composerText));
  const [expandedGaps, setExpandedGaps] = useState<string[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const matches = theme.matches.filter((match) => !match.excluded);
  const ordered = themePassages(paragraphs, matches.map((match) => match.paragraphId));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const available = useMemo(() => {
    const included = new Set(matches.map((match) => match.paragraphId));
    return paragraphs.filter((paragraph) => !included.has(paragraph.id) && `${nodeMap.get(paragraph.nodeId)?.title} ${paragraphEdits[paragraph.id] ?? paragraph.text}`.toLowerCase().includes(pickerQuery.toLowerCase()));
  }, [matches, paragraphs, paragraphEdits, nodes, pickerQuery]);

  function saveDraft() {
    const text = theme.composerText?.trim();
    if (!text) return;
    onAddDraft(text);
    setComposerOpen(false);
  }

  return (
    <div className="manuscript-zoom-pane">
    <div className={`theme-workspace ${explicitBlocks ? "explicit-source-blocks" : "plain-block-source"}`} ref={scrollRef} tabIndex={0} aria-label="Theme editor · Ctrl/⌘ scroll to zoom" onClick={event => {
      if (!event.ctrlKey && !event.metaKey) return;
      const paragraph = (event.target as HTMLElement).closest<HTMLElement>("p[data-paragraph-id]");
      if (paragraph?.dataset.paragraphId) { event.preventDefault(); onSyncToPreview?.(paragraph.dataset.paragraphId); }
    }}>
      <div className="pane-zoom-content" style={{ zoom }}>
      <div className="theme-header">
        <span>Theme view</span>
        <h1>{theme.name}</h1>
        <p>Edits save to the original file. Passages follow paper order; removing one from this view doesn't delete it.</p>
        <div className="theme-actions">
          <button className="secondary-button" onClick={() => setPickerOpen((open) => !open)}>
            <Plus size={15} /> Add existing passage
          </button>
          <button className="primary-button" onClick={() => setComposerOpen((open) => !open)}>
            <SquarePen size={15} /> Write new passage
          </button>
        </div>

        {pickerOpen && (
          <div className="theme-picker">
            <strong>Add a missed passage</strong>
            <input aria-label="Find a passage to add" className="text-field" placeholder="Search by text or section" value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} />
            <div>
              {available.map((paragraph) => (
                <button
                  key={paragraph.id}
                  onClick={() => {
                    onAddExisting(paragraph.id);
                    setPickerOpen(false);
                  }}
                >
                  <small>{nodeMap.get(paragraph.nodeId)?.title ?? paragraph.nodeId} · {paragraph.file}</small>
                  <span>{paragraphEdits[paragraph.id] ?? paragraph.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {composerOpen && (
          <div className="theme-composer">
            <label htmlFor="theme-draft">Draft a passage for this theme</label>
            <textarea
              id="theme-draft"
              value={theme.composerText ?? ""}
              onChange={(event) => onComposerChange(event.target.value)}
              placeholder="Write the point you want to add. You can place it in a section later."
            />
            <div>
              <button className="quiet-button" onClick={() => setComposerOpen(false)}>Collapse · draft kept</button>
              <button className="primary-button" disabled={!theme.composerText?.trim()} onClick={saveDraft}>
                <Save size={14} /> Add to view
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="theme-stack" data-source-surface>
        {ordered.map((paragraph, index) => {
          const match = matches.find((item) => item.paragraphId === paragraph.id)!;
          const gap = index > 0 ? themeGap(paragraphs, ordered[index - 1].id, paragraph.id) : [];
          const expanded = expandedGaps.includes(paragraph.id);
          return (
            <div key={match.paragraphId}>
              {gap.length > 0 && <button className="hidden-gap" aria-expanded={expanded} onClick={() => setExpandedGaps((current) => expanded ? current.filter((id) => id !== paragraph.id) : [...current, paragraph.id])}>{expanded ? "Collapse context" : `${gap.length} intervening passage${gap.length === 1 ? "" : "s"} hidden · show context`}</button>}
              {expanded && gap.map((context) => <article className="theme-card theme-context" key={context.id}><header><span>{nodeMap.get(context.nodeId)?.title}</span><small>context only</small><div><button aria-label="Include this paragraph" onClick={() => onAddExisting(context.id)}><Plus size={14} /></button></div></header><p>{paragraphEdits[context.id] ?? context.text}</p></article>)}
              <article className="theme-card">
                <header>
                  <span title={paragraph.file}>{nodeMap.get(paragraph.nodeId)?.title ?? paragraph.nodeId}</span>
                  <small title="Similar words, not a confidence estimate">{match.pinned ? "pinned" : `match ${Math.round(match.score * 100)}`}</small>
                  <div>
                    <button aria-label="Rewrite theme passage" disabled={readOnly} onClick={() => onRewrite(paragraph.id)}><WandSparkles size={14} /></button>
                    <button aria-label="Jump to source" onClick={() => onJumpToSource(paragraph.id)}><CornerUpLeft size={14} /></button>
                    <button className={match.pinned ? "is-pinned" : ""} aria-label="Pin passage" onClick={() => onPin(paragraph.id)}><Pin size={14} /></button>
                    <button aria-label="Remove passage" onClick={() => onExclude(paragraph.id)}><X size={14} /></button>
                  </div>
                </header>
                <div className="paragraph-wrap">
                  <SourceParagraph paragraph={paragraph} text={paragraphEdits[paragraph.id] ?? paragraph.text} editable={!readOnly} onEdit={onParagraphEdit} onFocus={onParagraphFocus} onReference={onReference} onChunkAction={onChunkAction} hasBlockContext={hasBlockContext} isQueued={isQueued} />
                  <WritingMarker marker={writingMarkers?.[paragraph.id]} onOpen={onWritingReview} />
                </div>
              </article>
            </div>
          );
        })}

        {(theme.drafts ?? []).map((draft: ThemeDraft) => (
          <div key={draft.id}>
            <div className="hidden-gap">New text · saved here, not yet in the paper</div>
            <article className="theme-card is-draft">
              <header>
                <span>unplaced draft</span>
                <small>local</small>
                <div>
                  <button aria-label="Remove draft" onClick={() => onRemoveDraft(draft.id)}><X size={14} /></button>
                </div>
              </header>
              <textarea aria-label="Edit theme draft" className="theme-draft-editor" value={draft.text} onChange={(event) => onDraftEdit(draft.id, event.target.value)} />
            </article>
          </div>
        ))}
      </div>
      </div>
    </div>
    <PaneZoomIndicator zoom={zoom} label="editor" onReset={() => setZoom(1)} />
    </div>
  );
}
