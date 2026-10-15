import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { createPaperProject, addProjectFiles } from "./projectFiles.ts";
import { createManuscriptVersion, versionSources } from "./manuscriptVersions.ts";
import { transferNotebook } from "./notebookTransfer.ts";
import { getProject, parseProject, saveEdits } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import { notebookAttentionTasks } from "../src/notebookSync.ts";
import { manuscriptPurpose, manuscriptWritingPolicy, newManuscript, notebookForManuscript, nextManuscriptVersion } from "../src/manuscripts.ts";
import { setManuscriptPurpose } from "./manuscriptPurpose.ts";
import { createSourceMonitor } from "./sourceMonitor.ts";
import { notebookPacket } from "../src/notebook.ts";
import { externalStudyPacket, studyPacket } from "../src/study.ts";
import { experimentAgentInstructions } from "../src/researchInstructions.ts";
import { studyState, makeStudyTurn } from "../src/study.ts";
import type { AppState, NotebookEntry } from "../src/types.ts";
import { versionsCommand, versionsOptions } from "../scripts/awVersions.ts";
import { researchCommand } from "../scripts/awResearch.ts";
import { latexMiddleware } from "./latexPlugin.ts";
import { collaboratorExport } from "./collaboratorExport.ts";
import { captureTaskSource } from "../src/taskSource.ts";
import { readWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { writingLocks, makeWritingRequest, receiveWritingReply, placeWritingDraft, acceptWritingParagraph } from "../src/writing.ts";
import { emptyWorkbench } from "../src/workbench.ts";

const upload = (file: string, text: string) => ({ path: file, data: Buffer.from(text).toString("base64") });
async function fixture() {
  const trials = path.resolve(".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "manuscript-versions-"));
  const main = "\\documentclass{article}\n\\input{macros}\n\\begin{document}\n\\section{Start}\nOriginal paragraph.\n\n\\input{sections/body}\n\\bibliography{refs}\n\\end{document}\n";
  const project = await createPaperProject(workspace, "Versions trial", [upload("main.tex", main), upload("macros.tex", "\\newcommand{\\R}{\\mathbb{R}}\n"), upload("sections/body.tex", "\\section{Body}\nAn included paragraph.\n"), upload("refs.bib", "@article{x, title={Synthetic fixture}}")]);
  const parsed = await parseProject(workspace, project.id);
  // These fixtures deliberately exercise publication review; imports default to notes.
  const { document } = await setManuscriptPurpose(workspace, { projectId: project.id, mainFile: "main.tex", file: "main.tex", revision: parsed.revision, expectedPurpose: "notes", purpose: "publication" });
  const p = document.paragraphs.find(p => p.text.includes("Original paragraph"))!;
  const entry: NotebookEntry = { id: "original-entry", title: "Working question", question: "Next step?", notes: "Human notes", reply: "Saved reasoning", proposal: "", status: "open", route: "codex", effort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), handoffs: [{ id: "waiting", packet: "Pending external request", createdAt: new Date().toISOString() }], appliedChanges: [],
    source: { rootFile: "main.tex", paragraphId: p.id, nodeId: p.nodeId, nodeTitle: "Start", file: p.file, revision: document.revision, paragraphText: p.text, start: 0, end: p.text.length, excerpt: p.text } };
  const turn = makeStudyTurn(entry, document); entry.study = { ...studyState(entry), turns: [turn], activeTurnId: turn.id };
  const notes = await writeNotebook(workspace, project.id, 0, [entry]);
  const notebook = newExperimentNotebook(), cell = newExperimentCell("code"); cell.id = "stable-cell"; cell.source = "# Synthetic saved display; not executed by this trial";
  cell.outputs = [{ output_type: "stream", name: "stdout", text: "Synthetic result fixture" }]; notebook.cells.push(cell); notebook.metadata.custom = "Keep unknown metadata";
  const experiments = await writeExperiments(workspace, project.id, entry.id, "", notebook);
  return { workspace, project: document.project, document, entry, notes, experiments, main, root: (await getProject(workspace, project.id)).root };
}
const request = (f: Awaited<ReturnType<typeof fixture>>, file = "main-v2.tex") => ({ projectId: f.project.id, mainFile: "main.tex", revision: f.document.revision, notebookRevision: f.notes.revision, file });

async function transferFixture() {
  const f = await fixture();
  await addProjectFiles(f.workspace, f.project.id, f.document.revision, "main.tex", [upload("other.tex", newManuscript("other.tex", "Other notes", "notes").source)]);
  const document = await parseProject(f.workspace, f.project.id);
  f.entry.manuscriptFile = "main.tex"; f.entry.handoffs = [];
  f.entry.study!.turns = f.entry.study!.turns.map(turn => ({ ...turn, closed: true, status: "ready", reply: "Synthetic saved response" }));
  const notes = await writeNotebook(f.workspace, f.project.id, f.notes.revision, [f.entry]);
  const input = { projectId: f.project.id, mainFile: "main.tex", revision: document.revision, notebookRevision: notes.revision, entryIds: [f.entry.id], targetFile: "other.tex", mode: "copy" as const };
  return { ...f, entry: (await readNotebook(f.workspace, f.project.id)).entries[0], document, notes, input };
}

test("notebook copy preserves complete independent evidence and original passage links without source changes", async () => {
  const f = await transferFixture();
  const preview = await transferNotebook(f.workspace, { ...f.input, preview: true });
  assert.equal(preview.preview, true); assert.equal((await readNotebook(f.workspace, f.project.id)).revision, f.notes.revision);
  const result = await transferNotebook(f.workspace, f.input);
  const original = result.notebook!.entries.find(entry => entry.id === f.entry.id)!, copy = result.notebook!.entries.find(entry => entry.id !== f.entry.id)!;
  assert.deepEqual(original, f.entry); assert.equal(copy.manuscriptFile, "other.tex"); assert.deepEqual(copy.source, f.entry.source);
  assert.equal(copy.continuedFrom?.entryId, f.entry.id); assert.notEqual(copy.experimentNotebookId, f.entry.id);
  assert.notEqual(copy.study!.turns[0].id, f.entry.study!.turns[0].id); assert.equal(copy.study!.turns[0].closed, true);
  const saved = await readExperiments(f.workspace, f.project.id, copy.experimentNotebookId!);
  assert.deepEqual(saved.notebook.cells, f.experiments.notebook.cells); assert.equal(saved.notebook.metadata.custom, "Keep unknown metadata");
  assert.equal((await parseProject(f.workspace, f.project.id)).revision, f.document.revision);
});

test("notebook move retains ownership and source; stale, missing, duplicate and waiting transfers refuse", async () => {
  const f = await transferFixture();
  for (const patch of [{ notebookRevision: 0 }, { revision: "0".repeat(64) }, { targetFile: "sections/body.tex" }, { entryIds: ["missing"] }, { entryIds: [f.entry.id, f.entry.id] }]) await assert.rejects(transferNotebook(f.workspace, { ...f.input, ...patch }));
  const result = await transferNotebook(f.workspace, { ...f.input, mode: "move" });
  assert.equal(result.notebook!.entries.length, 1);
  assert.deepEqual(result.notebook!.entries[0], { ...f.entry, manuscriptFile: "other.tex", updatedAt: result.notebook!.entries[0].updatedAt });
  assert.equal((await readExperiments(f.workspace, f.project.id, f.entry.id)).revision, f.experiments.revision);
  const waiting = { ...result.notebook!.entries[0], handoffs: [{ id: "pending", packet: "Pending", createdAt: new Date().toISOString() }] };
  const notes = await writeNotebook(f.workspace, f.project.id, result.notebook!.revision, [waiting]);
  await assert.rejects(transferNotebook(f.workspace, { ...f.input, mode: "move", targetFile: "main.tex", notebookRevision: notes.revision }), /waiting requests/);
});

test("transfer CLI previews and commits through an isolated service, rejects foreign origins and stale reuse", async () => {
  const f = await transferFixture(), middleware = latexMiddleware(f.workspace);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const scope = ["--workspace", f.workspace, "--project", f.project.id, "--url", origin];
    const inspected = await versionsCommand(["inspect", ...scope]);
    assert.equal(inspected.transferSupported, true); assert.match(inspected.writingPolicy, /Publication draft/);
    assert.equal(inspected.conversations[0].id, f.entry.id);
    const args = ["transfer", ...scope, "--root", "main.tex", "--revision", inspected.sourceRevision, "--notebook-revision", String(inspected.notebookRevision), "--entries", f.entry.id, "--target", "other.tex", "--mode", "copy"];
    assert.equal((await versionsCommand(args)).preview, true);
    const copied = await versionsCommand([...args, "--commit"]); assert.equal(copied.notebook.entries.length, 2);
    await assert.rejects(versionsCommand([...args, "--commit"]), /changed/);
    assert.equal((await fetch(`${origin}/api/paperfocus/notebook/transfer`, { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}" })).status, 403);
    assert.equal((await fetch(`${origin}/api/paperfocus/notebook/transfer`)).status, 405);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.throws(() => versionsOptions(["transfer", "--workspace", f.workspace, "--project", f.project.id]), /Transfer needs/);
});

test("overview is a distinct brief purpose with guarded main-manuscript links, inherited by versions", async () => {
  const f = await transferFixture(), monitor = createSourceMonitor();
  const beforeNotes = await readNotebook(f.workspace, f.project.id), beforeWorkbench = await readWorkbench(f.workspace, f.project.id);
  const input = { projectId: f.project.id, mainFile: "main.tex", file: "main.tex", revision: f.document.revision, expectedPurpose: "publication" as const, purpose: "overview" as const, targetFile: "other.tex", expectedTarget: "" };
  const marked = await setManuscriptPurpose(f.workspace, input);
  assert.equal(manuscriptPurpose(marked.document.project), "overview"); assert.equal(manuscriptPurpose(marked.document.project, "other.tex"), "notes");
  assert.equal(marked.document.project.manuscriptOverviewTargets?.["main.tex"], "other.tex");
  assert.equal(marked.document.revision, f.document.revision); assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.main);
  assert.deepEqual(await readNotebook(f.workspace, f.project.id), beforeNotes); assert.deepEqual(await readWorkbench(f.workspace, f.project.id), beforeWorkbench);
  assert.equal((await monitor(f.workspace, f.project.id)).overviewTarget, "other.tex");
  for (const patch of [{ targetFile: "main.tex" }, { targetFile: "sections/body.tex" }, { targetFile: "missing.tex" }, { targetFile: "", expectedTarget: "wrong.tex" }]) await assert.rejects(setManuscriptPurpose(f.workspace, { ...input, expectedPurpose: "overview", ...patch }));
  const version = await createManuscriptVersion(f.workspace, { ...request(f), revision: f.document.revision, notebookRevision: beforeNotes.revision });
  assert.equal(manuscriptPurpose(version.document!.project), "overview"); assert.equal(version.document!.project.manuscriptOverviewTargets?.["main-v2.tex"], "other.tex");
  const removed = await setManuscriptPurpose(f.workspace, { ...input, mainFile: "main-v2.tex", file: "main-v2.tex", revision: version.document!.revision, expectedPurpose: "overview", targetFile: "", expectedTarget: "other.tex" });
  assert.equal(removed.document.project.manuscriptOverviewTargets?.["main-v2.tex"], undefined);
  assert.equal(removed.document.project.manuscriptOverviewTargets?.["main.tex"], "other.tex");
  assert.equal((await monitor(f.workspace, f.project.id)).overviewTarget, "");
  const scaffold = newManuscript("overview.tex", "A short overview", "overview");
  assert.match(scaffold.source, /At a glance/); assert.doesNotMatch(scaffold.source, /\\section\{Results and evidence\}/);
  assert.match(manuscriptWritingPolicy("overview"), /short, clear and explanatory/);
  assert.match(experimentAgentInstructions({ origin: "http://127.0.0.1:4173", workspace: f.workspace, projectId: f.project.id, entryId: f.entry.id, notebookId: f.entry.id, path: f.experiments.path, purpose: "overview" }), /Never expand this overview/);
});

test("agent purpose/link commands and research inspect report Overview without changing notes or source", async () => {
  const f = await transferFixture(), middleware = latexMiddleware(f.workspace);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const scope = ["--workspace", f.workspace, "--project", f.project.id, "--url", origin];
    const args = ["purpose", ...scope, "--root", "main.tex", "--revision", f.document.revision, "--purpose", "overview", "--expected-purpose", "publication", "--target", "other.tex", "--expected-target", "none"];
    assert.equal((await versionsCommand(args)).preview, true); assert.equal(manuscriptPurpose((await getProject(f.workspace, f.project.id)).project), "publication");
    await versionsCommand([...args, "--commit"]);
    const inspected = await researchCommand(["inspect", ...scope, "--entry", f.entry.id]);
    assert.equal(inspected.manuscriptPurpose, "overview"); assert.equal(inspected.mainManuscript, "other.tex"); assert.match(inspected.writingPolicy, /README/);
    assert.equal((await versionsCommand(["inspect", ...scope])).overviewTargets["main.tex"], "other.tex");
    await assert.rejects(versionsCommand([...args, "--commit"]), /changed/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("unclassified imports default to notes; explicit publication remains opt-in and versions inherit", async () => {
  const trials = path.resolve(".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "notes-default-"));
  const source = newManuscript("paper.tex", "Not a publication yet", "paper");
  const project = await createPaperProject(workspace, "Default notes", [upload(source.path, source.source)]);
  const document = await parseProject(workspace, project.id);
  assert.equal(manuscriptPurpose(project), "notes"); // Name and TeX structure never imply publication.
  const copied = await createManuscriptVersion(workspace, { projectId: project.id, mainFile: project.mainFile, revision: document.revision, notebookRevision: 0, file: "paper-v2.tex" });
  assert.ok(copied.document); assert.equal(manuscriptPurpose(copied.document.project), "notes");
  const marked = await setManuscriptPurpose(workspace, { projectId: project.id, mainFile: "paper-v2.tex", file: "paper-v2.tex", revision: copied.document.revision, expectedPurpose: "notes", purpose: "publication" });
  assert.equal(manuscriptPurpose(marked.document.project), "publication");
  assert.equal(manuscriptPurpose(marked.document.project, "paper.tex"), "notes");
  const next = await createManuscriptVersion(workspace, { projectId: project.id, mainFile: "paper-v2.tex", revision: marked.document.revision, notebookRevision: copied.notebook!.revision, file: "paper-v3.tex" });
  assert.ok(next.document); assert.equal(manuscriptPurpose(next.document.project), "publication");
});

test("literal dependencies, cycles and includeonly are copied without flattening or sharing TeX", () => {
  const sources = { "main.tex": "\\documentclass{article}\n% \\input{absent}\n\\includeonly{sections/a}\n\\include{sections/a}", "sections/a.tex": "\\input{macros}", "macros.tex": "\\input{sections/a}" };
  const result = versionSources(sources, "main.tex", "main-v2.tex", "v2");
  assert.equal(result.copies.length, 3); const main = Buffer.from(result.copies[0].data, "base64").toString();
  assert.ok(main.includes("\\includeonly{sections/a-v2}")); assert.ok(main.includes("\\include{sections/a-v2}")); assert.ok(main.includes("% \\input{absent}"));
  for (const source of ["\\input macros", "\\input{\\dynamic}", "\\import{sections}{a}", "\\input{missing}"]) assert.throws(() => versionSources({ "main.tex": source }, "main.tex", "new.tex", "v2"));
  assert.throws(() => versionSources(sources, "main.tex", "other/new.tex", "v2"), /same folder/);
});

test("version preview is read-only; continued notes/cells are independent and requests stay original", async () => {
  const f = await fixture(), files = await readdir(f.root), preview = await createManuscriptVersion(f.workspace, { ...request(f), preview: true });
  assert.equal(preview.preview, true); assert.deepEqual(await readdir(f.root), files); assert.equal((await readNotebook(f.workspace, f.project.id)).revision, f.notes.revision);
  const result = await createManuscriptVersion(f.workspace, request(f)); assert.ok(result.document && result.notebook);
  assert.equal(result.version.number, 2); assert.equal((await getProject(f.workspace, f.project.id)).project.mainFile, "main-v2.tex");
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.main);
  const clone = result.notebook.entries.find(e => e.id === result.entryMapping[f.entry.id])!;
  assert.equal(clone.notes, f.entry.notes); assert.equal(clone.source?.rootFile, "main-v2.tex"); assert.equal(clone.continuedFrom?.entryId, f.entry.id);
  assert.equal(notebookForManuscript(result.notebook.entries, "main.tex").length, 1); assert.equal(notebookForManuscript(result.notebook.entries, "main-v2.tex").length, 1);
  assert.notEqual(clone.study?.turns[0].id, f.entry.study!.turns[0].id); assert.equal(clone.study?.turns[0].closed, true);
  assert.equal(clone.handoffs[0].historyOnly, true);
  const tasks = notebookAttentionTasks(result.notebook.entries, []);
  assert.equal(tasks.find(t => t.id === f.entry.study!.turns[0].id)?.notebookId, f.entry.id);
  assert.equal(tasks.filter(t => t.notebookId === clone.id && t.status !== "reviewed").length, 0);
  const copied = await readExperiments(f.workspace, f.project.id, clone.experimentNotebookId!);
  assert.deepEqual(copied.notebook.cells, f.experiments.notebook.cells); assert.equal(copied.notebook.metadata.custom, "Keep unknown metadata"); assert.ok(copied.notebook.metadata.awVersionOrigin);
  copied.notebook.cells[0].source = "Changed in new version";
  await writeExperiments(f.workspace, f.project.id, clone.experimentNotebookId!, copied.revision, copied.notebook);
  assert.equal((await readExperiments(f.workspace, f.project.id, f.entry.id)).revision, f.experiments.revision);
  const body = result.document.paragraphs.find(p => p.text.includes("An included paragraph"))!;
  assert.notEqual(body.file, "sections/body.tex");
  await saveEdits(f.workspace, f.project.id, { [body.id]: "Edited version body." }, result.document.revision, undefined, "main-v2.tex");
  assert.match(await readFile(path.join(f.root, "sections/body.tex"), "utf8"), /An included paragraph/);
  assert.equal(nextManuscriptVersion(result.document.project).number, 3);
});

test("fresh version starts empty without deleting earlier notes or experiment evidence", async () => {
  const f = await fixture(), result = await createManuscriptVersion(f.workspace, { ...request(f), notebook: "fresh" }); assert.ok(result.notebook);
  assert.equal(notebookForManuscript(result.notebook.entries, "main-v2.tex").length, 0);
  assert.equal(result.notebook.entries[0].notes, "Human notes"); assert.equal((await readExperiments(f.workspace, f.project.id, f.entry.id)).revision, f.experiments.revision);
  const sharing = await collaboratorExport(f.workspace, { projectId: f.project.id, mainFile: "main-v2.tex", revision: result.document!.revision, notebookRevision: result.notebook.revision, format: "html" });
  assert.doesNotMatch(sharing.data.toString(), /Human notes|Saved reasoning/);
});

test("exact human-reviewed locks carry forward, without changing the old approval", async () => {
  const f = await fixture(), p = f.document.paragraphs.find(p => p.text.includes("Original paragraph"))!;
  const round = makeWritingRequest(captureTaskSource(f.document, f.document.nodes.find(n => n.id === p.nodeId)!, {}, "paragraph", p.id), "Synthetic review fixture", "paragraph", "codex");
  let state = receiveWritingReply({ attentionTasks: [round], paragraphEdits: {} } as AppState, round.id, JSON.stringify({ version: 1, connection: "", nextStep: "", proposals: [{ id: "fixture", paragraphId: p.id, action: "replace", purpose: "Keep wording", rationale: "Synthetic fixture only", text: p.text }] }));
  const proposal = state.attentionTasks[1]; state = placeWritingDraft(state, f.document, proposal.id); state = acceptWritingParagraph(state, f.document, proposal.id, p.text);
  const store = await readWorkbench(f.workspace, f.project.id);
  await writeWorkbench(f.workspace, f.project.id, store.revision, { ...emptyWorkbench(), attentionTasks: state.attentionTasks });
  await setManuscriptPurpose(f.workspace, { projectId: f.project.id, mainFile: "main.tex", file: "main.tex", revision: f.document.revision, expectedPurpose: "publication", purpose: "notes" });
  const result = await createManuscriptVersion(f.workspace, request(f)); assert.ok(result.document && result.workbench);
  assert.equal(manuscriptPurpose(result.document.project), "notes");
  const locks = writingLocks(result.workbench.attentionTasks, result.document, {}); assert.equal(locks.size, 1);
  assert.notEqual([...locks.values()][0].id, proposal.id); assert.deepEqual(result.workbench.attentionTasks.find(t => t.id === proposal.id), state.attentionTasks[1]);
});

test("purpose is explicit per root, metadata-only, guarded, and seen by cached status", async () => {
  const f = await fixture(), monitor = createSourceMonitor(), before = await monitor(f.workspace, f.project.id), notesBefore = await readNotebook(f.workspace, f.project.id);
  assert.equal(manuscriptPurpose(f.project), "publication");
  assert.equal(before.purpose, "publication");
  const input = { projectId: f.project.id, mainFile: "main.tex", file: "main.tex", revision: f.document.revision, expectedPurpose: "publication" as const, purpose: "notes" as const };
  const result = await setManuscriptPurpose(f.workspace, input);
  assert.equal(manuscriptPurpose(result.document.project), "notes");
  assert.equal(result.document.revision, f.document.revision);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.main);
  assert.deepEqual(await readNotebook(f.workspace, f.project.id), notesBefore);
  assert.equal((await monitor(f.workspace, f.project.id)).purpose, "notes");
  await assert.rejects(() => setManuscriptPurpose(f.workspace, input), /another window/);
  for (const bad of [{ ...input, file: "sections/body.tex" }, { ...input, file: "../escape.tex" }, { ...input, revision: "stale" }, { ...input, mainFile: "wrong.tex" }, { ...input, purpose: "anything" as "notes" }]) await assert.rejects(() => setManuscriptPurpose(f.workspace, bad));
  await setManuscriptPurpose(f.workspace, { ...input, expectedPurpose: "notes", purpose: "publication" });
  assert.equal(manuscriptPurpose((await getProject(f.workspace, f.project.id)).project), "publication");
});

test("a new informative root is marked separately and does not change the paper's purpose", async () => {
  const f = await fixture(), note = newManuscript("notes.tex", "Full explanation", "notes");
  const { addProjectFiles } = await import("./projectFiles.ts");
  await addProjectFiles(f.workspace, f.project.id, f.document.revision, "main.tex", [upload(note.path, note.source)]);
  const document = await parseProject(f.workspace, f.project.id);
  const result = await setManuscriptPurpose(f.workspace, { projectId: f.project.id, mainFile: "main.tex", file: "notes.tex", revision: document.revision, expectedPurpose: "notes", purpose: "notes" });
  assert.equal(result.document.project.mainFile, "main.tex");
  assert.equal(manuscriptPurpose(result.document.project), "publication");
  assert.equal(manuscriptPurpose(result.document.project, "notes.tex"), "notes");
  const next = await createManuscriptVersion(f.workspace, { ...request(f), revision: document.revision });
  assert.ok(next.document); assert.equal(manuscriptPurpose(next.document.project), "publication");
  assert.equal(manuscriptPurpose(next.document.project, "notes.tex"), "notes");
});

test("research briefs allow full notes without relaxing publication rounds or proof boundaries", async () => {
  const f = await fixture(), entry = { ...f.entry, manuscriptFile: "main.tex" };
  const document = { ...f.document, project: { ...f.document.project, manuscriptPurposes: { "main.tex": "notes" as const, "publication.tex": "publication" as const } } };
  assert.match(notebookPacket(entry, document.project), /full-length/);
  assert.match(studyPacket(entry, document), /No three-paragraph limit/);
  assert.match(externalStudyPacket(entry, document), /No three-paragraph limit/);
  assert.match(manuscriptWritingPolicy("publication"), /one to three connected paragraphs/);
  assert.match(studyPacket(entry, document, undefined, true), /Do not modify source files/);
  const attempt = { ...entry, study: { ...studyState(entry), benchmark: { phase: "attempt" as const, statement: "Synthetic withheld statement", citationKey: "", locator: "", referenceNotes: "Withheld fixture proof" } } };
  assert.doesNotMatch(studyPacket(attempt, document), /No three-paragraph limit/);
  assert.doesNotMatch(externalStudyPacket(attempt, document), /No three-paragraph limit/);
  const brief = experimentAgentInstructions({ origin: "http://127.0.0.1:4173", workspace: f.workspace, projectId: f.project.id, entryId: entry.id, notebookId: entry.id, path: "returned.ipynb", manuscriptFile: "notes.tex", purpose: "notes" });
  assert.match(brief, /Manuscript: notes.tex/); assert.match(brief, /full explanation/); assert.match(brief, /Purpose is not permission/);
  const foreign = { ...entry, manuscriptFile: "publication.tex" };
  assert.match(externalStudyPacket(foreign, document), /Publication draft/);
});

test("stale source/notebook, existing names and unsupported imports refuse before source writes", async () => {
  const f = await fixture();
  for (const bad of [{ ...request(f), revision: "stale" }, { ...request(f), notebookRevision: 0 }, { ...request(f), file: "main.tex" }, { ...request(f), file: "../bad.tex" }]) await assert.rejects(() => createManuscriptVersion(f.workspace, bad));
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.main); assert.equal((await getProject(f.workspace, f.project.id)).project.mainFile, "main.tex");
});

test("scoped CLI preview/commit works through a real isolated service and rejects stale reuse", async () => {
  const f = await fixture(), middleware = latexMiddleware(f.workspace);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const scope = ["--workspace", f.workspace, "--project", f.project.id, "--url", origin];
    const inspected = await versionsCommand(["inspect", ...scope]); assert.equal(inspected.sourceRevision, f.document.revision);
    assert.equal(inspected.purpose, "publication"); assert.equal(inspected.purposeSupported, true);
    const purposeArgs = ["purpose", ...scope, "--root", "main.tex", "--revision", inspected.sourceRevision, "--expected-purpose", "publication", "--purpose", "notes"];
    assert.equal((await versionsCommand(purposeArgs)).preview, true);
    assert.equal(manuscriptPurpose((await getProject(f.workspace, f.project.id)).project), "publication");
    const marked = await versionsCommand([...purposeArgs, "--commit"]);
    assert.equal(manuscriptPurpose(marked.document.project), "notes");
    await assert.rejects(() => versionsCommand([...purposeArgs, "--commit"]), /purpose changed/);
    const deniedPurpose = await fetch(`${origin}/api/paperfocus/manuscripts/purpose`, { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}" }); assert.equal(deniedPurpose.status, 403);
    assert.equal((await fetch(`${origin}/api/paperfocus/manuscripts/purpose`)).status, 405);
    const args = ["create", ...scope, "--root", "main.tex", "--revision", inspected.sourceRevision, "--notebook-revision", String(inspected.notebookRevision), "--file", "main-v2.tex"];
    assert.equal((await versionsCommand(args)).preview, true); assert.equal((await getProject(f.workspace, f.project.id)).project.mainFile, "main.tex");
    const version = await versionsCommand([...args, "--commit"]);
    assert.equal(version.version.number, 2); assert.equal(manuscriptPurpose(version.document.project), "notes");
    await assert.rejects(() => versionsCommand([...args, "--commit"]), /changed/);
    const denied = await fetch(`${origin}/api/paperfocus/manuscripts/version`, { method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}" }); assert.equal(denied.status, 403);
    await assert.rejects(() => versionsCommand(["inspect", ...scope.map(s => s === f.workspace ? path.join(f.workspace, "wrong") : s)]), /differs/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  assert.throws(() => versionsOptions(["create", "--project", "x"]));
  assert.equal(await versionsCommand(["--help"]), (await versionsCommand(["inspect", "--help"])));
});
