import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { captureSyncSnapshot, initializeSyncDevice, privateSyncPath } from "./deviceSync.ts";
import { makeSnapshot, syncRecord, type SyncRecord } from "./syncProtocol.ts";
import { stageSyncSnapshot, previewStagedSync } from "./syncStaging.ts";
import { commitNotebookCollection, previewNotebookCollection, notebookCollectionStatus } from "./syncCollect.ts";
import { createPaperProject } from "./projectFiles.ts";
import { getProject, registry, saveRegistry } from "./projects.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { readWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { newExperimentNotebook, type ExperimentNotebook } from "../src/experiments.ts";
import { acquireRecordLock } from "./recordLock.ts";
import { syncCommand, syncOptions } from "../scripts/awSync.ts";

const name = "data/experiments/owner/notebook.ipynb", runName = "data/experiments/owner/runs/test-run.json";
const stamp = "2026-10-14T00:00:00Z";
async function fixture(remoteEdit?: (nb: ExperimentNotebook) => void, runEdit?: (records: SyncRecord[]) => SyncRecord[], originalEdit?: (nb: ExperimentNotebook) => void) {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(path.join(parent, "collect-")), project = await createPaperProject(workspace, "Synthetic notebook collection"), root = (await getProject(workspace, project.id)).root;
  await initializeSyncDevice(workspace, "Laptop");
  await writeNotebook(workspace, project.id, 0, [{ id: "conversation", experimentNotebookId: "owner", title: "Fixture", question: "Synthetic test", notes: "Human context", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp }]);
  await writeWorkbench(workspace, project.id, 0, emptyWorkbench());
  const original: ExperimentNotebook = { ...newExperimentNotebook(), metadata: { synthetic: true, keepUnknown: { value: 42 } }, cells: [
    { id: "left", cell_type: "markdown", source: "Initial laptop idea", metadata: {} },
    { id: "right", cell_type: "markdown", source: "Initial desktop idea", metadata: {} },
    { id: "code", cell_type: "code", source: "print('fixture-only')", metadata: {}, execution_count: null, outputs: [] }
  ] };
  originalEdit?.(original);
  const initial = await writeExperiments(workspace, project.id, "owner", "", original), base = await captureSyncSnapshot(workspace, project.id);
  const localNb = structuredClone(original); localNb.cells[0].source = "The human's offline idea";
  const localStore = await writeExperiments(workspace, project.id, "owner", initial.revision, localNb), local = await captureSyncSnapshot(workspace, project.id, base);
  const remoteNb = structuredClone(original); remoteNb.cells[1].source = "A separate desktop idea";
  remoteNb.cells[2].outputs = [{ output_type: "stream", name: "stdout", text: "SYNTHETIC FIXTURE, not an executed experiment\n" }];
  remoteNb.cells[2].execution_count = 1; remoteNb.cells[2].metadata = { paperfocus: { runId: "test-run", lastRunSource: "print('fixture-only')", execution: { mode: "fresh", runtime: { executable: "C:/old-host/python.exe", python: "synthetic", packages: {} } } } };
  remoteEdit?.(remoteNb);
  let records = base.records.map(record => record.path === name ? syncRecord(name, "experiment", Buffer.from(JSON.stringify(remoteNb, null, 2))) : record);
  records.push(syncRecord(runName, "run", Buffer.from(JSON.stringify({ id: "test-run", cellId: "code", status: "ready", source: "print('fixture-only')", outputs: remoteNb.cells.find(cell => cell.id === "code")?.outputs ?? [], synthetic: true }))));
  records.push(syncRecord("data/experiments/owner/runs/test-run.collection.json", "run", Buffer.from(JSON.stringify({ id: "test-run", status: "ready", notebookUpdated: true, synthetic: true }))));
  if (runEdit) records = runEdit(records);
  const remote = makeSnapshot(project.id, { version: 1, id: "synthetic-desktop", label: "Desktop" }, records, base);
  for (const snapshot of [base, local, remote]) await stageSyncSnapshot(workspace, project.id, snapshot);
  const plan = await previewStagedSync(workspace, project.id, local.id, remote.id);
  return { workspace, projectId: project.id, root, base, local, remote, planId: plan.id, original, localStore, localNb, scope: ["--workspace", workspace, "--project", project.id, "--plan", plan.id, "--path", name] };
}
async function commit(f: Awaited<ReturnType<typeof fixture>>, hooks?: Parameters<typeof commitNotebookCollection>[5]) {
  const preview = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  return commitNotebookCollection(f.workspace, f.projectId, f.planId, name, preview.collectionId, hooks);
}
test("collection preview is exact and read-only, with bounded cell/run changes", async () => {
  const f = await fixture(), before = await readFile(f.localStore.path), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  assert.equal(p.liveImport, false); assert.equal(p.codeExecuted, false); assert.equal(p.catalogueWrites, false);
  assert.deepEqual(p.changedCells, ["right", "code"]); assert.equal(p.runFiles.length, 2);
  assert.deepEqual(await readFile(f.localStore.path), before); await assert.rejects(stat(path.join(path.dirname(f.localStore.path), "runs")), /ENOENT/);
  await assert.rejects(stat(path.join(f.workspace, ".paperfocus/device-sync/collections")), /ENOENT/);
});
test("exact-review commit combines saved evidence through the guarded store without source/task changes", async () => {
  const f = await fixture(), source = await readFile(path.join(f.root, "main.tex")), catalogue = await readNotebook(f.workspace, f.projectId), workbench = await readWorkbench(f.workspace, f.projectId);
  const copied = await commit(f), saved = await readExperiments(f.workspace, f.projectId, "owner");
  assert.equal(copied.liveImport, true); assert.equal(copied.codeExecuted, false); assert.equal(copied.approvalGranted, false); assert.equal(copied.runFilesAdded, 2);
  assert.equal(saved.revision, copied.revision); assert.equal(saved.notebook.cells[0].source, "The human's offline idea"); assert.equal(saved.notebook.cells[1].source, "A separate desktop idea");
  assert.match(saved.notebook.cells[2].outputs![0].text as string, /SYNTHETIC FIXTURE/); assert.equal(saved.notebook.cells[2].metadata.paperfocus?.execution?.runtime?.executable, "C:/old-host/python.exe");
  assert.deepEqual(saved.notebook.metadata, f.original.metadata);
  assert.deepEqual(await readNotebook(f.workspace, f.projectId), catalogue); assert.deepEqual(await readWorkbench(f.workspace, f.projectId), workbench); assert.deepEqual(await readFile(path.join(f.root, "main.tex")), source);
  const backup = JSON.parse(await readFile(copied.backupPath, "utf8")); assert.equal(backup.records.find((record: SyncRecord) => record.path === name).sha256, f.localStore.revision);
  assert.equal((await notebookCollectionStatus(f.workspace, f.projectId, copied.collectionId)).completed, true);
});
test("wrong review and stale local work make no live writes", async () => {
  const f = await fixture(); await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, "a".repeat(64)), /review changed/);
  const p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name); await writeFile(path.join(f.root, "extra-note.tex"), "New human note");
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId), /Saved local files changed/);
  assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).revision, f.localStore.revision);
});
test("all source/catalogue/review/policy paths are held, not disguised as notebook collection", async () => {
  const f = await fixture();
  for (const target of ["source/main.tex", "data/notebook.json", "data/workbench.json", "project/manuscripts.json", "data/experiments/../notebook.ipynb"]) await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, target), /existing experiment notebook only/);
});
test("unresolved code/output conflicts cannot be forced by a review token", async () => {
  const f = await fixture(), nb = structuredClone(f.localNb); nb.cells[2].source = "print('human changed code')";
  await writeExperiments(f.workspace, f.projectId, "owner", f.localStore.revision, nb);
  const local = await captureSyncSnapshot(f.workspace, f.projectId, f.base); await stageSyncSnapshot(f.workspace, f.projectId, local);
  const plan = await previewStagedSync(f.workspace, f.projectId, local.id, f.remote.id);
  await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, plan.id, name), /unresolved/);
});
test("cell removals and kind changes remain for explicit organization", async () => {
  for (const edit of [(nb: ExperimentNotebook) => { nb.cells.splice(1, 1); }, (nb: ExperimentNotebook) => { nb.cells[1].cell_type = "raw"; }]) {
    const f = await fixture(edit); await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, name), /Removed cells|cell kinds/);
  }
});
test("new output/run identity must match the cell, without inventing verification", async () => {
  const f = await fixture(nb => { nb.cells[2].metadata.paperfocus!.runId = "missing-run"; });
  await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, name), /matching immutable run/);
});
test("collection cannot resurrect filed or trashed cells", async () => {
  for (const flag of ["filed", "deleted"] as const) {
    const f = await fixture(nb => { nb.cells[1].metadata.paperfocus![flag] = false; }, undefined, nb => { nb.cells[1].metadata = { paperfocus: { [flag]: true } }; });
    await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, name), /resurrect/);
  }
});
test("queued/working run records cannot be replayed or imported as finished", async () => {
  const f = await fixture(undefined, records => records.map(record => record.path === runName ? syncRecord(runName, "run", Buffer.from(JSON.stringify({ id: "test-run", cellId: "code", status: "working" }))) : record));
  await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, name), /unsettled run/);
});
test("interruption before writing retains the full backup and resumes the identical review", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterBackup: () => { throw new Error("Synthetic stop"); } }), /Synthetic stop.*Collection retained/);
  assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).revision, f.localStore.revision); assert.equal((await notebookCollectionStatus(f.workspace, f.projectId, p.collectionId)).partial, true);
  assert.equal((await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId)).completed, true);
});
test("interruption after immutable run copying does not duplicate or overwrite runs", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterRuns: () => { throw new Error("Synthetic stop"); } }), /Synthetic stop/);
  const run = path.join(path.dirname(f.localStore.path), "runs/test-run.json"), before = await readFile(run);
  const done = await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId); assert.equal(done.completed, true); assert.deepEqual(await readFile(run), before);
});
test("interruption after the guarded save is recognized without saving or executing twice", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterSave: () => { throw new Error("Synthetic stop"); } }), /Synthetic stop/);
  assert.equal((await notebookCollectionStatus(f.workspace, f.projectId, p.collectionId)).completed, false);
  const before = await readFile(f.localStore.path), done = await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId);
  assert.equal(done.completed, true); assert.deepEqual(await readFile(f.localStore.path), before);
});
test("a changed partial notebook/run stays untouched and cannot be forced on retry", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterRuns: () => { throw new Error("Stop"); } }), /Stop/);
  const current = await readExperiments(f.workspace, f.projectId, "owner"); current.notebook.cells[0].source = "Later human correction";
  await writeExperiments(f.workspace, f.projectId, "owner", current.revision, current.notebook);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId), /Notebook changed during collection/);
  assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).notebook.cells[0].source, "Later human correction");
});
test("new human context during run copying stays saved and stops the notebook write", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterRuns: async () => {
    const current = await readNotebook(f.workspace, f.projectId); current.entries[0].notes = "A new human direction"; await writeNotebook(f.workspace, f.projectId, current.revision, current.entries);
  } }), /Other saved local work changed/);
  assert.equal((await readNotebook(f.workspace, f.projectId)).entries[0].notes, "A new human direction"); assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).revision, f.localStore.revision);
});
test("completed retry never replaces later local research", async () => {
  const f = await fixture(), done = await commit(f), current = await readExperiments(f.workspace, f.projectId, "owner"); current.notebook.cells[0].source = "Later human correction";
  await writeExperiments(f.workspace, f.projectId, "owner", current.revision, current.notebook);
  assert.equal((await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, done.collectionId)).alreadyComplete, true);
  assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).notebook.cells[0].source, "Later human correction");
});
test("run lease blocks collection without stealing/stopping a computation", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name), release = await acquireRecordLock(path.join(path.dirname(f.localStore.path), "python-run"), 0);
  try { await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId), /locked by another writer/); } finally { await release(); }
  assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).revision, f.localStore.revision);
  assert.equal((await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId)).completed, true);
});
test("source/main-file changes during partial collection stop completion while retaining both", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterSave: async () => { const r = await registry(f.workspace); r.projects.find(project => project.id === f.projectId)!.engine = "xelatex"; await saveRegistry(f.workspace, r); } }), /selection changed/);
  assert.equal((await notebookCollectionStatus(f.workspace, f.projectId, p.collectionId)).completed, false); assert.equal((await readExperiments(f.workspace, f.projectId, "owner")).revision, p.afterRevision);
});
test("routine queue clock changes do not trigger replacement or lose the current clock", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  const wb = await readWorkbench(f.workspace, f.projectId); await writeWorkbench(f.workspace, f.projectId, wb.revision, { ...wb, queueLastActiveAt: stamp });
  await commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId); assert.equal((await readWorkbench(f.workspace, f.projectId)).queueLastActiveAt, stamp);
});
test("linked run destinations and corrupt candidate blobs cannot be imported", async () => {
  const f = await fixture(), elsewhere = path.join(f.workspace, "unrelated"); await mkdir(elsewhere);
  await symlink(elsewhere, path.join(path.dirname(f.localStore.path), "runs"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => previewNotebookCollection(f.workspace, f.projectId, f.planId, name), /linked/);
  const g = await fixture(), blob = await privateSyncPath(g.workspace, `blobs/${g.remote.records.find(record => record.path === name)!.sha256}.blob`); await writeFile(blob, "Changed synthetic blob");
  await assert.rejects(() => previewNotebookCollection(g.workspace, g.projectId, g.planId, name), /checksum/);
});
test("changed backups and false completion receipts are rejected without repair", async () => {
  const f = await fixture(), p = await previewNotebookCollection(f.workspace, f.projectId, f.planId, name);
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId, { afterRuns: () => { throw new Error("Stop"); } }), /Stop/);
  const folder = (await notebookCollectionStatus(f.workspace, f.projectId, p.collectionId)).folder, backup = path.join(folder, "before.json"); await writeFile(backup, "{}");
  await assert.rejects(() => commitNotebookCollection(f.workspace, f.projectId, f.planId, name, p.collectionId), /Unsupported sync format/);
  assert.equal(await readFile(backup, "utf8"), "{}");
  const g = await fixture(), done = await commit(g), ready = path.join(done.folder, "ready.json"), receipt = JSON.parse(await readFile(ready, "utf8")); receipt.approvalGranted = true; await writeFile(ready, JSON.stringify(receipt));
  await assert.rejects(() => notebookCollectionStatus(g.workspace, g.projectId, done.collectionId), /receipt changed/);
});
test("CLI is preview-first, scope-bound and requires a separate exact review token", async () => {
  const f = await fixture(); assert.throws(() => syncOptions(["collect", ...f.scope, "--commit"]), /--review/);
  const p = await syncCommand(["collect", ...f.scope]) as any; assert.equal(p.liveImport, false);
  const done = await syncCommand(["collect", ...f.scope, "--review", p.collectionId, "--commit"]) as any;
  const status = await syncCommand(["collect-status", "--workspace", f.workspace, "--project", f.projectId, "--collection", done.collectionId]) as any;
  assert.equal(status.completed, true); assert.equal(status.sourceWrites, false);
});
