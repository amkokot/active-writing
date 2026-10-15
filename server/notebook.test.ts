import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppState, ProjectDocument } from "../src/types.ts";
import { freshTurbo } from "../src/turbo.ts";
import { branchId, newNotebookEntry, nextWork, notebookEntriesForPassage, notebookPassageUrl, notebookQueuePassage, notebookPacket, notebookReplyStatus, notebookTaskSource, notebookTitle, proposalReplacement, suggestWork, toggleNotebookConversation } from "../src/notebook.ts";
import { applyWindowRequest, readWindowRequest } from "../src/windowWorkspace.ts";
import { captureTaskSource } from "../src/taskSource.ts";
import { readNotebook, validateNotebookEntries, writeNotebook } from "./notebookStore.ts";
import { checkpointStudy, makeStudyTurn, parseStudyAnswer, receiveStudyReply, retireRemoteRequests, studyBibliography, studyPacket, studyState } from "../src/study.ts";
import { mathParts } from "../src/mathText.ts";
import katex from "katex";
import { registerProject, saveEdits, parseProject } from "./projects.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { experimentContext, newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import { notebookSync, reconcileNotebook, receiveNotebook } from "../src/notebookSync.ts";
import { anchorAppliedNotebookEntries, locateSavedPassage } from "../src/sourceRefresh.ts";
import { orderedNotebookEntries, reorderNotebook, moveNotebookEntry, fileNotebookEntry } from "../src/notebookCatalogue.ts";
import { addAnswerCues, answerCueDuration, answerCueExpiry, answerCueKey } from "../src/answerCue.ts";
import { phaseNeighbours, phasePredecessor, phaseSelection, navigateSavedPhase, researchPhases, openResearchPhase } from "../src/notebook.ts";

test("phase navigation resolves both directions in existing archived rollovers, not catalogue order", () => {
  const first = { ...newNotebookEntry(document, state()), id: "first", filed: true };
  const second = { ...first, id: "second", filed: false, notes: `Research phase checkpoint; previous phase: http://127.0.0.1:4173/?awProject=${document.project.id}&awPanel=notebook&awNotebook=first\nFixed backup: /saved` };
  const branch = { ...second, id: "branch" };
  const unrelated = { ...first, id: "unrelated", filed: false, notes: "See previous phase: https://example.org/" };
  const before = JSON.stringify([first, second, branch, unrelated]);
  const list = [branch, unrelated, second, first];
  assert.equal(phaseNeighbours(second, list, document.project.id).previous, first);
  assert.deepEqual(phaseNeighbours(first, list, document.project.id).next.map(entry => entry.id), ["branch", "second"]);
  assert.equal(phasePredecessor(second, "another-project"), undefined);
  assert.equal(phasePredecessor({ ...second, recoveryKey: "draft" }, document.project.id), undefined);
  assert.equal(phasePredecessor({ ...second, notes: second.notes.replace('http://127.0.0.1:4173/', 'javascript:') }, document.project.id), undefined);
  assert.equal(phasePredecessor(unrelated, document.project.id), undefined);
  assert.equal(phaseNeighbours(second, [second], document.project.id).previous, undefined);
  assert.deepEqual(researchPhases(list, document.project.id).map(item => item.id), ["branch", "first", "second"]);
  assert.deepEqual(researchPhases([unrelated], document.project.id), []);
  assert.deepEqual(researchPhases([{ ...second, recoveryKey: "draft" }, first], document.project.id), []);
  const selected = phaseSelection({ ...state(), notebookEntries: [first, second], collapsedNotebookIds: ["first", "second"] }, "first");
  assert.equal(selected.activeNotebookId, "first");
  assert.equal(selected.notebookEntries[0].filed, true);
  assert.equal(selected.notebookEntries[0].experimentNotebookId, first.experimentNotebookId);
  assert.deepEqual(selected.collapsedNotebookIds, ["second"]);
  assert.equal(JSON.stringify([first, second, branch, unrelated]), before);
});

test("phase navigation saves before selecting and stops on draft conflicts", async () => {
  const events: string[] = [];
  await navigateSavedPhase(async () => { events.push("save"); }, () => { events.push("select"); });
  assert.deepEqual(events, ["save", "select"]);
  await assert.rejects(navigateSavedPhase(async () => { throw new Error("draft conflict"); }, () => { events.push("unexpected"); }), /draft conflict/);
  assert.deepEqual(events, ["save", "select"]);
});

test("normal project opening selects the newest phase while archive and recovery links remain deliberate", () => {
  const early = { ...newNotebookEntry(document, state()), id: "early", filed: true, createdAt: "2026-10-01T00:00:00Z" };
  const next = { ...early, id: "next", filed: false, createdAt: "2026-10-02T00:00:00Z", notes: `Research phase checkpoint; previous phase: http://127.0.0.1:4173/?awProject=${document.project.id}&awPanel=notebook&awNotebook=early\nFixed backup: /saved` };
  const unrelated = { ...early, id: "question", filed: false, createdAt: "2026-10-10T00:00:00Z" };
  const cached = { ...state(), activeNotebookId: "early", paragraphEdits: { human: "Keep my draft" } };
  const result = openResearchPhase(cached, [next, unrelated, early], document.project.id, { showNotebook: true });
  assert.equal(result.activeNotebookId, "next"); assert.equal(result.destination, "notebook");
  assert.deepEqual(result.paragraphEdits, cached.paragraphEdits);
  assert.equal(result.previewMode, cached.previewMode);
  const manuscript = { ...cached, destination: "manuscript" as const, previewMode: "split" as const };
  const refreshed = openResearchPhase(manuscript, [next, early], document.project.id);
  assert.equal(refreshed.activeNotebookId, "next");
  assert.equal(refreshed.destination, "manuscript");
  assert.equal(refreshed.previewMode, "split");
  assert.equal(openResearchPhase(cached, [next, early], document.project.id, { entryId: "early" }).activeNotebookId, "early");
  assert.equal(openResearchPhase(cached, [next, early], document.project.id, { recovery: true }), cached);
  assert.equal(openResearchPhase(cached, [next, early], document.project.id, { entryId: "missing" }), cached);
  assert.equal(early.filed, true); assert.equal(next.filed, false);
});

test("answer cues expire after a minute, survive refresh and do not rearm after opening or note edits", () => {
  const now = Date.parse("2026-10-09T15:00:00Z");
  const entry = { ...newNotebookEntry(document, state()), reply: "Saved answer", updatedAt: new Date(now).toISOString() };
  assert.equal(answerCueDuration, 60_000);
  const cues = addAnswerCues({}, [entry], now);
  assert.equal(cues[answerCueKey(entry)], now + 60_000);
  const refreshed = JSON.parse(JSON.stringify(cues));
  const edited = { ...entry, updatedAt: new Date(now + 120_000).toISOString() };
  assert.equal(addAnswerCues(refreshed, [edited], now + 120_000), refreshed);
  const opened = { ...cues, [answerCueKey(entry)]: 0 };
  assert.equal(addAnswerCues(opened, [edited], now + 120_000), opened);
  assert.equal(answerCueExpiry({ ...entry, updatedAt: "invalid" }, now), 0);
  assert.ok(answerCueExpiry({ ...entry, updatedAt: new Date(now - 120_000).toISOString() }, now) < now);
  entry.study = studyState(entry);
  const turn = makeStudyTurn(entry, document);
  entry.study.turns = [{ ...turn, status: "queued" }];
  assert.equal(addAnswerCues(cues, [entry], now), cues);
  entry.study.turns[0] = { ...turn, status: "ready", reply: "Fresh answer" };
  assert.equal(addAnswerCues(opened, [entry], now)[answerCueKey(entry)], now + 60_000);
});

test("manuscript answer availability follows the active request without completing or changing it", () => {
  const entry = newNotebookEntry(document, state());
  assert.equal(notebookReplyStatus(entry), "none");
  assert.equal(notebookReplyStatus({ ...entry, reply: "Saved legacy answer" }), "answer");
  entry.study = studyState(entry);
  const turn = makeStudyTurn(entry, document);
  entry.study.turns = [{ ...turn, status: "queued", reply: "" }];
  entry.study.activeTurnId = turn.id;
  const before = JSON.stringify(entry);
  assert.equal(notebookReplyStatus(entry), "waiting");
  assert.equal(JSON.stringify(entry), before);
  entry.study.turns[0] = { ...turn, status: "ready", reply: "Saved answer" };
  assert.equal(notebookReplyStatus(entry), "answer");
  entry.study.turns[0] = { ...turn, status: "ready", reply: "", answer: { idea: "A structured answer", background: "", argument: "", checks: "", references: [] } };
  assert.equal(notebookReplyStatus(entry), "answer");
  entry.study.turns[0] = { ...turn, status: "failed", reply: "", partialReply: "Incomplete answer" };
  assert.equal(notebookReplyStatus(entry), "none");
  entry.study.turns[0] = { ...turn, status: "queued", reply: "", closed: true };
  assert.equal(notebookReplyStatus(entry), "none");
  entry.study.turns[0] = { ...turn, status: "queued", reply: "", completedExternally: true };
  assert.equal(notebookReplyStatus(entry), "none");
  entry.study.turns = [{ ...turn, id: "older", status: "ready", reply: "Earlier answer" }, { ...turn, status: "queued", reply: "" }];
  assert.equal(notebookReplyStatus(entry), "waiting");
  entry.study.activeTurnId = "missing";
  assert.equal(notebookReplyStatus(entry), "waiting");
});

test("moving a conversation retains the active fallback instead of opening the new top card",()=>{
  const a={...newNotebookEntry(document,state()),id:"a"},b={...a,id:"b"};
  const initial={...state(),activeNotebookId:undefined,notebookEntries:[a,b]};
  const moved=moveNotebookEntry(initial,"a","b");
  assert.equal(moved.activeNotebookId,"b");assert.deepEqual(orderedNotebookEntries(moved.notebookEntries).map(e=>e.id),["a","b"]);
  assert.equal(moveNotebookEntry(initial,"unknown","b"),initial);
});

test("conversation order is stable through selection, pins, new questions and serialization",()=>{
  const a={...newNotebookEntry(document,state()),id:"a",title:"A",pinned:true},b={...a,id:"b",title:"B",pinned:false},c={...a,id:"c",title:"C",pinned:false};
  const entries=reorderNotebook([a,b,c],"a","c");
  assert.deepEqual(orderedNotebookEntries(entries).map(e=>e.id),["a","c","b"]);
  assert.deepEqual(orderedNotebookEntries(JSON.parse(JSON.stringify(entries))).map(e=>e.id),["a","c","b"]);
  const selected=toggleNotebookConversation({...state(),notebookEntries:entries},"b",true);
  assert.deepEqual(orderedNotebookEntries(selected.notebookEntries).map(e=>e.id),["a","c","b"]);
  assert.deepEqual(orderedNotebookEntries([...entries,{...c,id:"new",cataloguePosition:undefined}]).map(e=>e.id),["new","a","c","b"]);
  assert.deepEqual(entries.find(e=>e.id==="a")!.source,a.source);assert.equal(entries.find(e=>e.id==="a")!.pinned,true);
});
test("file away preserves text, experiments, pins and waiting queue; explicit open restores it",()=>{
  const a={...newNotebookEntry(document,state()),id:"a",notes:"Keep these notes",pinned:true,experimentNotebookId:"original"},b={...a,id:"b",pinned:false};
  const original={...state(),activeNotebookId:"a",notebookEntries:[a,b]},filed=fileNotebookEntry(original,"a",true,"Boundary checks");
  assert.equal(filed.activeNotebookId,"b");assert.deepEqual(filed.attentionTasks,original.attentionTasks);
  assert.deepEqual(filed.notebookEntries[0],{...a,filed:true,folder:"Boundary checks",updatedAt:filed.notebookEntries[0].updatedAt});
  const restored=toggleNotebookConversation(filed,"a",true);assert.equal(restored.notebookEntries[0].filed,false);assert.equal(restored.notebookEntries[0].pinned,true);
  assert.equal(fileNotebookEntry(original,"unknown",true),original);
});
test("catalogue moves and filing merge independently from a finalized agent reply",()=>{
  const a={...newNotebookEntry(document,state()),id:"a"},b={...a,id:"b"},base=[a,b];
  const local=reorderNotebook(base,"a","b").map(e=>e.id==="b"?{...e,filed:true,folder:"Later"}:e);
  const remote=base.map(e=>e.id==="a"?{...e,reply:"A new answer"}:e);
  const merged=reconcileNotebook(local,remote,notebookSync(base,1));
  assert.equal(merged.length,2);assert.equal(merged[0].reply,"A new answer");assert.equal(merged[1].filed,true);
  assert.deepEqual(orderedNotebookEntries(merged).map(e=>e.id),["a","b"]);validateNotebookEntries(merged);
});
test("invalid catalogue positions and folder metadata cannot enter the saved notebook",()=>{
  const entry=newNotebookEntry(document,state());
  for(const patch of [{filed:"yes"},{cataloguePosition:-1},{cataloguePosition:2000},{cataloguePosition:.5},{folder:"bad\nfolder"},{folder:"x".repeat(101)}])assert.throws(()=>validateNotebookEntries([{...entry,...patch}]));
  validateNotebookEntries([{...entry,filed:true,folder:"Later / checks",cataloguePosition:0}]);
});

test("notebook reconciliation combines independent author, experiment and agent-turn changes", () => {
  const entry = newNotebookEntry(document, state()); entry.id = "shared"; entry.study = studyState(entry);
  const turn = makeStudyTurn(entry, document); entry.study.turns = [turn];
  const local = { ...entry, notes: "Author insight", experimentContext: "New measured result", updatedAt: "later-local" };
  const remote = structuredClone(entry); remote.study!.turns[0] = { ...turn, status: "ready", reply: "Agent deduction" }; remote.updatedAt = "later-disk";
  const merged = reconcileNotebook([local], [remote], notebookSync([entry], 1));
  assert.equal(merged.length, 1); assert.equal(merged[0].notes, local.notes); assert.equal(merged[0].experimentContext, local.experimentContext);
  assert.equal(merged[0].study!.turns[0].reply, "Agent deduction"); validateNotebookEntries(merged);
  assert.equal(reconcileNotebook(merged, [remote], notebookSync([remote], 2)).length, 1);
});
test("conversation disclosure never removes work; pins merge independently from replies", () => {
  const entry = newNotebookEntry(document, state()); entry.id = "conversation"; entry.question = "A useful question\nMore context";
  assert.equal(notebookTitle(entry), "A useful question");
  assert.equal(notebookTitle({ ...entry, title: "Author's title" }), "Author's title");
  const pinned = { ...entry, pinned: true }, current = { ...state(), notebookEntries: [pinned], activeNotebookId: entry.id };
  const collapsed = toggleNotebookConversation(current, entry.id, false);
  assert.deepEqual(collapsed.collapsedNotebookIds, [entry.id]); assert.equal(collapsed.notebookEntries[0].pinned, false);
  assert.equal(collapsed.notebookEntries[0].question, entry.question); assert.equal(collapsed.notebookEntries[0].source, entry.source);
  const opened = toggleNotebookConversation(collapsed, entry.id, true); assert.deepEqual(opened.collapsedNotebookIds, []);
  assert.equal(toggleNotebookConversation(current, "missing", true), current);
  const merged = reconcileNotebook([pinned], [{ ...entry, reply: "Agent result" }], notebookSync([entry], 1));
  assert.equal(merged.length, 1); assert.equal(merged[0].pinned, true); assert.equal(merged[0].reply, "Agent result"); validateNotebookEntries(merged);
  assert.throws(() => validateNotebookEntries([{ ...entry, pinned: "yes" }]), /pin/);
  validateNotebookEntries([{ ...entry, pinned: true, pinMode: "experiments" }]);
  assert.throws(() => validateNotebookEntries([{ ...entry, pinMode: "unknown" }]), /pin display/);
});
test("manuscript conversation requests track their saved source, not a newer paragraph", () => {
  const entry = newNotebookEntry(document, state(), { paragraphId: "p1", nodeId: "a", start: 2, end: 12, text: document.paragraphs[0].text.slice(2, 12), x: 0, y: 0 });
  const after = { ...document, revision: "new-revision", paragraphs: document.paragraphs.map(p => p.id === "p1" ? { ...p, text: "Changed manuscript text" } : p) };
  const snapshot = notebookTaskSource(entry, after)!;
  assert.equal(snapshot.revision, document.revision); assert.equal(snapshot.paragraphs[0].text, document.paragraphs[0].text);
  assert.notEqual(snapshot.paragraphs[0].text, after.paragraphs[0].text); assert.equal(snapshot.focusParagraphId, "p1");
  assert.equal(notebookTaskSource(newNotebookEntry(document, state()), document), undefined);
});
test("contested drafts keep catalogue ownership and do not duplicate or reactivate queue requests", () => {
  const entry = newNotebookEntry(document, state()); entry.id = "shared"; entry.study = studyState(entry);
  const turn = { ...makeStudyTurn(entry, document), status: "ready" as const, reply: "Retained result" }; entry.study.turns = [turn];
  const local = { ...entry, notes: "Local author argument" }, remote = { ...entry, notes: "Different disk argument" };
  const current = { ...state(), notebookEntries: [local], notebookSync: notebookSync([entry], 1) };
  const merged = receiveNotebook(current, { version: 1, revision: 2, entries: [remote] });
  assert.equal(merged.notebookEntries.length, 2); assert.equal(merged.notebookEntries[0].notes, local.notes);
  const recovery = merged.notebookEntries.find(item => item.recoveryKey)!;
  assert.equal(recovery.notes, remote.notes); assert.equal(recovery.experimentNotebookId, "shared"); assert.equal(recovery.study!.turns[0].closed, true);
  assert.equal(merged.attentionTasks.length, 1); assert.equal(merged.attentionTasks[0].notebookId, "shared");
  assert.equal(receiveNotebook(merged, { version: 1, revision: 2, entries: [remote] }).notebookEntries.length, 2);
  validateNotebookEntries(merged.notebookEntries);
  assert.equal(reconcileNotebook([local], [remote])[0].notes, local.notes, "unknown baseline never uses timestamps as authority");
});
test("own multi-paragraph saves retain navigation without authorizing a partial replacement", () => {
  const entry = newNotebookEntry(document, state(), { paragraphId: "p1", nodeId: "a", text: document.paragraphs[0].text, start: 0, end: document.paragraphs[0].text.length, x: 0, y: 0 });
  const replacement = "First new paragraph.\n\nSecond new paragraph.";
  entry.source = { ...entry.source!, paragraphText: replacement, excerpt: replacement, start: 0, end: replacement.length };
  entry.appliedChanges.push({ before: document.paragraphs[0].text, after: replacement, createdAt: "now" });
  const after = { ...document, revision: "source-b", paragraphs: [{ ...document.paragraphs[0], text: "First new paragraph." }, { ...document.paragraphs[0], id: "expanded", text: "Second new paragraph." }, ...document.paragraphs.slice(1)] };
  const linked = anchorAppliedNotebookEntries([entry], { p1: replacement }, after)[0];
  assert.equal(locateSavedPassage(linked.source, after, {})?.id, "p1");
  assert.match(proposalReplacement({ ...linked, proposal: "Do not truncate" }, after.paragraphs[0].text).error!, /paragraph changed/);
  const inserted = { ...after, revision: "source-c", paragraphs: [{ ...after.paragraphs[0], text: "Reused ordinal" }, { ...after.paragraphs[0], id: "moved" }, ...after.paragraphs.slice(1)] };
  assert.equal(locateSavedPassage(linked.source, inserted, {})?.id, "moved");
  inserted.paragraphs.push({ ...after.paragraphs[0], id: "duplicate" }); assert.equal(locateSavedPassage(linked.source, inserted, {}), undefined);
  assert.equal(anchorAppliedNotebookEntries([entry], {}, after)[0], entry);
  validateNotebookEntries([linked]);
});

const document: ProjectDocument = {
  project: { id: "test", name: "Paper", folder: "paper", mainFile: "main.tex", createdAt: "now" },
  files: ["main.tex", "sections/results.tex"], rootFiles: ["main.tex"], revision: "source-a",
  nodes: [
    { id: "a", title: "First section", kind: "section", depth: 0, paragraphIds: ["p1"] },
    { id: "lemma", parentId: "a", title: "A lemma", kind: "lemma", depth: 1, paragraphIds: ["p2"] },
    { id: "proof", parentId: "lemma", title: "Its proof", kind: "proof", depth: 2, paragraphIds: ["p3"] },
    { id: "b", title: "Other section", kind: "section", depth: 0, paragraphIds: ["p4"] },
  ],
  paragraphs: [
    { id: "p1", nodeId: "a", text: "A bound on $x$ with \\ref{key}.", file: "main.tex" },
    { id: "p2", nodeId: "lemma", text: "The hypothesis holds.", file: "sections/results.tex" },
    { id: "p3", nodeId: "proof", text: "We test the boundary case." },
    { id: "p4", nodeId: "b", text: "An independent writing task." },
  ],
};
function state(): AppState { return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "related", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "project", activeNodeId: "a", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" }; }

test("each notebook entry supplies its own saved manuscript URL, independently of the selected conversation", () => {
  const first = newNotebookEntry(document, state(), { paragraphId: "p1", nodeId: "a", start: 0, end: 10, text: document.paragraphs[0].text.slice(0, 10), x: 0, y: 0 });
  const second = newNotebookEntry(document, state(), { paragraphId: "p2", nodeId: "lemma", start: 0, end: 10, text: document.paragraphs[1].text.slice(0, 10), x: 0, y: 0 });
  const current = { ...state(), destination: "notebook" as const, activeNotebookId: first.id, notebookEntries: [first, second], activeParagraphId: "p1" };
  const href = notebookPassageUrl("http://localhost:4203/?unrelated=old#old", second, document, current)!;
  const request = readWindowRequest(new URL(href).search)!;
  assert.equal(request.panel, "paper"); assert.equal(request.paragraphId, "p2"); assert.equal(request.notebookId, second.id);
  assert.equal(request.projectId, document.project.id); assert.equal(request.rootFile, "main.tex");
  assert.equal(new URL(href).hash, ""); assert.equal(new URL(href).searchParams.has("unrelated"), false);
  const opened = applyWindowRequest(current, document, request);
  assert.equal(opened.destination, "manuscript"); assert.equal(opened.activeParagraphId, "p2");
  const changed = { ...document, revision: "changed", paragraphs: document.paragraphs.map(p => p.id === "p2" ? { ...p, text: "Different source" } : p) };
  assert.equal(notebookPassageUrl(href, second, changed, current), undefined, "no guessed link when source changed");
  assert.equal(applyWindowRequest(current, changed, request).activeParagraphId, undefined, "stale new-tab URLs never jump to a recycled ID");
  assert.equal(applyWindowRequest(current, changed, request).activeNodeId, "a");
  const draftEntry = { ...second, source: { ...second.source!, paragraphText: "Unsaved draft", excerpt: "Unsaved draft" } };
  const draftHref = notebookPassageUrl(href, draftEntry, document, { ...current, paragraphEdits: { p2: "Unsaved draft" } })!;
  assert.equal(readWindowRequest(new URL(draftHref).search)?.paragraphId, "p2", "an existing saved block opens saved source, not this window's draft");
  assert.equal(draftHref.includes("Unsaved"), false);
  assert.equal(notebookPassageUrl(href, { ...draftEntry, source: { ...draftEntry.source, paragraphId: "new-unsaved-block" } }, document, current), undefined);
});

test("queue questions prefer their own reliable manuscript passage; independent and ambiguous links stay notebook-only", () => {
  const entry = newNotebookEntry(document, state(), { paragraphId: "p2", nodeId: "lemma", start: 0, end: 10, text: document.paragraphs[1].text.slice(0, 10), x: 0, y: 0 });
  const task = { id: "task", notebookId: entry.id } as AppState["attentionTasks"][number];
  const current = { ...state(), notebookEntries: [{ ...entry, filed: true }], activeNotebookId: "a different question" };
  assert.equal(notebookQueuePassage(task, document, current)?.id, "p2");
  assert.equal(notebookQueuePassage({ ...task, notebookId: "missing" }, document, current), undefined);
  assert.equal(notebookQueuePassage(task, document, { ...current, notebookEntries: [{ ...entry, source: undefined }] }), undefined);
  const moved = { ...document, revision: "moved", paragraphs: document.paragraphs.map(p => p.id === "p2" ? { ...p, id: "moved-p2" } : p) };
  assert.equal(notebookQueuePassage(task, moved, current)?.id, "moved-p2");
  assert.equal(notebookQueuePassage(task, { ...moved, paragraphs: [...moved.paragraphs, { ...moved.paragraphs[1], id: "duplicate" }] }, current), undefined);
  assert.equal(current.notebookEntries[0].filed, true, "navigation lookup does not unfile or resolve anything");
});

test("passage links include filed and multi-block conversations without changing notes or queue", () => {
  const selection = { paragraphId: "p1", nodeId: "a", start: 0, end: document.paragraphs[0].text.length, text: document.paragraphs[0].text, x: 0, y: 0 };
  const older = { ...newNotebookEntry(document, state(), selection), id: "older", filed: true, updatedAt: "2026-10-01", notes: "Keep my notes" };
  const multi = { ...newNotebookEntry(document, state(), { ...selection, spans: [selection, { paragraphId: "p2", nodeId: "lemma", start: 0, end: document.paragraphs[1].text.length, text: document.paragraphs[1].text }] }), id: "multi", updatedAt: "2026-10-06" };
  const independent = newNotebookEntry(document, state());
  const recovered = { ...older, id: "recovered", recoveryKey: "disk-copy" };
  const entries = [older, independent, recovered, multi], before = structuredClone(entries);
  assert.deepEqual(notebookEntriesForPassage(entries, document, {}, "p1").map(e => e.id), ["multi", "older"]);
  assert.deepEqual(notebookEntriesForPassage(entries, document, {}, "p2").map(e => e.id), ["multi"]);
  assert.equal(notebookEntriesForPassage(entries, document, {}, "p4").length, 0);
  assert.equal(notebookEntriesForPassage(entries, document, {}, "missing").length, 0);
  assert.deepEqual(entries, before);
  const original = { ...state(), notebookEntries: entries }, opened = toggleNotebookConversation(original, older.id, true);
  assert.equal(opened.notebookEntries[0].filed, false); assert.equal(opened.notebookEntries[0].notes, older.notes);
  assert.deepEqual(opened.attentionTasks, original.attentionTasks);
});

test("passage links follow safe relocation and own-save anchors, never reused or ambiguous positions", () => {
  const entry = newNotebookEntry(document, state(), { paragraphId: "p1", nodeId: "a", start: 0, end: 5, text: document.paragraphs[0].text.slice(0, 5), x: 0, y: 0 });
  const moved = { ...document, revision: "source-b", paragraphs: [{ ...document.paragraphs[0], id: "relocated" }, { ...document.paragraphs[0], text: "An unrelated new paragraph at the old position." }] };
  assert.deepEqual(notebookEntriesForPassage([entry], moved, {}, "relocated"), [entry]);
  assert.equal(notebookEntriesForPassage([entry], moved, {}, "p1").length, 0);
  const ambiguous = { ...moved, paragraphs: [...moved.paragraphs, { ...moved.paragraphs[0], id: "duplicate" }] };
  assert.equal(notebookEntriesForPassage([entry], ambiguous, {}, "relocated").length, 0);
  const differentFile = { ...moved, paragraphs: moved.paragraphs.map(p => ({ ...p, file: "different.tex" })) };
  assert.equal(notebookEntriesForPassage([entry], differentFile, {}, "relocated").length, 0);
  const anchored = { ...entry, source: { ...entry.source!, returnAnchor: { paragraphId: "p1", paragraphText: moved.paragraphs[1].text, revision: moved.revision, file: "main.tex" } } };
  assert.deepEqual(notebookEntriesForPassage([anchored], moved, {}, "p1"), [anchored]);
  assert.equal(notebookEntriesForPassage([anchored], moved, {}, "relocated").length, 0);
});

test("section-file moves keep primary and multi-block notebook links without replacing captured evidence", () => {
  const selection = { paragraphId: "p1", nodeId: "a", start: 0, end: document.paragraphs[0].text.length, text: document.paragraphs[0].text, x: 0, y: 0 };
  const entry = newNotebookEntry(document, state(), { ...selection, spans: [selection, { paragraphId: "p2", nodeId: "lemma", start: 0, end: document.paragraphs[1].text.length, text: document.paragraphs[1].text }] });
  const moved = { ...document, revision: "moved-files", paragraphs: document.paragraphs.map(p => ({ ...p, id: `moved-${p.id}`, file: "sections/new.tex" })) };
  const anchor = (source: NonNullable<typeof entry.source>) => {
    const paragraph = moved.paragraphs.find(p => p.id === `moved-${source.paragraphId}`)!;
    return { ...source, returnAnchor: { rootFile: "main.tex", paragraphId: paragraph.id, paragraphText: paragraph.text, revision: moved.revision, file: paragraph.file } };
  };
  const linked = { ...entry, source: { ...anchor(entry.source!), passages: entry.source!.passages!.map(anchor) } };
  assert.deepEqual(notebookEntriesForPassage([linked], moved, {}, "moved-p1"), [linked]);
  assert.deepEqual(notebookEntriesForPassage([linked], moved, {}, "moved-p2"), [linked]);
  const href = notebookPassageUrl("http://localhost:4199/", linked, moved, state())!;
  assert.equal(readWindowRequest(new URL(href).search)?.paragraphId, "moved-p1");
  assert.equal(linked.source.file, "main.tex");
  assert.equal(linked.source.passages[1].file, "sections/results.tex");
  assert.equal(notebookTaskSource(linked, moved)!.revision, document.revision);
  assert.equal(notebookTaskSource(linked, moved)!.paragraphs[1].file, "sections/results.tex");
});

test("local study packets retain independent experiment findings within the shared budget", () => {
  const entry=newNotebookEntry(document,state()), nb=newExperimentNotebook();
  for(let i=0;i<4;i++){
    const cell=newExperimentCell("code");cell.id=`result-${i}`;cell.source="# long implementation\n".repeat(100);
    cell.outputs=[{output_type:"stream",text:`RESULT_${i}: error=0.${i}123; numerical check only.\n`+"details\n".repeat(200)}];
    nb.cells.push(cell);
  }
  entry.experimentContext=experimentContext(nb,entry.id);
  const packet=studyPacket(entry,document,"develop",true);
  const context=JSON.parse(packet.split("## Context\n")[1].split("\n\n## Response")[0]);
  assert.ok(context.experimentsNotProof.length<=1800);
  for(let i=0;i<4;i++)assert.match(context.experimentsNotProof,new RegExp(`RESULT_${i}`));
  assert.doesNotMatch(context.experimentsNotProof,/# long implementation/);
  assert.equal(studyPacket(entry,document,"develop").includes("Source excerpt:"),true);
});

test("Tiny study prompts keep the task visible with learning and provenance boundaries", () => {
  const entry=newNotebookEntry(document,state());entry.question="Explain an error ball, not a raw residual.";entry.notes="24 of 36 numerical checks accepted; not proof.";
  entry.study={...studyState(entry),localEffort:0,guidance:"hint",benchmark:{statement:"Assume finite cost and positive marginals.",citationKey:"held-back",locator:"secret section",phase:"attempt",referenceNotes:"do not reveal published proof"}};
  const packet=studyPacket(entry,document,"explain",true);
  assert.ok(packet.length<2500);assert.match(packet,/Explain an error ball/);assert.match(packet,/24 of 36/);assert.match(packet,/not a completed proof/);
  assert.match(packet,/Numerical checks are not proof/);assert.match(packet,/Statement-only attempt/);assert.doesNotMatch(packet,/held-back|secret section|do not reveal published proof/);
  assert.doesNotMatch(packet,/## Response|idea: mechanism and target/);
});

test("new questions use local inference; retired remote jobs retain work without resuming", () => {
  const entry = newNotebookEntry(document, state());
  assert.equal(entry.route, "local");
  const turn = { ...makeStudyTurn({ ...entry, route: "codex" }, document), subscriptionJobId: "old-job", partialReply: "Unfinished finding", packet: "Original saved packet" };
  const local = makeStudyTurn(entry, document);
  const previous = { ...entry, notes: "Author notes", study: { ...studyState(entry), turns: [turn, local] } };
  const retired = retireRemoteRequests([previous])[0];
  assert.equal(retired.notes, previous.notes);
  assert.equal(retired.study!.turns[0].status, "failed");
  assert.equal(retired.study!.turns[0].packet, turn.packet);
  assert.equal(retired.study!.turns[0].partialReply, turn.partialReply);
  assert.match(retired.study!.turns[0].error!, /nothing will be resent/);
  assert.equal(retired.study!.turns[1], local);
  assert.equal(previous.study.turns[0].status, "queued");
  assert.equal(retireRemoteRequests([retired])[0], retired);
  validateNotebookEntries([retired]);
});

test("removed subscription endpoints fail closed instead of starting an account connection", async () => {
  let handler: any;
  const configure = latexPlugin(process.cwd()).configureServer;
  assert.equal(typeof configure, "function");
  (configure as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  for (const url of ["/api/paperfocus/subscription", "/api/paperfocus/subscription/job", "/api/paperfocus/subscription/study", "/api/paperfocus/subscription/cancel"]) {
    for (const method of ["GET", "POST"]) {
      const response: any = { setHeader: () => undefined, end: (value: string) => { response.body = JSON.parse(value); } };
      let fellThrough = false;
      await handler({ url, method, headers: {} }, response, () => { fellThrough = true; });
      assert.equal(response.statusCode, 410);
      assert.match(response.body.error, /removed/);
      assert.equal(fellThrough, false);
    }
  }
});

test("related suggestions stay in the branch; unrelated work is independent, without relevance assertions", () => {
  const s = state();
  assert.equal(suggestWork(document, s)?.id, "p2");
  s.suggestions.relation = "unrelated";
  assert.equal(suggestWork(document, s)?.id, "p4");
  s.hiddenNodeIds = ["b"];
  assert.equal(suggestWork(document, s), undefined, "never silently fall back to related work");
  s.suggestions.relation = "related"; s.hiddenNodeIds = ["lemma"];
  assert.equal(suggestWork(document, s), undefined, "hidden ancestors suppress descendants");
});

test("indexed branch lookup preserves roots, missing parents and cycle guards", () => {
  const nodes = [...document.nodes,
    { id: "orphan", parentId: "missing", title: "Orphan", kind: "section" as const, depth: 1, paragraphIds: [] },
    { id: "cycle-a", parentId: "cycle-b", title: "Cycle A", kind: "section" as const, depth: 1, paragraphIds: [] },
    { id: "cycle-b", parentId: "cycle-a", title: "Cycle B", kind: "section" as const, depth: 1, paragraphIds: [] },
  ];
  const index = new Map(nodes.map((node) => [node.id, node]));
  for (const id of [undefined, "absent", ...nodes.map((node) => node.id)]) {
    assert.equal(branchId(nodes, id, index), branchId(nodes, id));
  }
  assert.equal(branchId(nodes, "proof", index), "a");
});

test("long-manuscript suggestions stop at the first eligible passage without checking later text", () => {
  let laterTextReads = 0;
  const later = Array.from({ length: 1440 }, (_, index) => ({ id: `later-${index}`, nodeId: "b", get text() { laterTextReads++; return "Later independent passage"; } }));
  const large = { ...document, paragraphs: [...document.paragraphs, ...later] };
  const s = state(); s.suggestions.relation = "unrelated";
  assert.equal(suggestWork(large, s)?.id, "p4");
  assert.equal(laterTextReads, 0, "Only the chosen passage needs eligibility checks");
  assert.deepEqual(s.progressByNode, {});
  assert.deepEqual(s.paragraphEdits, {});
});

test("waiting work and done sections are excluded; Turbo skipping never checks the origin", () => {
  const s = state(); s.turbo.enabled = true; s.turbo.activeParagraphId = "p1";
  s.attentionTasks = [{ id: "task", title: "Waiting question", nodeId: "lemma", paragraphId: "p2", route: "chatgpt", status: "queued", createdAt: "now", updatedAt: "now" }];
  assert.equal(suggestWork(document, s)?.id, "p3");
  assert.deepEqual(s.turbo.reviews, {});
  s.progressByNode.proof = "done";
  assert.equal(suggestWork(document, s), undefined);
});

function sectionTask() {
  const snapshot = captureTaskSource(document, document.nodes[0], {}, "section", "p1");
  return { id: "assigned", title: "Whole section", nodeId: "a", paragraphId: "p1", route: "codex" as const, status: "queued" as const, sourceSnapshot: snapshot, createdAt: "now", updatedAt: "now" };
}

test("whole-section waiting work excludes nested statements and proofs but keeps independent work", () => {
  const s = state(); s.attentionTasks = [sectionTask()];
  const before = structuredClone(s);
  assert.equal(suggestWork(document, s), undefined);
  s.suggestions.relation = "unrelated";
  assert.equal(suggestWork(document, s)?.id, "p4");
  assert.deepEqual(s.attentionTasks, before.attentionTasks);
  assert.deepEqual(s.progressByNode, {});
  assert.deepEqual(s.turbo.reviews, {});
});

test("the just-exported request is considered before React commits; fallback remains explicit", () => {
  const s = state(); const before = structuredClone(s);
  assert.equal(suggestWork(document, s)?.id, "p2", "old render would send the author into the assigned lemma");
  const next = nextWork(document, s, sectionTask());
  assert.equal(next.suggestion?.id, "p4");
  assert.equal(next.relation, "unrelated"); assert.equal(next.fallback, true);
  assert.deepEqual(s, before, "choosing the next task cannot queue work, navigate or check off source");
});

test("ready work remains reserved until review; failed/reviewed tasks release their section", () => {
  for (const status of ["queued", "working", "ready", "failed", "reviewed"] as const) {
    const s = state(); s.attentionTasks = [{ ...sectionTask(), status }];
    assert.equal(suggestWork(document, s)?.id, ["failed", "reviewed"].includes(status) ? "p2" : undefined, status);
  }
});

test("paragraph-only reservations follow exact relocated source rather than reused ordinal IDs", () => {
  const s = state(); const task = sectionTask();
  task.sourceSnapshot = captureTaskSource(document, document.nodes[1], {}, "paragraph", "p2");
  task.nodeId = "lemma"; task.paragraphId = "p2"; s.attentionTasks = [task];
  assert.equal(suggestWork(document, s)?.id, "p3");
  const changed = structuredClone(document); changed.revision = "source-b";
  changed.paragraphs.splice(1, 1, { ...document.paragraphs[1], text: "Inserted text reusing the former ordinal" }, { ...document.paragraphs[1], id: "shifted" });
  assert.equal(suggestWork(changed, s)?.id, "p2", "new text at a reused ordinal was not assigned");
  s.activeParagraphId = "p2";
  assert.equal(suggestWork(changed, s)?.id, "p3", "the relocated assigned source is skipped");
});

test("legacy and oversized section reservations cover descendants without blocking foreign roots", () => {
  const s = state(); const task = sectionTask();
  s.attentionTasks = [{ ...task, sourceSnapshot: undefined, paragraphId: undefined, nodeId: "lemma" }];
  assert.equal(suggestWork(document, s), undefined);
  s.attentionTasks = [{ ...task, sourceSnapshot: { ...task.sourceSnapshot, paragraphs: [], unavailableReason: "oversized" } }];
  assert.equal(suggestWork(document, s), undefined);
  for (const foreign of [{ projectId: "different-paper" }, { rootFile: "alternate.tex" }]) {
    s.attentionTasks = [{ ...task, sourceSnapshot: { ...task.sourceSnapshot, ...foreign } }];
    assert.equal(suggestWork(document, s)?.id, "p2");
  }
});

test("related notebook questions cannot route attention back into the full assigned excerpt", () => {
  const s = state();
  const origin = newNotebookEntry(document, s, { paragraphId: "p4", nodeId: "b", start: 0, end: 5, text: "An in", x: 0, y: 0 });
  const assigned = newNotebookEntry(document, s, { paragraphId: "p2", nodeId: "lemma", start: 0, end: 5, text: "The h", x: 0, y: 0 });
  const independent = newNotebookEntry(document, s);
  s.destination = "notebook"; s.activeNotebookId = origin.id; s.suggestions.relation = "unrelated";
  s.notebookEntries = [origin, assigned, independent]; s.attentionTasks = [sectionTask()];
  assert.equal(suggestWork(document, s)?.id, independent.id);
});

test("no unassigned work produces no navigation target or invented progress", () => {
  const s = state(); s.attentionTasks = [sectionTask(), { ...sectionTask(), id: "other", nodeId: "b", paragraphId: undefined, sourceSnapshot: undefined }];
  assert.equal(nextWork(document, s).suggestion, undefined);
  assert.deepEqual(s.progressByNode, {}); assert.deepEqual(s.paragraphEdits, {});
});

test("selection snapshots preserve LaTeX, proposals require unchanged source, and prompts make no verification claims", () => {
  const s = state();
  const entry = newNotebookEntry(document, s, { paragraphId: "p1", nodeId: "a", start: 0, end: 7, text: "A bound", x: 0, y: 0 });
  entry.proposal = "An estimate";
  assert.equal(proposalReplacement(entry, document.paragraphs[0].text).text, "An estimate on $x$ with \\ref{key}.");
  assert.match(proposalReplacement(entry, "Changed source").error!, /paragraph changed/);
  assert.match(proposalReplacement(entry, undefined).error!, /no longer/);
  assert.match(notebookPacket(entry, document.project), /Nothing is sent automatically/);
  assert.match(notebookPacket(entry, document.project), /Do not mark claims verified/);
  s.notebookEntries.push(entry); s.activeNotebookId = entry.id; s.destination = "notebook"; s.suggestions.relation = "unrelated";
  const standalone = newNotebookEntry(document, s); s.notebookEntries.push(standalone);
  assert.equal(suggestWork(document, s)?.id, standalone.id);
});

test("notebook storage round-trips all drafts and history, rejects stale writes, and leaves ordinary multi-file LaTeX alone", async () => {
  const base = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "notebook-"));
  const folder = path.join(workspace, "paper"); await mkdir(path.join(folder, "sections"), { recursive: true });
  const root = "\\documentclass{article}\n\\begin{document}\n\\input{sections/results}\n\\end{document}\n";
  const child = "\\section{Result}\nA bound on $x$ with \\ref{key}.\n";
  await writeFile(path.join(folder, "main.tex"), root); await writeFile(path.join(folder, "sections/results.tex"), child);
  const project = await registerProject(workspace, "paper");
  const parsed = await parseProject(workspace, project.id);
  const paragraph = parsed.paragraphs[0]; const s = state();
  const entry = newNotebookEntry(parsed, s, { paragraphId: paragraph.id, nodeId: paragraph.nodeId, start: 0, end: 7, text: "A bound", x: 0, y: 0 });
  entry.notes = "A failed boundary check — preserve it."; entry.reply = "An unverified idea"; entry.proposal = "An estimate";
  entry.handoffs.push({ id: "prompt", packet: notebookPacket(entry, project), createdAt: entry.createdAt });
  const initial = await readNotebook(workspace, project.id); assert.equal(initial.revision, 0);
  const saved = await writeNotebook(workspace, project.id, 0, [entry]);
  assert.deepEqual((await readNotebook(workspace, project.id)).entries, JSON.parse(JSON.stringify([entry])));
  await assert.rejects(writeNotebook(workspace, project.id, 0, []), /another window/);
  const request = makeStudyTurn(entry, parsed);
  entry.study = receiveStudyReply({ ...studyState(entry), turns: [request], activeTurnId: request.id }, request.id, "A retained, unstructured explanation.");
  entry.study.focus = { text: "$x$", origin: "Linked passage" }; entry.study.depth = "derivation";
  entry.handoffs.push({ id: request.id, studyTurnId: request.id, packet: request.packet, createdAt: request.createdAt });
  await writeNotebook(workspace, project.id, saved.revision, [entry]);
  assert.deepEqual((await readNotebook(workspace, project.id)).entries, JSON.parse(JSON.stringify([entry])), "explanation depth, focus, raw replies and history survive disk reload");
  assert.equal(JSON.parse(await readFile(path.join(workspace, ".paperfocus/project-data", project.id, "notebook.previous.json"), "utf8")).revision, 1);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), root);
  assert.equal(await readFile(path.join(folder, "sections/results.tex"), "utf8"), child);
  const proposed = proposalReplacement(entry, paragraph.text).text!;
  await saveEdits(workspace, project.id, { [paragraph.id]: proposed }, parsed.revision);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), root);
  assert.equal(await readFile(path.join(folder, "sections/results.tex"), "utf8"), child.replace("A bound", "An estimate"));
  assert.equal((await readNotebook(workspace, project.id)).entries[0].notes, entry.notes);
  await assert.rejects(writeNotebook(workspace, project.id, 2, [{ ...entry, source: { ...entry.source, start: -1 } }]), /excerpt range/);
  const writes = await Promise.allSettled([writeNotebook(workspace, project.id, 2, [entry]), writeNotebook(workspace, project.id, 2, [])]);
  assert.equal(writes[0].status, "fulfilled"); assert.equal(writes[1].status, "rejected", "simultaneous stale clients cannot both overwrite the same revision");
  assert.equal((await readNotebook(workspace, project.id)).entries.length, 1);
});

test("learning requests separate explanation depth from effort, retain exact focus and include prior findings", () => {
  const entry = newNotebookEntry(document, state()); entry.notes = "The approach uses $x^2 \\geq 0$.";
  entry.study = { ...studyState(entry), depth: "derivation", action: "catchup", focus: { text: "$x^2 \\geq 0$", origin: "Notes" }, background: "New to this topic" };
  const packet = studyPacket(entry, document);
  assert.match(packet, /shortest prerequisite path/); assert.match(packet, /depth: derivation/); assert.match(packet, /independent of model effort/);
  assert.match(packet, /rather than repeating an already established deduction/);
  assert.match(packet, /ask for that specific missing item instead of inventing it/);
  const context = JSON.parse(packet.split("## Context\n")[1].split("\n\n## Response")[0]);
  assert.equal(context.selectedDetail.text, entry.study.focus.text);
  const turn = makeStudyTurn(entry, document);
  entry.study = receiveStudyReply({ ...entry.study, turns: [turn], activeTurnId: turn.id }, turn.id, "Unresolved boundary case.");
  assert.match(studyPacket(entry, document, "develop"), /Substantively develop/);
  assert.match(studyPacket(entry, document, "step"), /intermediate algebra/);
  assert.match(studyPacket(entry, document), /Unresolved boundary case/);
  const waiting = makeStudyTurn(entry, document);
  entry.study = { ...entry.study, turns: [...entry.study.turns, waiting], activeTurnId: waiting.id };
  assert.match(studyPacket(entry, document), /Unresolved boundary case/, "a pending request does not hide the most recent completed findings");
  entry.notes = "A".repeat(10000);
  const local = studyPacket(entry, document, "explain", true);
  assert.match(local, /Use only the supplied passages; no browsing or proof verification/);
  assert.match(local, /Context excerpt shortened/); assert.ok(local.length < 16000);
});

test("reading suggestions are constrained data, with safe links and real project keys rather than verification claims", () => {
  const entry = newNotebookEntry(document, state()); entry.notes = "Compare \\cite[Theorem 2.1]{real}.";
  const paper = { ...document, citations: [{ key: "real", title: "Known source" }, { key: "other", title: "Unrelated source" }] };
  assert.deepEqual(studyBibliography(entry, paper).map((citation) => citation.key), ["real"]);
  const answer = { idea: "A mechanism", background: "", argument: "A gap", checks: "Needs checking", references: [{ title: "Unverified lead", why: "Introduction", locator: "", citationKey: "real", url: "javascript:alert(1)" }], verified: true };
  const parsed = parseStudyAnswer(`\u0060\u0060\u0060json\n${JSON.stringify(answer)}\n\u0060\u0060\u0060`)!;
  assert.equal(parsed.references[0].url, ""); assert.equal("verified" in parsed, false);
  answer.references[0].url = "https://example.org/paper";
  assert.equal(parseStudyAnswer(JSON.stringify(answer))?.references[0].url, "https://example.org/paper");
  assert.equal(parseStudyAnswer("A helpful plain-text explanation."), undefined);
  assert.equal(parseStudyAnswer(JSON.stringify({ ...answer, references: [{}] })), undefined);
});

test("follow-up replies never replace other requests, author notes, or manuscript proposals; invalid learning state is rejected", () => {
  const entry = newNotebookEntry(document, state()); entry.proposal = "Author's separate proposal"; entry.reply = "Earlier findings";
  const before = JSON.stringify(document);
  const first = makeStudyTurn(entry, document), second = makeStudyTurn(entry, document);
  entry.study = receiveStudyReply({ ...studyState(entry), turns: [first, second], activeTurnId: second.id }, second.id, "Ordinary retained reply");
  assert.equal(entry.study.turns[0].reply, ""); assert.equal(entry.study.turns[1].reply, "Ordinary retained reply");
  assert.equal(entry.proposal, "Author's separate proposal"); assert.equal(entry.reply, "Earlier findings"); assert.equal(JSON.stringify(document), before);
  validateNotebookEntries([entry]);
  assert.throws(() => validateNotebookEntries([{ ...entry, study: { ...entry.study, action: "toString" } }]), /learning workspace/);
  assert.throws(() => validateNotebookEntries([{ ...entry, study: { ...entry.study, activeTurnId: "missing" } }]), /explanation selection/);
  assert.throws(() => validateNotebookEntries([{ ...entry, study: { ...entry.study, turns: [{ ...first, closed: "yes" }] } }]), /retained explanation/);
});

test("hint-first trials hold comparison material back and retain the first attempt across later edits", () => {
  const entry = newNotebookEntry(document, state()); entry.notes = "My independent attempt";
  entry.study = { ...studyState(entry), guidance: "hint", depth: "derivation", benchmark: { statement: "Prove finite-time convergence.", citationKey: "secret-key", locator: "Lemma 7", phase: "attempt", referenceNotes: "WITHHELD_PROOF" } };
  let packet = studyPacket(entry, document);
  assert.match(packet, /one small hint/); assert.match(packet, /Respect this even when full derivation/);
  assert.match(packet, /do not browse/); assert.doesNotMatch(packet, /WITHHELD_PROOF|secret-key|Lemma 7|sections\/results|paper\/main/);
  assert.equal(makeStudyTurn(entry, document).guidance, "hint");
  entry.study = checkpointStudy(entry); const checkpoint = structuredClone(entry.study.benchmark!.checkpoint);
  entry.notes = "Later revised attempt"; entry.study = checkpointStudy(entry);
  assert.deepEqual(entry.study.benchmark!.checkpoint, checkpoint);
  packet = studyPacket(entry, document);
  assert.match(packet, /WITHHELD_PROOF/); assert.match(packet, /My independent attempt/);
  validateNotebookEntries([entry]);
  assert.throws(() => validateNotebookEntries([{ ...entry, study: { ...entry.study, guidance: "toString" } }]), /help level/);
  assert.throws(() => validateNotebookEntries([{ ...entry, study: { ...entry.study, benchmark: { ...entry.study.benchmark, phase: "verified" } } }]), /comparison/);
});

test("small-model follow-ups preserve argument and checks despite long introductory findings", () => {
  const entry = newNotebookEntry(document, state()); const turn = makeStudyTurn(entry, document);
  const answer = { idea: "I".repeat(9000), background: "B".repeat(9000), argument: "DECISIVE_ARGUMENT", checks: "MISSING_ASSUMPTION", references: [] };
  entry.study = receiveStudyReply({ ...studyState(entry), turns: [turn], activeTurnId: turn.id }, turn.id, JSON.stringify(answer));
  const packet = studyPacket(entry, document, "step", true);
  assert.match(packet, /DECISIVE_ARGUMENT/); assert.match(packet, /MISSING_ASSUMPTION/); assert.ok(packet.length < 10000);
});

test("scientific findings render delimited math, leave code/unclosed delimiters literal and deny trusted commands", () => {
  const parts = mathParts('Bound $x^2$ and \\[G^{-1}b\\]. `cost $5$` and \\$2. Unclosed $x');
  assert.deepEqual(parts.filter((p) => p.math).map((p) => [p.text, p.display]), [["x^2", false], ["G^{-1}b", true]]);
  assert.match(parts.at(-1)!.text, /Unclosed \$x/);
  assert.equal(mathParts('```tex\n$x$\n```').filter((p) => p.math).length, 0);
  const html = katex.renderToString('\\href{javascript:alert(1)}{x} \\includegraphics{https://evil.example/a}', { trust: false, throwOnError: false, maxExpand: 500, maxSize: 10 });
  assert.doesNotMatch(html, /<a\b|<img\b|<script\b/);
});
