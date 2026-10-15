import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { latexPlugin } from "./latexPlugin.ts";
import { focusedDocument, focusedSourceSnippets } from "./focus.ts";
import path from "node:path";
import { automaticSourceRefresh, locateSavedPassage, refreshSourceState, sourceRefreshPlan } from "../src/sourceRefresh.ts";
import { acknowledgeSave, reconcileEditorSave } from "../src/acknowledgedSave.ts";
import type { SourceDraftCopy } from "../src/sourceRefresh.ts";
import type { AppState, ProjectDocument } from "../src/types.ts";
import { freshTurbo } from "../src/turbo.ts";
import { createRewriteSession } from "../src/rewrite.ts";
import { newNotebookEntry } from "../src/notebook.ts";
import { createSourceMonitor } from "./sourceMonitor.ts";
import { editableProject, parseProject, publicDocument, registerProject, saveEdits } from "./projects.ts";
import { readSourceDraftCopies, saveSourceDraftCopy, validateSourceDraftCopy } from "./sourceDrafts.ts";
import { finishNavigationDraft, manuscriptSourceFiles, navigationDraftCopy, navigationDraftKey, prepareProjectNavigation, sourceFileTarget } from "../src/projectNavigation.ts";

function document(): ProjectDocument { return { project: { id: "paper", name: "Trial", folder: "paper", mainFile: "main.tex", createdAt: "now" }, files: ["main.tex", "sections/proof.tex"], rootFiles: ["main.tex"], revision: "before",
  nodes: [{ id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p0", "p1"] }, { id: "proof", title: "Proof", kind: "proof", depth: 1, paragraphIds: ["proof-p"] }],
  paragraphs: [{ id: "p0", nodeId: "intro", file: "main.tex", text: "The result $x\\leq 1$." }, { id: "p1", nodeId: "intro", file: "main.tex", text: "Independent prose." }, { id: "proof-p", nodeId: "proof", file: "sections/proof.tex", text: "By the bound." }] }; }
function initialState(): AppState { return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "editing", activeNodeId: "intro", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" }; }
function inserted(before: ProjectDocument) { const after = structuredClone(before); after.revision = "after";
  after.paragraphs = [{ ...before.paragraphs[0], id: "p0", text: "Inserted new prose." }, { ...before.paragraphs[0], id: "p1" }, { ...before.paragraphs[1], id: "p2" }, before.paragraphs[2]];
  after.nodes[0].paragraphIds = ["p0", "p1", "p2"]; return after; }

test("automatic save retry follows only exact unchanged passages, keeping double Enter and the caret", () => {
  const before = document(), after = inserted(before);
  const text = before.paragraphs[0].text + "\n\nNew paragraph.";
  const state = { ...initialState(), activeParagraphId: "p0", paragraphEdits: { p0: text }, draftRevision: before.revision };
  const next = automaticSourceRefresh(state, before, after, { paragraphId: "p0", offset: text.length })!;
  assert.equal(next.document, after); assert.deepEqual(next.state.paragraphEdits, { p1: text });
  assert.equal(next.state.draftRevision, after.revision);
  assert.deepEqual(next.caret, { paragraphId: "p1", nodeId: "intro", offset: text.length });
  assert.equal(next.state.notebookEntries, state.notebookEntries); assert.equal(next.state.attentionTasks, state.attentionTasks);
  assert.equal(automaticSourceRefresh(state, before, before), undefined);
  assert.equal(automaticSourceRefresh({ ...state, draftRevision: "unknown" }, before, after), undefined);
  const overlap = structuredClone(after); overlap.paragraphs[1].text = "Collaborator's changed passage.";
  assert.equal(automaticSourceRefresh(state, before, overlap), undefined);
  const duplicates = structuredClone(after); duplicates.paragraphs.push({ ...after.paragraphs[1], id: "duplicate" });
  assert.equal(automaticSourceRefresh(state, before, duplicates), undefined);
  const engine = structuredClone(after); engine.project.engine = "xelatex";
  assert.equal(automaticSourceRefresh(state, before, engine), undefined);
  assert.equal(automaticSourceRefresh({ ...state, sourceSaveContinuation: { document: before, ranges: [] } }, before, after), undefined);
});

test("a stale save automatically rebases a new paragraph without replacing concurrent independent text", async () => {
  const { workspace, folder, project, source } = await fixture();
  const before = publicDocument(await parseProject(workspace, project.id)), p = before.paragraphs[0];
  const text = p.text + "\n\nA new paragraph created with two Enters.";
  const state = { ...initialState(), activeParagraphId: p.id, paragraphEdits: { [p.id]: text }, draftRevision: before.revision };
  await writeFile(path.join(folder, "sections/proof.tex"), "Independent collaborator update.\n");
  await assert.rejects(saveEdits(workspace, project.id, state.paragraphEdits, state.draftRevision), /changed on disk/);
  const incoming = publicDocument(await parseProject(workspace, project.id));
  const next = automaticSourceRefresh(state, before, incoming)!; assert.ok(next);
  const saved = await saveEdits(workspace, project.id, next.state.paragraphEdits, next.state.draftRevision);
  assert.ok(saved.paragraphs.some(p => p.text === "A new paragraph created with two Enters."));
  assert.equal(await readFile(path.join(folder, "sections/proof.tex"), "utf8"), "Independent collaborator update.\n");
  assert.match(await readFile(path.join(folder, "main.tex"), "utf8"), /\n\nA new paragraph created with two Enters\./);
  assert.ok(source.includes("\\begin{document}"));
});

test("two editors of the same passage expose the incoming version and never save over it", async () => {
  const { workspace, folder, project } = await fixture();
  const before = publicDocument(await parseProject(workspace, project.id)), p = before.paragraphs[0];
  const own = { ...initialState(), paragraphEdits: { [p.id]: "My unfinished argument." }, draftRevision: before.revision };
  const incoming = publicDocument(await saveEdits(workspace, project.id, { [p.id]: "The other editor's saved argument." }, before.revision));
  assert.equal(automaticSourceRefresh(own, before, incoming), undefined);
  const plan = sourceRefreshPlan(before, incoming, own.paragraphEdits, own.draftRevision);
  assert.equal(plan.conflicts.length, 1); assert.equal(plan.conflicts[0].draftText, "My unfinished argument.");
  assert.equal(plan.conflicts[0].baseText, p.text);
  assert.equal(incoming.paragraphs.find(item => item.id === p.id)?.text, "The other editor's saved argument.");
  await assert.rejects(saveEdits(workspace, project.id, own.paragraphEdits, own.draftRevision), /changed on disk/);
  assert.ok((await readFile(path.join(folder, "main.tex"), "utf8")).includes("The other editor's saved argument."));
  assert.equal(own.paragraphEdits[p.id], "My unfinished argument.");
});

test("project navigation saves ordinary drafts and preserves orphan drafts before leaving", async () => {
  const before = document(), state = { ...initialState(), paragraphEdits: { lost: "Exact orphan $x$ draft", p0: "Revised paragraph" }, draftRevision: "before" };
  const events: string[] = [], copies: unknown[] = [];
  const key = await prepareProjectNavigation(before, () => state, async () => { events.push("save"); throw new Error("A passage moved on disk. Reload this paper before saving."); },
    () => { events.push("persist"); }, async copy => { events.push("archive"); copies.push(copy); });
  assert.deepEqual(events, ["persist", "save", "archive"]);
  assert.equal(key, navigationDraftKey(state));
  assert.equal(state.paragraphEdits.lost, "Exact orphan $x$ draft"); // Failed destination opening never clears it.
  assert.equal((copies[0] as SourceDraftCopy).drafts.length, 2);
  const done = finishNavigationDraft(state, key!);
  assert.deepEqual(done.paragraphEdits, {});
  assert.equal(done.attentionTasks, state.attentionTasks); assert.equal(done.notebookEntries, state.notebookEntries);
  assert.equal(await prepareProjectNavigation(before, () => state, async () => before, () => {}, async () => { assert.fail("Must not back up an ordinary successful save"); }), undefined);
});

test("navigation never clears a changed draft or navigates without successful preservation", async () => {
  const before = document(), state = { ...initialState(), paragraphEdits: { p0: "Draft" }, draftRevision: "before" };
  const savedKey = navigationDraftKey(state);
  await assert.rejects(() => prepareProjectNavigation(before, () => state, async () => { throw new Error("Stale source"); }, () => {}, async () => { throw new Error("Disk unavailable"); }), /Disk unavailable/);
  assert.equal(state.paragraphEdits.p0, "Draft");
  await assert.rejects(() => prepareProjectNavigation(before, () => state, async () => { throw new Error("Stale source"); }, () => {}, async () => { state.paragraphEdits.p0 = "Newer draft"; }), /draft changed/);
  assert.throws(() => finishNavigationDraft(state, savedKey), /draft changed/);
  const untrusted = navigationDraftCopy(before, { ...state, draftRevision: undefined, draftMainFile: "old-root.tex" })!;
  assert.equal(untrusted.rootFile, "old-root.tex"); assert.equal(untrusted.baseRevision, "unknown");
  assert.equal(untrusted.drafts[0].baseText, undefined); assert.equal(untrusted.drafts[0].reason, "unknown-base");
});

test("source-file navigation distinguishes included passages from roots and preamble-only files", () => {
  const before = { ...document(), sourceFiles: ["main.tex", "settings.tex", "sections/proof.tex", "references.bib"] };
  assert.deepEqual(manuscriptSourceFiles(before), ["main.tex", "settings.tex", "sections/proof.tex"]);
  assert.deepEqual(sourceFileTarget(before, "sections/proof.tex"), { nodeId: "proof", paragraphId: "proof-p" });
  assert.equal(sourceFileTarget(before, "settings.tex"), undefined);
  assert.equal(sourceFileTarget(before, "other.tex"), undefined);
});

test("an orphan draft is kept on disk before switching a real project and survives returning", async () => {
  const trials = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "navigation-"));
  for (const folder of ["one", "two"]) { await mkdir(path.join(workspace, folder)); await writeFile(path.join(workspace, folder, "main.tex"), `\\documentclass{article}\n\\begin{document}\n\\section{${folder}}\n${folder} body.\n\\end{document}`); }
  const oneProject = await registerProject(workspace, "one", "One"), twoProject = await registerProject(workspace, "two", "Two");
  const one = publicDocument(await editableProject(workspace, oneProject.id));
  const two = publicDocument(await editableProject(workspace, twoProject.id));
  const state = { ...initialState(), paragraphEdits: { "old-position": "Author’s unfinished edit." }, draftRevision: one.revision };
  const key = await prepareProjectNavigation(one, () => state,
    async () => publicDocument(await saveEdits(workspace, one.project.id, state.paragraphEdits, state.draftRevision)),
    () => {}, async copy => { await saveSourceDraftCopy(workspace, one.project.id, copy); });
  const { selectProject } = await import("./repositories.ts");
  assert.equal((await selectProject(workspace, two.project.id)).project.id, two.project.id);
  assert.deepEqual(finishNavigationDraft(state, key!).paragraphEdits, {});
  await selectProject(workspace, one.project.id);
  const copies = await readSourceDraftCopies(workspace, one.project.id);
  assert.equal(copies[0].drafts[0].draftText, "Author’s unfinished edit.");
  assert.equal(copies[0].rootFile, "main.tex");
  assert.match(await readFile(path.join(workspace, "one", "main.tex"), "utf8"), /one body\./);
  assert.match(await readFile(path.join(workspace, "two", "main.tex"), "utf8"), /two body\./);
});

test("refresh follows literal same-file identity, never an ordinal reused by inserted prose", () => {
  const before = document(); const after = inserted(before); const draft = "A clarified result $x\\leq 1$.";
  const plan = sourceRefreshPlan(before, after, { p0: draft, "proof-p": "Proof draft." }, "before");
  assert.equal(plan.mapping.get("p0")?.id, "p1"); assert.deepEqual(plan.rebasedEdits, { p1: draft, "proof-p": "Proof draft." }); assert.deepEqual(plan.conflicts, []);
  assert.equal(before.paragraphs[0].text, "The result $x\\leq 1$.");
});

test("changed, deleted, duplicate and wrong-file passages keep complete detached drafts", () => {
  const before = document(); const changed = structuredClone(before); changed.revision = "after"; changed.paragraphs[0].text = "Collaborator changed the result.";
  assert.equal(sourceRefreshPlan(before, changed, { p0: "Local draft" }, "before").conflicts[0].reason, "changed");
  changed.paragraphs.shift(); assert.equal(sourceRefreshPlan(before, changed, { p0: "Local draft" }, "before").conflicts[0].reason, "missing");
  const duplicate = inserted(before); duplicate.paragraphs.push({ ...before.paragraphs[0], id: "duplicate" });
  const plan = sourceRefreshPlan(before, duplicate, { p0: "Local draft" }, "before"); assert.equal(plan.conflicts[0].reason, "ambiguous"); assert.deepEqual(plan.rebasedEdits, {});
  duplicate.paragraphs = [{ ...before.paragraphs[0], file: "elsewhere.tex" }];
  assert.equal(sourceRefreshPlan(before, duplicate, { p0: "Local draft" }, "before").conflicts[0].reason, "missing");
});

test("duplicate text in an entirely unchanged file stays safe; deleting one copy is not relocation", () => {
  const before = document(); before.paragraphs[1].text = before.paragraphs[0].text;
  const after = structuredClone(before); after.revision = "after"; after.paragraphs[2].text = "Other file changed.";
  assert.deepEqual(sourceRefreshPlan(before, after, { p0: "Local draft" }, "before").rebasedEdits, { p0: "Local draft" });
  after.paragraphs.splice(1, 1);
  assert.equal(sourceRefreshPlan(before, after, { p0: "Local draft" }, "before").conflicts[0].reason, "ambiguous");
});

test("stale browser baselines cannot overwrite newer text even when an old ID survives", () => {
  const before = document(); const plan = sourceRefreshPlan(before, before, { p0: before.paragraphs[0].text, lost: "Orphan draft" }, "unknown-original");
  assert.deepEqual(plan.rebasedEdits, {}); assert.equal(plan.conflicts.length, 2); assert.ok(plan.conflicts.every((c) => c.reason === "unknown-base"));
  assert.equal(sourceRefreshPlan(before, before, { p0: "Undated browser draft" }).conflicts[0].reason, "unknown-base");
  assert.throws(() => sourceRefreshPlan(before, { ...before, project: { ...before.project, id: "other" } }, {}));
  assert.throws(() => sourceRefreshPlan(before, { ...before, project: { ...before.project, mainFile: "other.tex" } }, {}));
});

test("refresh preserves findings, queue, notebook and workspace while relocating safe editing links", () => {
  const before = document(); const after = inserted(before);
  const session = createRewriteSession({ paragraphId: "p0", nodeId: "intro", start: 0, end: 3, text: "The", paragraphText: before.paragraphs[0].text });
  const state = { ...initialState(), activeNodeId: "intro", activeParagraphId: "p0", focusedNodeId: "intro", hiddenNodeIds: [], paragraphEdits: { p0: "Local draft" }, draftRevision: "before", rewriteSessions: [session],
    blockWindow: { radius: 2, paragraphId: "p0" },
    turbo: { ...freshTurbo(), enabled: true, activeParagraphId: "p0", reviews: { p0: { fingerprint: "old", checkedAt: "now", reason: "next" as const } } } };
  state.attentionTasks.push({ id: "waiting", title: "Proof request", nodeId: "proof", paragraphId: "proof-p", route: "codex", status: "working", packet: "Original immutable request", replyDraft: "Author working notes", createdAt: "now", updatedAt: "now" });
  state.notebookEntries.push(newNotebookEntry(before, state));
  const refreshed = refreshSourceState(state, before, after);
  assert.equal(refreshed.activeParagraphId, "p1"); assert.equal(refreshed.focusedNodeId, "intro"); assert.equal(refreshed.rewriteSessions[0].paragraphId, "p1"); assert.equal(refreshed.turbo.activeParagraphId, "p1");
  assert.deepEqual(refreshed.blockWindow, { radius: 2, paragraphId: "p1" });
  assert.deepEqual(refreshed.attentionTasks, state.attentionTasks); assert.deepEqual(refreshed.notebookEntries, state.notebookEntries); assert.deepEqual(refreshed.suggestions, state.suggestions);
  assert.equal(refreshed.attentionTasks, state.attentionTasks); assert.equal(refreshed.notebookEntries, state.notebookEntries);
  const bookmarked = refreshSourceState({ ...state, handoffResume: { destination: "manuscript", activeNodeId: "intro", activeParagraphId: "p0", lens: "paper", previewMode: "hidden", turbo: state.turbo } }, before, after);
  assert.equal(bookmarked.handoffResume?.activeParagraphId, "p1"); assert.equal(bookmarked.handoffResume?.turbo.activeParagraphId, "p1"); assert.ok(bookmarked.handoffResume?.turbo.reviews.p1);
  after.paragraphs[1].text = "Changed original.";
  const uncertain = refreshSourceState(state, before, after); assert.equal(uncertain.turbo.enabled, false); assert.match(uncertain.rewriteSessions[0].paragraphId, /^unlinked:/); assert.equal(uncertain.rewriteSessions[0].status, "stale");
});

test("Notebook links follow unchanged text across source refresh, withholding uncertain duplicate/deleted locations", () => {
  const before = document(); const after = inserted(before); const source = { paragraphId: "p0", file: "main.tex", paragraphText: before.paragraphs[0].text, revision: before.revision };
  assert.equal(locateSavedPassage(source, before, {})?.id, "p0"); assert.equal(locateSavedPassage(source, after, {})?.id, "p1");
  after.paragraphs.push({ ...before.paragraphs[0], id: "duplicate" }); assert.equal(locateSavedPassage(source, after, {}), undefined);
  after.paragraphs.pop(); assert.equal(locateSavedPassage({ ...source, duplicateAtCapture: true }, after, {}), undefined, "removing another identical copy cannot identify the survivor");
  after.paragraphs = [{ ...before.paragraphs[0], text: "Completely different source." }]; assert.equal(locateSavedPassage(source, after, {}), undefined);
  before.paragraphs[1].text = before.paragraphs[0].text;
  const captured = newNotebookEntry(before, initialState(), { paragraphId: "p0", nodeId: "intro", text: "The", start: 0, end: 3, x: 0, y: 0 });
  assert.equal(captured.source?.duplicateAtCapture, true);
});

test("paragraphs lacking optional file metadata cannot confuse a missing position with a real match", () => {
  const before = document(); delete before.paragraphs[0].file;
  const after = structuredClone(before); after.revision = "after"; after.paragraphs.shift();
  const plan = sourceRefreshPlan(before, after, { p0: "Kept draft" }, before.revision);
  assert.equal(plan.mapping.has("p0"), false); assert.equal(plan.conflicts[0].reason, "missing");
});

async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "refresh-check-")); const folder = path.join(workspace, "paper"); await mkdir(path.join(folder, "sections"), { recursive: true });
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{Result}\nThe result $x\\leq 1$.\n\nIndependent prose.\n\\input{sections/proof}\n\\end{document}\n";
  await writeFile(path.join(folder, "main.tex"), source); await writeFile(path.join(folder, "sections/proof.tex"), "Proof prose.\n");
  const project = await registerProject(workspace, "paper"); return { workspace, folder, project, source };
}

test("inserting a duplicate section keeps both headings and follows its prose instead of the empty section", async () => {
  const { workspace, folder, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const submitted = { [p.id]: `\\section{Result}\n${p.text}` };
  const after = await saveEdits(workspace, project.id, submitted, before.revision);
  const state = { ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, focusedNodeId: p.nodeId, paragraphEdits: submitted };
  const result = acknowledgeSave(state, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement, { paragraphId: p.id, offset: submitted[p.id].length });
  const moved = after.paragraphs.find(item => item.text === p.text)!;
  assert.notEqual(moved.nodeId, p.nodeId); assert.ok(after.nodes.find(n => n.id === p.nodeId)?.paragraphIds.every(id => after.paragraphs.find(item => item.id === id)?.emptySource));
  assert.equal(result.state.focusedNodeId, moved.nodeId); assert.equal(result.state.activeParagraphId, moved.id);
  assert.deepEqual(result.caret, { paragraphId: moved.id, nodeId: moved.nodeId, offset: p.text.length }); assert.deepEqual(result.state.paragraphEdits, {});
  assert.equal((await readFile(path.join(folder, "main.tex"), "utf8")).match(/\\section\{Result\}/g)?.length, 2);
  const included = before.paragraphs.find(item => item.file === "sections/proof.tex")!;
  assert.equal(after.saveAcknowledgement?.paragraphMap[included.id].length, 1, "included files retain exact position acknowledgements");
});

test("save acknowledgement relocates the caret across a new heading and blank paragraph breaks", async () => {
  for (const separator of ["\n\\section{New}\n", "\n\n"]) {
    const { workspace, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
    const text = `First prose.${separator}Second prose.`, submitted = { [p.id]: text };
    const after = await saveEdits(workspace, project.id, submitted, before.revision);
    const result = acknowledgeSave({ ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, focusedNodeId: p.nodeId, blockWindow: { radius: 0, paragraphId: p.id }, paragraphEdits: submitted }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement, { paragraphId: p.id, offset: text.length - 2 });
    const second = after.paragraphs.find(item => item.text === "Second prose.")!;
    assert.equal(result.caret?.paragraphId, second.id); assert.equal(result.caret?.offset, second.text.length - 2);
    assert.equal(result.state.focusedNodeId, second.nodeId); assert.equal(result.deferredDrafts, 0);
    assert.deepEqual(result.state.blockWindow, { radius: 0, paragraphId: second.id }, "a one-block window keeps the caret visible across restructuring");
  }
});

test("typing during a structural save rebases only new prose without duplicating the heading", async () => {
  const { workspace, folder, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const submitted = { [p.id]: `First.\n\\section{New}\nSecond.` }, newer = submitted[p.id] + " More.";
  const after = await saveEdits(workspace, project.id, submitted, before.revision);
  const result = acknowledgeSave({ ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, focusedNodeId: p.nodeId, paragraphEdits: { [p.id]: newer } }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement, { paragraphId: p.id, offset: newer.length });
  const second = after.paragraphs.find(item => item.text === "Second.")!;
  assert.deepEqual(result.state.paragraphEdits, { [second.id]: "Second. More." }); assert.equal(result.caret?.offset, "Second. More.".length);
  const final = await saveEdits(workspace, project.id, result.state.paragraphEdits, after.revision);
  assert.ok(final.paragraphs.some(item => item.text === "Second. More."));
  assert.equal((await readFile(path.join(folder, "main.tex"), "utf8")).match(/\\section\{New\}/g)?.length, 1);
});

test("ambiguous concurrent structural typing is retained separately, not replayed into a reused ordinal", async () => {
  const { workspace, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const submitted = { [p.id]: "First.\n\\section{New}\nSecond." }, newer = submitted[p.id].replace("{New}", "{New title}");
  const after = await saveEdits(workspace, project.id, submitted, before.revision);
  const result = acknowledgeSave({ ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, paragraphEdits: { [p.id]: newer } }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement, { paragraphId: p.id, offset: newer.length });
  assert.equal(result.deferredDrafts, 1); assert.deepEqual(result.state.paragraphEdits, { [`unlinked:save:${p.id}`]: newer }); assert.equal(result.caret, undefined);
  await assert.rejects(saveEdits(workspace, project.id, result.state.paragraphEdits, after.revision), /passage moved/);
});

test("position acknowledgements distinguish repeated wording and retain captured comments and requests", async () => {
  const { workspace, folder, project } = await fixture(); await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Result}\nSame prose.\n\nSame prose.\n\\end{document}\n");
  const before = await parseProject(workspace, project.id), p = before.paragraphs[0], originalSecond = before.paragraphs[1];
  const submitted = { [p.id]: "New prose.\n\nSame prose." }, after = await saveEdits(workspace, project.id, submitted, before.revision);
  const state = { ...initialState(), activeNodeId: originalSecond.nodeId, activeParagraphId: originalSecond.id, paragraphEdits: submitted };
  state.attentionTasks.push({ id: "comment", title: "Human comment", route: "codex", nodeId: p.nodeId, paragraphId: p.id, status: "queued", packet: "Keep this original snapshot.", createdAt: "now", updatedAt: "now" });
  state.notebookEntries.push(newNotebookEntry(publicDocument(before), state));
  const result = acknowledgeSave(state, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement);
  assert.equal(result.state.activeParagraphId, after.paragraphs[2].id, "second original copy stays the second original copy, not a reused ID");
  assert.equal(result.state.attentionTasks, state.attentionTasks); assert.equal(result.state.notebookEntries, state.notebookEntries); assert.equal(result.state.attentionTasks[0].status, "queued");
});

test("unconfirmed save versions do not clear drafts or alter review state", () => {
  const before = document(), after = inserted(before), state = { ...initialState(), paragraphEdits: { p0: "Kept draft." } };
  assert.throws(() => acknowledgeSave(state, before, after, state.paragraphEdits), /could not be confirmed/);
  assert.throws(() => acknowledgeSave(state, before, after, state.paragraphEdits, { baseRevision: "wrong", savedRevision: after.revision!, paragraphMap: {}, sourceRanges: [] }), /could not be confirmed/);
  assert.deepEqual(state.paragraphEdits, { p0: "Kept draft." });
});

test("turbo checks do not silently attach to changed prose under reused paragraph IDs", async () => {
  const { workspace, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0], next = before.paragraphs[1];
  const submitted = { [p.id]: "Inserted.\n\n" + p.text }, after = await saveEdits(workspace, project.id, submitted, before.revision);
  const review = { fingerprint: "captured", checkedAt: "now", reason: "next" as const };
  const state = { ...initialState(), activeNodeId: next.nodeId, activeParagraphId: next.id, paragraphEdits: submitted, turbo: { ...freshTurbo(), enabled: true, activeParagraphId: next.id, reviews: { [p.id]: review, [next.id]: review }, history: [{ paragraphId: next.id }] } };
  const result = acknowledgeSave(state, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement);
  assert.equal(result.state.turbo.activeParagraphId, after.paragraphs[2].id);
  assert.equal(result.state.turbo.reviews[after.paragraphs[0].id], undefined); assert.deepEqual(result.state.turbo.reviews[after.paragraphs[2].id], review);
  assert.equal(result.state.turbo.history[0].paragraphId, after.paragraphs[2].id);
});

test("ordinary paragraph restructuring, technical environments and included-file edits use the same exact save mapping", async () => {
  const replacements = [
    "Expanded wording with $x^2$ and \\emph{emphasis}.",
    "Leading prose.\n\nA new paragraph.\n\nAnother paragraph.",
    "\\subsection*{New detail}\nProse under an unnumbered heading.",
    "\\begin{proof}\nA new argument.\n\\end{proof}\nFollowing prose.",
    "A calculation follows.\n\\[x^2=1\\]\nIts interpretation.",
    "\\begin{itemize}\n\\item First item.\n\\item Second item.\n\\end{itemize}",
    "",
  ];
  for (const text of replacements) {
    const { workspace, folder, project, source } = await fixture(); const before = await parseProject(workspace, project.id), first = before.paragraphs[0];
    const included = before.paragraphs.find(p => p.file === "sections/proof.tex")!;
    const submitted = { [first.id]: text, [included.id]: "Included prose.\n\nNew included paragraph." };
    const after = await saveEdits(workspace, project.id, submitted, before.revision);
    const result = acknowledgeSave({ ...initialState(), activeNodeId: included.nodeId, activeParagraphId: included.id, paragraphEdits: submitted }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement, { paragraphId: included.id, offset: submitted[included.id].length });
    assert.deepEqual(result.state.paragraphEdits, {}); assert.equal(result.deferredDrafts, 0);
    assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source.replace(first.text, text), "source is saved verbatim, not reconstructed from rendering");
    assert.equal(await readFile(path.join(folder, "sections/proof.tex"), "utf8"), submitted[included.id] + "\n");
    assert.equal(after.paragraphs.find(p => p.id === result.caret?.paragraphId)?.text, "New included paragraph.");
  }
});

test("half-typed heading and input commands remain editable and become structural when completed", async () => {
  for (const command of ["\\section{New", "\\input{sections/proof"]) {
    const { workspace, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
    const text = command + "\n" + p.text, submitted = { [p.id]: text };
    const after = await saveEdits(workspace, project.id, submitted, before.revision);
    // An unclosed command argument now deliberately keeps later blank lines
    // inside the same editable block until its brace closes.
    assert.ok(after.paragraphs.some(item => item.text.startsWith(text) && item.text.includes("Independent prose.")), "unfinished groups retain all later source in one editable block");
    assert.equal(after.sources[before.project.mainFile], before.sources[before.project.mainFile].replace(p.text, text), "grouping never changes saved source characters");
    const result = acknowledgeSave({ ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, paragraphEdits: submitted }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement);
    const active = after.paragraphs.find(item => item.id === result.state.activeParagraphId)!;
    const completed = await saveEdits(workspace, project.id, { [active.id]: active.text.replace(command, command + "}") }, after.revision);
    assert.ok(completed.paragraphs.some(item => item.text === p.text));
    assert.ok(completed.paragraphs.some(item => item.text === "Independent prose."));
  }
});

test("any newer structural typing continues in exact source regions, across reload, without a detached draft", async () => {
  const { workspace, folder, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const submitted = { [p.id]: "First.\n\\section{New}\nSecond." }, newer = submitted[p.id].replace("{New}", "{Revised heading}").replace("First.", "First revised.");
  const after = await saveEdits(workspace, project.id, submitted, before.revision);
  const state = { ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, focusedNodeId: p.nodeId, paragraphEdits: { [p.id]: newer } };
  const first = reconcileEditorSave(state, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement!, { paragraphId: p.id, offset: newer.length });
  assert.equal(first.deferredDrafts, 0); assert.equal(first.state.activeParagraphId, p.id); assert.equal(first.state.sourceSaveContinuation?.document.revision, after.revision);
  const reloaded: AppState = JSON.parse(JSON.stringify(first.state)); const view = reloaded.sourceSaveContinuation!.document;
  const settled = await saveEdits(workspace, project.id, reloaded.paragraphEdits, view.revision, reloaded.sourceSaveContinuation!.ranges);
  const final = reconcileEditorSave(reloaded, view, publicDocument(settled), reloaded.paragraphEdits, settled.saveAcknowledgement!, { paragraphId: p.id, offset: newer.length });
  assert.deepEqual(final.state.paragraphEdits, {}); assert.equal(final.state.sourceSaveContinuation, undefined); assert.equal(final.deferredDrafts, 0);
  assert.ok(settled.nodes.some(n => n.title === "Revised heading")); assert.ok(settled.paragraphs.some(item => item.text === "First revised."));
  const source = await readFile(path.join(folder, "main.tex"), "utf8"); assert.ok(source.includes(newer)); assert.equal(source.match(/\\section\{Revised heading\}/g)?.length, 1);
});

test("a missing input affects only its snippet, not saving or rendering neighboring blocks", async () => {
  const { workspace, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const submitted = { [p.id]: "Before the snippet.\n\\input{sections/not-created-yet}\nAfter the snippet." };
  const after = await saveEdits(workspace, project.id, submitted, before.revision);
  const bad = after.paragraphs.find(item => item.renderIssue)!; assert.equal(bad.text, "\\input{sections/not-created-yet}");
  assert.ok(after.paragraphs.some(item => item.text === "After the snippet." && !item.renderIssue)); assert.ok(after.paragraphs.some(item => item.text === "Independent prose." && !item.renderIssue));
  const result = reconcileEditorSave({ ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, paragraphEdits: submitted }, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement!);
  assert.deepEqual(result.state.paragraphEdits, {}); assert.equal(result.deferredDrafts, 0);
  const focused = focusedDocument(after, { focusNodeId: p.nodeId }); assert.ok(focused.includes("Before the snippet.")); assert.ok(focused.includes("After the snippet."));
  assert.ok(!focused.includes("\\input{sections/not-created-yet}")); assert.ok(focused.includes("[Unrendered snippet.")); assert.equal(focusedSourceSnippets(after, { focusNodeId: p.nodeId }).length, 1);
  const repaired = await saveEdits(workspace, project.id, { [bad.id]: "The snippet is replaced by prose." }, after.revision);
  assert.ok(repaired.paragraphs.every(item => !item.renderIssue));
});

test("even an unfinished root remains saved, reloadable and repairable with its caret in exact source", async () => {
  const { workspace, folder, project } = await fixture();
  const text = "\\begin{document}\nAn unfinished root.";
  await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n" + text);
  const raw = await editableProject(workspace, project.id); assert.ok(raw.structureIssue); const main = raw.paragraphs.find(item => item.file === "main.tex")!;
  assert.ok(main.text.includes(text)); assert.ok((await editableProject(workspace, project.id)).paragraphs.some(item => item.text === main.text));
  const submitted = { [main.id]: main.text + "\n\\end{document}\n" };
  const repaired = await saveEdits(workspace, project.id, submitted, raw.revision);
  const result = reconcileEditorSave({ ...initialState(), activeNodeId: main.nodeId, activeParagraphId: main.id, paragraphEdits: submitted }, publicDocument(raw), publicDocument(repaired), submitted, repaired.saveAcknowledgement!, { paragraphId: main.id, offset: submitted[main.id].indexOf("root.") + 5 });
  assert.equal(repaired.structureIssue, undefined); assert.deepEqual(result.state.paragraphEdits, {}); assert.ok(result.caret); assert.equal(result.deferredDrafts, 0);
});

test("raw region continuation rejects stale, overlapping, forged and out-of-project ranges without writes", async () => {
  const { workspace, folder, project } = await fixture(); const before = await parseProject(workspace, project.id), p = before.paragraphs[0];
  const first = await saveEdits(workspace, project.id, { [p.id]: "\\section{New}\nSaved." }, before.revision), ranges = first.saveAcknowledgement!.sourceRanges;
  const source = await readFile(path.join(folder, "main.tex"), "utf8");
  for (const forged of [[{ ...ranges[0], file: "../../escape.tex" }], [{ ...ranges[0], text: "Different text" }], [ranges[0], { ...ranges[0], paragraphId: "other" }]]) {
    await assert.rejects(saveEdits(workspace, project.id, {}, first.revision, forged));
    assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source);
  }
  await assert.rejects(saveEdits(workspace, project.id, { [p.id]: "Do not overwrite." }, before.revision, ranges), /source changed/);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source);
});

test("deleting the last paragraph leaves an editable insertion point, not a dead empty section", async () => {
  const { workspace, folder, project } = await fixture(); await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Empty after deleting}\nOnly paragraph.\n\\end{document}\n");
  const before = await editableProject(workspace, project.id), first = before.paragraphs[0];
  const empty = await saveEdits(workspace, project.id, { [first.id]: "" }, before.revision);
  const insertion = empty.paragraphs.find(p => p.emptySource)!; assert.ok(insertion); assert.equal(insertion.text, "");
  const restored = await saveEdits(workspace, project.id, { [insertion.id]: "Replacement paragraph." }, empty.revision);
  assert.ok(restored.paragraphs.some(p => p.text === "Replacement paragraph." && !p.emptySource));
  assert.ok((await readFile(path.join(folder, "main.tex"), "utf8")).includes("Replacement paragraph."));
});

test("empty section insertion keeps source line boundaries and exact ownership for continued typing", async () => {
  const { workspace, folder, project } = await fixture(); await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{First}\n\\section{Second}\nExisting prose.\n\\end{document}\n");
  const before = await editableProject(workspace, project.id), p = before.paragraphs.find(p => p.emptySource)!;
  const submitted = { [p.id]: "New prose." }, after = await saveEdits(workspace, project.id, submitted, before.revision);
  assert.ok((await readFile(path.join(folder, "main.tex"), "utf8")).includes("New prose.\n\\section{Second}"));
  const current = { ...initialState(), activeNodeId: p.nodeId, activeParagraphId: p.id, paragraphEdits: { [p.id]: "New prose. More." } };
  const pending = reconcileEditorSave(current, publicDocument(before), publicDocument(after), submitted, after.saveAcknowledgement!);
  const final = await saveEdits(workspace, project.id, pending.state.paragraphEdits, after.revision, pending.state.sourceSaveContinuation!.ranges);
  assert.ok(final.paragraphs.some(p => p.text === "New prose. More."));
  assert.ok((await readFile(path.join(folder, "main.tex"), "utf8")).includes("New prose. More.\n\\section{Second}"));
});

test("draft copies are immutable, project-scoped, excluded from source revision and recoverable after reload", async () => {
  const { workspace, folder, project, source } = await fixture(); const before = await parseProject(workspace, project.id);
  const data: SourceDraftCopy = { version: 1, id: "client-cannot-choose", createdAt: "client-cannot-date", projectId: project.id, rootFile: "main.tex", baseRevision: before.revision, incomingRevision: "incoming",
    drafts: [{ paragraphId: before.paragraphs[0].id, file: "main.tex", baseText: before.paragraphs[0].text, draftText: "An unfinished $x\\leq 1$ correction.", reason: "changed" }] };
  const copy = await saveSourceDraftCopy(workspace, project.id, data); const another = await saveSourceDraftCopy(workspace, project.id, data);
  assert.notEqual(copy.id, data.id); assert.notEqual(copy.id, another.id);
  assert.deepEqual((await readSourceDraftCopies(workspace, project.id)).find((c) => c.id === copy.id), copy);
  assert.equal((await parseProject(workspace, project.id)).revision, before.revision); assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source);
  await assert.rejects(saveSourceDraftCopy(workspace, project.id, { ...data, projectId: "other" }));
  assert.throws(() => validateSourceDraftCopy({ ...data, drafts: [{ ...data.drafts[0], draftText: "x".repeat(1_000_001) }] }));
  assert.throws(() => validateSourceDraftCopy({ ...data, drafts: [data.drafts[0], data.drafts[0]] }));
});

test("source monitor detects included files, new bibliography/assets and leaves broken papers readable only when repaired", async () => {
  const { workspace, folder, project, source } = await fixture(); let time = 0; const monitor = createSourceMonitor(() => time);
  const first = await monitor(workspace, project.id); assert.equal(first.revision, (await parseProject(workspace, project.id)).revision);
  assert.deepEqual(await monitor(workspace, project.id), first);
  await writeFile(path.join(folder, "sections/proof.tex"), "A revised proof.\n");
  const revised = await monitor(workspace, project.id); assert.notEqual(revised.revision, first.revision);
  await writeFile(path.join(folder, "refs.bib"), "@article{trial,title={A reference}}\n");
  const bibliography = await monitor(workspace, project.id); assert.notEqual(bibliography.revision, revised.revision);
  await writeFile(path.join(folder, "figure.dat"), "new figure"); assert.notEqual((await monitor(workspace, project.id)).revision, bibliography.revision);
  time = 61_000; assert.equal((await monitor(workspace, project.id)).revision, (await parseProject(workspace, project.id)).revision);
  await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\nTemporary incomplete write.");
  assert.notEqual((await monitor(workspace, project.id)).revision, first.revision); await assert.rejects(parseProject(workspace, project.id));
  await writeFile(path.join(folder, "main.tex"), source); assert.ok((await parseProject(workspace, project.id)).paragraphs.length);
});

test("real multi-file draft rebase saves only the intended shifted paragraph and stale guards stay active", async () => {
  const { workspace, folder, project, source } = await fixture(); const before = await parseProject(workspace, project.id); const first = before.paragraphs[0];
  const changed = source.replace("The result", "New collaborator prose.\n\nThe result"); await writeFile(path.join(folder, "main.tex"), changed);
  const after = await parseProject(workspace, project.id); const plan = sourceRefreshPlan(before, after, { [first.id]: "Clarified $x\\leq 1$." }, before.revision);
  await assert.rejects(saveEdits(workspace, project.id, { [first.id]: "Wrong position." }, before.revision));
  const result = await saveEdits(workspace, project.id, plan.rebasedEdits, after.revision);
  assert.equal(result.paragraphs[0].text, "New collaborator prose."); assert.equal(result.paragraphs[1].text, "Clarified $x\\leq 1$.");
  assert.equal(await readFile(path.join(folder, "sections/proof.tex"), "utf8"), "Proof prose.\n");
});

test("source draft storage refuses junction escapes without changing manuscript source", async () => {
  const { workspace, folder, project, source } = await fixture(); const outside = path.join(workspace, "outside"); await mkdir(outside);
  await symlink(outside, path.join(folder, ".paperfocus"), "junction");
  await assert.rejects(readSourceDraftCopies(workspace, project.id), /symbolic links|junctions/);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source);
});

test("source HTTP checks are read-only; recovery rejects foreign writes and preserves exact draft text", async () => {
  const { workspace, folder, project } = await fixture(); let handler: any;
  const plugin = latexPlugin(workspace); (plugin.configureServer as any)({ middlewares: { use: (callback: any) => { handler = callback; } } });
  const server = createServer((req, res) => { void handler(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${origin}/api/paperfocus/source-status?projectId=${project.id}`); assert.equal(response.status, 200); const status = await response.json() as any;
    assert.equal(status.revision, (await parseProject(workspace, project.id)).revision);
    assert.equal((await fetch(`${origin}/api/paperfocus/source-status?projectId=${project.id}`, { method: "POST" })).status, 405);
    const data = { version: 1, projectId: project.id, rootFile: "main.tex", baseRevision: status.revision, incomingRevision: "incoming", drafts: [{ paragraphId: "draft", draftText: "Exact $x  \\leq 1$ draft.\n", reason: "changed" }] };
    assert.equal((await fetch(`${origin}/api/paperfocus/source-drafts`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://foreign.invalid" }, body: JSON.stringify(data) })).status, 403);
    const saved = await fetch(`${origin}/api/paperfocus/source-drafts`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(data) }); assert.equal(saved.status, 200);
    const copies = await (await fetch(`${origin}/api/paperfocus/source-drafts?projectId=${project.id}`)).json() as SourceDraftCopy[]; assert.equal(copies[0].drafts[0].draftText, data.drafts[0].draftText);
    assert.equal((await parseProject(workspace, project.id)).revision, status.revision);
    const before = await editableProject(workspace, project.id), p = before.paragraphs[0];
    const partial = await saveEdits(workspace, project.id, { [p.id]: "Before.\n\\input{missing-file}\nAfter." }, before.revision);
    const build = path.join(workspace, ".paperfocus", "project-data", project.id, "build"); await mkdir(build, { recursive: true });
    await writeFile(path.join(build, "last-compile.json"), JSON.stringify({ mode: "focus", success: true, sourceRevision: partial.revision, mainFile: project.mainFile, engine: partial.project.engine, compiledAt: "now", diagnostics: [{ code: "focus_source_snippets", severity: "info", title: "1 source snippet" }] }));
    const cached = await fetch(`${origin}/api/paperfocus/status?projectId=${project.id}`); assert.equal(cached.status, 200);
    const restored = await cached.json() as any; assert.equal(restored.success, true); assert.equal(restored.stale, false); assert.equal(restored.fullVerified, false); assert.equal(restored.diagnostics[0].code, "focus_source_snippets");
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
