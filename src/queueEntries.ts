import type { AppState, AttentionTask, PendingSelection, ProjectDocument } from "./types.ts";
import { archiveAttentionTask, queueAttentionTask, reopenAttentionTask } from "./attention.ts";
import { makeReviewComment } from "./review.ts";
import { locateReturnAnchor } from "./sourceAnchors.ts";

export type QueuedPassage = Pick<PendingSelection, "paragraphId" | "nodeId" | "start" | "end" | "text">;

/** Exact saved range, not a fuzzy match to a similarly worded passage. */
export function passageBookmark(tasks: AttentionTask[], document: ProjectDocument, edits: Record<string, string>, selection: QueuedPassage, includeHistory = false) {
  return tasks.find(task => {
    if (task.reminder?.kind !== "passage" || !task.reminder.wholeBlock && task.reminder.quote !== selection.text || !includeHistory && task.status === "reviewed") return false;
    const source = task.sourceSnapshot;
    if (!source || source.projectId !== document.project.id || source.rootFile !== document.project.mainFile) return false;
    const saved = source.returnAnchor;
    const start = saved ? saved.start : task.reminder.start, end = saved ? saved.end : task.reminder.end;
    if (!task.reminder.wholeBlock && (start !== selection.start || end !== selection.end)) return false;
    const original = source.paragraphs[0];
    if (!original) return false;
    const anchor = saved ?? { paragraphId: original.id, paragraphText: original.text, file: original.file, revision: source.revision, duplicateAtCapture: original.duplicateAtCapture };
    const p = locateReturnAnchor(anchor, document, edits)
      ?? (anchor.revision === document.revision ? document.paragraphs.find(p => p.id === anchor.paragraphId && p.file === anchor.file) : undefined);
    if (p?.id === selection.paragraphId && task.reminder.wholeBlock) {
      const text = edits[p.id] ?? p.text;
      return selection.start === 0 && selection.end === text.length && selection.text === text;
    }
    return p?.id === selection.paragraphId && start === selection.start && end === selection.end && task.reminder.quote === selection.text
      && (edits[p.id] ?? p.text).slice(start, end) === selection.text;
  });
}

export function togglePassageBookmarks(state: AppState, document: ProjectDocument, selections: QueuedPassage[], edits = state.paragraphEdits) {
  if (!selections.length) return state;
  // Validate every range before mutating anything, including when removing a bookmark.
  const validated = selections.map(selection => makeReviewComment(document, edits, selection));
  const matches = selections.map(selection => passageBookmark(state.attentionTasks, document, edits, selection));
  if (matches.every(Boolean)) return matches.reduce((next, task) => archiveAttentionTask(next, task!.id), state);
  const missing = selections.filter((_, i) => !matches[i]);
  const newCount = new Set(missing.filter(selection => !passageBookmark(state.attentionTasks, document, edits, selection, true)).map(selection => JSON.stringify([selection.paragraphId, selection.start, selection.end, selection.text]))).size;
  if (state.attentionTasks.length + newCount > 2000) throw new Error("The saved task limit is reached. Export older work before adding more.");
  return selections.reduce((next, selection, index) => {
    if (passageBookmark(next.attentionTasks, document, edits, selection)) return next;
    const old = passageBookmark(next.attentionTasks, document, edits, selection, true);
    if (old) return reopenAttentionTask(next, old.id);
    const { review: _review, ...task } = validated[index];
    const p = task.sourceSnapshot!.paragraphs[0];
    const bookmark: AttentionTask = { ...task, title: `Later · ${selection.text.trim().replace(/\s+/g, " ").slice(0, 80)}`,
      reminder: { kind: "passage", start: selection.start, end: selection.end, quote: selection.text, ...(selection.start === 0 && selection.end === p.text.length ? { wholeBlock: true } : {}) },
      sourceSnapshot: { ...task.sourceSnapshot!, returnAnchor: { paragraphId: p.id, paragraphText: p.text, revision: document.revision, file: p.file, duplicateAtCapture: p.duplicateAtCapture, start: selection.start, end: selection.end } } };
    return queueAttentionTask(next, bookmark);
  }, state);
}

/** Only a human status click creates work. Untouched blank sections never flood the queue. */
export function cycleQueuedProgress(state: AppState, document: ProjectDocument, nodeId: string): AppState {
  const node = document.nodes.find(n => n.id === nodeId);
  if (!node) return state;
  const current = state.progressByNode[nodeId] ?? "blank";
  const progress = current === "blank" ? "progress" : current === "progress" ? "done" : "blank";
  const matching = state.attentionTasks.filter(task => sectionReminderTarget(task, document)?.nodeId === nodeId);
  let next: AppState = { ...state, progressByNode: { ...state.progressByNode, [nodeId]: progress } };
  if (progress === "done") {
    const closed = matching.reduce((saved, task) => archiveAttentionTask(saved, task.id), next);
    return { ...closed, progressByNode: { ...state.progressByNode, [nodeId]: progress } };
  }
  if (matching.some(task => task.status !== "reviewed")) return next;
  if (matching.length) { next = reopenAttentionTask(next, matching[0].id); return { ...next, progressByNode: { ...state.progressByNode, [nodeId]: progress } }; }
  if (state.attentionTasks.length >= 2000) throw new Error("The saved task limit is reached. Export older work before adding more.");
  const now = new Date().toISOString();
  return queueAttentionTask(next, { id: crypto.randomUUID(), title: node.title, nodeId, route: "local", status: "queued", createdAt: now, updatedAt: now,
    reminder: { kind: "section" }, sourceSnapshot: { version: 1, projectId: document.project.id, rootFile: document.project.mainFile, revision: document.revision,
      scope: "section", nodeId, nodeTitle: node.title, paragraphs: [], ...(document.nodes.filter(n => n.title === node.title).length > 1 ? { locationUnverified: true } : {}) } });
}

/** Section IDs can change on structural saves; never jump to a recycled position. */
export function sectionReminderTarget(task: AttentionTask, document: ProjectDocument) {
  const source = task.sourceSnapshot;
  if (task.reminder?.kind !== "section" || source?.projectId !== document.project.id || source.rootFile !== document.project.mainFile) return undefined;
  const exact = document.nodes.filter(n => n.title === source.nodeTitle);
  const node = source.revision === document.revision ? exact.find(n => n.id === task.nodeId) : !source.locationUnverified && exact.length === 1 ? exact[0] : undefined;
  if (!node) return undefined;
  return { nodeId: node.id, paragraphId: document.paragraphs.find(p => p.nodeId === node.id)?.id };
}
