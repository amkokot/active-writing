import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { createPaperProject } from "./projectFiles.ts";
import { getProject, saveEdits, editableProject, projectFiles } from "./projects.ts";
import { captureSyncSnapshot, initializeSyncDevice } from "./deviceSync.ts";
import { makeSnapshot, syncRecord, type SyncRecord } from "./syncProtocol.ts";
import { previewStagedSync, stageSyncSnapshot } from "./syncStaging.ts";
import { commitResearchMerge, previewResearchMerge, researchMergeDetails, researchMergeStatus } from "./syncResearchMerge.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { writeWorkbench } from "./workbenchStore.ts";
import { acquireRecordLock } from "./recordLock.ts";
import { guardedFileHash, saveGuardedFile } from "./guardedFile.ts";
import { syncCommand } from "../scripts/awSync.ts";
import type { NotebookEntry } from "../src/types.ts";

const stamp = "2026-10-14T00:00:00Z", tex = "\\documentclass{article}\n\\begin{document}\nFirst idea.\n\nStable context.\n\nLast idea.\n\\end{document}\n";
const entry = (id: string): NotebookEntry => ({ id, manuscriptFile: "main.tex", title: id, notes: "First note.\n\nLast note.\n", question: "Question", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp });
async function fixture(options: { change?: (records: SyncRecord[]) => void; publication?: boolean; code?: boolean } = {}) {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true }); const workspace = await mkdtemp(path.join(parent, "research-merge-"));
  const project = await createPaperProject(workspace, "Synthetic research merging"), projectId = project.id, root = (await getProject(workspace, projectId)).root;
  await initializeSyncDevice(workspace, "Laptop"); await writeFile(path.join(root, "main.tex"), tex); await writeWorkbench(workspace, projectId, 0, emptyWorkbench());
  await writeNotebook(workspace, projectId, 0, [entry("question")]);
  const notebook = await writeExperiments(workspace, projectId, "question", "", { ...newExperimentNotebook(), metadata: { retain: "unknown" }, cells: [
    { id: "human", cell_type: "markdown", source: "Initial human", metadata: {} }, { id: "desktop", cell_type: "markdown", source: "Initial desktop", metadata: {} },
    ...(options.code ? [{ id:"calc",cell_type:"code" as const,source:"# Synthetic code only; not executed",metadata:{},execution_count:null,outputs:[] }] : [])
  ] });
  if (options.publication) { const file = path.join(workspace, ".paperfocus/projects.json"), registry = JSON.parse(await readFile(file, "utf8")); registry.projects.find(item => item.id === projectId).manuscriptPurposes = { "main.tex": "publication" }; await writeFile(file, JSON.stringify(registry)); }
  const base = await captureSyncSnapshot(workspace, projectId);
  await writeFile(path.join(root, "main.tex"), tex.replace("First idea.", "Human clarification.")); const notes = await readNotebook(workspace, projectId); notes.entries[0].notes = notes.entries[0].notes.replace("First note.", "Human note."); await writeNotebook(workspace, projectId, notes.revision, notes.entries);
  notebook.notebook.cells[0].source = "Human evidence"; if (options.code) notebook.notebook.cells[2].source="# New synthetic proposal; not executed"; await writeExperiments(workspace, projectId, "question", notebook.revision, notebook.notebook);
  const local = await captureSyncSnapshot(workspace, projectId, base);
  const records = base.records.map(record => {
    if (record.path === "source/main.tex") return syncRecord(record.path, record.kind, Buffer.from(tex.replace("Last idea.", "Desktop deduction.")));
    if (record.path === "data/notebook.json") { const data = JSON.parse(Buffer.from(record.data, "base64").toString()); data.revision = 900; data.entries[0].notes = data.entries[0].notes.replace("Last note.", "Desktop note."); data.entries.push(entry("new-question")); return syncRecord(record.path, record.kind, Buffer.from(JSON.stringify(data))); }
    if (record.kind === "experiment") { const data = JSON.parse(Buffer.from(record.data, "base64").toString()); data.cells[1].source = "Desktop evidence"; return syncRecord(record.path, record.kind, Buffer.from(JSON.stringify(data))); } return record;
  });
  records.push(syncRecord("data/experiments/new-question/notebook.ipynb", "experiment", Buffer.from(JSON.stringify({ ...newExperimentNotebook(), cells: [{ id: "state", cell_type: "markdown", source: "Synthetic new question; no experiment executed", metadata: {} }] }))));
  records.push(syncRecord("source/sections/new-note.tex", "source", Buffer.from("\\section{Independent note}\nSynthetic source addition.\n")));
  records.push(syncRecord("data/research/summary.md", "record", Buffer.from("Synthetic derivation note, not proof verification.")));
  options.change?.(records); const remote = makeSnapshot(projectId, { version: 1, id: "desktop", label: "Desktop" }, records, base);
  for (const snapshot of [base, local, remote]) await stageSyncSnapshot(workspace, projectId, snapshot);
  const planned = await previewStagedSync(workspace, projectId, local.id, remote.id); const data = path.join(workspace, ".paperfocus/project-data", projectId);
  return { workspace, projectId, root, data, base, local, remote, planId: planned.id };
}
const preview = (f: Awaited<ReturnType<typeof fixture>>) => previewResearchMerge(f.workspace, f.projectId, f.planId);
const commit = (f: Awaited<ReturnType<typeof fixture>>, id: string, hooks?: Parameters<typeof commitResearchMerge>[5]) => commitResearchMerge(f.workspace, f.projectId, f.planId, id, {}, hooks);
const modify = (records: SyncRecord[], name: string, fn: (value: any) => void) => { const index = records.findIndex(record => record.path === name), record = records[index], value = JSON.parse(Buffer.from(record.data, "base64").toString()); fn(value); records[index] = syncRecord(name, record.kind, Buffer.from(JSON.stringify(value))); };

test("research merge previews complete independent source, conversations and experiments without live writes", async () => {
  const f = await fixture(), p = await preview(f); assert.equal(p.complete, true); assert.equal(p.liveImport, false); assert.equal(p.approvalGranted, false); assert.deepEqual(p.newEntries, ["new-question"]); assert.equal(p.changes.length, 6);
  assert.equal((await readNotebook(f.workspace, f.projectId)).entries.length, 1); await assert.rejects(stat(path.join(f.root, "sections/new-note.tex")), /ENOENT/); await assert.rejects(stat(path.join(f.workspace, ".paperfocus/device-sync/merges")), /ENOENT/);
});
test("batch retains both humans' source/notes/evidence and publishes the catalogue last", async () => {
  const f = await fixture(), p = await preview(f), done = await commit(f, p.mergeId, { afterCatalogue: async () => {
    assert.equal((await readExperiments(f.workspace, f.projectId, "new-question")).notebook.cells.length, 1); assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /Desktop deduction/);
  } }); assert.equal(done.completed, true); assert.equal(done.complete, true); assert.equal(done.tasksCompleted, false);
  const cat = await readNotebook(f.workspace, f.projectId); assert.equal(cat.revision, 3); assert.equal(cat.entries[0].notes, "Human note.\n\nDesktop note.\n"); assert.deepEqual(cat.entries.map(entry => entry.id), ["question", "new-question"]);
  const source = await readFile(path.join(f.root, "main.tex"), "utf8"); assert.match(source, /Human clarification/); assert.match(source, /Desktop deduction/);
  assert.deepEqual((await readExperiments(f.workspace, f.projectId, "question")).notebook.cells.map(cell => cell.source), ["Human evidence", "Desktop evidence"]); assert.equal((await researchMergeStatus(f.workspace, f.projectId, p.mergeId)).completed, true);
});
test("publication source remains held while research conversations can transfer", async () => {
  const f = await fixture({ publication: true }), p = await preview(f); assert.equal(p.complete, false); assert.ok(p.held.some(item => item.path === "source/main.tex" && /publication/.test(item.reason))); await commit(f, p.mergeId); assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /Last idea/);
});
test("existing accepted wording locks hold even one-sided research-source edits", async () => {
  const f = await fixture(), current = await readNotebook(f.workspace,f.projectId); // The lock is independent of document purpose.
  const lock = { ...emptyWorkbench(), attentionTasks:[{ id:"curated",title:"Locked wording",nodeId:"node",paragraphId:"p",route:"codex",status:"reviewed",createdAt:stamp,updatedAt:stamp,
    sourceSnapshot:{ version:1,scope:"paragraph",projectId:f.projectId,revision:"source-hash",rootFile:"main.tex",nodeId:"node",nodeTitle:"Notes",paragraphs:[{ id:"p",nodeId:"node",text:"Human clarification.",file:"main.tex" }] },
    writing:{ kind:"paragraph",roundId:"round",externalId:"p",action:"replace",purpose:"Clarify",rationale:"Synthetic fixture",proposedText:"Human clarification.",draftText:"Human clarification.",placement:{ text:"Human clarification.",before:"First idea.",createdAt:stamp },decision:"accepted",curatedText:"Human clarification.",decidedAt:stamp } }] };
  await writeWorkbench(f.workspace,f.projectId,1,lock); const local = await captureSyncSnapshot(f.workspace,f.projectId,f.local); await stageSyncSnapshot(f.workspace,f.projectId,local); const plan = await previewStagedSync(f.workspace,f.projectId,local.id,f.remote.id), p = await previewResearchMerge(f.workspace,f.projectId,plan.id);
  assert.ok(p.held.some(item => item.path === "source/main.tex" && /locked wording/.test(item.reason))); await commitResearchMerge(f.workspace,f.projectId,plan.id,p.mergeId);
  assert.match(await readFile(path.join(f.root,"main.tex"),"utf8"),/Last idea/); assert.equal((await readNotebook(f.workspace,f.projectId)).entries[0].notes.includes("Desktop note"),true); assert.equal(current.entries[0].status,"open");
});
test("protected existing task/approval state stays local and is not a completion event", async () => {
  const f = await fixture({ change: records => modify(records, "data/notebook.json", data => { data.entries[0].status = "integrated"; data.extension = "Remote unknown metadata"; }) }), p = await preview(f); assert.ok(p.held.some(item => item.field === "question/status")); await commit(f, p.mergeId);
  const cat = await readNotebook(f.workspace, f.projectId); assert.equal(cat.entries[0].status, "open"); assert.equal((cat as any).extension, undefined);
});
test("concurrent code and output changes are held as one unit, not spliced", async () => {
  const f = await fixture({ code:true,change:records=>modify(records,"data/experiments/question/notebook.ipynb",data=>{ data.cells[2].execution_count=1; data.cells[2].outputs=[{ output_type:"stream",name:"stdout",text:"SYNTHETIC OUTPUT, NOT EXECUTED" }]; }) }), p=await preview(f), previous=await readExperiments(f.workspace,f.projectId,"question");
  assert.ok(p.held.some(item=>item.path==="data/experiments/question/notebook.ipynb")); const result=await commit(f,p.mergeId); assert.equal(result.historyJoined,false); assert.deepEqual((await readExperiments(f.workspace,f.projectId,"question")).notebook,previous.notebook);
});
test("one-sided source removal is retained for explicit review, never an automatic deletion", async () => {
  const f=await fixture({ change:records=>{ records.splice(records.findIndex(item=>item.path==="source/main.tex"),1); } }), p=await preview(f); assert.ok(p.held.some(item=>item.path==="source/main.tex" && /deletion/.test(item.reason))); const result=await commit(f,p.mergeId); assert.equal(result.historyJoined,false); assert.match(await readFile(path.join(f.root,"main.tex"),"utf8"),/Human clarification/);
});
test("ordinary overlapping notes expose exact variants and accept a guarded targeted choice", async () => {
  const f = await fixture({ change: records => modify(records, "data/notebook.json", data => { data.entries[0].notes = "Other replacement.\n\nLast note.\n"; }) }), details = await researchMergeDetails(f.workspace, f.projectId, f.planId);
  const conflict = details.held.find(item => item.field === "question/notes")!; assert.equal(conflict.local, "Human note.\n\nLast note.\n"); assert.equal(conflict.ordinary, true);
  const options = { decisions: [{ conflictId: conflict.id, choice: "text" as const, text: "Explicit combined note." }] }, p = await previewResearchMerge(f.workspace, f.projectId, f.planId, options);
  await commitResearchMerge(f.workspace, f.projectId, f.planId, p.mergeId, options); assert.equal((await readNotebook(f.workspace, f.projectId)).entries[0].notes, "Explicit combined note.");
  await assert.rejects(previewResearchMerge(f.workspace, f.projectId, f.planId, { decisions: [{ conflictId: "a".repeat(64), choice: "local" }] }), /exact current/);
});
test("pending new request is not published or replayed", async () => {
  const f = await fixture({ change: records => modify(records, "data/notebook.json", data => { data.entries[1].handoffs = [{ id: "waiting", packet: "Do work", createdAt: stamp }]; }) }), p = await preview(f); assert.deepEqual(p.newEntries, []); assert.ok(p.held.some(item => /waiting/.test(item.reason))); await commit(f, p.mergeId); assert.equal((await readNotebook(f.workspace, f.projectId)).entries.length, 1);
});
test("ambiguous concurrent source is held without losing independent notebook changes", async () => {
  const f = await fixture({ change: records => { const index = records.findIndex(item => item.path === "source/main.tex"); records[index] = syncRecord("source/main.tex", "source", Buffer.from(tex.replace("First idea.", "Other conflicting first idea."))); } }), p = await preview(f); assert.ok(p.held.some(item => item.path === "source/main.tex")); await commit(f, p.mergeId); assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /Human clarification/);
});
test("interrupted partial writes resume without saving a notebook or catalogue twice", async () => {
  const f = await fixture(), p = await preview(f); await assert.rejects(commit(f, p.mergeId, { afterFile: name => { if (name === "data/experiments/question/notebook.ipynb") throw new Error("synthetic disconnect"); } }), /partial live/);
  const owner = await readExperiments(f.workspace, f.projectId, "question"); assert.equal((await researchMergeStatus(f.workspace, f.projectId, p.mergeId)).completed, false); assert.equal((await readNotebook(f.workspace, f.projectId)).revision, 2);
  await commit(f, p.mergeId); assert.equal((await readExperiments(f.workspace, f.projectId, "question")).revision, owner.revision); assert.equal((await readNotebook(f.workspace, f.projectId)).revision, 3);
});
test("interruption after catalogue resumes with one allocated local revision", async () => {
  const f = await fixture(), p = await preview(f); await assert.rejects(commit(f, p.mergeId, { afterCatalogue: () => { throw new Error("disconnect after save"); } }), /partial live/); await commit(f, p.mergeId); assert.equal((await readNotebook(f.workspace, f.projectId)).revision, 3);
});
test("new local work after preview or during partial preparation is never overwritten", async () => {
  const f = await fixture(), p = await preview(f); await writeFile(path.join(f.root, "main.tex"), "Later human draft"); await assert.rejects(commit(f, p.mergeId), /changed/); assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), "Later human draft");
  const g = await fixture(), q = await preview(g); await assert.rejects(commit(g, q.mergeId, { afterFile: name => { if (name.includes("question/notebook.ipynb")) throw new Error("stop"); } }));
  const cat = await readNotebook(g.workspace, g.projectId); cat.entries[0].notes = "New work during interruption"; await writeNotebook(g.workspace, g.projectId, cat.revision, cat.entries); await assert.rejects(commit(g, q.mergeId), /partial|changed/); assert.equal((await readNotebook(g.workspace, g.projectId)).entries[0].notes, "New work during interruption");
});
test("busy experiment owner refuses collection without stealing its lease", async () => {
  const f = await fixture(), p = await preview(f), done = await acquireRecordLock(path.join(f.data, "experiments/question/python-run"), 0); try { await assert.rejects(commit(f, p.mergeId), /locked by another writer/); } finally { await done(); } await commit(f, p.mergeId);
});
test("completed retry preserves later human edits", async () => {
  const f = await fixture(), p = await preview(f); await commit(f, p.mergeId); const cat = await readNotebook(f.workspace, f.projectId); cat.entries[0].notes = "After completion"; await writeNotebook(f.workspace, f.projectId, cat.revision, cat.entries); const retry = await commit(f, p.mergeId); assert.equal(retry.alreadyComplete, true); assert.equal((await readNotebook(f.workspace, f.projectId)).entries[0].notes, "After completion");
});
test("new owner with hidden orphan assets is preserved", async () => {
  const f = await fixture(), p = await preview(f), folder = path.join(f.data, "experiments/new-question"); await mkdir(folder); await writeFile(path.join(folder, ".hidden-note"), "Private orphan"); await assert.rejects(preview(f), /orphan/); await assert.rejects(commit(f, p.mergeId), /orphan/); assert.equal(await readFile(path.join(folder, ".hidden-note"), "utf8"), "Private orphan");
});
test("exact-byte file guards preserve external edits and reject linked parents", async t => {
  const f = await fixture(), hash = await guardedFileHash(f.root, "main.tex"); await writeFile(path.join(f.root, "main.tex"), "External"); await assert.rejects(saveGuardedFile(f.root, "main.tex", hash, Buffer.from("Should not save")), /changed/); assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), "External");
  const external = path.join(f.workspace, "external"); await mkdir(external); try { await symlink(external, path.join(f.root, "linked"), "junction"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { t.diagnostic("Link creation unavailable"); return; } throw error; } await assert.rejects(saveGuardedFile(f.root, "linked/secret.tex", "", Buffer.from("no")), /linked/);
});
test("normal manuscript saves use the same file lease and do not expose internal lock/temporary files", async () => {
  const f = await fixture(), parsed = await editableProject(f.workspace, f.projectId), passage = parsed.paragraphs.find(p => /Human clarification/.test(p.text))!;
  const done = await acquireRecordLock(path.join(f.root, "main.tex"), 0); try { await assert.rejects(saveEdits(f.workspace, f.projectId, { [passage.id]: "New" }, parsed.revision), /locked by another writer/); assert.equal((await projectFiles(f.root)).some(name => name.endsWith(".aw-lock")), false); } finally { await done(); }
  await saveEdits(f.workspace, f.projectId, { [passage.id]: "New" }, parsed.revision); assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /New/);
});
test("CLI merge/status share the guarded protocol and refuse missing review scope", async () => {
  const f = await fixture(), scope = ["--workspace", f.workspace, "--project", f.projectId, "--plan", f.planId], p = await syncCommand(["merge", ...scope]); assert.ok("mergeId" in p); if (!("mergeId" in p)) return;
  await assert.rejects(syncCommand(["merge", ...scope, "--commit"]), /review ID/); const done = await syncCommand(["merge", ...scope, "--review", p.mergeId as string, "--commit"]); assert.equal((done as any).completed, true);
  assert.equal((await syncCommand(["merge-status", "--workspace", f.workspace, "--project", f.projectId, "--merge", p.mergeId as string]) as any).completed, true);
});
test("offline agents can read the exact batch candidate, including automatically combined source", async () => {
  const f=await fixture(), scope=["--workspace",f.workspace,"--project",f.projectId,"--plan",f.planId,"--path","source/main.tex"], read=await syncCommand(["merge-file",...scope]) as any;
  assert.equal(read.complete,true); assert.equal(read.liveImport,false); assert.match(read.text,/Human clarification/); assert.match(read.text,/Desktop deduction/);
  const output=path.join(f.workspace,"exact-proposal.tex"), saved=await syncCommand(["merge-file",...scope,"--output",output]) as any; assert.equal(await readFile(output,"utf8"),read.text); assert.equal(saved.sha256,read.sha256); await assert.rejects(syncCommand(["merge-file",...scope,"--output",output]),/EEXIST/);
  assert.match(await readFile(path.join(f.root,"main.tex"),"utf8"),/Last idea/);
});
