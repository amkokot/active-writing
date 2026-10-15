import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { captureSyncSnapshot, initializeSyncDevice } from "./deviceSync.ts";
import { makeSnapshot, syncRecord, syncHash, syncLimits, type SyncSnapshot } from "./syncProtocol.ts";
import { stageSyncSnapshot, previewStagedSync } from "./syncStaging.ts";
import { previewConversationCollection, commitConversationCollection, conversationCollectionStatus } from "./syncConversationCollect.ts";
import { checkCollectionFootprint } from "./syncCollect.ts";
import { createPaperProject } from "./projectFiles.ts";
import { getProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { readWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import type { NotebookEntry } from "../src/types.ts";
import { syncCommand, syncOptions } from "../scripts/awSync.ts";
import { acquireRecordLock } from "./recordLock.ts";

const stamp = "2026-10-14T00:00:00Z", selected = ["desktop-a", "desktop-b"];
const entry = (id: string, owner: string): NotebookEntry => ({ id, experimentNotebookId: owner, manuscriptFile: "main.tex", title: id, question: "Synthetic research branch", notes: "Keep the original context", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp });
async function fixture(options: { empty?: boolean; change?: (entries: NotebookEntry[]) => void } = {}) {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(path.join(parent, "conversation-collect-")), project = await createPaperProject(workspace, "Synthetic conversation bundle"), root = (await getProject(workspace, project.id)).root;
  await initializeSyncDevice(workspace, "Laptop"); await writeWorkbench(workspace, project.id, 0, emptyWorkbench());
  if (!options.empty) {
    await writeNotebook(workspace, project.id, 0, [entry("original", "existing-owner")]);
    await writeExperiments(workspace, project.id, "existing-owner", "", { ...newExperimentNotebook(), cells: [{ id: "human", cell_type: "markdown", source: "Existing human evidence", metadata: {} }] });
  }
  const data = path.join(workspace, ".paperfocus/project-data", project.id), catFile = path.join(data, "notebook.json");
  if (!options.empty) { const raw = JSON.parse(await readFile(catFile, "utf8")); raw.extension = { preserve: "unknown catalogue metadata" }; await writeFile(catFile, JSON.stringify(raw)); }
  const base = await captureSyncSnapshot(workspace, project.id), original = await readNotebook(workspace, project.id);
  if (!options.empty) { original.entries[0].notes = "Human offline correction"; await writeNotebook(workspace, project.id, original.revision, original.entries); }
  const local = await captureSyncSnapshot(workspace, project.id, base), before = await readNotebook(workspace, project.id);
  const incoming = [entry("desktop-a", "owner-a"), entry("desktop-b", "owner-b")]; options.change?.(incoming);
  const remoteEntries = [...(options.empty ? [] : [entry("original", "existing-owner")]), ...incoming];
  const records = base.records.filter(record => record.path !== "data/notebook.json");
  records.push(syncRecord("data/notebook.json", "catalogue", Buffer.from(JSON.stringify({ version: 1, revision: 999, entries: remoteEntries }))));
  for (const item of incoming) {
    const owner = item.experimentNotebookId!, prefix = `data/experiments/${owner}/`, runId = `fixture-${owner}`;
    if (records.some(record => record.path === `${prefix}notebook.ipynb`)) continue;
    records.push(syncRecord(`${prefix}notebook.ipynb`, "experiment", Buffer.from(JSON.stringify({ ...newExperimentNotebook(), metadata: { synthetic: true, preserveUnknown: "value" }, cells: [
      { id: "summary", cell_type: "markdown", source: `Synthetic ${item.id} explanation`, metadata: { paperfocus: { pinned: true } } },
      { id: "code", cell_type: "code", source: "# Synthetic fixture only; never executed", execution_count: 1,
        outputs: [{ output_type: "stream", name: "stdout", text: "SYNTHETIC, NOT EXECUTED\n" }], metadata: { paperfocus: { runId, execution: { mode: "fresh", runtime: { executable: "C:/historical/python.exe", python: "synthetic", packages: {} } } } } }
    ] }))));
    records.push(syncRecord(`${prefix}runs/${runId}.json`, "run", Buffer.from(JSON.stringify({ id: runId, cellId: "code", status: "ready", synthetic: true }))));
  }
  const remote = makeSnapshot(project.id, { version: 1, id: "synthetic-desktop", label: "Desktop" }, records, base);
  for (const snapshot of [base, local, remote]) await stageSyncSnapshot(workspace, project.id, snapshot);
  const plan = await previewStagedSync(workspace, project.id, local.id, remote.id);
  return { workspace, projectId: project.id, root, data, catFile, base, local, remote, before, planId: plan.id, incoming, scope: ["--workspace", workspace, "--project", project.id, "--plan", plan.id, "--entries", selected.join(",")] };
}
const preview = (f: Awaited<ReturnType<typeof fixture>>) => previewConversationCollection(f.workspace, f.projectId, f.planId, selected);
const commit = (f: Awaited<ReturnType<typeof fixture>>, id: string, hooks?: Parameters<typeof commitConversationCollection>[5]) => commitConversationCollection(f.workspace, f.projectId, f.planId, selected, id, hooks);

test("new-conversation preview is read-only and keeps exact entry/owner identities", async () => {
  const f = await fixture(), before = await readFile(f.catFile), p = await preview(f);
  assert.deepEqual(p.entries.map(entry => entry.id), selected); assert.deepEqual(p.entries.map(entry => entry.notebookId), ["owner-a", "owner-b"]);
  assert.equal(p.liveImport, false); assert.equal(p.tasksCompleted, false); assert.equal(p.afterCatalogueRevision, f.before.revision + 1);
  assert.deepEqual(await readFile(f.catFile), before); await assert.rejects(stat(path.join(f.data, "experiments/owner-a")), /ENOENT/);
});
test("an unrelated catalogue conflict remains held while a new branch can be added", async () => {
  const f = await fixture(), records = f.remote.records.map(record => {
    if (record.path !== "data/notebook.json") return record;
    const value = JSON.parse(Buffer.from(record.data, "base64").toString()); value.entries[0].notes = "Conflicting desktop revision to existing notes";
    return syncRecord(record.path, record.kind, Buffer.from(JSON.stringify(value)));
  });
  const remote = makeSnapshot(f.projectId, f.remote.device, records, f.base); await stageSyncSnapshot(f.workspace, f.projectId, remote);
  const plan = await previewStagedSync(f.workspace, f.projectId, f.local.id, remote.id), p = await previewConversationCollection(f.workspace, f.projectId, plan.id, selected);
  assert.ok(p.heldConflicts > 0); await commitConversationCollection(f.workspace, f.projectId, plan.id, selected, p.collectionId);
  assert.equal((await readNotebook(f.workspace, f.projectId)).entries[0].notes, "Human offline correction");
});
test("bundle publishes new evidence then catalogue, preserving human notes and unknown metadata", async () => {
  const f = await fixture(), p = await preview(f), source = await readFile(path.join(f.root, "main.tex")), wb = await readWorkbench(f.workspace, f.projectId), existing = await readExperiments(f.workspace, f.projectId, "existing-owner");
  const done = await commit(f, p.collectionId), saved = await readNotebook(f.workspace, f.projectId);
  assert.equal(done.completed, true); assert.equal(done.codeExecuted, false); assert.equal(done.sourceWrites, false); assert.equal(done.tasksCompleted, false); assert.equal(done.approvalGranted, false);
  assert.equal(saved.revision, f.before.revision + 1); assert.deepEqual(saved.entries[0], f.before.entries[0]); assert.deepEqual(saved.entries.slice(1), f.incoming);
  assert.deepEqual((saved as any).extension, { preserve: "unknown catalogue metadata" }); assert.deepEqual((await readExperiments(f.workspace, f.projectId, "existing-owner")).notebook, existing.notebook);
  const owner = await readExperiments(f.workspace, f.projectId, "owner-a"); assert.match(owner.notebook.cells[1].outputs![0].text as string, /NOT EXECUTED/); assert.equal(owner.notebook.cells[1].metadata.paperfocus?.execution?.runtime?.executable, "C:/historical/python.exe");
  assert.deepEqual(await readWorkbench(f.workspace, f.projectId), wb); assert.deepEqual(await readFile(path.join(f.root, "main.tex")), source);
  assert.equal((await conversationCollectionStatus(f.workspace, f.projectId, done.collectionId)).completed, true);
});
test("a first catalogue is created with revision one without a fake local conversation", async () => {
  const f = await fixture({ empty: true }), p = await preview(f); assert.equal(p.beforeCatalogueRevision, 0); await assert.rejects(stat(f.catFile), /ENOENT/);
  const done = await commit(f, p.collectionId); assert.equal(done.catalogueRevision, 1); assert.deepEqual((await readNotebook(f.workspace, f.projectId)).entries.map(entry => entry.id), selected);
});
test("existing conversations and shared/local experiment owners are never replaced", async () => {
  const f = await fixture(); await assert.rejects(() => previewConversationCollection(f.workspace, f.projectId, f.planId, ["original"]), /only adds new/);
  const g = await fixture({ change: entries => { entries[0].experimentNotebookId = "existing-owner"; } }); await assert.rejects(() => preview(g), /distinct new experiment owner/);
});
test("pending requests are held while explicitly closed history keeps its IDs", async () => {
  const f = await fixture({ change: entries => { entries[0].handoffs = [{ id: "waiting", packet: "Synthetic pending task", createdAt: stamp }]; } }); await assert.rejects(() => preview(f), /waiting requests/);
  const g = await fixture({ change: entries => { entries[0].study = { mode: "understand", depth: "intuition", action: "explain", background: "", localEffort: 1, turns: [{ id: "old-turn", action: "explain", depth: "intuition", route: "codex", packet: "Historical fixture", reply: "Kept history", status: "ready", closed: true, createdAt: stamp }] }; } });
  const p = await preview(g); await commit(g, p.collectionId); assert.equal((await readNotebook(g.workspace, g.projectId)).entries.find(entry => entry.id === "desktop-a")!.study!.turns[0].id, "old-turn");
});
test("ready answers remain unreviewed instead of requiring a manual close before transfer", async () => {
  const f = await fixture({ change: entries => { entries[0].study = { mode: "understand", depth: "intuition", action: "explain", background: "", localEffort: 1, turns: [{ id: "ready-unreviewed", action: "explain", depth: "intuition", route: "codex", packet: "Synthetic completed response", reply: "Needs the human's assessment", status: "ready", closed: false, createdAt: stamp }] }; } });
  const p = await preview(f), done = await commit(f, p.collectionId), copied = (await readNotebook(f.workspace, f.projectId)).entries.find(entry => entry.id === "desktop-a")!.study!.turns[0];
  assert.equal(copied.closed, false); assert.equal(copied.status, "ready"); assert.equal(done.tasksCompleted, false);
});
test("missing roots, recovery drafts and duplicate/oversized selections stop before import", async () => {
  const f = await fixture({ change: entries => { entries[0].manuscriptFile = "desktop-only.tex"; } }); await assert.rejects(() => preview(f), /root is not available/);
  const g = await fixture({ change: entries => { entries[0].recoveryKey = "synthetic-draft"; } }); await assert.rejects(() => preview(g), /recovery draft/);
  await assert.rejects(() => previewConversationCollection(g.workspace, g.projectId, g.planId, ["desktop-a", "desktop-a"]), /distinct/);
  await assert.rejects(() => previewConversationCollection(g.workspace, g.projectId, g.planId, Array.from({ length: 9 }, (_, i) => `entry-${i}`)), /1–8/);
});
test("existing hidden owner files or linked destinations are not adopted", async () => {
  const f = await fixture(), folder = path.join(f.data, "experiments/owner-a"); await mkdir(folder); await writeFile(path.join(folder, ".private"), "Keep this hidden work");
  await assert.rejects(() => preview(f), /folder already exists/); assert.equal(await readFile(path.join(folder, ".private"), "utf8"), "Keep this hidden work");
  const g = await fixture(), outside = path.join(g.workspace, "unrelated"); await mkdir(outside); await symlink(outside, path.join(g.data, "experiments/owner-a"), process.platform === "win32" ? "junction" : "dir"); await assert.rejects(() => preview(g), /linked/);
});
test("exact review mismatch and new local notes make no imports", async () => {
  const f = await fixture(); await assert.rejects(() => commit(f, "a".repeat(64)), /review changed/);
  const p = await preview(f), current = await readNotebook(f.workspace, f.projectId); current.entries[0].notes = "A newer human correction"; await writeNotebook(f.workspace, f.projectId, current.revision, current.entries);
  await assert.rejects(() => commit(f, p.collectionId), /Saved local files changed/); assert.equal((await readNotebook(f.workspace, f.projectId)).entries.length, 1);
});
test("interruption after one owner leaves catalogue unpublished and resumes exact files", async () => {
  const f = await fixture(), p = await preview(f);
  await assert.rejects(() => commit(f, p.collectionId, { afterOwner: count => { if (count === 1) throw new Error("Synthetic stop"); } }), /Synthetic stop/);
  assert.deepEqual(await readNotebook(f.workspace, f.projectId), f.before); assert.equal((await conversationCollectionStatus(f.workspace, f.projectId, p.collectionId)).partial, true);
  const owner = await readExperiments(f.workspace, f.projectId, "owner-a"), done = await commit(f, p.collectionId); assert.equal(done.completed, true); assert.equal((await readExperiments(f.workspace, f.projectId, "owner-a")).revision, owner.revision);
});
test("interruption after catalogue save resumes without a second revision increment", async () => {
  const f = await fixture(), p = await preview(f); await assert.rejects(() => commit(f, p.collectionId, { afterCatalogue: () => { throw new Error("Synthetic stop"); } }), /Synthetic stop/);
  assert.equal((await conversationCollectionStatus(f.workspace, f.projectId, p.collectionId)).completed, false);
  const before = await readFile(f.catFile); const done = await commit(f, p.collectionId); assert.equal(done.completed, true); assert.deepEqual(await readFile(f.catFile), before);
});
test("changed prepared evidence and same-counter catalogue edits are preserved on retry", async () => {
  const f = await fixture(), p = await preview(f); await assert.rejects(() => commit(f, p.collectionId, { afterOwner: () => { throw new Error("Stop"); } }), /Stop/);
  const owner = await readExperiments(f.workspace, f.projectId, "owner-a"); owner.notebook.cells[0].source = "New human direction"; await writeExperiments(f.workspace, f.projectId, "owner-a", owner.revision, owner.notebook);
  await assert.rejects(() => commit(f, p.collectionId), /prepared notebook\/run changed/); assert.equal((await readExperiments(f.workspace, f.projectId, "owner-a")).notebook.cells[0].source, "New human direction");
  const g = await fixture(), gp = await preview(g); await assert.rejects(() => commit(g, gp.collectionId, { afterOwner: async count => { if (count === 1) { const raw = JSON.parse(await readFile(g.catFile, "utf8")); raw.entries[0].notes = "Same-counter external correction"; await writeFile(g.catFile, JSON.stringify(raw)); } } }), /catalogue changed/);
  assert.equal((await readNotebook(g.workspace, g.projectId)).entries[0].notes, "Same-counter external correction");
});
test("completed retries do not remove later conversations or overwrite notebook edits", async () => {
  const f = await fixture(), p = await preview(f); await commit(f, p.collectionId);
  const current = await readNotebook(f.workspace, f.projectId); current.entries.push(entry("later-human", "later-owner")); await writeNotebook(f.workspace, f.projectId, current.revision, current.entries);
  assert.equal((await commit(f, p.collectionId)).alreadyComplete, true); assert.equal((await readNotebook(f.workspace, f.projectId)).entries.at(-1)!.id, "later-human");
});
test("a busy new owner is not stopped and the identical review can resume later", async () => {
  const f = await fixture(), p = await preview(f); let release: (() => Promise<void>) | undefined;
  await assert.rejects(() => commit(f, p.collectionId, { afterBackup: async () => {
    const folder = path.join(f.data, "experiments/owner-a"); await mkdir(folder); await writeFile(path.join(folder, ".aw-collection.json"), JSON.stringify({ version: 1, projectId: f.projectId, owner: "owner-a", collectionId: p.collectionId }) + "\n"); release = await acquireRecordLock(path.join(folder, "python-run"), 0);
  } }), /locked by another writer/);
  assert.deepEqual(await readNotebook(f.workspace, f.projectId), f.before); await release!(); assert.equal((await commit(f, p.collectionId)).completed, true);
});
test("all other owned leases are released even if one lease was changed externally", async () => {
  const f = await fixture(), p = await preview(f), changed = path.join(f.data, "experiments/owner-b/python-run.aw-lock");
  await assert.rejects(() => commit(f, p.collectionId, { afterOwner: async count => { if (count === 1) { await writeFile(changed, JSON.stringify({ token: "different-owner", pid: 123, createdAt: stamp })); throw new Error("Synthetic interruption"); } } }), /all other owned leases were released/);
  await assert.rejects(stat(path.join(f.data, "experiments/owner-a/python-run.aw-lock")), /ENOENT/); assert.equal(JSON.parse(await readFile(changed, "utf8")).token, "different-owner");
});
test("catalogue hash guards reject same-counter edits and preserve unknown fields", async () => {
  const f = await fixture(), bytes = await readFile(f.catFile), hash = syncHash(bytes), original = JSON.parse(bytes.toString()); original.entries[0].notes = "External edit with unchanged revision"; await writeFile(f.catFile, JSON.stringify(original));
  await assert.rejects(() => writeNotebook(f.workspace, f.projectId, original.revision, original.entries, hash), /Catalogue bytes changed/);
  const current = await readFile(f.catFile); const saved = await writeNotebook(f.workspace, f.projectId, original.revision, original.entries, syncHash(current)); assert.deepEqual((saved as any).extension, original.extension);
});
test("collection footprint budgets hold oversize projects before any live copying", () => {
  const before = { records: [{ path: "source/big.bin", bytes: syncLimits.totalBytes - 1 }] } as unknown as SyncSnapshot;
  assert.throws(() => checkCollectionFootprint(before, [{ path: "data/notebook.json", bytes: 2 }]), /payload limit/);
  assert.throws(() => checkCollectionFootprint({ records: [] } as unknown as SyncSnapshot, [{ path: "data/experiments/new/notebook.ipynb", bytes: 5_000_001 }]), /saved-record size limit/);
});
test("the same collect/status commands support entries but refuse ambiguous mixed scope", async () => {
  const f = await fixture(); assert.throws(() => syncOptions(["collect", ...f.scope, "--path", "data/experiments/new/notebook.ipynb"]), /collection needs/);
  assert.throws(() => syncOptions(["collect", ...f.scope, "--commit"]), /--review/);
  const p = await syncCommand(["collect", ...f.scope]) as any, done = await syncCommand(["collect", ...f.scope, "--review", p.collectionId, "--commit"]) as any;
  const status = await syncCommand(["collect-status", "--workspace", f.workspace, "--project", f.projectId, "--collection", done.collectionId]) as any; assert.equal(status.completed, true); assert.equal(status.tasksCompleted, false);
});
