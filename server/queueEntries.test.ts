import assert from "node:assert/strict";
import { test } from "node:test";
import { cycleQueuedProgress, passageBookmark, sectionReminderTarget, togglePassageBookmarks } from "../src/queueEntries.ts";
import { archiveAttentionTask, attentionQueue, reopenAttentionTask, taskStatusLabel } from "../src/attention.ts";
import { makeReviewComment } from "../src/review.ts";
import { freshTurbo } from "../src/turbo.ts";
import { anchorSavedNotes } from "../src/sourceAnchors.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench, workbenchData } from "../src/workbench.ts";
import type { AppState, ProjectDocument, SaveAcknowledgement } from "../src/types.ts";

function doc(): ProjectDocument {
  return { project: { id: "paper", name: "Queue test", folder: "paper", mainFile: "main.tex", createdAt: "now" }, files: ["main.tex"], rootFiles: ["main.tex"], revision: "first",
    nodes: [{ id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p1", "p2"] }, { id: "other", title: "Other", kind: "section", depth: 0, paragraphIds: ["p3"] }],
    paragraphs: [{ id: "p1", nodeId: "intro", file: "main.tex", text: "First sentence. Second sentence." }, { id: "p2", nodeId: "intro", file: "main.tex", text: "Another passage." }, { id: "p3", nodeId: "other", file: "main.tex", text: "Another passage." }] };
}
function state(): AppState {
  return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "related", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "editing", activeNodeId: "intro", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" };
}
function selection(d = doc(), index = 0, start = 0, end = d.paragraphs[index].text.length) {
  const p = d.paragraphs[index]; return { paragraphId: p.id, nodeId: p.nodeId, start, end, text: p.text.slice(start, end) };
}
test("Later toggles only bookmarks, reuses history, and keeps comments and prompts", () => {
  const d = doc(), chosen = selection(d), s = state();
  s.attentionTasks = [makeReviewComment(d, {}, chosen, "Human concern"), { id: "prompt", title: "Question", nodeId: "intro", paragraphId: "p1", route: "codex", status: "working", createdAt: "now", updatedAt: "now" }];
  const queued = togglePassageBookmarks(s, d, [chosen]);
  assert.equal(attentionQueue(queued.attentionTasks).length, 3);
  const bookmark = passageBookmark(queued.attentionTasks, d, {}, chosen)!;
  assert.equal(bookmark.review, undefined); assert.equal(taskStatusLabel(bookmark), "saved passage");
  const removed = togglePassageBookmarks(queued, d, [chosen]);
  assert.equal(attentionQueue(removed.attentionTasks).length, 2);
  assert.equal(removed.attentionTasks[0], s.attentionTasks[0]);
  assert.equal(removed.attentionTasks[1], s.attentionTasks[1]);
  const restored = togglePassageBookmarks(removed, d, [chosen]);
  assert.equal(restored.attentionTasks.length, 3);
  assert.equal(passageBookmark(restored.attentionTasks, d, {}, chosen)?.id, bookmark.id);
  validateWorkbench({ ...emptyWorkbench(), ...workbenchData(restored) });
});
test("mixed and repeated highlight selections add only missing bookmarks, atomically", () => {
  const d = doc(), one = selection(d), two = selection(d, 1);
  const s = togglePassageBookmarks(state(), d, [one]);
  const both = togglePassageBookmarks(s, d, [one, two, two]);
  assert.equal(both.attentionTasks.length, 2);
  assert.equal(both.attentionTasks[0], s.attentionTasks[0]);
  assert.equal(attentionQueue(togglePassageBookmarks(both, d, [one, two]).attentionTasks).length, 0);
  const before = JSON.stringify(both);
  assert.throws(() => togglePassageBookmarks(both, d, [one, { ...two, text: "Changed" }]));
  assert.equal(JSON.stringify(both), before);
});
test("bookmark matching distinguishes highlights, repeated text, paper roots and revisions", () => {
  const d = doc(), one = selection(d, 0, 0, 15), two = selection(d, 0, 16);
  const s = togglePassageBookmarks(state(), d, [one, two, selection(d, 1)]);
  assert.notEqual(passageBookmark(s.attentionTasks, d, {}, one)?.id, passageBookmark(s.attentionTasks, d, {}, two)?.id);
  assert.equal(passageBookmark(s.attentionTasks, d, {}, selection(d, 2)), undefined);
  assert.equal(passageBookmark(s.attentionTasks, { ...d, project: { ...d.project, mainFile: "other.tex" } }, {}, one), undefined);
  const changed = { ...d, revision: "changed", paragraphs: d.paragraphs.map(p => p.id === "p1" ? { ...p, text: "Unrelated" } : p) };
  assert.equal(passageBookmark(s.attentionTasks, changed, {}, one), undefined);
});
test("explicit section status cycles create one reminder, keep notes, and preserve default blanks", () => {
  const d = doc(), s = state(); s.attentionTasks = [makeReviewComment(d, {}, selection(d), "Concern")];
  assert.equal(s.progressByNode.other, undefined); assert.equal(s.attentionTasks.length, 1);
  const begun = cycleQueuedProgress(s, d, "intro"), reminder = begun.attentionTasks[1];
  assert.equal(begun.progressByNode.intro, "progress"); assert.equal(reminder.reminder?.kind, "section");
  assert.equal(taskStatusLabel(reminder), "unfinished section");
  assert.deepEqual(sectionReminderTarget(reminder, d), { nodeId: "intro", paragraphId: "p1" });
  const finished = cycleQueuedProgress(begun, d, "intro");
  assert.equal(finished.progressByNode.intro, "done"); assert.equal(finished.attentionTasks[0], s.attentionTasks[0]);
  assert.equal(finished.attentionTasks[1].status, "reviewed");
  const blank = cycleQueuedProgress(finished, d, "intro");
  assert.equal(blank.progressByNode.intro, "blank"); assert.equal(blank.attentionTasks.length, 2); assert.equal(blank.attentionTasks[1].status, "queued");
  const progress = cycleQueuedProgress(blank, d, "intro"); assert.equal(progress.attentionTasks.length, 2);
  assert.equal(archiveAttentionTask(progress, reminder.id).progressByNode.intro, "done");
  assert.equal(reopenAttentionTask(finished, reminder.id).progressByNode.intro, "progress");
  assert.equal(cycleQueuedProgress(s, d, "missing"), s);
  validateWorkbench({ ...emptyWorkbench(), ...workbenchData(blank) });
  assert.equal(sectionReminderTarget(reminder, { ...d, nodes: d.nodes.map(n => ({ ...n, title: "Renamed" })) }), undefined);
});
test("bookmarked highlights follow acknowledged paragraph splits without changing their quotes", () => {
  const before = doc(), chosen = selection(before, 0, 16), s = togglePassageBookmarks(state(), before, [chosen]);
  const text = "First sentence.\n\nSecond sentence.";
  const after = { ...before, revision: "second", paragraphs: [{ ...before.paragraphs[0], id: "new1", text: "First sentence." }, { ...before.paragraphs[0], id: "new2", text: "Second sentence." }, ...before.paragraphs.slice(1)] };
  const ack: SaveAcknowledgement = { baseRevision: before.revision, savedRevision: after.revision, sourceRanges: [], paragraphMap: { p1: [{ paragraphId: "new1", start: 0, end: 15 }, { paragraphId: "new2", start: 17, end: text.length }] } };
  const updated = { ...s, ...anchorSavedNotes(s, before, after, { p1: text }, ack) };
  const target = { ...chosen, paragraphId: "new2", start: 0, end: "Second sentence.".length };
  assert.equal(passageBookmark(updated.attentionTasks, after, {}, target)?.id, s.attentionTasks[0].id);
  assert.equal(updated.attentionTasks[0].reminder?.kind === "passage" && updated.attentionTasks[0].reminder.quote, chosen.text);
  validateWorkbench({ ...emptyWorkbench(), ...workbenchData(updated) });
  assert.equal(attentionQueue(togglePassageBookmarks(updated, after, [target]).attentionTasks).length, 0);
});
test("store validation rejects malformed reminders and disguised model/comment tasks", () => {
  const s = togglePassageBookmarks(state(), doc(), [selection()]);
  const data = { ...emptyWorkbench(), ...workbenchData(s) };
  for (const patch of [{ status: "working" }, { review: { kind: "comment" } }, { localJobId: "job" }, { reminder: { kind: "passage", quote: "wrong", start: 0, end: 5 } }, { reminder: { kind: "section" } }]) {
    assert.throws(() => validateWorkbench({ ...data, attentionTasks: [{ ...data.attentionTasks[0], ...patch }] }));
  }
});
test("bookmark capture never manufactures source drafts or changes their revision", () => {
  const d = doc(), s = state(), chosen = selection(d);
  const captured = togglePassageBookmarks(s, d, [chosen], { p1: d.paragraphs[0].text });
  assert.equal(captured.paragraphEdits, s.paragraphEdits);
  assert.equal(captured.draftRevision, undefined);
  const typed = "Revised text.";
  const selected = { ...chosen, start: 0, end: typed.length, text: typed };
  const withDraft = { ...s, paragraphEdits: { p1: typed }, draftRevision: d.revision };
  const saved = togglePassageBookmarks(withDraft, d, [selected], withDraft.paragraphEdits);
  assert.equal(saved.paragraphEdits, withDraft.paragraphEdits); assert.equal(saved.draftRevision, d.revision);
});
test("section reminders follow a unique saved heading without trusting recycled IDs", () => {
  const d = doc(), s = cycleQueuedProgress(state(), d, "intro"), task = s.attentionTasks[0];
  const moved = { ...d, revision: "new", nodes: d.nodes.map(n => n.id === "intro" ? { ...n, id: "moved" } : n) };
  assert.equal(sectionReminderTarget(task, moved)?.nodeId, "moved");
  const next = cycleQueuedProgress(s, moved, "moved");
  assert.equal(next.attentionTasks.length, 1, "status clicks reuse the section reminder after a verified heading move");
  const ambiguous = { ...moved, nodes: [...moved.nodes, { ...moved.nodes[0], id: "duplicate" }] };
  assert.equal(sectionReminderTarget(task, ambiguous), undefined);
  const wrongRoot = { ...moved, project: { ...moved.project, mainFile: "other.tex" } };
  assert.equal(sectionReminderTarget(task, wrongRoot), undefined);
});
test("whole-block toggles remain on through normal typing, while highlight anchors stay exact", () => {
  const d = doc(), s = togglePassageBookmarks(state(), d, [selection(d)]), typed = "A completely revised paragraph.";
  const chosen = { ...selection(d), text: typed, end: typed.length };
  assert.equal(passageBookmark(s.attentionTasks, d, { p1: typed }, chosen)?.id, s.attentionTasks[0].id);
  const updated = { ...s, paragraphEdits: { p1: typed }, draftRevision: d.revision };
  assert.equal(attentionQueue(togglePassageBookmarks(updated, d, [chosen]).attentionTasks).length, 0);
  assert.equal(passageBookmark(s.attentionTasks, { ...d, revision: "external", paragraphs: d.paragraphs.map(p => p.id === "p1" ? { ...p, text: typed } : p) }, {}, chosen), undefined);
  const highlight = togglePassageBookmarks(state(), d, [selection(d, 0, 0, 15)]);
  assert.equal(passageBookmark(highlight.attentionTasks, d, { p1: typed }, chosen), undefined);
});
