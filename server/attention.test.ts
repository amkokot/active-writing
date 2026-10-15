import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveAttentionTask, archiveReadyNotebookTasks, attentionHistory, attentionQueue, attentionTaskLocation, attentionTurnNumber, canFinishWithoutImport, finishWithoutImport, moveAttentionTask, queueAgeWarmth, queueAttentionTask, queueColorPageSize, queueColorVariables, queueHue, queueNeighborGap, queueNeighborHueGap, queueWaitLabel, queueWarmth, readyResponseArrivals, rememberDeferredTasks, replyReturnBookmark, reopenAttentionTask, resetQueueColors, taskStatusLabel, touchQueueActivity, waitingPasteHandoffs, waitingQueueAge } from "../src/attention.ts";
import { freshTurbo } from "../src/turbo.ts";
import { receiveHandoffReply } from "../src/handoffs.ts";
import { handoffContinuation } from "../src/workspaceTools.ts";
import { notebookAttentionTasks, receiveNotebook } from "../src/notebookSync.ts";
import { studyState } from "../src/study.ts";
import { setAsideCurrentQueue } from "../src/attention.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import type { AppState, AttentionTask, NotebookEntry } from "../src/types.ts";

function task(id: string, status: AttentionTask["status"], patch: Partial<AttentionTask> = {}): AttentionTask {
  return { id, status, title: id, route: "codex", nodeId: "section-a", paragraphId: "p-a", packet: "Saved prompt", createdAt: "2026-10-02T01:00:00Z", updatedAt: "2026-10-02T01:00:00Z", ...patch };
}

test("clearing a queue is reversible and never approves wording, resolves comments or changes findings", () => {
  const comment = task("comment", "queued", { review: { kind: "comment", author: "human", body: "Keep this question", start: 0, end: 1, quote: "x" } });
  const writing = task("draft", "queued", { writing: { kind: "paragraph", roundId: "round", externalId: "draft", action: "replace", purpose: "Explanation", rationale: "Unchecked", proposedText: "Draft", draftText: "Human revision" } });
  const tasks = [comment, writing, task("reply", "ready", { reply: "Unverified findings", authorEditedReply: true }), task("old", "reviewed")];
  const now = "2026-10-09T10:00:00Z", hidden = setAsideCurrentQueue(tasks, now);
  assert.equal(attentionQueue(hidden).length, 0); assert.equal(attentionHistory(hidden).length, 4);
  for (let i = 0; i < hidden.length; i++) { const { queueHiddenAt, ...unchanged } = hidden[i]; assert.deepEqual(unchanged, tasks[i]); if (i < 3) assert.equal(queueHiddenAt, now); }
  assert.equal(hidden[0].review?.kind === "comment" && hidden[0].review.resolvedAt, undefined);
  assert.equal(hidden[1].writing?.kind === "paragraph" && hidden[1].writing.decision, undefined);
  assert.equal(taskStatusLabel(hidden[0]), "set aside · not reviewed");
  const reopened = reopenAttentionTask(state(hidden), "comment");
  assert.deepEqual(reopened.attentionTasks[0], tasks[0]); assert.equal(attentionQueue(reopened.attentionTasks).length, 1);
  assert.deepEqual(readyResponseArrivals([task("reply", "queued")], [hidden[2]]), []);
  assert.throws(() => setAsideCurrentQueue(tasks, "invalid"), /valid/);
});

test("set-aside notebook requests survive projection and reopen without rerunning or losing findings", () => {
  const now = "2026-10-09T10:00:00Z";
  const entry: NotebookEntry = { id: "owner", title: "Research", question: "Open question", notes: "Human notes", reply: "Unchecked explanation", proposal: "", status: "open", route: "codex", effort: 1, createdAt: now, updatedAt: now, handoffs: [], appliedChanges: [] };
  entry.study = { ...studyState(entry), turns: [{ id: "turn", action: "explain", depth: "intuition", route: "codex", packet: "Saved request", reply: "Unchecked answer", status: "ready", closed: true, queueHiddenAt: now, createdAt: now }] };
  const tasks = notebookAttentionTasks([entry], []);
  assert.equal(attentionQueue(tasks).length, 0); assert.equal(taskStatusLabel(tasks[0]), "set aside · not reviewed");
  const reopened = reopenAttentionTask({ ...state(tasks), notebookEntries: [entry] }, "turn");
  const projected = notebookAttentionTasks(reopened.notebookEntries, reopened.attentionTasks);
  assert.equal(attentionQueue(projected).length, 1); assert.equal(projected[0].status, "ready");
  assert.equal(reopened.notebookEntries[0].study!.turns[0].closed, false);
  assert.equal(reopened.notebookEntries[0].study!.turns[0].queueHiddenAt, undefined);
  assert.equal(reopened.notebookEntries[0].study!.turns[0].reply, "Unchecked answer");
});
function state(tasks: AttentionTask[]): AppState {
  return { destination: "manuscript", activeNodeId: "section-b", activeParagraphId: "p-b", focusedNodeId: "section-b", lens: "proofs", previewMode: "split", displayMode: "editing",
    suggestions: { relation: "unrelated", minimized: true }, hiddenNodeIds: [], progressByNode: { "section-a": "progress" }, paragraphEdits: { "p-b": "Author text" },
    rewriteSessions: [], attentionTasks: tasks, notebookEntries: [], themeLenses: [], activeThemeId: "", turbo: freshTurbo() };
}

test("queue warmth rises nonlinearly, is 75% at a week, and caps at thirty days", () => {
  const day = 86400_000;
  assert.equal(queueAgeWarmth(0), 0);
  assert.equal(queueAgeWarmth(-1), 0);
  assert.equal(queueAgeWarmth(NaN), 0);
  assert.equal(queueAgeWarmth(7 * day), .75);
  assert.equal(queueAgeWarmth(120000), .6);
  assert.ok(queueHue(queueWarmth([task("short", "queued")], Date.parse("2026-10-02T01:00:00Z") + 30000)[0]) < 175, "thirty seconds noticeably leaves the cool blue starting tint");
  assert.equal(queueAgeWarmth(30 * day), 1);
  assert.equal(queueAgeWarmth(300 * day), 1);
  assert.ok(queueAgeWarmth(120000) - queueAgeWarmth(30000) > queueAgeWarmth(210000) - queueAgeWarmth(120000));
  const samples = [0, 30000, 120000, 210000, day, 7 * day, 15 * day, 30 * day];
  assert.ok(samples.every((time, i) => !i || queueAgeWarmth(time) > queueAgeWarmth(samples[i - 1])));
  const start = Date.parse("2026-10-02T01:00:00Z"), queued = [task("top", "queued")];
  assert.equal(queueWarmth(queued, start + 7 * day)[0], .75);
  assert.equal(queueWarmth(queued, start + 30 * day)[0], 1);
  assert.ok(queueWarmth(queued, start + 120000)[0] > queueWarmth(queued, start + 30000)[0]);
});

test("weeks one through four stay distinct, with progressively smaller later hue gaps", () => {
  const now = Date.parse("2026-10-06T12:00:00Z"), day = 86400_000;
  const weeks = [28, 21, 14, 7].map((days, i) => task(String(i), "queued", { createdAt: new Date(now - days * day).toISOString(), queuePosition: i }));
  const hues = queueWarmth(weeks, now).map(queueHue);
  const [lateGap, middleGap, earlyGap] = hues.slice(1).map((hue, i) => hue - hues[i]);
  assert.ok(earlyGap > middleGap && middleGap > lateGap);
  assert.ok(lateGap > 10, "all four weeks remain visibly distinct, well above the adjacent-row floor");
  assert.ok(Math.abs(earlyGap - 30.961) < .01);
  assert.ok(Math.abs(middleGap - 18.112) < .01);
  assert.ok(Math.abs(lateGap - 12.849) < .01);
  const ages = [7, 14, 21, 28, 30].map(days => queueAgeWarmth(days * day));
  const gains = ages.slice(1).map((age, i) => age - ages[i]);
  assert.ok(gains[0] > gains[1] && gains[1] > gains[2]);
  assert.equal(ages[0], .75); assert.equal(ages.at(-1), 1);
  // The final two days must not accelerate the daily change near the cap.
  assert.ok((hues[0] - queueHue(1)) / 2 < lateGap / 7);
  for (const tone of queueWarmth(weeks, now)) {
    const color = queueColorVariables(tone);
    assert.equal(color["--queue-chroma"], .12);
    assert.ok(color["--queue-hue"] >= 40 && color["--queue-hue"] <= 105, "no pink/purple weekly hue");
  }
});

test("adjacent hues use a sharper sparse-queue gap without squeezing larger age gaps", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  for (const count of [2, 5, 16, queueColorPageSize, 1000]) {
    const tasks = Array.from({ length: count }, (_, i) => task(String(i), "queued", { createdAt: new Date(now).toISOString() }));
    const colors = queueWarmth(tasks, now).map(queueHue);
    colors.forEach((hue, i) => { if (i % queueColorPageSize) assert.ok(Math.abs(hue - colors[i - 1] - queueNeighborGap(Math.min(queueColorPageSize,count-Math.floor(i/queueColorPageSize)*queueColorPageSize))) < 1e-9, "same-age neighbors use the visible page's dynamic floor"); });
  }
  const tasks = [28, 28, 21, 7].map((days, i) => task(String(i), "queued", { createdAt: new Date(now - days * 86400_000).toISOString() }));
  const before = JSON.stringify(tasks), hues = queueWarmth(tasks, now).map(queueHue);
  const oldest = queueHue(queueAgeWarmth(28 * 86400_000)), thirdWeek = queueHue(queueAgeWarmth(21 * 86400_000));
  const step=queueNeighborGap(tasks.length);
  assert.ok(hues.every((hue, i) => Math.abs(hue - [oldest, oldest + step, Math.max(thirdWeek,oldest+2*step), 105][i]) < 1e-9));
  assert.equal(JSON.stringify(tasks), before);
});
test("adaptive gaps decrease smoothly with count, stay bounded and handle empty/single queues",()=>{
  assert.equal(queueNeighborGap(0),0);assert.equal(queueNeighborGap(1),0);assert.equal(queueNeighborGap(NaN),0);
  assert.equal(queueNeighborGap(2),8);assert.equal(queueNeighborGap(queueColorPageSize),queueNeighborHueGap);
  assert.equal(queueNeighborGap(1000),queueNeighborHueGap);
  for(let n=3;n<=queueColorPageSize;n++)assert.ok(queueNeighborGap(n)<queueNeighborGap(n-1));
  const now=Date.parse("2026-10-06T12:00:00Z");
  for(let count=2;count<=queueColorPageSize;count++){
    for(const days of [0,7,14,21,28,90]){
      const tasks=Array.from({length:count},(_,i)=>task(String(i),"queued",{createdAt:new Date(now-days*86400_000).toISOString()}));
      const hues=queueWarmth(tasks,now).map(queueHue);
      assert.ok(hues.every((hue,i)=>hue>=40 && hue<=250 && (!i || hue-hues[i-1]>=queueNeighborGap(count)-1e-9)));
    }
  }
});

test("mixed ages and forced manual order reserve the fixed gap even at the cool edge", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const tasks = Array.from({ length: queueColorPageSize }, (_, i) => task(String(i), "queued", { createdAt: new Date(now - (i % 3 ? 0 : 60 * 86400_000)).toISOString() }));
  const hues = queueWarmth(tasks, now).map(queueHue);
  assert.ok(hues.every((hue, i) => hue >= 40 && hue <= 250 && (!i || hue - hues[i - 1] >= queueNeighborHueGap - 1e-9)));
  assert.equal(queueHue(NaN), 250);
  assert.equal(queueHue(-1), 250);
  assert.equal(queueHue(2), 40);
});

test("queue color follows rank after demotion, never changes status or age, and handles long queues", () => {
  const before = state([task("old", "ready", { createdAt: "2026-08-01T01:00:00Z" }), task("new", "queued", { createdAt: "2026-10-06T01:00:00Z" }), task("invalid", "queued", { createdAt: "unknown" })]);
  const after = moveAttentionTask(before, "old", "new", true);
  const now = Date.parse("2026-10-06T01:01:00Z"), queue = attentionQueue(after.attentionTasks, now);
  assert.deepEqual(queue.map(t => t.id), ["new", "old", "invalid"]);
  const saved = JSON.stringify(after), tones = queueWarmth(queue, now);
  assert.ok(tones[1] < tones[0]);
  assert.ok(tones[2] < tones[1]);
  assert.equal(after.attentionTasks[0].createdAt, before.attentionTasks[0].createdAt);
  assert.equal(JSON.stringify(after), saved);
  assert.deepEqual(queueWarmth([], now), []);
  const many = queueWarmth(Array.from({ length: 1000 }, (_, i) => task(String(i), "queued")), now);
  assert.ok(many.every((tone, i) => Number.isFinite(tone) && tone >= 0 && tone <= 1 && (!(i % queueColorPageSize) || queueHue(tone) - queueHue(many[i - 1]) >= queueNeighborHueGap - 1e-10)));
  assert.ok(queueWarmth([task("future", "queued", { createdAt: "2027-01-01T00:00:00Z" })], now)[0] >= 0);
});

test("queue waiting labels are compact and retain the manual-check distinction", () => {
  const waiting = task("chat", "queued", { deferredAt: "2026-10-06T00:00:00Z", ticket: { transport: "paste" } as AttentionTask["ticket"] });
  assert.equal(queueWaitLabel(waiting, Date.parse("2026-10-06T00:00:30Z")), "Check chat · <1 min");
  assert.equal(queueWaitLabel(waiting, Date.parse("2026-10-06T00:02:00Z")), "Check chat · 2 min");
  assert.equal(queueWaitLabel(waiting, Date.parse("2026-10-06T03:00:00Z")), "Check chat · 3 h");
  assert.equal(queueWaitLabel(waiting, Date.parse("2026-10-08T00:00:00Z")), "Check chat · 2 d");
  assert.equal(queueWaitLabel({ ...waiting, deferredAt: "invalid" }), taskStatusLabel(waiting));
});

test("reset colors preserves order, real waiting time, comments and history, then ages anew", () => {
  const before = state([task("top", "ready"), task("old", "queued", { queuePosition: 1, deferredAt: "2026-09-01T00:00:00Z", review: { kind: "comment", author: "human", body: "Still open", quote: "x", start: 0, end: 1 } }), task("history", "reviewed")]);
  const now = "2026-10-06T10:00:00Z", time = Date.parse(now), after = resetQueueColors(before, now);
  assert.deepEqual(attentionQueue(after.attentionTasks, time).map(t => t.id), attentionQueue(before.attentionTasks, time).map(t => t.id));
  assert.deepEqual(after.attentionTasks[1].review, before.attentionTasks[1].review);
  assert.equal(after.attentionTasks[1].deferredAt, before.attentionTasks[1].deferredAt);
  assert.equal(after.attentionTasks[2], before.attentionTasks[2]);
  assert.deepEqual(after.attentionTasks.map(t => t.status), before.attentionTasks.map(t => t.status));
  const tones = queueWarmth(attentionQueue(after.attentionTasks, time), time);
  assert.equal(tones[0], .45);
  assert.ok(Math.abs(queueHue(tones[1]) - queueHue(tones[0]) - queueNeighborGap(tones.length)) < 1e-12);
  assert.equal(queueWarmth(attentionQueue(after.attentionTasks, time), time + 7 * 86400_000)[0], .75);
  const empty = state([]); assert.equal(resetQueueColors(empty), empty, "empty state has no new records");
});

test("return after thirty inactive days resets only colors, not after twenty-nine, and activity is throttled", () => {
  const now = "2026-10-06T10:00:00Z", time = Date.parse(now), day = 86400_000;
  const base = { ...state([task("old", "ready")]), queueLastActiveAt: new Date(time - 29 * day).toISOString() };
  const active = touchQueueActivity(base, now);
  assert.equal(active.attentionTasks, base.attentionTasks);
  assert.equal(active.queueLastActiveAt, now);
  assert.equal(touchQueueActivity(active, new Date(time + 59000).toISOString()), active);
  const idle = { ...base, queueLastActiveAt: new Date(time - 30 * day).toISOString() };
  const reset = touchQueueActivity(idle, now);
  assert.equal(reset.attentionTasks[0].queueColorResetAt, now);
  assert.equal(reset.attentionTasks[0].status, "ready");
  assert.equal(reset.activeNodeId, idle.activeNodeId);
  assert.equal(touchQueueActivity(state([]), "invalid").queueLastActiveAt, undefined);
  assert.equal(touchQueueActivity(state([task("legacy", "ready")]), now).attentionTasks[0].queueColorResetAt, now);
});

test("queue handles reorder across statuses without resolving comments or losing findings", () => {
  const before = state([task("waiting", "queued"), task("ready", "ready"), task("comment", "queued", { review: { kind: "comment", author: "human", body: "Check", quote: "x", start: 0, end: 1 } }), task("old", "reviewed")]);
  const after = moveAttentionTask(before, "comment", "ready");
  assert.deepEqual(attentionQueue(after.attentionTasks).map(t => t.id), ["comment", "ready", "waiting"]);
  assert.deepEqual(after.attentionTasks.map(t => t.status), before.attentionTasks.map(t => t.status));
  assert.equal(after.attentionTasks[2].review, before.attentionTasks[2].review);
  assert.equal(after.attentionTasks[3], before.attentionTasks[3]);
  assert.equal(moveAttentionTask(after, "old", "ready"), after);
  assert.equal(moveAttentionTask(after, "comment", "comment"), after);
  assert.deepEqual(after.paragraphEdits, before.paragraphEdits);
});

test("left-behind external chats age up without inventing a reply, and manual ordering resets aging", () => {
  const ticket = { id: "web", label: "Web chat", transport: "paste" as const, promptPath: "prompt", responsePath: "unused", requestHash: "hash", copyText: "Prompt" };
  const before = state([task("ready", "ready"), task("other", "failed"), task("web", "queued", { ticket })]);
  const saved = rememberDeferredTasks(before, "2026-10-06T10:00:00Z");
  assert.equal(saved.attentionTasks[2].deferredAt, "2026-10-06T10:00:00Z");
  assert.equal(rememberDeferredTasks(saved), saved);
  assert.deepEqual(attentionQueue(saved.attentionTasks, Date.parse("2026-10-06T10:31:00Z")).map(t => t.id), ["web", "ready", "other"]);
  assert.equal(saved.attentionTasks[2].status, "queued"); assert.equal(saved.attentionTasks[2].reply, undefined);
  assert.equal(waitingQueueAge({ ...saved.attentionTasks[2], localJobId: "local" }), 0);
  const ordered = moveAttentionTask(saved, "other", "ready");
  assert.equal(waitingQueueAge(ordered.attentionTasks[2], Date.parse(ordered.attentionTasks[2].queueOrderedAt!)), 0);
  const here = { ...before, activeNodeId: "section-a", activeParagraphId: "p-a" };
  assert.equal(rememberDeferredTasks(here), here);
});

test("queue labels use section ancestry and paragraph numbers, or theorem names", () => {
  const nodes = [{ id: "s", kind: "section" as const, depth: 0, number: "2", title: "Results", paragraphIds: [] }, { id: "ss", parentId: "s", kind: "subsection" as const, depth: 1, number: "2.1", title: "Rates", paragraphIds: ["p1", "p2"] }, { id: "l", parentId: "ss", kind: "lemma" as const, depth: 2, title: "Lemma 3", paragraphIds: ["p3"] }];
  const document = { nodes, paragraphs: ["p1", "p2", "p3"].map((id, i) => ({ id, nodeId: i === 2 ? "l" : "ss", text: "x" })) };
  assert.equal(attentionTaskLocation(task("t", "queued", { nodeId: "ss", paragraphId: "p2" }), document), "2 Results / 2.1 Rates — Block 2");
  assert.equal(attentionTaskLocation(task("t", "queued", { nodeId: "l", paragraphId: "p3" }), document), "2 Results / 2.1 Rates — Lemma 3");
  assert.equal(attentionTaskLocation(task("missing", "queued"), document), "missing");
});

test("queue order and left-behind timestamps survive notebook cold hydration", () => {
  const before = state([task("turn", "queued", { notebookId: "entry", studyTurnId: "turn", ticket: { id: "ticket", transport: "paste", label: "Chat", promptPath: "prompt", responsePath: "reply", requestHash: "hash", copyText: "copy" } }), task("other", "ready")]);
  before.notebookEntries = [{ id: "entry", title: "Question", question: "Q", notes: "Notes", reply: "", proposal: "", status: "open", route: "chatgpt", effort: 1, handoffs: [], appliedChanges: [], createdAt: "now", updatedAt: "now", study: { mode: "understand", depth: "intuition", action: "explain", background: "", localEffort: 1, activeTurnId: "turn", turns: [{ id: "turn", action: "explain", depth: "intuition", route: "chatgpt", packet: "Prompt", reply: "", status: "queued", ticket: before.attentionTasks[0].ticket, createdAt: "now" }] } }];
  assert.equal(rememberDeferredTasks(before, "2026-10-06T10:00:00Z", "entry"), before, "an open manuscript question is still active");
  const saved = resetQueueColors(rememberDeferredTasks(moveAttentionTask(before, "turn", "other"), "2026-10-06T10:00:00Z"), "2026-10-06T11:00:00Z");
  const restored = receiveNotebook(state([]), { version: 1, revision: 1, entries: saved.notebookEntries });
  assert.equal(restored.attentionTasks[0].deferredAt, "2026-10-06T10:00:00Z");
  assert.equal(restored.attentionTasks[0].queuePosition, 0);
  assert.equal(restored.attentionTasks[0].queueOrderedAt, saved.attentionTasks[0].queueOrderedAt);
  assert.equal(restored.attentionTasks[0].queueColorResetAt, "2026-10-06T11:00:00Z");
  assert.equal(restored.notebookEntries[0].notes, "Notes");
});

test("saved queue positions are optional, round-trip, and reject invalid values", () => {
  const data = { ...emptyWorkbench(), attentionTasks: [task("saved", "queued", { queuePosition: 2, deferredAt: "2026-10-06T10:00:00Z" })] };
  validateWorkbench(JSON.parse(JSON.stringify(data)));
  for (const position of [-1, .1, "2", NaN]) assert.throws(() => validateWorkbench({ ...data, attentionTasks: [{ ...data.attentionTasks[0], queuePosition: position }] }));
  assert.throws(() => validateWorkbench({ ...data, attentionTasks: [{ ...data.attentionTasks[0], deferredAt: "not a date" }] }));
  assert.throws(() => validateWorkbench({ ...data, attentionTasks: [{ ...data.attentionTasks[0], queueColorResetAt: "not a date" }] }));
});

test("satisfactory external answers can finish without importing, changing navigation, or claiming verification", () => {
  const ticket = { id: "web", label: "Any chat", transport: "paste" as const, promptPath: "prompt", responsePath: "unused", requestHash: "request", copyText: "Copied prompt" };
  const before = state([task("web", "queued", { route: "chatgpt", ticket })]);
  const finished = finishWithoutImport(before, "web");
  assert.equal(finished.attentionTasks[0].status, "reviewed");
  assert.equal(finished.attentionTasks[0].completedExternally, true);
  assert.equal(finished.attentionTasks[0].reply, undefined);
  assert.equal(finished.attentionTasks[0].packet, before.attentionTasks[0].packet);
  assert.equal(waitingPasteHandoffs(finished.attentionTasks).length, 0);
  assert.match(taskStatusLabel(finished.attentionTasks[0]), /no reply imported/);
  assert.equal(finishWithoutImport(finished, "web"), finished);
  for (const key of ["paragraphEdits", "progressByNode", "turbo", "destination", "activeNodeId", "focusedNodeId"] as const) assert.deepEqual(finished[key], before[key]);
  assert.equal(receiveHandoffReply(finished, "web", "Late reply"), finished);
  const reopened = reopenAttentionTask(finished, "web");
  assert.equal(reopened.attentionTasks[0].completedExternally, undefined);
  assert.equal(waitingPasteHandoffs(reopened.attentionTasks).length, 1);
  assert.equal(receiveHandoffReply(reopened, "web", "## Later reply\n**Retained.**").attentionTasks[0].reply, "## Later reply\n**Retained.**");
  for (const patch of [{ localJobId: "job" }, { ticket: { ...ticket, transport: "files" as const } }, { reply: "Already retained" }, { replyDraft: "Author draft" }]) {
    const other = state([task("web", "queued", { ticket, ...patch })]);
    assert.equal(canFinishWithoutImport(other.attentionTasks[0]), false);
    assert.equal(finishWithoutImport(other, "web"), other);
  }
});

test("optional import closes only the requested notebook turn; reopening retains all local context", () => {
  const ticket = { id: "turn-1", label: "Web chat", transport: "paste" as const, promptPath: "prompt", responsePath: "unused", requestHash: "request", copyText: "Prompt" };
  const before = state([task("turn-1", "queued", { notebookId: "entry", studyTurnId: "turn-1", ticket })]);
  before.notebookEntries = [{ id: "entry", title: "Question", question: "Q", notes: "Author notes", reply: "Older retained findings", proposal: "", status: "open", route: "chatgpt", effort: 2, handoffs: [], appliedChanges: [], createdAt: "now", updatedAt: "now",
    study: { mode: "develop", depth: "derivation", action: "step", background: "", localEffort: 1, turns: ["turn-1", "turn-2"].map((id) => ({ id, action: "step", depth: "derivation", route: "chatgpt", packet: "Prompt", reply: "", status: "queued", createdAt: "now", ticket })) } }];
  const finished = finishWithoutImport(before, "turn-1");
  const entry = finished.notebookEntries[0];
  assert.equal(entry.notes, before.notebookEntries[0].notes); assert.equal(entry.reply, "Older retained findings");
  assert.equal(entry.study!.turns[0].closed, true); assert.equal(entry.study!.turns[0].completedExternally, true);
  assert.equal(entry.study!.turns[0].reply, ""); assert.equal(entry.study!.turns[0].answer, undefined);
  assert.equal(entry.study!.turns[1].closed, undefined);
  const restored = reopenAttentionTask(finished, "turn-1");
  assert.equal(restored.notebookEntries[0].study!.turns[0].closed, false);
  assert.equal(restored.notebookEntries[0].study!.turns[0].completedExternally, undefined);
});

test("attention queue prioritizes ready replies, then failures, without changing task order in storage", () => {
  const tasks = [task("waiting", "queued"), task("ready-later", "ready", { createdAt: "2026-10-02T02:00:00Z" }), task("running", "working"), task("ready-earlier", "ready"), task("archived", "reviewed"), task("failed", "failed")];
  assert.deepEqual(attentionQueue(tasks).map((t) => t.id), ["ready-earlier", "ready-later", "failed", "running", "waiting"]);
  assert.equal(tasks[0].id, "waiting");
  assert.equal(taskStatusLabel(task("running", "working", { localJobId: "job" })), "running locally");
  assert.equal(taskStatusLabel(task("failed", "failed")), "needs attention");
});

test("manual waiting notices are task-bound, hideable and never imply external completion detection", () => {
  const ticket = { id: "web", label: "Any web client", transport: "paste" as const, promptPath: "prompt", responsePath: "unused-response", requestHash: "request", copyText: "Copy me" };
  const web = task("web", "queued", { route: "chatgpt", ticket });
  const tasks = [web, task("done", "ready", { ticket }), task("history", "reviewed", { ticket }), task("failure", "failed", { ticket }),
    task("files", "queued", { ticket: { ...ticket, transport: "files" } }), task("local", "working", { localJobId: "job", ticket }), task("draft", "queued", { route: "chatgpt" })];
  assert.deepEqual(waitingPasteHandoffs(tasks).map((t) => t.id), ["web"]);
  assert.deepEqual(waitingPasteHandoffs(tasks, [web.id]), []);
  assert.equal(taskStatusLabel(web), "awaiting pasted reply");
  const before = state(tasks);
  const received = receiveHandoffReply(before, web.id, "Synthetic pasted response");
  assert.deepEqual(waitingPasteHandoffs(received.attentionTasks), []);
  assert.deepEqual(readyResponseArrivals(before.attentionTasks, received.attentionTasks), [], "no notification from typing a first character; explicit paste triggers the UI notice");
  assert.equal(received.activeNodeId, before.activeNodeId);
  assert.deepEqual(received.progressByNode, before.progressByNode);
});

test("finishing generic findings preserves author corrections and permits reopening without source or navigation changes", () => {
  const saved = task("generic", "ready", { reply: "Author corrected findings", replyDraft: "Author corrected findings" });
  const before = state([saved]);
  const archived = archiveAttentionTask(before, saved.id);
  assert.equal(archived.attentionTasks.length, 1);
  assert.equal(attentionHistory(archived.attentionTasks)[0].replyDraft, saved.replyDraft);
  assert.equal(attentionQueue(archived.attentionTasks).length, 0);
  assert.equal(receiveHandoffReply(archived, saved.id, "Late replacement", "late-hash"), archived);
  const restored = reopenAttentionTask(archived, saved.id);
  assert.equal(restored.attentionTasks[0].status, "ready");
  assert.equal(restored.attentionTasks[0].packet, saved.packet);
  assert.equal(restored.attentionTasks[0].reply, saved.reply);
  for (const key of ["paragraphEdits", "progressByNode", "turbo", "destination", "activeNodeId", "focusedNodeId", "suggestions"] as const) assert.deepEqual(restored[key], before[key]);
  assert.equal(archiveAttentionTask(archived, saved.id), archived);
  assert.equal(reopenAttentionTask(before, saved.id), before);
});

test("archiving and reopening a study request closes only the bound turn and retains its explanations", () => {
  const s = state([task("turn-1", "ready", { notebookId: "entry", studyTurnId: "turn-1" })]);
  s.notebookEntries = [{ id: "entry", title: "Question", question: "Q", notes: "N", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: "now", updatedAt: "now",
    study: { mode: "develop", depth: "derivation", action: "step", background: "", localEffort: 1, turns: ["turn-1", "turn-2"].map((id) => ({ id, action: "step", depth: "derivation", route: "codex", packet: "Prompt", reply: "Retained explanation", status: "ready", createdAt: "now" })) } }];
  const archived = archiveAttentionTask(s, "turn-1");
  assert.equal(archived.notebookEntries[0].study!.turns[0].closed, true);
  assert.equal(archived.notebookEntries[0].study!.turns[1].closed, undefined);
  const restored = reopenAttentionTask(archived, "turn-1");
  assert.equal(restored.notebookEntries[0].study!.turns[0].closed, false);
  assert.equal(restored.notebookEntries[0].study!.turns[0].reply, "Retained explanation");
});

test("manuscript integration closes ready turns durably without archiving pending or unrelated work", () => {
  const s=state([task("ready","ready",{notebookId:"entry",studyTurnId:"ready",reply:"Inspected findings"}),task("pending","working",{notebookId:"entry",studyTurnId:"pending",localJobId:"job"}),task("foreign","ready",{notebookId:"other"})]);
  s.notebookEntries=[{id:"entry",title:"Question",question:"Q",notes:"Author notes",reply:"",proposal:"Author text",status:"integrated",route:"local",effort:1,handoffs:[],appliedChanges:[],createdAt:"now",updatedAt:"now",study:{mode:"develop",depth:"derivation",action:"develop",background:"",localEffort:1,turns:[{id:"ready",action:"develop",depth:"derivation",route:"local",packet:"Saved prompt",reply:"Inspected findings",status:"ready",createdAt:"now"},{id:"pending",action:"develop",depth:"derivation",route:"local",packet:"Next request",reply:"",status:"queued",jobId:"job",createdAt:"now"}]}}];
  const archived=archiveReadyNotebookTasks(s,"entry"), saved=JSON.parse(JSON.stringify(archived));
  assert.equal(saved.attentionTasks[0].status,"reviewed");assert.equal(saved.notebookEntries[0].study.turns[0].closed,true);
  assert.equal(saved.notebookEntries[0].study.turns[0].reply,"Inspected findings");
  assert.equal(saved.attentionTasks[1].status,"working");assert.equal(saved.notebookEntries[0].study.turns[1].closed,undefined);
  assert.equal(saved.attentionTasks[2].status,"ready");assert.deepEqual(saved.progressByNode,s.progressByNode);
  assert.equal(archiveReadyNotebookTasks(archived,"entry"),archived);
});

test("stopped local work and removed subscriptions never restart from history", () => {
  const stopped = reopenAttentionTask(archiveAttentionTask(state([task("local", "working", { route: "local", localJobId: "job" })]), "local", true), "local");
  assert.equal(stopped.attentionTasks[0].status, "failed");
  assert.match(stopped.attentionTasks[0].error!, /rerun explicitly/);
  const legacy = reopenAttentionTask(state([task("legacy", "reviewed", { subscriptionJobId: "old", archivedStatus: "working" })]), "legacy");
  assert.equal(legacy.attentionTasks[0].status, "failed");
});

test("completion notices cover background local and finalized file work, never navigation, pasted edits or duplicate ready work", () => {
  const local = task("local", "working", { localJobId: "job" });
  const file = task("file", "queued", { ticket: { id: "file", label: "Agent", transport: "files", promptPath: "prompt", responsePath: "response", requestHash: "request", copyText: "Pointer" } });
  const manual = task("manual", "queued", { route: "chatgpt" });
  const done = task("done", "ready", { localJobId: "cached-job" });
  const current = [{ ...local, status: "ready" as const }, { ...file, status: "ready" as const, ticket: { ...file.ticket!, replyHash: "reply" } }, { ...manual, status: "ready" as const }, done];
  assert.deepEqual(readyResponseArrivals([local, file, manual, done], current), ["local", "file"]);
  assert.deepEqual(readyResponseArrivals(current, current), []);
  assert.deepEqual(readyResponseArrivals([], current), []);
});

test("a second reply bookmarks the immediate workspace while repeated returns retain that bookmark", () => {
  const s = state([]), original = replyReturnBookmark(s, task("first", "ready"));
  s.handoffResume = original;
  s.destination = "notebook"; s.activeNotebookId = "boundary";
  const reply = task("second", "ready", { notebookId: "experiment", studyTurnId: "second" });
  const latest = replyReturnBookmark(s, reply);
  assert.equal(latest.destination, "notebook"); assert.equal(latest.activeNotebookId, "boundary");
  assert.notEqual(latest, original); assert.deepEqual(s.handoffResume, original, "capture itself is read-only");
  s.handoffResume = latest; s.activeNotebookId = "experiment";
  s.notebookEntries = [{ id: "experiment", study: { turns: [{ id: "second" }], activeTurnId: "second" } }] as AppState["notebookEntries"];
  assert.equal(replyReturnBookmark(s, reply), latest, "do not lose the return place when reopening the same answer");
  s.notebookEntries[0].study!.activeTurnId = undefined;
  assert.equal(replyReturnBookmark(s, reply), latest, "last-turn display is also the current reply");
  s.destination = "manuscript"; s.activeNodeId = reply.nodeId; s.activeParagraphId = reply.paragraphId;
  assert.equal(replyReturnBookmark(s, { ...reply, notebookId: undefined, studyTurnId: undefined }), latest);
});

test("follow-ups link the earlier files, include author edits, and avoid pretending to have a model conversation connection", () => {
  const previous = task("prior", "ready", { reply: "Original model findings", packet: "Long old excerpt", ticket: { id: "prior", label: "Any agent", transport: "files", requestHash: "request", replyHash: "reply", promptPath: "old/prompt.md", responsePath: "old/response.json", copyText: "Pointer" } });
  const compact = handoffContinuation(previous, "codex", "continuation");
  assert.match(compact, /old\/prompt.md/); assert.match(compact, /old\/response.json/);
  assert.match(compact, /not a connection to a model conversation/); assert.match(compact, /If you lack that history/);
  assert.ok(!compact.includes("Original model findings")); assert.ok(!compact.includes("Long old excerpt"));
  const corrected = receiveHandoffReply(state([previous]), previous.id, "Author corrected findings").attentionTasks[0];
  assert.equal(corrected.authorEditedReply, true);
  assert.match(handoffContinuation(corrected, "codex", "continuation"), /Author corrected findings/);
  assert.equal(corrected.ticket?.replyHash, previous.ticket!.replyHash);
  const briefing = handoffContinuation(previous, "chatgpt", "briefing");
  assert.match(briefing, /Long old excerpt/); assert.match(briefing, /Original model findings/);
  assert.ok(!briefing.includes("old/response.json"));
  assert.equal(handoffContinuation(undefined, "codex", "continuation"), "");
});

test("exported follow-ups retire only their ready parent, retain its edits and get cycle-safe turn numbers", () => {
  const s = state([task("first", "ready", { reply: "Author findings", authorEditedReply: true }), task("unrelated", "ready"), task("waiting", "working")]);
  const child = task("second", "queued", { previousTaskId: "first" });
  const next = queueAttentionTask(s, child);
  assert.equal(next.attentionTasks.find((t) => t.id === "first")!.status, "reviewed");
  assert.equal(next.attentionTasks.find((t) => t.id === "first")!.reply, "Author findings");
  assert.equal(next.attentionTasks.find((t) => t.id === "first")!.authorEditedReply, true);
  assert.equal(next.attentionTasks.find((t) => t.id === "unrelated")!.status, "ready");
  assert.equal(queueAttentionTask(next, child), next);
  assert.equal(attentionTurnNumber(next.attentionTasks, "first"), 2);
  assert.equal(attentionTurnNumber(next.attentionTasks, "second"), 3);
  const pendingChild = queueAttentionTask(s, task("third", "queued", { previousTaskId: "waiting" }));
  assert.equal(pendingChild.attentionTasks.find((t) => t.id === "waiting")!.status, "working");
  assert.equal(attentionTurnNumber([task("cycle-a", "ready", { previousTaskId: "cycle-b" }), task("cycle-b", "ready", { previousTaskId: "cycle-a" })], "cycle-a"), 3);
  assert.equal(attentionTurnNumber([], "missing"), 1);
});
