import assert from "node:assert/strict";
import test from "node:test";
import { checkedReviewReply, rankReviewPassages, readReviewTool, reviewQuestion, runLocalSecondLook } from "./localReview.ts";
import { canUseSecondLook, secondLookContext, validateSecondLook } from "../src/localReview.ts";
import { fingerprint } from "../src/rewrite.ts";
import { externalStudyPacket, handoffSnapshot, makeStudyTurn, makeThinkingTurn, studyPacket } from "../src/study.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import type { NotebookEntry, ProjectDocument } from "../src/types.ts";
import { receiveNotebook } from "../src/notebookSync.ts";
import { queueAttentionTask } from "../src/attention.ts";
import type { AppState, AttentionTask } from "../src/types.ts";

const document = { project: { id: "test", folder: "test-paper", mainFile: "main.tex" }, revision: "revision-1", nodes: [], paragraphs: [
  { id: "p-residual", file: "sections/result.tex", nodeId: "result", text: "Assume a fixed point exists and 0<=q<1. The residual bounds the error." },
  { id: "p-wording", file: "intro.tex", nodeId: "intro", text: "Under these assumptions the error may decrease; the numerical study is not a proof." },
], citations: [{ key: "known", title: "A supplied bibliography entry", year: "2026" }] } as unknown as ProjectDocument;
const sources = { document, experiments: "Saved output: five checks passed, not a general proof.", experimentRevision: "exp-1" };
const base = { model: "test-local", packet: "Check whether the residual bounds the error.", draft: "All five examples prove the universal claim.", sources };
const controller = () => new AbortController().signal;
const raw = JSON.stringify({ summary: "Review the evidence boundary.", observations: [{ observation: "Five examples cannot prove a universal claim.", sourceId: "draft", quote: "five examples prove", nextCheck: "Supply a mathematical argument under explicit assumptions." }] });
const entry = (): NotebookEntry => ({ id: "entry", title: "Question", question: "Check this claim", notes: "", reply: "", proposal: "", route: "local", effort: 1,
  status: "open", handoffs: [], appliedChanges: [], createdAt: "now", updatedAt: "now",
  study: { mode: "understand", depth: "derivation", action: "assumptions", background: "", localEffort: 1, secondLook: true, turns: [] } });

test("review read tools are bounded, current-project-only and cannot execute commands or read paths", () => {
  assert.equal(rankReviewPassages(sources, "residual error")[0].id, "p-residual");
  assert.match(readReviewTool(sources, "read_passage", { id: "p-residual" })["p-residual"], /fixed point/);
  assert.deepEqual(readReviewTool(sources, "read_experiments", {}), { experiments: sources.experiments });
  assert.match(readReviewTool(sources, "lookup_citation", { key: "unknown" })["citation:unknown"], /No matching key/);
  for (const [name, args] of [["shell", { command: "echo bad" }], ["read_passage", { id: "../../secret" }], ["read_passage", { id: "foreign-paper" }],
    ["read_experiments", { notebookId: "someone-else" }], ["search_paper", { query: "x".repeat(301) }], ["search_paper", []], ["read_passage", { id: 4 }]])
    assert.throws(() => readReviewTool(sources, name as string, args));
  assert.equal(Object.keys(readReviewTool(sources, "search_paper", { query: "unmatchedquux" })).length, 0);
});
test("the reviewer performs at most two tool reads and two model calls, preserving the original draft", async () => {
  let calls = 0;
  const result = await runLocalSecondLook(base, async body => {
    calls++;
    if (calls === 1) { assert.ok(body.tools); return { message: { tool_calls: [{ function: { name: "read_experiments", arguments: {} } }, { function: { name: "read_passage", arguments: { id: "p-residual" } } }] } }; }
    assert.equal(body.tools, undefined); assert.ok(body.format); return { message: { content: raw } };
  }, controller());
  assert.equal(calls, 2); assert.equal(result.tools.length, 2); assert.equal(result.status, "ready");
  assert.equal(result.tools[0].requestedBy, "model"); assert.equal(result.draftFingerprint, fingerprint(base.draft)); validateSecondLook(result);
  assert.equal(base.draft, "All five examples prove the universal claim.");
});
test("a missing native tool call uses one honestly recorded lexical fallback", async () => {
  let calls = 0;
  const result = await runLocalSecondLook(base, async () => ++calls === 1 ? { message: { content: "No tools" } } : { message: { content: raw } }, controller());
  assert.equal(result.status, "ready"); assert.equal(result.tools.length, 1); assert.equal(result.tools[0].requestedBy, "fallback");
});
test("unsupported tools, excessive calls, truncation, aborted work and errors cannot become a completed review", async () => {
  const firsts = [{ message: { tool_calls: [{ function: { name: "shell", arguments: { command: "bad" } } }] } },
    { message: { tool_calls: [1, 2, 3].map(() => ({ function: { name: "read_experiments", arguments: {} } })) } }, { done_reason: "length" }];
  for (const first of firsts) { let calls = 0; const result = await runLocalSecondLook(base, async () => { calls++; return first; }, controller()); assert.equal(calls, 1); assert.equal(result.status, "failed"); assert.ok(result.error); }
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  assert.equal((await runLocalSecondLook(base, async () => { calls++; return {}; }, aborted.signal)).status, "failed"); assert.equal(calls, 0);
  assert.equal((await runLocalSecondLook(base, async () => { throw new Error("offline"); }, controller())).error, "offline");
});
test("exact evidence quotes gate structure, not mathematical validity", () => {
  assert.equal(checkedReviewReply(raw, { draft: base.draft }).observations.length, 1);
  for (const bad of [raw.replace("five examples prove", "invented source quote"), raw.replace('"draft"', '"foreign"'), "not JSON"])
    assert.throws(() => checkedReviewReply(bad, { draft: base.draft }));
  // A quoted observation can still be wrong: never convert this guard into proof verification.
  assert.match(checkedReviewReply(raw.replace("cannot prove", "do prove"), { draft: base.draft }).observations[0].observation, /do prove/);
});
test("hints, Tiny and statement-only attempts cannot enable the wider reviewer", () => {
  assert.equal(canUseSecondLook(0, "walkthrough"), false); assert.equal(canUseSecondLook(3, "hint"), false); assert.equal(canUseSecondLook(3, "walkthrough", true), false);
  for (const [effort, guidance, benchmark] of [[0, "walkthrough", undefined], [3, "hint", undefined], [3, "walkthrough", { phase: "attempt" }]] as const) {
    const e = entry(); Object.assign(e.study!, { localEffort: effort, guidance, benchmark });
    assert.equal(makeStudyTurn(e, document).secondLookRequested, undefined);
  }
  assert.equal(makeStudyTurn(entry(), document).secondLookRequested, true);
});
test("saved reviews round-trip, feed handoffs once, and stale edited replies don't contribute review context", async () => {
  let calls = 0; const review = await runLocalSecondLook(base, async () => ++calls === 1 ? {} : { message: { content: raw } }, controller());
  const e = entry(), turn = makeStudyTurn(e, document); Object.assign(turn, { reply: base.draft, secondLook: review, status: "ready" }); e.study!.turns.push(turn);
  validateNotebookEntries([e]); assert.match(secondLookContext(e), /unchecked suggestions/); assert.match(studyPacket(e, document), /Five examples/);
  e.route = "codex"; assert.match(externalStudyPacket(e, document), /Local review suggestions/);
  turn.handoffSnapshot = handoffSnapshot(e); turn.route = "codex";
  assert.doesNotMatch(externalStudyPacket(e, document), /Local review suggestions/);
  turn.reply += " edited"; assert.equal(secondLookContext(e), "");
  const corrupt = structuredClone(e); corrupt.study!.turns[0].secondLook!.tools[0].name = "shell" as any;
  assert.throws(() => validateNotebookEntries([corrupt]), /review tool/);
});
test("review context extraction keeps the question instead of a long harness prefix", () => {
  const e = entry(), packet = studyPacket(e, document, "assumptions", true);
  assert.match(reviewQuestion(packet), /Check this claim/); assert.doesNotMatch(reviewQuestion(packet), /Return JSON only/);
});

test("Keep thinking creates one linked fresh turn while preserving settings and earlier answers", async () => {
  const e = entry(); let calls = 0;
  const review = await runLocalSecondLook(base, async () => ++calls === 1 ? {} : { message: { content: raw } }, controller());
  const previous = { ...makeStudyTurn(e, document), reply: base.draft, secondLook: review, status: "ready" as const };
  e.study!.turns = [previous]; e.study!.activeTurnId = previous.id;
  const next = makeThinkingTurn(e, document);
  assert.notEqual(next.id, previous.id); assert.equal(next.previousTurnId, previous.id);
  assert.equal(next.effort, previous.effort); assert.equal(next.secondLookRequested, true);
  assert.match(next.packet, /Fresh pass/); assert.match(next.packet, /unchecked suggestions/);
  assert.match(next.packet, /Accept objections only when justified/);
  assert.equal(e.study!.turns.length, 1); assert.equal(e.study!.turns[0].reply, base.draft);
  e.study!.turns.push(next); validateNotebookEntries([e]);
  assert.throws(() => makeThinkingTurn(e, document), /already waiting/);
  const corrupt = structuredClone(e); corrupt.study!.turns[1].previousTurnId = "unknown";
  assert.throws(() => validateNotebookEntries([corrupt]), /earlier explanation/);
  corrupt.study!.turns[1].previousTurnId = next.id; assert.throws(() => validateNotebookEntries([corrupt]), /earlier explanation/);
});

test("a fresh pass uses the selected answer's review, not a different or edited version", () => {
  const e = entry();
  const review = { status: "ready" as const, model: "test", sourceRevision: "old-paper", draftFingerprint: fingerprint("First answer"), summary: "First review", observations: [{ observation: "First observation", sourceId: "draft", quote: "First answer", nextCheck: "Check first" }], tools: [], durationMs: 1 };
  const first = { ...makeStudyTurn(e, document), reply: "First answer", secondLook: review, status: "ready" as const };
  const second = { ...first, id: "second", reply: "Second answer", secondLook: { ...review, draftFingerprint: fingerprint("Second answer"), observations: [{ ...review.observations[0], observation: "Second observation", quote: "Second answer" }] } };
  e.study!.turns = [first, second]; e.study!.activeTurnId = first.id;
  assert.match(makeThinkingTurn(e, document).packet, /First observation/);
  assert.doesNotMatch(makeThinkingTurn(e, document).packet, /Second observation/);
  first.reply = "Edited first answer"; assert.equal(secondLookContext(e), "");
  e.study!.guidance = "hint"; assert.equal(makeThinkingTurn(e, document).secondLookRequested, undefined);
  assert.doesNotMatch(makeThinkingTurn(e, document).packet, /Second observation/);
  e.study!.guidance = "walkthrough"; e.study!.benchmark = { statement: "A theorem", citationKey: "hidden", locator: "hidden", referenceNotes: "hidden proof", phase: "attempt" };
  const attempt = makeThinkingTurn(e, document); assert.equal(attempt.secondLookRequested, undefined);
  assert.doesNotMatch(attempt.packet, /hidden proof|test-paper\/main.tex/);
});

test("linked fresh passes consume only their parent's ready notice and survive notebook hydration", () => {
  const e = entry(), previous = { ...makeStudyTurn(e, document), reply: "Saved deduction", status: "ready" as const };
  e.study!.turns = [previous]; e.study!.activeTurnId = previous.id;
  const next = makeThinkingTurn(e, document);
  const parent = { id: previous.id, notebookId: e.id, studyTurnId: previous.id, status: "ready", title: "Previous", route: "local", nodeId: "n", createdAt: "now", updatedAt: "now" } as AttentionTask;
  const unrelated = { ...parent, id: "unrelated", notebookId: "other", studyTurnId: undefined };
  const pending = { ...parent, id: next.id, studyTurnId: next.id, previousTaskId: previous.id, status: "working" as const };
  const before = { notebookEntries: [e], attentionTasks: [parent, unrelated], activeNodeId: "n", destination: "notebook", paragraphEdits: {}, progressByNode: {} } as unknown as AppState;
  const queued = queueAttentionTask(before, pending);
  assert.equal(queued.attentionTasks[0].status, "reviewed"); assert.equal(queued.attentionTasks[1].status, "ready");
  assert.equal(queued.notebookEntries[0].study!.turns[0].closed, true);
  queued.notebookEntries[0].study!.turns.push({ ...next, jobId: "job" });
  const hydrated = receiveNotebook({ ...before, notebookEntries: [], attentionTasks: [] }, { version: 1, revision: 1, entries: queued.notebookEntries });
  assert.equal(hydrated.attentionTasks.find(task => task.id === next.id)?.previousTaskId, previous.id);
  assert.equal(hydrated.attentionTasks.find(task => task.id === previous.id)?.status, "reviewed");
  assert.equal(hydrated.notebookEntries[0].study!.turns[0].reply, "Saved deduction");
});
