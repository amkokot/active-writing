import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { AppState, ProjectDocument, AttentionTask } from "../src/types.ts";
import { defaultReviewInstructions, makeCommandReviewComment, makeReviewComment, editReviewComment, resolveReviewComment, resolveQueuedReviewComments, reviewComments, adjacentReviewComment, nextCommentAfterResolve, reviewSnapshot, makeReviewRequest, parseReviewReply, reviewCommentTarget, reviewCommentLocation, blockReviewComments } from "../src/review.ts";
import { archiveAttentionTask, archiveReadyNotebookTasks, attentionQueue, queueAttentionTask, reopenAttentionTask } from "../src/attention.ts";
import { receiveHandoffReply } from "../src/handoffs.ts";
import { checkTaskSource } from "../src/taskSource.ts";
import { checkParagraph, freshTurbo } from "../src/turbo.ts";
import { emptyWorkbench, workbenchData, receiveWorkbench, restoreWorkbenchDraft } from "../src/workbench.ts";
import { readWorkbench, writeWorkbench, validateWorkbench } from "./workbenchStore.ts";
import { exportReview, annotateCompletedReview } from "./reviewExport.ts";
import { readHandoff } from "./handoffs.ts";
import { parseProject, registerProject } from "./projects.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { makeReviewCommentReply, nextCommentOutsideBlock } from "../src/review.ts";

function document(): ProjectDocument {
  return { project: { id: "paper", name: "Review fixture", folder: "paper", mainFile: "main.tex", createdAt: "now" }, files: ["main.tex", "sections/proof.tex"], rootFiles: ["main.tex"], revision: "first",
    nodes: [{ id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p1", "p2"] }, { id: "proof", title: "Proof", kind: "proof", parentId: "intro", depth: 1, paragraphIds: ["p3"] }, { id: "other", title: "Other work", kind: "section", depth: 0, paragraphIds: ["p4"] }],
    paragraphs: [{ id: "p1", nodeId: "intro", file: "main.tex", text: "The bound $x \\leq 1$ holds. See \\ref{lem}." }, { id: "p2", nodeId: "intro", file: "main.tex", text: "Repeated term, repeated term. 🙂" }, { id: "p3", nodeId: "proof", file: "sections/proof.tex", text: "By \\cite{source}, compactness suffices." }, { id: "p4", nodeId: "other", file: "main.tex", text: "An independent branch." }] };
}
function state(tasks: AttentionTask[] = []): AppState {
  return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "editing", activeNodeId: "other", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: tasks, themeLenses: [], activeThemeId: "", previewMode: "hidden" };
}

test("heading comments capture their own exact command, survive round trips, and never attach to nearby prose", () => {
  const doc = document(), value = "\\section{Introduction}";
  doc.nodes[0].sourceOpening = { file: "main.tex", start: 0, end: value.length, text: value };
  const task = makeCommandReviewComment(doc, { nodeId: "intro", command: "opening", file: "main.tex", value, start: 9, end: 21 }, "Clarify this heading.");
  assert.equal(task.review?.kind === "comment" && task.review.quote, "Introduction");
  assert.equal(task.paragraphId, "aw-command:intro:opening");
  assert.equal(reviewCommentTarget(task, doc)?.command, "opening");
  validateWorkbench({ ...emptyWorkbench(), attentionTasks: [task] });
  const moved = structuredClone(doc); moved.revision = "second"; moved.nodes[0].id = "new-intro-id";
  assert.equal(reviewCommentTarget(task, moved)?.nodeId, "new-intro-id", "only exact uniquely matched commands relocate");
  const changed = structuredClone(doc); changed.revision = "second"; changed.nodes[0].sourceOpening!.text = "\\section{New title}";
  assert.equal(reviewCommentTarget(task, changed), undefined);
  assert.equal(reviewCommentTarget(task, { ...doc, project: { ...doc.project, mainFile: "other.tex" } }), undefined);
  const duplicate = structuredClone(doc); duplicate.revision = "second"; duplicate.nodes[2].sourceOpening = { ...doc.nodes[0].sourceOpening! };
  assert.equal(reviewCommentTarget(task, duplicate), undefined);
  assert.throws(() => makeCommandReviewComment(doc, { nodeId: "intro", command: "opening", file: "main.tex", value: "unsaved", start: 0, end: 7 }), /changed/);
  const invalid = structuredClone(task); invalid.sourceSnapshot!.paragraphs[0].command = "wrong" as "opening";
  assert.throws(() => validateWorkbench({ ...emptyWorkbench(), attentionTasks: [invalid] }));
});

test("comment navigation follows priority order, wraps both ways and never resolves a note", () => {
  const one = { ...comment(), id: "one", queuePosition: 2 }, two = { ...comment(), id: "two", queuePosition: 0 };
  const closed = { ...comment(), id: "closed", status: "reviewed" as const, queuePosition: 1 };
  const tasks = [one, closed, two];
  const before = JSON.stringify(tasks);
  assert.equal(adjacentReviewComment(tasks, undefined, 1)?.id, "two");
  assert.equal(adjacentReviewComment(tasks, "two", 1)?.id, "one");
  assert.equal(adjacentReviewComment(tasks, "two", -1)?.id, "one");
  assert.equal(adjacentReviewComment(tasks, "one", 1)?.id, "two");
  assert.equal(adjacentReviewComment(tasks, "closed", -1)?.id, "one");
  assert.equal(adjacentReviewComment([], undefined, 1), undefined);
  assert.equal(JSON.stringify(tasks), before);
});
function comment(doc = document()) {
  const p = doc.paragraphs[0]; return makeReviewComment(doc, {}, { paragraphId: p.id, nodeId: p.nodeId, start: 0, end: 9, text: p.text.slice(0, 9) }, "Explain the assumptions.");
}

test("leaving block comments skips that block and closed/hidden work, including after the last resolution", () => {
  const first = { ...comment(), id: "first", queuePosition: 0 };
  const inBlock = { ...comment(), id: "block", queuePosition: 1 };
  const sibling = { ...comment(), id: "sibling", queuePosition: 2 };
  const closed = { ...comment(), id: "closed", status: "reviewed" as const, queuePosition: 3 };
  const hidden = { ...comment(), id: "hidden", queueHiddenAt: "2026-10-15T10:00:00Z", queuePosition: 4 };
  const last = { ...comment(), id: "last", queuePosition: 5 };
  const tasks = [last, closed, sibling, first, hidden, inBlock];
  const before = JSON.stringify(tasks);
  assert.equal(nextCommentOutsideBlock(tasks, [inBlock, sibling], inBlock.id)?.id, "last");
  assert.equal(nextCommentOutsideBlock(tasks, [last], last.id)?.id, "first", "wraps in priority order");
  assert.equal(nextCommentOutsideBlock(tasks, [], undefined)?.id, "first", "empty finished block still offers continuation");
  assert.equal(nextCommentOutsideBlock([inBlock, sibling, closed, hidden], [inBlock, sibling], inBlock.id), undefined);
  assert.equal(nextCommentOutsideBlock([], [], undefined), undefined);
  assert.equal(JSON.stringify(tasks), before, "navigation cannot resolve or edit comments");
});
test("human replies append linked history, can be chained, and do not reopen resolved parents", () => {
  const parent = comment();
  const closed = resolveReviewComment(state([parent]), parent.id).attentionTasks[0], before = JSON.stringify(closed);
  const reply = makeReviewCommentReply(closed, "The change looks good, but explain the second step.");
  const followup = makeReviewCommentReply(reply, "Here is the additional question.");
  assert.equal(reply.review?.kind === "comment" && reply.review.replyTo, closed.id);
  assert.equal(followup.review?.kind === "comment" && followup.review.replyTo, reply.id);
  assert.equal(reply.review?.kind === "comment" && reply.review.author, "human");
  assert.equal(closed.status, "reviewed"); assert.equal(reply.status, "queued");
  assert.equal(JSON.stringify(closed), before);
  assert.notEqual(reply.sourceSnapshot, closed.sourceSnapshot);
  assert.deepEqual(reply.sourceSnapshot, closed.sourceSnapshot);
  validateWorkbench({ ...emptyWorkbench(), attentionTasks: [closed, reply, followup] });
  assert.throws(() => makeReviewCommentReply(closed, "   "));
  assert.throws(() => makeReviewCommentReply(closed, "a".repeat(6001)));
});
test("resolving a parent closes nested replies, keeps history, and never closes ancestors or siblings", () => {
  const parent = { ...comment(), id: "parent", queuePosition: 0 };
  const reply = { ...makeReviewCommentReply(parent, "Reply"), id: "reply", queuePosition: 1 };
  const nested = { ...makeReviewCommentReply(reply, "Nested reply"), id: "nested", queuePosition: 2, queueHiddenAt: "2026-10-15T10:00:00Z" };
  const other = { ...comment(), id: "other", queuePosition: 3 };
  const sibling = { ...makeReviewCommentReply(parent, "Sibling"), id: "sibling", queuePosition: 4 };
  const tasks = [nested, other, reply, sibling, parent], original = JSON.stringify(tasks);
  const after = resolveReviewComment(state(tasks), parent.id);
  assert.equal(JSON.stringify(tasks), original);
  for (const item of [parent, reply, nested, sibling]) {
    const saved = after.attentionTasks.find(t => t.id === item.id)!;
    assert.equal(saved.status, "reviewed");
    assert.deepEqual(saved.sourceSnapshot, item.sourceSnapshot);
    assert.deepEqual({ ...saved.review, resolvedAt: undefined }, { ...item.review, resolvedAt: undefined });
  }
  assert.equal(after.attentionTasks.find(t => t.id === other.id), other);
  assert.equal(resolveReviewComment(after, parent.id), after, "repeated resolution is idempotent");
  const reopened = resolveReviewComment(after, parent.id, false);
  assert.equal(reopened.attentionTasks.find(t => t.id === parent.id)?.status, "queued");
  assert.equal(reopened.attentionTasks.find(t => t.id === reply.id)?.status, "reviewed");
  const onlyReply = resolveReviewComment(state(tasks), reply.id);
  assert.equal(onlyReply.attentionTasks.find(t => t.id === nested.id)?.status, "reviewed");
  for (const untouched of [parent, sibling, other]) assert.equal(onlyReply.attentionTasks.find(t => t.id === untouched.id), untouched);
  const newReply = makeReviewCommentReply(after.attentionTasks.find(t => t.id === parent.id)!, "New concern");
  assert.equal(resolveReviewComment(state([...after.attentionTasks, newReply]), parent.id).attentionTasks.at(-1)?.status, "reviewed");
  assert.equal(nextCommentAfterResolve(tasks, parent.id)?.id, "other");
  const closedReply = resolveReviewComment(state([reply]), reply.id).attentionTasks[0];
  const nestedOpen = { ...nested, queueHiddenAt: undefined };
  assert.equal(nextCommentAfterResolve([parent, nestedOpen, other], parent.id, [parent, closedReply, nestedOpen, other])?.id, "other", "block navigation follows links through resolved intermediate replies");
  assert.equal(resolveQueuedReviewComments(state(tasks), [parent.id]).attentionTasks.find(t => t.id === nested.id)?.status, "reviewed");
  validateWorkbench(workbenchData(after));
});

test("thread traversal terminates with cyclic or missing reply links", () => {
  const first = { ...comment(), id: "first" };
  const second = { ...makeReviewCommentReply(first, "Reply"), id: "second" };
  const review = first.review;
  if (review?.kind !== "comment") throw new Error("Expected comment fixture");
  first.review = { ...review, replyTo: second.id };
  const orphan = { ...makeReviewCommentReply(first, "Orphan"), id: "orphan", review: { ...review, replyTo: "missing" } };
  const after = resolveReviewComment(state([first, second, orphan]), first.id);
  assert.deepEqual(after.attentionTasks.map(t => t.status), ["reviewed", "reviewed", "queued"]);
  assert.equal(resolveReviewComment(after, "missing"), after);
});

test("block indicators group only present comments at safe current-root locations and disappear on resolution", () => {
  const doc = document(), one = { ...comment(doc), id: "one" }, two = { ...comment(doc), id: "two", queuePosition: 0 };
  const otherRoot = structuredClone(one); otherRoot.id = "foreign"; otherRoot.sourceSnapshot!.rootFile = "other.tex";
  const gone = structuredClone(one); gone.id = "gone"; gone.sourceSnapshot!.paragraphs[0].text = "Removed block"; gone.sourceSnapshot!.revision = "older";
  const hidden = { ...comment(doc), id: "hidden", queueHiddenAt: "now" };
  const tasks = [one, two, otherRoot, gone, hidden], before = JSON.stringify(tasks);
  assert.deepEqual(blockReviewComments(tasks, doc).p1.map(t => t.id), ["two", "one", "hidden"]);
  assert.equal(blockReviewComments(tasks, doc).p2, undefined);
  assert.equal(JSON.stringify(tasks), before);
  const closed = [one, two, hidden].reduce((s, t) => resolveReviewComment(s, t.id), state(tasks));
  assert.deepEqual(blockReviewComments(closed.attentionTasks, doc), {});
  doc.nodes[0].sourceOpening = { file: "main.tex", start: 0, end: 12, text: "\\section{Hi}" };
  const heading = makeCommandReviewComment(doc, { nodeId: "intro", command: "opening", file: "main.tex", value: "\\section{Hi}", start: 9, end: 11 }, "A heading comment");
  assert.equal(blockReviewComments([heading], doc)["aw-command:intro:opening"].length, 1);
});
test("resolving advances to the next queued comment, or the previous when last, without wrapping or mutating", () => {
  const one = { ...comment(), id: "one", queuePosition: 0 }, two = { ...comment(), id: "two", queuePosition: 1 }, three = { ...comment(), id: "three", queuePosition: 2 };
  const hidden = { ...comment(), id: "hidden", queueHiddenAt: "now", queuePosition: 3 };
  const tasks = [three, hidden, one, two], before = JSON.stringify(tasks);
  assert.equal(nextCommentAfterResolve(tasks, "one")?.id, "two");
  assert.equal(nextCommentAfterResolve(tasks, "two")?.id, "three");
  assert.equal(nextCommentAfterResolve(tasks, "three")?.id, "two");
  assert.equal(nextCommentAfterResolve([one], "one"), undefined);
  assert.equal(nextCommentAfterResolve(tasks, "missing"), undefined);
  assert.equal(nextCommentAfterResolve(tasks, "hidden"), undefined);
  assert.equal(JSON.stringify(tasks), before);
});
test("edited comments can navigate to explicit stable blocks without enabling stale quote edits", () => {
  const doc = document(), task = comment(doc);
  const edited = structuredClone(doc); edited.revision = "second";
  edited.paragraphs[0] = { ...edited.paragraphs[0], text: "Rewritten proof with new equations.", explicitId: true, nodeId: "other" };
  assert.deepEqual(reviewCommentLocation(task, edited), { nodeId: "other", paragraphId: "p1", changedBlock: true });
  assert.equal(reviewCommentTarget(task, edited), undefined);
  assert.equal(checkTaskSource(task.sourceSnapshot, edited).target, undefined, "other task types retain strict source checks");
  const ordinal = structuredClone(edited); delete ordinal.paragraphs[0].explicitId;
  assert.equal(reviewCommentLocation(task, ordinal), undefined);
  const wrongFile = structuredClone(edited); wrongFile.paragraphs[0].file = "sections/proof.tex";
  assert.equal(reviewCommentLocation(task, wrongFile), undefined);
  const duplicate = structuredClone(edited); duplicate.paragraphs.push({ ...edited.paragraphs[0] });
  assert.equal(reviewCommentLocation(task, duplicate), undefined);
  assert.equal(reviewCommentLocation(task, { ...edited, project: { ...edited.project, mainFile: "other.tex" } }), undefined);
  assert.equal(reviewCommentLocation(task, { ...edited, project: { ...edited.project, id: "other" } }), undefined);
  const unverified = structuredClone(task); unverified.sourceSnapshot!.paragraphs[0].locationUnverified = true;
  assert.equal(reviewCommentLocation(unverified, edited), undefined);
  assert.deepEqual(reviewCommentLocation(task, doc, { p1: "Unsaved new wording." }), { nodeId: "intro", paragraphId: "p1", changedBlock: true });
});
test("comment highlight uses exact quote offsets through note typing and verified source relocation", () => {
  const doc = document(), p = doc.paragraphs[0], start = p.text.indexOf("$x"), quote = "$x \\leq 1$";
  const note = makeReviewComment(doc, {}, { paragraphId:p.id, nodeId:p.nodeId, start, end:start+quote.length, text:quote }, "Explain this expression.");
  const target = { paragraphId:p.id, nodeId:p.nodeId, start, end:start+quote.length, text:quote };
  assert.deepEqual(reviewCommentTarget(note, doc), target);
  const edited = editReviewComment(state([note]), note.id, "Explain this expression more clearly.").attentionTasks[0];
  assert.deepEqual(reviewCommentTarget(edited, doc), target);
  assert.equal(reviewCommentTarget(edited, doc, { [p.id]:"An unrelated replacement." }), undefined);
  const after = document(), prefix = "Added context. "; after.revision = "second"; after.paragraphs[0].text = prefix+p.text;
  const relocated = { ...note, sourceSnapshot: { ...note.sourceSnapshot!, returnAnchor: { paragraphId:p.id, paragraphText:after.paragraphs[0].text, file:p.file, revision:after.revision, start:start+prefix.length, end:start+prefix.length+quote.length } } };
  assert.deepEqual(reviewCommentTarget(relocated, after), { ...target, start:start+prefix.length, end:start+prefix.length+quote.length });
  assert.equal(reviewCommentTarget(note, { ...doc, project:{ ...doc.project, id:"another" } }), undefined);
});
test("bulk Resolve changes only captured queued comments and preserves reopening/history", () => {
  const one = { ...comment(), id: "one" }, two = { ...comment(), id: "two", review: { ...comment().review!, author: "assistant" as const } };
  const hidden = { ...comment(), id: "hidden", queueHiddenAt: "2026-10-13T10:00:00Z" };
  const closed = { ...comment(), id: "closed", status: "reviewed" as const, review: { ...comment().review!, resolvedAt: "2026-10-12T10:00:00Z" } };
  const newlyArrived = { ...comment(), id: "new" }, ordinary = { ...request(), id: "request" };
  const before = state([one, two, hidden, closed, newlyArrived, ordinary]), saved = JSON.stringify(before);
  const after = resolveQueuedReviewComments(before, ["one", "two", "hidden", "closed", "request", "missing", "one"]);
  assert.equal(JSON.stringify(before), saved);
  for (const original of [one, two]) {
    const updated = after.attentionTasks.find(t => t.id === original.id)!;
    assert.equal(updated.status, "reviewed");
    assert.deepEqual(updated.sourceSnapshot, original.sourceSnapshot);
    assert.equal(updated.review?.kind === "comment" && updated.review.quote, original.review?.kind === "comment" && original.review.quote);
    assert.ok(updated.review?.kind === "comment" && updated.review.resolvedAt);
  }
  for (const untouched of [hidden, closed, newlyArrived, ordinary]) assert.equal(after.attentionTasks.find(t => t.id === untouched.id), untouched);
  assert.deepEqual(after.paragraphEdits, before.paragraphEdits);
  validateWorkbench(workbenchData(after));
  const reopened = resolveReviewComment(after, "one", false);
  assert.equal(reopened.attentionTasks.find(t => t.id === "one")?.status, "queued");
  assert.equal(resolveQueuedReviewComments(after, ["missing", "hidden", "request"]), after);
});
function request(doc = document(), tasks: AttentionTask[] = [], mode: "human" | "ai" = "ai", route: "codex" | "chatgpt" = "codex") {
  return makeReviewRequest(reviewSnapshot(doc, {}, "paper", doc.nodes[0].id, doc.paragraphs[0].id), tasks, mode, defaultReviewInstructions[mode], route);
}
function reply(req: AttentionTask, patch: Record<string, unknown> = {}) {
  const p = req.sourceSnapshot!.paragraphs[0]; return JSON.stringify({ version: 1, comments: [{ id: "note-1", paragraphId: p.id, quote: p.text.slice(0, 9), comment: "State the hypotheses before the conclusion.", ...patch }] });
}
const source = "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nThe bound $x \\leq 1$ holds.\n\nA second paragraph.\n\\input{sections/proof}\n\\end{document}\n";
const child = "\\section{Argument}\nThe equality case requires care.\n\nBy compactness the claim follows.\n";
async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "review-")), root = path.join(workspace, "paper");
  await mkdir(path.join(root, "sections"), { recursive: true }); await writeFile(path.join(root, "main.tex"), source); await writeFile(path.join(root, "sections/proof.tex"), child);
  const project = await registerProject(workspace, root, "Review fixture"), doc = await parseProject(workspace, project.id);
  return { workspace, root, project, doc };
}

test("human comments save exact quotes and only explicit Resolve retires them", () => {
  const doc = document(), note = comment(doc), before = state([note]);
  assert.match(editReviewComment(before, note.id, "").attentionTasks[0].title, /^Comment · The bound/);
  assert.equal(note.review!.kind, "comment"); validateWorkbench(workbenchData(before));
  assert.equal(archiveAttentionTask(before, note.id), before); assert.equal(receiveHandoffReply(before, note.id, "Looks good."), before);
  const edited = editReviewComment(before, note.id, "Recheck this assumption."); assert.equal(attentionQueue(edited.attentionTasks).length, 1);
  const followed = queueAttentionTask(edited, { ...request(doc), previousTaskId: note.id }); assert.equal(followed.attentionTasks[0].status, "queued");
  const checked = { ...edited, turbo: checkParagraph(edited.turbo, "p1", doc.paragraphs[0].text, "scroll") };
  assert.equal(reviewComments(checked.attentionTasks).length, 1); assert.equal(archiveReadyNotebookTasks(checked, "notebook").attentionTasks[0].status, "queued");
  const resolved = resolveReviewComment(checked, note.id); assert.equal(attentionQueue(resolved.attentionTasks).length, 0); assert.equal(reviewComments(resolved.attentionTasks, true).length, 1);
  validateWorkbench(workbenchData(resolved)); assert.equal(reopenAttentionTask(resolved, note.id), resolved);
  const reopened = resolveReviewComment(resolved, note.id, false); assert.equal(reopened.attentionTasks[0].status, "queued"); validateWorkbench(workbenchData(reopened));
  assert.deepEqual(doc, document()); assert.deepEqual(checked.paragraphEdits, {});
});

test("selection anchors reject stale ranges, oversize quotes and out-of-bounds endpoints", () => {
  const doc = document(), p = doc.paragraphs[0], selection = { paragraphId: p.id, nodeId: p.nodeId, start: 0, end: p.text.length, text: p.text };
  for (const change of [{ end: p.text.length + 1 }, { start: -1 }, { text: "Changed" }, { end: 0 }]) assert.throws(() => makeReviewComment(doc, {}, { ...selection, ...change }), /selected passage changed/);
  assert.throws(() => makeReviewComment(doc, { p1: "Different" }, selection), /selected passage changed/);
  assert.throws(() => makeReviewComment(doc, {}, selection, "x".repeat(6001)), /6,000/);
  const queued = state([comment(doc)]); const changed = document(); changed.paragraphs[0].text = "Changed source.";
  assert.equal(checkTaskSource(queued.attentionTasks[0].sourceSnapshot, changed).target, undefined); assert.equal(reviewComments(queued.attentionTasks).length, 1);
});

test("section reviews include nested multi-file arguments, whole paper includes other work, and oversized exports fail explicitly", () => {
  const doc = document(); assert.deepEqual(reviewSnapshot(doc, {}, "section", "intro", "p1").paragraphs.map(p => p.id), ["p1", "p2", "p3"]);
  assert.deepEqual(reviewSnapshot(doc, {}, "paragraph", "intro", "p1").paragraphs.map(p => p.id), ["p1"]);
  const full = reviewSnapshot(doc, { p3: "Unsaved proof" }, "paper", "intro"); assert.equal(full.paragraphs[2].text, "Unsaved proof"); assert.equal(full.paragraphs[2].nodeTitle, "Proof");
  assert.throws(() => reviewSnapshot(doc, { p1: "x".repeat(65001) }, "paper", "intro"), /too large/);
  assert.throws(() => makeReviewRequest(reviewSnapshot(doc, {}, "paragraph", "other", "p4"), [comment(doc)], "human", "Review", "codex"), /No open comments/);
  const req = request(doc, [comment(doc)], "human"); assert.match(req.packet!, /Human comment/); assert.match(req.packet!, /Only the human resolves/); assert.match(req.packet!, /sections\/proof.tex/); assert.match(req.packet!, /unsaved author text/);
});

test("detached comments are retained in their section or whole-paper exports, never given guessed new anchors", () => {
  const doc = document(), note = comment(doc), changed = document(); changed.revision = "edited"; changed.paragraphs = changed.paragraphs.filter(p => p.id !== "p1");
  const req = request(changed, [note], "human"); assert.match(req.packet!, /Detached comment/); assert.match(req.packet!, /NOT a new paragraph ID/); assert.match(req.packet!, /Explain the assumptions/);
  assert.throws(() => parseReviewReply(reply(req, { paragraphId: "p1" }), req), /outside/);
  const section = makeReviewRequest(reviewSnapshot(changed, {}, "section", "intro"), [note], "human", "Review comments", "codex"); assert.match(section.packet!, /Detached comment/);
  assert.throws(() => makeReviewRequest(reviewSnapshot(changed, {}, "section", "other"), [note], "human", "Review comments", "codex"), /No open comments/);
  assert.throws(() => makeReviewRequest(reviewSnapshot(changed, {}, "paper", "intro"), [{ ...note, sourceSnapshot: { ...note.sourceSnapshot!, rootFile: "another.tex" } }], "human", "Review", "codex"), /No open comments/);
});

test("finishing a review packet, without an import or after a reply, leaves every comment queued", () => {
  const note = comment(), req = request(document(), [note], "human"), queued = state([note, req]);
  assert.equal(archiveAttentionTask(queued, req.id).attentionTasks[0].status, "queued");
  const received = receiveHandoffReply(queued, req.id, reply(req));
  const finished = archiveAttentionTask(received, req.id); assert.equal(reviewComments(finished.attentionTasks).length, 2);
  const rewritten = { ...finished, paragraphEdits: { p1: "The author revised this passage." }, progressByNode: { intro: "done" as const } };
  assert.equal(reviewComments(rewritten.attentionTasks).length, 2); assert.equal(attentionQueue(rewritten.attentionTasks).length, 2);
});

test("assistant comments validate all anchors before import and reject status/source injection", () => {
  const note = comment(), req = request(document(), [note], "human"), before = state([note, req]);
  const valid = reply(req, { replyTo: note.id }); const after = receiveHandoffReply(before, req.id, '```json\n' + valid + '\n```');
  assert.equal(after.attentionTasks.length, 3); assert.equal(after.attentionTasks[0].status, "queued"); assert.equal(after.attentionTasks[1].status, "ready"); assert.equal(after.attentionTasks[2].review?.kind === "comment" && after.attentionTasks[2].review.author, "assistant");
  validateWorkbench(workbenchData(after)); assert.deepEqual(after.paragraphEdits, before.paragraphEdits); assert.equal(after.activeNodeId, before.activeNodeId);
  for (const patch of [{ resolved: true }, { status: "reviewed" }, { paragraphId: "outside" }, { quote: "invented quote" }, { replyTo: "unexported" }, { end: 999, start: 0 }]) {
    const invalid = receiveHandoffReply(before, req.id, reply(req, patch)); assert.equal(invalid.attentionTasks.length, 2); assert.equal(invalid.attentionTasks[1].status, "queued"); assert.ok(invalid.attentionTasks[1].replyDraft); assert.ok(invalid.attentionTasks[1].error);
  }
  const items = JSON.parse(valid).comments; const partial = JSON.stringify({ version: 1, comments: [...items, { ...items[0], id: "bad", quote: "not there" }] });
  assert.equal(receiveHandoffReply(before, req.id, partial).attentionTasks.length, 2);
  assert.throws(() => parseReviewReply(JSON.stringify({ version: 1, comments: [...items, ...items] }), req), /unique ID/);
});

test("repeated quotes require offsets, UTF-16 offsets preserve unicode and empty review is not a certification", () => {
  const req = request(), p = req.sourceSnapshot!.paragraphs[1];
  assert.throws(() => parseReviewReply(reply(req, { paragraphId: p.id, quote: "term" }), req), /repeated/);
  const start = p.text.lastIndexOf("term"); assert.equal(parseReviewReply(reply(req, { paragraphId: p.id, quote: "term", start, end: start + 4 }), req).length, 1);
  const unicode = p.text.indexOf("🙂"); assert.equal(parseReviewReply(reply(req, { paragraphId: p.id, quote: "🙂", start: unicode, end: unicode + 2 }), req)[0].review?.kind, "comment");
  const note = comment(), humanReq = request(document(), [note], "human"), after = receiveHandoffReply(state([note, humanReq]), humanReq.id, '{"version":1,"comments":[]}');
  assert.equal(after.attentionTasks[1].status, "ready"); assert.equal(after.attentionTasks[0].status, "queued");
});

test("duplicate imports never replace author-edited or resolved comments and capacity errors preserve the reply", () => {
  const req = request(), response = reply(req), imported = receiveHandoffReply(state([req]), req.id, response);
  const edited = resolveReviewComment(editReviewComment(imported, imported.attentionTasks[1].id, "My correction"), imported.attentionTasks[1].id);
  const again = receiveHandoffReply(edited, req.id, response); assert.equal(again.attentionTasks.length, 2); assert.deepEqual(again.attentionTasks[1], edited.attentionTasks[1]);
  assert.equal(receiveHandoffReply(edited, req.id, response, "late-hash"), edited);
  const full = state([req, ...Array.from({ length: 1999 }, (_, i) => ({ ...comment(), id: `saved-${i}` }))]);
  const refused = receiveHandoffReply(full, req.id, response); assert.equal(refused.attentionTasks.length, 2000); assert.match(refused.attentionTasks[0].error!, /Too many/); assert.equal(refused.attentionTasks[0].replyDraft, response);
});

test("comments and resolutions persist on disk; recovery is queued and validation rejects implicit completion", async () => {
  const f = await fixture(), note = comment(f.doc), original = state([note]);
  await writeWorkbench(f.workspace, f.project.id, 0, workbenchData(original));
  const disk = await readWorkbench(f.workspace, f.project.id), hydrated = receiveWorkbench(state(), disk); assert.deepEqual(hydrated.attentionTasks, original.attentionTasks);
  const resolved = resolveReviewComment(hydrated, note.id); await writeWorkbench(f.workspace, f.project.id, disk.revision, workbenchData(resolved));
  assert.equal((await readWorkbench(f.workspace, f.project.id)).attentionTasks[0].review?.kind === "comment", true);
  const invalid = workbenchData(original); invalid.attentionTasks = [{ ...note, status: "reviewed" }]; assert.throws(() => validateWorkbench(invalid), /resolution/);
  const recovered = restoreWorkbenchDraft({ ...resolved, recoveredWorkbenchDrafts: [{ id: "copy", key: "task", kind: "task", createdAt: "now", value: resolved.attentionTasks[0] }] }, "copy");
  assert.equal(recovered.attentionTasks.at(-1)!.status, "queued"); validateWorkbench(workbenchData(recovered));
});

test("shared-folder review exports editable instructions, imports only finalized replies and creates a reusable commented text file", async () => {
  const f = await fixture(), note = comment(f.doc), req = request(f.doc, [note], "human");
  const exported = await exportReview(f.workspace, f.project.id, req); assert.match(exported.ticket.copyText, /REVIEW_INSTRUCTIONS.txt/);
  const instructions = await readFile(exported.instructionsPath, "utf8"); assert.match(instructions, /Do not change the manuscript/); assert.match(await readFile(exported.webPath, "utf8"), /Human comment/);
  await writeFile(exported.instructionsPath, instructions + "\nAuthor added instruction: preserve hypotheses.\n");
  const retry = await exportReview(f.workspace, f.project.id, { ...req, error: "Uncertain response", updatedAt: "later", ticket: exported.ticket, review: { ...req.review as any, instructionsPath: exported.instructionsPath } });
  assert.equal(retry.ticket.id, exported.ticket.id); assert.match(await readFile(exported.instructionsPath, "utf8"), /Author added instruction/);
  const response = reply(req, { replyTo: note.id }), envelope = { version: 1, taskId: req.id, requestHash: exported.ticket.requestHash, complete: false, reply: response };
  await writeFile(exported.ticket.responsePath, JSON.stringify(envelope)); assert.equal((await readHandoff(f.workspace, f.project.id, req.id)).status, "pending");
  await writeFile(exported.ticket.responsePath, JSON.stringify({ ...envelope, complete: true })); const ready = await readHandoff(f.workspace, f.project.id, req.id); assert.equal(ready.status, "ready");
  const received = receiveHandoffReply(state([note, { ...req, ticket: exported.ticket }]), req.id, ready.reply!, ready.replyHash); assert.equal(received.attentionTasks[0].status, "queued");
  const annotated = await annotateCompletedReview(f.workspace, f.project.id, req.id, response); assert.ok(annotated.text.startsWith("# Active Writing · review for deeper thinking")); assert.match(annotated.text, /State the hypotheses/); assert.match(annotated.text, /Human comment/); assert.match(annotated.text, /Not checked/);
  await writeFile(annotated.path, annotated.text + "\nAuthor addition.\n"); assert.match((await annotateCompletedReview(f.workspace, f.project.id, req.id, response)).text, /Author addition/);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), source); assert.equal(await readFile(path.join(f.root, "sections/proof.tex"), "utf8"), child);
  assert.ok(!(await parseProject(f.workspace, f.project.id)).files.some(file => file.includes("review-")));
});

test("web review is manual and its exact Copy-button JSON uses the same anchored import", async () => {
  const f = await fixture(), req = request(f.doc, [], "ai", "chatgpt"), exported = await exportReview(f.workspace, f.project.id, req), response = reply(req);
  assert.equal(exported.ticket.copyText, req.packet); assert.equal(exported.ticket.transport, "paste");
  await writeFile(exported.ticket.responsePath, JSON.stringify({ version: 1, taskId: req.id, requestHash: exported.ticket.requestHash, complete: true, reply: response }));
  assert.equal((await readHandoff(f.workspace, f.project.id, req.id)).status, "pending");
  const imported = receiveHandoffReply(state([{ ...req, ticket: exported.ticket }]), req.id, response); assert.equal(imported.attentionTasks[1].status, "queued");
  assert.ok((await annotateCompletedReview(f.workspace, f.project.id, req.id, response)).path.endsWith(".txt"));
});

test("review sidecars cannot escape the paper, use symlinks, or accept foreign sources", async () => {
  const f = await fixture(), req = request(f.doc);
  await assert.rejects(exportReview(f.workspace, f.project.id, { ...req, sourceSnapshot: { ...req.sourceSnapshot!, projectId: "foreign" } }), /this paper/);
  await assert.rejects(annotateCompletedReview(f.workspace, f.project.id, "../../other", reply(req)), /valid handoff ID/);
  const exported = await exportReview(f.workspace, f.project.id, req); await assert.rejects(annotateCompletedReview(f.workspace, f.project.id, req.id, reply(req, { status: "reviewed" })), /extra fields/);
  const second = await fixture(), secondReq = request(second.doc), other = path.join(second.workspace, "foreign"); await mkdir(other);
  await mkdir(path.join(second.root, ".paperfocus")); await symlink(other, path.join(second.root, ".paperfocus/handoffs"), "junction");
  await assert.rejects(exportReview(second.workspace, second.project.id, secondReq), /symbolic links|inside this paper/);
  assert.equal(await readFile(exported.webPath, "utf8"), req.packet);
});

test("review HTTP writes require the editor Origin and validate the exported request and returned anchors", async () => {
  const f = await fixture(), task = request(f.doc); let handler: any;
  (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  async function call(url: string, body: unknown, origin?: string) {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), { method: "POST", url, headers: { host: "127.0.0.1:4173", ...(origin ? { origin } : {}) } });
    const res: any = { setHeader: () => undefined, end: (raw: string) => { res.body = JSON.parse(raw); } };
    await handler(req, res, () => assert.fail("must not fall through")); return res;
  }
  for (const origin of [undefined, "https://foreign.example"]) assert.equal((await call("/api/paperfocus/review/export", { projectId: f.project.id, task }, origin)).statusCode, origin ? 403 : 400);
  const origin = "http://127.0.0.1:4173";
  assert.equal((await call("/api/paperfocus/review/export", { projectId: f.project.id, task }, origin)).statusCode, 200);
  assert.equal((await call("/api/paperfocus/review/annotated", { projectId: f.project.id, id: task.id, reply: reply(task) }, origin)).statusCode, 200);
  assert.equal((await call("/api/paperfocus/review/annotated", { projectId: f.project.id, id: task.id, reply: reply(task, { status: "reviewed" }) }, origin)).statusCode, 400);
  assert.equal((await call("/api/paperfocus/review/annotated", { projectId: f.project.id, id: task.id, reply: reply(task) })).statusCode, 400);
});
