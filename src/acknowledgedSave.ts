import type { AppState, Paragraph, ProjectDocument, SaveAcknowledgement, ThemeLens } from "./types";
import { anchorSavedNotes } from "./sourceAnchors.ts";

export interface SaveCaret { paragraphId: string; offset: number }
export interface SavedCaret extends SaveCaret { nodeId: string }

function textChange(before: string, after: string) {
  let start = 0, tail = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (tail < before.length - start && tail < after.length - start && before[before.length - tail - 1] === after[after.length - tail - 1]) tail++;
  return { start, end: before.length - tail, replacement: after.slice(start, after.length - tail), delta: after.length - before.length };
}

/** Reconcile only a confirmed own save. Captured comments and requests stay immutable. */
export function acknowledgeSave(state: AppState, before: ProjectDocument, after: ProjectDocument, submitted: Record<string, string>, acknowledgement?: SaveAcknowledgement, caret?: SaveCaret) {
  const valid = before.project.id === after.project.id && before.project.mainFile === after.project.mainFile
    && acknowledgement?.baseRevision === before.revision && acknowledgement.savedRevision === after.revision;
  if (!valid) throw new Error("The saved version could not be confirmed. Your draft is kept; review source changes before saving again.");
  const originals = new Map(before.paragraphs.map(p => [p.id, p]));
  const saved = new Map(after.paragraphs.map(p => [p.id, p]));
  const pieces = (id: string) => {
    const old = originals.get(id), text = submitted[id] ?? old?.text;
    if (!valid || !old || text === undefined) return [];
    return (acknowledgement.paragraphMap[id] ?? []).flatMap(piece => {
      const p = saved.get(piece.paragraphId);
      const targetStart = piece.targetStart ?? 0;
      return p && p.file === old.file && Number.isInteger(piece.start) && Number.isInteger(piece.end) && piece.start >= 0
        && piece.end <= text.length && (piece.end > piece.start || piece.end === piece.start && p.emptySource && !p.text) && Number.isInteger(targetStart) && targetStart >= 0
        && text.slice(piece.start, piece.end) === p.text.slice(targetStart, targetStart + piece.end - piece.start) ? [{ ...piece, targetStart, paragraph: p }] : [];
    });
  };
  const remaining: Record<string, string> = {};
  let deferredDrafts = 0;
  for (const [id, text] of Object.entries(state.paragraphEdits)) {
    if (submitted[id] === text) continue;
    const old = originals.get(id), baseline = submitted[id] ?? old?.text;
    const candidates = pieces(id);
    if (baseline !== undefined && candidates.length) {
      const change = textChange(baseline, text);
      const destinations = candidates.filter(piece => change.start >= piece.start && change.end <= piece.end);
      if (destinations.length === 1) {
        const { paragraph, start, targetStart } = destinations[0];
        const next = paragraph.text.slice(0, targetStart + change.start - start) + change.replacement + paragraph.text.slice(targetStart + change.end - start);
        if (next !== paragraph.text) remaining[paragraph.id] = next;
        continue;
      }
    }
    // Never replay a whole pre-split draft into a reused paragraph ID.
    remaining[id.startsWith("unlinked:") ? id : `unlinked:save:${id}`] = text; deferredDrafts++;
  }
  const destination = (id?: string, offset?: number): Paragraph | undefined => {
    if (!id) return undefined;
    const candidates = pieces(id);
    return offset === undefined ? candidates[0]?.paragraph : (candidates.find(piece => offset >= piece.start && offset <= piece.end) ?? candidates.find(piece => offset < piece.start) ?? candidates.at(-1))?.paragraph;
  };
  let savedCaret: SavedCaret | undefined;
  if (caret) {
    const baseline = submitted[caret.paragraphId] ?? originals.get(caret.paragraphId)?.text;
    const current = state.paragraphEdits[caret.paragraphId] ?? baseline;
    const candidates = pieces(caret.paragraphId);
    if (baseline !== undefined && current !== undefined) {
      const change = textChange(baseline, current);
      const livePieces = candidates.map(piece => {
        const delta = current === baseline ? 0 : change.delta;
        return { ...piece, start: piece.start + (change.end <= piece.start ? delta : 0), end: piece.end + (change.end <= piece.end ? delta : 0) };
      });
      const chosen = livePieces.find(piece => caret.offset >= piece.start && caret.offset <= piece.end) ?? livePieces.find(piece => caret.offset < piece.start) ?? livePieces.at(-1);
      if (chosen && !Object.keys(remaining).some(id => id === `unlinked:save:${caret.paragraphId}`)) {
        savedCaret = { paragraphId: chosen.paragraph.id, nodeId: chosen.paragraph.nodeId,
          offset: Math.max(0, Math.min((remaining[chosen.paragraph.id] ?? chosen.paragraph.text).length, chosen.targetStart + caret.offset - chosen.start)) };
      }
    }
  }
  const active = savedCaret ? saved.get(savedCaret.paragraphId) : destination(state.activeParagraphId);
  const focused = state.focusedNodeId && (active && state.activeNodeId === state.focusedNodeId ? active.nodeId
    : before.nodes.find(node => node.id === state.focusedNodeId)?.paragraphIds.map(id => destination(id)).find(Boolean)?.nodeId);
  const nodeIds = new Set(after.nodes.map(node => node.id));
  const cursor = destination(state.turbo.activeParagraphId);
  const unchanged = (id: string) => { const p = destination(id); return p?.text === originals.get(id)?.text ? p : undefined; };
  const turboReviews = Object.fromEntries(Object.entries(state.turbo.reviews).flatMap(([id, review]) => { const p = unchanged(id); return p ? [[p.id, review]] : []; }));
  const next: AppState = { ...state, ...anchorSavedNotes(state, before, after, submitted, acknowledgement!), paragraphEdits: remaining, draftRevision: Object.keys(remaining).length ? after.revision : undefined,
    ...(after.structureIssue ? { lens: "paper" as const, hiddenNodeIds: [] } : {}),
    activeParagraphId: active?.id ?? (saved.has(state.activeParagraphId ?? "") ? state.activeParagraphId : undefined),
    activeNodeId: active?.nodeId ?? (nodeIds.has(state.activeNodeId) ? state.activeNodeId : after.nodes[0]?.id ?? "document"),
    focusedNodeId: state.focusedNodeId ? focused ?? (nodeIds.has(state.focusedNodeId) ? state.focusedNodeId : undefined) : undefined,
    blockWindow: state.blockWindow ? { ...state.blockWindow, paragraphId: savedCaret && state.blockWindow.paragraphId === caret?.paragraphId ? savedCaret.paragraphId : destination(state.blockWindow.paragraphId)?.id ?? active?.id } : undefined,
    turbo: { ...state.turbo, enabled: state.turbo.enabled && Boolean(cursor || savedCaret), activeParagraphId: savedCaret && state.turbo.enabled ? savedCaret.paragraphId : cursor?.id,
      reviews: turboReviews, history: state.turbo.history.flatMap(item => { const p = unchanged(item.paragraphId); return p ? [{ ...item, paragraphId: p.id }] : []; }),
      resumeParagraphId: destination(state.turbo.resumeParagraphId)?.id },
    rewriteSessions: state.rewriteSessions.map(session => {
      if (session.selectionSpans) {
        const selectionSpans = session.selectionSpans.map((span, i) => ({ ...span, paragraphId: unchanged(span.paragraphId)?.id ?? `unlinked:save:${session.id}:${i}`, nodeId: unchanged(span.paragraphId)?.nodeId ?? span.nodeId }));
        const linked = selectionSpans.every(span => !span.paragraphId.startsWith("unlinked:"));
        return { ...session, selectionSpans, paragraphId: selectionSpans[0].paragraphId, nodeId: selectionSpans[0].nodeId,
          status: linked || ["applied", "archived"].includes(session.status) ? session.status : "stale" as const };
      }
      const target = destination(session.paragraphId), old = originals.get(session.paragraphId);
      if (!target || !old || target.text !== old.text) return { ...session, paragraphId: `unlinked:save:${session.id}`, status: ["applied", "archived"].includes(session.status) ? session.status : "stale" as const };
      return { ...session, paragraphId: target.id, nodeId: target.nodeId };
    }),
    // A theme is an editable collection, not an immutable captured quotation.
    // Follow all verified pieces of an own save, including changed/split text.
    // Unknown external changes still use the conservative source-refresh path.
    themeLenses: state.themeLenses.map(theme => {
      const matches = new Map<string, ThemeLens["matches"][number]>();
      for (const match of theme.matches) for (const piece of pieces(match.paragraphId)) {
        const paragraphId = piece.paragraph.id, previous = matches.get(paragraphId);
        matches.set(paragraphId, previous ? { ...previous, score: Math.max(previous.score, match.score),
          pinned: Boolean(previous.pinned || match.pinned), excluded: Boolean(previous.excluded && match.excluded) }
          : { ...match, paragraphId });
      }
      return { ...theme, seedParagraphId: destination(theme.seedParagraphId)?.id ?? "", matches: [...matches.values()] };
    }),
  };
  return { state: next, caret: savedCaret, deferredDrafts };
}

/** Keep an editable source region intact while newer typing outlives a save.
 * The next save replaces that exact raw region, including headings/separators.
 * Only a settled save changes the parsed view; no detachment or manual merge.
 */
export function reconcileEditorSave(state: AppState, before: ProjectDocument, after: ProjectDocument, submitted: Record<string, string>, acknowledgement: SaveAcknowledgement, caret?: SaveCaret) {
  if (before.project.id !== after.project.id || acknowledgement?.baseRevision !== before.revision || acknowledgement.savedRevision !== after.revision) throw new Error("The saved version could not be confirmed. Your draft is kept.");
  const newer = Object.fromEntries(Object.entries(state.paragraphEdits).filter(([id, text]) => text !== (submitted[id] ?? before.paragraphs.find(p => p.id === id)?.text)));
  if (Object.keys(newer).length) {
    const ranges = new Map(acknowledgement.sourceRanges.map(range => [range.paragraphId, range]));
    for (const p of before.paragraphs) { const range = ranges.get(p.id); if (!range || range.file !== p.file || range.text !== (submitted[p.id] ?? p.text)) throw new Error("The saved source region could not be confirmed. Your draft is kept."); }
    const document: ProjectDocument = { ...before, revision: after.revision, paragraphs: before.paragraphs.map(p => submitted[p.id] === undefined ? p : { ...p, text: submitted[p.id] }) };
    // These confirmed raw regions remain the live editor identity until typing
    // settles. Move navigation anchors through them, not through reused ordinals.
    const regionAck = { ...acknowledgement, paragraphMap: Object.fromEntries(document.paragraphs.map(p => [p.id, p.text ? [{ paragraphId: p.id, start: 0, end: p.text.length }] : []])) };
    return { document, state: { ...state, ...anchorSavedNotes(state, before, document, submitted, regionAck), paragraphEdits: newer, draftRevision: after.revision,
      sourceSaveContinuation: { document, ranges: acknowledgement.sourceRanges } }, caret: undefined, deferredDrafts: 0 };
  }
  const settled = acknowledgeSave(state, before, after, submitted, acknowledgement, caret);
  return { ...settled, document: after, state: { ...settled.state, sourceSaveContinuation: undefined } };
}
