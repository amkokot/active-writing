import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createPaperProject } from "./projectFiles.ts";
import { getProject, registry, saveRegistry } from "./projects.ts";
import { captureSyncSnapshot, initializeSyncDevice, privateSyncPath, saveSyncSnapshot } from "./deviceSync.ts";
import { hydrateStagedSnapshot, prepareSyncReview, previewStagedSync, stageSyncSnapshot, stagedHistory, stagedPlan, stagedSnapshots } from "./syncStaging.ts";
import { canonical, makeSnapshot, syncHash, syncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { writeNotebook } from "./notebookStore.ts";
import { writeExperiments } from "./experiments.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import type { NotebookEntry } from "../src/types.ts";
import { syncCommand } from "../scripts/awSync.ts";
import { latexMiddleware } from "./latexPlugin.ts";

function entry(id: string, notes: string): NotebookEntry {
  return { id, title: id, question: "Synthetic research question", notes, reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };
}
async function fixture() {
  const trials = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const left = await mkdtemp(path.join(trials, "staging-laptop-")), right = await mkdtemp(path.join(trials, "staging-desktop-"));
  const first = await createPaperProject(left, "Synthetic remote research"), second = await createPaperProject(right, "Synthetic remote research");
  const root = (await getProject(left, first.id)).root, other = (await getProject(right, second.id)).root;
  await cp(root, other, { recursive: true });
  const r = await registry(right); r.projects = r.projects.map(item => item.id === second.id ? { ...first, folder: second.folder } : item); await saveRegistry(right, r);
  await initializeSyncDevice(left, "Laptop"); await initializeSyncDevice(right, "Desktop");
  await writeNotebook(left, first.id, 0, [entry("question", "Original")]); await writeNotebook(right, first.id, 0, [entry("question", "Original")]);
  const base = await captureSyncSnapshot(left, first.id);
  await writeNotebook(left, first.id, 1, [entry("question", "Human offline note")]);
  await writeNotebook(right, first.id, 1, [entry("question", "Original"), entry("result", "Desktop finding")]);
  const local = await captureSyncSnapshot(left, first.id, base), remote = await captureSyncSnapshot(right, first.id, base);
  return { left, right, root, projectId: first.id, base, local, remote };
}
async function stageAll(f: Awaited<ReturnType<typeof fixture>>) {
  for (const snapshot of [f.base, f.local, f.remote]) await stageSyncSnapshot(f.left, f.projectId, snapshot);
}
function rehash(snapshot: SyncSnapshot) { const { id: _id, ...body } = snapshot; return { ...body, id: syncHash(canonical(body)) }; }

test("staging reuses checked content-addressed blobs and remains outside live project stores", async () => {
  const f = await fixture(), live = await readFile(path.join(f.left, ".paperfocus/project-data", f.projectId, "notebook.json"));
  const first = await stageSyncSnapshot(f.left, f.projectId, f.base), again = await stageSyncSnapshot(f.left, f.projectId, f.base);
  assert.ok(first.createdBlobs > 0); assert.equal(again.createdBlobs, 0); assert.equal(again.reusedBlobs, first.createdBlobs);
  const next = await stageSyncSnapshot(f.left, f.projectId, f.local); assert.ok(next.reusedBlobs > 0); assert.equal(next.liveImport, false);
  assert.deepEqual(await hydrateStagedSnapshot(f.left, f.projectId, f.local.id), f.local);
  assert.deepEqual(await readFile(path.join(f.left, ".paperfocus/project-data", f.projectId, "notebook.json")), live);
});

test("an interrupted stage is visibly incomplete and resumes without duplicate evidence", async () => {
  const f = await fixture();
  await assert.rejects(() => stageSyncSnapshot(f.left, f.projectId, f.base, { afterBlob: count => { if (count === 1) throw new Error("Synthetic disconnect"); } }), /disconnect/);
  const pending = await stagedSnapshots(f.left, f.projectId); assert.equal(pending[0].ready, false);
  const resumed = await stageSyncSnapshot(f.left, f.projectId, f.base); assert.equal(resumed.reusedBlobs, 1); assert.equal((await stagedSnapshots(f.left, f.projectId))[0].ready, true);
  assert.deepEqual(await hydrateStagedSnapshot(f.left, f.projectId, f.base.id), f.base);
});

test("comparison waits for actual parent history and chooses the shared baseline without clocks", async () => {
  const f = await fixture(); await stageSyncSnapshot(f.left, f.projectId, f.local); await stageSyncSnapshot(f.left, f.projectId, f.remote);
  assert.deepEqual((await stagedHistory(f.left, f.projectId, [f.local.id, f.remote.id])).missing, [f.base.id]);
  await assert.rejects(() => previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id), /missing parent/);
  await stageSyncSnapshot(f.left, f.projectId, f.base);
  const result = await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id); assert.equal(result.plan.base, f.base.id); assert.equal(result.plan.conflicts.length, 0); assert.equal(result.historyChecked, true);
  assert.equal((await stagedPlan(f.left, f.projectId, result.id)).id, result.id);
});

test("unfinished intermediate staging blocks comparison even when the parent manifest exists", async () => {
  const f = await fixture();
  await assert.rejects(() => stageSyncSnapshot(f.left, f.projectId, f.base, { afterBlob: () => { throw new Error("Interrupt"); } }), /Interrupt/);
  await stageSyncSnapshot(f.left, f.projectId, f.local); await stageSyncSnapshot(f.left, f.projectId, f.remote);
  await assert.rejects(() => previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id), /incomplete snapshots/);
  await stageSyncSnapshot(f.left, f.projectId, f.base); assert.equal((await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id)).plan.conflicts.length, 0);
});

test("forged ancestry and missing deletion history are rejected after checksum-valid staging", async () => {
  const f = await fixture(); await stageSyncSnapshot(f.left, f.projectId, f.base);
  const forged = rehash({ ...f.local, ancestors: [...f.local.ancestors, syncHash("invented ancestor")] }); await stageSyncSnapshot(f.left, f.projectId, forged);
  await assert.rejects(() => stagedHistory(f.left, f.projectId, [forged.id]), /does not match/);
  const omitted = rehash({ ...f.local, records: f.local.records.filter(record => record.path !== "source/main.tex"), tombstones: [] }); await stageSyncSnapshot(f.left, f.projectId, omitted);
  await assert.rejects(() => stagedHistory(f.left, f.projectId, [omitted.id]), /deletion history/);
});

test("nearest common baseline is selected through the verified graph, not the oldest root", async () => {
  const f = await fixture(), shared = f.local;
  const left = makeSnapshot(f.projectId, shared.device, shared.records, shared), right = makeSnapshot(f.projectId, f.remote.device, shared.records, shared);
  for (const snapshot of [f.base, shared, left, right]) await stageSyncSnapshot(f.left, f.projectId, snapshot);
  assert.equal((await previewStagedSync(f.left, f.projectId, left.id, right.id)).plan.base, shared.id);
});

test("review preparation is replayable, retains both devices' notes and leaves live records untouched", async () => {
  const f = await fixture(); await stageAll(f); const result = await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id);
  const prepared = await prepareSyncReview(f.left, f.projectId, result.id); assert.equal(prepared.liveImport, false); assert.equal(prepared.applySupported, false);
  const copy = JSON.parse(await readFile(path.join(prepared.folder, "candidates/data/notebook.json"), "utf8"));
  assert.equal(copy.entries.find((item: NotebookEntry) => item.id === "question").notes, "Human offline note"); assert.equal(copy.entries.length, 2);
  const live = JSON.parse(await readFile(path.join(f.left, ".paperfocus/project-data", f.projectId, "notebook.json"), "utf8")); assert.equal(live.entries.length, 1);
  assert.equal((await prepareSyncReview(f.left, f.projectId, result.id)).folder, prepared.folder);
});

test("new local notes and revisions invalidate a pending preparation, not the original draft", async () => {
  const f = await fixture(); await stageAll(f); const result = await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id);
  await writeNotebook(f.left, f.projectId, 2, [entry("question", "A newer human note")]);
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, result.id), /changed after this plan/);
  await writeNotebook(f.left, f.projectId, 3, [entry("question", "Human offline note")]);
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, result.id), /changed after this plan/);
  assert.equal((await stagedPlan(f.left, f.projectId, result.id)).id, result.id);
});

test("source edits and the wrong local installation cannot prepare an outdated or reversed plan", async () => {
  const f = await fixture(); await stageAll(f);
  const reversed = await previewStagedSync(f.left, f.projectId, f.remote.id, f.local.id);
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, reversed.id), /another installation/);
  const result = await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id);
  const target = path.join(f.root, "main.tex"), original = await readFile(target, "utf8");
  await writeFile(target, original + "\n% New human source edit\n");
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, result.id), /changed after this plan/);
  assert.equal(await readFile(target, "utf8"), original + "\n% New human source edit\n");
});

test("initializing review metadata after capture reports the changed file without weakening the guard", async () => {
  const f = await fixture(); await stageAll(f); const result = await previewStagedSync(f.left, f.projectId, f.local.id, f.remote.id);
  const { writeWorkbench } = await import("./workbenchStore.ts"), { emptyWorkbench } = await import("../src/workbench.ts");
  await writeWorkbench(f.left, f.projectId, 0, emptyWorkbench());
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, result.id), /changed after this plan: data\/workbench\.json/);
});

test("queue activity does not stale a detached review, but a new saved concern still does", async () => {
  const f = await fixture();
  const { writeWorkbench } = await import("./workbenchStore.ts"), { emptyWorkbench } = await import("../src/workbench.ts");
  await writeWorkbench(f.left, f.projectId, 0, emptyWorkbench());
  const local = await captureSyncSnapshot(f.left, f.projectId, f.local);
  await stageAll(f); await stageSyncSnapshot(f.left, f.projectId, local);
  const result = await previewStagedSync(f.left, f.projectId, local.id, f.remote.id);
  await writeWorkbench(f.left, f.projectId, 1, { ...emptyWorkbench(), queueLastActiveAt: "2026-10-13T12:00:00Z" });
  assert.equal((await prepareSyncReview(f.left, f.projectId, result.id)).liveImport, false);
  await writeWorkbench(f.left, f.projectId, 2, { ...emptyWorkbench(), attentionTasks: [{ id: "new-concern", title: "Check assumption", nodeId: "synthetic-node", createdAt: "2026-10-13T12:01:00Z", updatedAt: "2026-10-13T12:01:00Z", route: "codex", status: "queued" }] });
  await assert.rejects(() => prepareSyncReview(f.left, f.projectId, result.id), /changed after this plan: data\/workbench\.json/);
});

test("staged inventories reject damaged kind/path metadata before presenting it as ready", async () => {
  const f = await fixture(); await stageSyncSnapshot(f.left, f.projectId, f.base);
  const filename = await privateSyncPath(f.left, `staged/${f.projectId}/${f.base.id}.json`);
  const saved = JSON.parse(await readFile(filename, "utf8")); saved.references[0].kind = "unknown-future-kind";
  const { referenceHash: _hash, ...body } = saved; saved.referenceHash = syncHash(canonical(body));
  await writeFile(filename, JSON.stringify(saved));
  await assert.rejects(() => stagedSnapshots(f.left, f.projectId), /Invalid staged file reference/);
});

test("conflicting manuscript variants remain in review records and never overwrite the source", async () => {
  const f = await fixture(), baseSource = f.base.records.find(record => record.path === "source/main.tex")!;
  await writeFile(path.join(f.root, "main.tex"), Buffer.from(baseSource.data, "base64").toString() + "\n% Human edit\n");
  const local = await captureSyncSnapshot(f.left, f.projectId, f.base), remote = makeSnapshot(f.projectId, f.remote.device, f.remote.records.map(record => record.path === baseSource.path ? syncRecord(record.path, record.kind, Buffer.from(Buffer.from(record.data, "base64").toString() + "\n% Agent edit\n")) : record), f.base);
  for (const snapshot of [f.base, local, remote]) await stageSyncSnapshot(f.left, f.projectId, snapshot);
  const result = await previewStagedSync(f.left, f.projectId, local.id, remote.id), prepared = await prepareSyncReview(f.left, f.projectId, result.id);
  const review = JSON.parse(await readFile(path.join(prepared.folder, "review.json"), "utf8")); assert.ok(review.conflicts.some((item: any) => item.path === "source/main.tex"));
  await assert.rejects(readFile(path.join(prepared.folder, "candidates/source/main.tex")), /ENOENT/); assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /Human edit/);
});

test("corrupted blobs and linked cache paths stop inspection without repairing or importing them", async () => {
  const f = await fixture(); await stageSyncSnapshot(f.left, f.projectId, f.base);
  const record = f.base.records[0], blob = await privateSyncPath(f.left, `blobs/${record.sha256}.blob`); await writeFile(blob, "corrupt");
  await assert.rejects(() => hydrateStagedSnapshot(f.left, f.projectId, f.base.id), /checksum/);
  await assert.rejects(() => stageSyncSnapshot(f.left, f.projectId, f.base), /immutable sync artifact differs/);
  assert.equal(await readFile(blob, "utf8"), "corrupt");
  const other = await fixture(), external = path.join(other.left, "outside-sync"); await mkdir(external);
  await symlink(external, await privateSyncPath(other.left, "blobs"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => stageSyncSnapshot(other.left, other.projectId, other.base), /cannot follow links/);
});

test("offline CLI stages, compares and prepares without a server or automatic execution", async () => {
  const f = await fixture(), scope = ["--workspace", f.left, "--project", f.projectId];
  for (const snapshot of [f.base, f.local, f.remote]) { const file = await saveSyncSnapshot(f.left, snapshot); await syncCommand(["stage", ...scope, "--file", file.path]); }
  const result = await syncCommand(["compare", ...scope, "--local", f.local.id, "--remote", f.remote.id]) as any;
  assert.equal(result.historyChecked, true); const prepared = await syncCommand(["prepare", ...scope, "--plan", result.planId]) as any; assert.equal(prepared.liveImport, false);
  assert.equal(((await syncCommand(["staged", ...scope])) as any).snapshots.length, 3);
});

test("local staging/compare endpoints enforce origin, project scope and explicit methods", async () => {
  const f = await fixture(), middleware = latexMiddleware(f.left), server = createServer((req, res) => { void middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (action: string, body: unknown) => fetch(`${origin}/api/paperfocus/device-sync/${action}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(`${origin}/api/paperfocus/device-sync/stage`)).status, 405);
    assert.equal((await fetch(`${origin}/api/paperfocus/device-sync/stage`, { method: "POST", body: "{}" })).status, 403);
    assert.equal((await post("stage", { projectId: randomUUID(), snapshot: f.base })).status, 400);
    for (const snapshot of [f.base, f.local, f.remote]) assert.equal((await post("stage", { projectId: f.projectId, snapshot })).status, 200);
    const status = await (await fetch(`${origin}/api/paperfocus/device-sync?projectId=${f.projectId}`)).json(); assert.equal(status.snapshots.length, 3); assert.equal(status.connected, false); assert.equal(status.folder, undefined);
    const response = await post("compare", { projectId: f.projectId, localId: f.local.id, remoteId: f.remote.id }); assert.equal(response.status, 200); const plan = await response.json(); assert.equal(plan.applySupported, false);
    const prepared = await post("prepare", { projectId: f.projectId, planId: plan.id }); assert.equal(prepared.status, 200); assert.equal((await prepared.json()).liveImport, false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
