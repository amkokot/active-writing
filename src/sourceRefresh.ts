import type { AppState, NotebookSource, Paragraph, ProjectDocument } from "./types";
import { locateReturnAnchor } from "./sourceAnchors.ts";
import type { SaveCaret } from "./acknowledgedSave.ts";

/** A source conflict is not a TeX compiler failure. */
export class SourceSaveConflict extends Error {
  constructor(message: string) { super(message); this.name = "SourceSaveConflict"; }
}

export interface SourceDraftConflict {
  paragraphId: string;
  file?: string;
  baseText?: string;
  draftText: string;
  reason: "changed" | "missing" | "ambiguous" | "unknown-base";
}
export interface SourceDraftCopy {
  version: 1;
  id: string;
  createdAt: string;
  projectId: string;
  rootFile: string;
  baseRevision: string;
  incomingRevision: string;
  drafts: SourceDraftConflict[];
}

/** Only literal, unambiguous same-file matches are eligible for automatic rebasing. */
export function sourceRefreshPlan(before: ProjectDocument, after: ProjectDocument, edits: Record<string, string>, draftRevision?: string) {
  if (before.project.id !== after.project.id || before.project.mainFile !== after.project.mainFile) throw new Error("Refresh the same paper and root file only.");
  const mapping = new Map<string, Paragraph>();
  const trustedDrafts = draftRevision === before.revision;
  const index = (paragraphs: Paragraph[]) => {
    const byText = new Map<string, Paragraph[]>(); const byFile = new Map<string, Paragraph[]>();
    for (const p of paragraphs) {
      const key = JSON.stringify([p.file, p.text]); const file = p.file ?? "";
      if (!byText.has(key)) byText.set(key, []); if (!byFile.has(file)) byFile.set(file, []);
      byText.get(key)!.push(p); byFile.get(file)!.push(p);
    }
    return { byText, byFile, byId: new Map(paragraphs.map((p) => [p.id, p])) };
  };
  const left = index(before.paragraphs); const right = index(after.paragraphs);
  const unchangedFiles = new Set(before.files.filter((file) => {
    return JSON.stringify(left.byFile.get(file)) === JSON.stringify(right.byFile.get(file));
  }));
  for (const original of before.paragraphs) {
    const key = JSON.stringify([original.file, original.text]);
    const exact = right.byText.get(key) ?? []; const duplicates = left.byText.get(key) ?? [];
    const position = right.byId.get(original.id);
    const stable = position && position.file === original.file && position.nodeId === original.nodeId && position.text === original.text ? position : undefined;
    if (stable && (before.revision === after.revision || unchangedFiles.has(original.file ?? ""))) mapping.set(original.id, stable);
    else if (exact.length === 1 && duplicates.length === 1) mapping.set(original.id, exact[0]);
  }
  const rebasedEdits: Record<string, string> = {};
  const conflicts: SourceDraftConflict[] = [];
  for (const [id, text] of Object.entries(edits)) {
    const original = left.byId.get(id);
    if (original && text === original.text && trustedDrafts) continue;
    const target = mapping.get(id);
    if (trustedDrafts && target) {
      if (target.text !== text) rebasedEdits[target.id] = text;
      continue;
    }
    const matches = original ? right.byText.get(JSON.stringify([original.file, original.text])) ?? [] : [];
    const candidate = right.byId.get(id);
    const position = original && candidate && candidate.file === original.file && candidate.nodeId === original.nodeId;
    conflicts.push({ paragraphId: id, file: original?.file, baseText: original?.text, draftText: text,
      reason: !original || !trustedDrafts ? "unknown-base" : matches.length ? "ambiguous" : position ? "changed" : "missing" });
  }
  return { mapping, rebasedEdits, conflicts };
}

/** Keep workspace/queue/Notebook records intact. Unverified source links never gain new meaning. */
export function refreshSourceState(state: AppState, before: ProjectDocument, after: ProjectDocument) {
  const plan = sourceRefreshPlan(before, after, state.paragraphEdits, state.draftRevision);
  const target = (id?: string) => id ? plan.mapping.get(id) : undefined;
  const nodeIds = new Set(after.nodes.map((node) => node.id));
  const active = target(state.activeParagraphId);
  const activeNodeId = active?.nodeId ?? (nodeIds.has(state.activeNodeId) ? state.activeNodeId : after.nodes[0]?.id ?? "document");
  const cursor = target(state.turbo.activeParagraphId);
  const resumeTarget = target(state.handoffResume?.activeParagraphId);
  const resumeCursor = target(state.handoffResume?.turbo.activeParagraphId);
  const mappedReviews = (reviews: AppState["turbo"]["reviews"]) => Object.fromEntries(Object.entries(reviews).flatMap(([id, review]) => target(id) ? [[target(id)!.id, review]] : []));
  const reviews = mappedReviews(state.turbo.reviews);
  return { ...state,
    activeNodeId, activeParagraphId: active?.id,
    focusedNodeId: state.focusedNodeId && nodeIds.has(state.focusedNodeId) ? state.focusedNodeId : undefined,
    blockWindow: state.blockWindow ? { ...state.blockWindow, paragraphId: target(state.blockWindow.paragraphId)?.id ?? active?.id } : undefined,
    hiddenNodeIds: state.hiddenNodeIds.filter((id) => nodeIds.has(id)),
    collapsedNodeIds: state.collapsedNodeIds?.filter((id) => nodeIds.has(id)),
    paragraphEdits: plan.rebasedEdits,
    sourceSaveContinuation: undefined,
    draftRevision: Object.keys(plan.rebasedEdits).length ? after.revision : undefined,
    handoffResume: state.handoffResume ? { ...state.handoffResume, activeNodeId: resumeTarget?.nodeId ?? state.handoffResume.activeNodeId, activeParagraphId: resumeTarget?.id,
      blockWindow: state.handoffResume.blockWindow ? { ...state.handoffResume.blockWindow, paragraphId: target(state.handoffResume.blockWindow.paragraphId)?.id ?? resumeTarget?.id } : undefined,
      turbo: { ...state.handoffResume.turbo, enabled: state.handoffResume.turbo.enabled && Boolean(resumeCursor), activeParagraphId: resumeCursor?.id,
        reviews: mappedReviews(state.handoffResume.turbo.reviews), history: [], pendingPrompt: undefined, resumeParagraphId: target(state.handoffResume.turbo.resumeParagraphId)?.id } } : undefined,
    rewriteSessions: state.rewriteSessions.map((session) => {
      const paragraph = target(session.paragraphId);
      if (session.selectionSpans) {
        const selectionSpans = session.selectionSpans.map((span, i) => ({ ...span, paragraphId: target(span.paragraphId)?.id ?? `unlinked:${session.id}:${i}`, nodeId: target(span.paragraphId)?.nodeId ?? span.nodeId }));
        const linked = selectionSpans.every(span => !span.paragraphId.startsWith("unlinked:"));
        return { ...session, selectionSpans, paragraphId: selectionSpans[0].paragraphId, nodeId: selectionSpans[0].nodeId,
          status: linked || ["archived", "applied"].includes(session.status) ? session.status : "stale" as const };
      }
      if (!paragraph) return { ...session, paragraphId: `unlinked:${session.id}`, status: session.status === "archived" || session.status === "applied" ? session.status : "stale" as const };
      return { ...session, paragraphId: paragraph.id, nodeId: paragraph.nodeId };
    }),
    // An uncertain theme result must not point to a different paragraph with a reused ID.
    themeLenses: state.themeLenses.map((theme) => ({ ...theme, seedParagraphId: target(theme.seedParagraphId)?.id ?? "",
      matches: theme.matches.flatMap((match) => target(match.paragraphId) ? [{ ...match, paragraphId: target(match.paragraphId)!.id }] : []) })),
    turbo: { ...state.turbo, enabled: state.turbo.enabled && Boolean(cursor), activeParagraphId: cursor?.id, reviews,
      history: [], pendingPrompt: undefined, resumeParagraphId: target(state.turbo.resumeParagraphId)?.id, atEnd: false },
  };
}

/** Retry an outdated source version only when every draft's original passage
 * is still literally, unambiguously present. Never guess at overlapping edits,
 * an unknown draft baseline, changed compiler/root, or a pending raw region.
 */
export function automaticSourceRefresh(state: AppState, before: ProjectDocument, after: ProjectDocument, caret?: SaveCaret) {
  if (before.project.id !== after.project.id || before.project.mainFile !== after.project.mainFile || before.project.engine !== after.project.engine
    || before.revision === after.revision || state.sourceSaveContinuation) return undefined;
  const plan = sourceRefreshPlan(before, after, state.paragraphEdits, state.draftRevision);
  if (plan.conflicts.length) return undefined;
  const next = refreshSourceState(state, before, after);
  const target = caret && plan.mapping.get(caret.paragraphId);
  return { state: next, document: after, caret: target && caret ? { paragraphId: target.id, nodeId: target.nodeId,
    offset: Math.min(caret.offset, (next.paragraphEdits[target.id] ?? target.text).length) } : undefined };
}

/** Notebook snapshots stay immutable; follow their text, not a reused source position. */
export function locateSavedPassage(source: Pick<NotebookSource, "rootFile" | "paragraphId" | "paragraphText" | "file" | "revision" | "duplicateAtCapture" | "returnAnchor"> | undefined, document: ProjectDocument, edits: Record<string, string>): import("./types.ts").Paragraph | undefined {
  if (!source || source.rootFile && source.rootFile !== document.project.mainFile) return undefined;
  if (source.returnAnchor) return locateReturnAnchor(source.returnAnchor, document, edits);
  const position = document.paragraphs.find((p) => p.id === source.paragraphId && p.file === source.file);
  if (source.revision === document.revision && position) return position;
  if (source.duplicateAtCapture) return undefined;
  const exact = document.paragraphs.filter((p) => p.file === source.file && (p.text === source.paragraphText || edits[p.id] === source.paragraphText));
  return exact.length === 1 ? exact[0] : source.returnAnchor ? locateSavedPassage(source.returnAnchor, document, edits) : undefined;
}

/** Only an acknowledged own save can anchor an expanded passage. Require one exact contiguous run. */
export function anchorAppliedNotebookEntries(entries: import("./types.ts").NotebookEntry[], savedEdits: Record<string, string>, document: ProjectDocument) {
  return entries.map(entry => {
    const source = entry.source;
    if (!source || source.rootFile && source.rootFile !== document.project.mainFile || !entry.appliedChanges.length || savedEdits[source.paragraphId] !== source.paragraphText) return entry;
    const parts = source.paragraphText.split(/\r?\n\s*\r?\n/).map(part => part.trim()).filter(Boolean);
    const matches = document.paragraphs.filter((p, i) => p.file === source.file && parts.every((part, offset) => {
      const q = document.paragraphs[i + offset]; return q?.file === source.file && q.nodeId === p.nodeId && q.text === part;
    }));
    if (!parts.length || matches.length !== 1) return entry;
    const p = matches[0];
    return { ...entry, source: { ...source, returnAnchor: { paragraphId: p.id, paragraphText: p.text, file: p.file, revision: document.revision,
      duplicateAtCapture: document.paragraphs.filter(q => q.file === p.file && q.text === p.text).length > 1 } } };
  });
}
