import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { createPaperProject } from "./projectFiles.ts";
import { getProject } from "./projects.ts";
import { initializeSyncDevice, readSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { writeWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { createSyncInventory, exportSyncExchange, receiveSyncExchange, syncWorkingCheckpoint, exchangeStatus, acknowledgeSyncHead, semanticSyncHash, rememberSyncHead } from "./syncExchange.ts";
import { commitSyncClone, previewSyncClone } from "./syncClone.ts";
import { hydrateStagedSnapshot, previewStagedSync, stagedHistory } from "./syncStaging.ts";
import { previewResearchMerge, commitResearchMerge } from "./syncResearchMerge.ts";
import { canonical, syncHash, validateSnapshot } from "./syncProtocol.ts";
import { syncCommand } from "../scripts/awSync.ts";
import type { NotebookEntry } from "../src/types.ts";

const source = "\\documentclass{article}\n\\begin{document}\nFirst idea.\n\nContext.\n\nLast idea.\n\\end{document}\n";
async function copies() {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true }); const laptop = await mkdtemp(path.join(parent, "exchange-"));
  const project = await createPaperProject(laptop, "Synthetic reconnect"), projectId = project.id, lPaper = (await getProject(laptop, projectId)).root;
  await writeFile(path.join(lPaper, "main.tex"), source); await initializeSyncDevice(laptop, "Laptop"); await writeWorkbench(laptop, projectId, 0, emptyWorkbench());
  const stamp = "2026-10-14T00:00:00Z", entry: NotebookEntry = { id: "question", title: "Question", question: "Synthetic transfer test", notes: "First note.\n\nLast note.\n", reply: "", proposal: "", route: "codex", effort: 2, status: "open", handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp }; await writeNotebook(laptop, projectId, 0, [entry]);
  const baseline = await syncWorkingCheckpoint(laptop, projectId), snapshot = await readSyncSnapshot(baseline.path), desktop = path.join(laptop, "desktop");
  const options = { destination: desktop, label: "Desktop", mainFile: "main.tex" }, clone = await previewSyncClone(snapshot, options); await commitSyncClone(snapshot, options, clone.planId);
  const dPaper = (await getProject(desktop, projectId)).root;
  return { laptop, desktop, projectId, lPaper, dPaper, baseline, snapshot };
}
async function branches() {
  const f = await copies(); await writeFile(path.join(f.lPaper, "main.tex"), source.replace("First idea.", "Human offline edit.")); await writeFile(path.join(f.dPaper, "main.tex"), source.replace("Last idea.", "Desktop continuation."));
  const lCat = await readNotebook(f.laptop, f.projectId); lCat.entries[0].notes = lCat.entries[0].notes.replace("First note.", "Human note."); await writeNotebook(f.laptop, f.projectId, lCat.revision, lCat.entries);
  const dCat = await readNotebook(f.desktop, f.projectId); dCat.entries[0].notes = dCat.entries[0].notes.replace("Last note.", "Desktop note."); await writeNotebook(f.desktop, f.projectId, dCat.revision, dCat.entries);
  const local = await syncWorkingCheckpoint(f.laptop, f.projectId), remote = await syncWorkingCheckpoint(f.desktop, f.projectId); return { ...f, local, remote };
}
const alteredPacket = (bytes: Buffer, change: (packet: any) => void) => { const packet = JSON.parse(gunzipSync(bytes).toString()); change(packet); const { id: _id, ...body } = packet; packet.id = syncHash(canonical(body)); return gzipSync(Buffer.from(JSON.stringify(packet))); };

test("working checkpoints remember ancestry and reuse unchanged authored work", async () => {
  const f = await copies(), same = await syncWorkingCheckpoint(f.laptop, f.projectId); assert.equal(same.id, f.baseline.id); assert.equal(same.noAuthoredChanges, true);
  await writeFile(path.join(f.lPaper, "main.tex"), source + "% offline change\n"); const next = await syncWorkingCheckpoint(f.laptop, f.projectId), saved = await readSyncSnapshot(next.path); assert.deepEqual(saved.parents, [f.baseline.id]);
  const desktop = await syncWorkingCheckpoint(f.desktop, f.projectId); assert.deepEqual((await readSyncSnapshot(desktop.path)).parents, [f.baseline.id]); assert.notEqual((await syncStatus(f.desktop)).device!.id, (await syncStatus(f.laptop)).device!.id);
});
test("counter-only native saves get a fresh exact fence instead of a stale reused checkpoint", async () => {
  const f = await copies(), cat = await readNotebook(f.laptop,f.projectId); await writeNotebook(f.laptop,f.projectId,cat.revision,cat.entries);
  const checkpoint = await syncWorkingCheckpoint(f.laptop,f.projectId); assert.notEqual(checkpoint.id,f.baseline.id); assert.equal(checkpoint.noAuthoredChanges,true);
  assert.equal((await readSyncSnapshot(checkpoint.path)).records.find(record => record.path === "data/notebook.json")!.sha256, syncHash(await readFile(path.join(f.laptop,".paperfocus/project-data",f.projectId,"notebook.json"))));
});
test("a compressed exchange carries complete missing history and stages without applying", async () => {
  const f = await branches(), inventory = await createSyncInventory(f.laptop, f.projectId), packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id, inventory), before = await readFile(path.join(f.lPaper, "main.tex"));
  assert.equal(packet.manifests, 1); assert.ok(packet.blobCount > 0); const received = await receiveSyncExchange(f.laptop, f.projectId, packet.bytes); assert.equal(received.liveImport, false); assert.equal(received.head, f.remote.id); assert.deepEqual(await readFile(path.join(f.lPaper, "main.tex")), before);
  const history = await stagedHistory(f.laptop, f.projectId, [f.remote.id]); assert.deepEqual(history.missing, []); assert.deepEqual(history.pending, []);
  assert.equal((await exchangeStatus(f.laptop, f.projectId)).received[(await syncStatus(f.desktop)).device!.id].head, f.remote.id);
});
test("unchanged exchanges transfer no duplicated manifests or blobs", async () => {
  const f = await branches(), first = await exportSyncExchange(f.desktop, f.projectId, f.remote.id); await receiveSyncExchange(f.laptop, f.projectId, first.bytes);
  const second = await exportSyncExchange(f.desktop, f.projectId, f.remote.id, await createSyncInventory(f.laptop, f.projectId)); assert.equal(second.manifests, 0); assert.equal(second.blobCount, 0); assert.equal(second.dataBytes, 0);
  await receiveSyncExchange(f.laptop, f.projectId, second.bytes);
});
test("complete research collection joins history; matching peer acknowledges without rewriting", async () => {
  const f = await branches(); const packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id, await createSyncInventory(f.laptop, f.projectId)); await receiveSyncExchange(f.laptop, f.projectId, packet.bytes);
  const compared = await previewStagedSync(f.laptop, f.projectId, f.local.id, f.remote.id), p = await previewResearchMerge(f.laptop, f.projectId, compared.id), lDone = await commitResearchMerge(f.laptop, f.projectId, compared.id, p.mergeId);
  assert.equal(lDone.historyJoined, true); const joined = await hydrateStagedSnapshot(f.laptop, f.projectId, lDone.head); assert.deepEqual(joined.parents, [f.local.id, f.remote.id]); validateSnapshot(joined);
  const back = await exportSyncExchange(f.laptop, f.projectId, joined.id, await createSyncInventory(f.desktop, f.projectId)); await receiveSyncExchange(f.desktop, f.projectId, back.bytes);
  const reverse = await previewStagedSync(f.desktop, f.projectId, f.remote.id, joined.id), rPreview = await previewResearchMerge(f.desktop, f.projectId, reverse.id), rDone = await commitResearchMerge(f.desktop, f.projectId, reverse.id, rPreview.mergeId);
  const rHead = await hydrateStagedSnapshot(f.desktop, f.projectId, rDone.head); assert.equal(semanticSyncHash(joined), semanticSyncHash(rHead));
  const acknowledged = await exportSyncExchange(f.desktop, f.projectId, rHead.id, await createSyncInventory(f.laptop, f.projectId)); await receiveSyncExchange(f.laptop, f.projectId, acknowledged.bytes);
  const before = await readFile(path.join(f.lPaper, "main.tex")); assert.equal((await acknowledgeSyncHead(f.laptop, f.projectId, rHead.id)).agrees, true); assert.deepEqual(await readFile(path.join(f.lPaper, "main.tex")), before);
  // New offline work now descends from the agreed head rather than the original
  // baseline, so already integrated changes do not become repeated conflicts.
  await writeFile(path.join(f.lPaper, "main.tex"), before.toString() + "% next offline idea\n"); const next = await syncWorkingCheckpoint(f.laptop, f.projectId); assert.deepEqual((await readSyncSnapshot(next.path)).parents, [rHead.id]);
});
test("receiving alone cannot acknowledge unequal work or discard the local branch", async () => {
  const f = await branches(), packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id); await receiveSyncExchange(f.laptop, f.projectId, packet.bytes); await assert.rejects(acknowledgeSyncHead(f.laptop, f.projectId, f.remote.id), /do not yet agree/);
  assert.equal((await exchangeStatus(f.laptop, f.projectId)).commonHead, undefined);
});
test("partial collection keeps a single-parent head and never acknowledges held work", async () => {
  const f = await branches(); await writeFile(path.join(f.dPaper, "main.tex"), source.replace("First idea.", "Conflicting desktop first idea.")); const remote = await syncWorkingCheckpoint(f.desktop, f.projectId);
  const packet = await exportSyncExchange(f.desktop, f.projectId, remote.id); await receiveSyncExchange(f.laptop, f.projectId, packet.bytes); const compared = await previewStagedSync(f.laptop, f.projectId, f.local.id, remote.id), p = await previewResearchMerge(f.laptop, f.projectId, compared.id), done = await commitResearchMerge(f.laptop, f.projectId, compared.id, p.mergeId);
  assert.equal(done.complete, false); assert.equal(done.historyJoined, false); assert.deepEqual((await hydrateStagedSnapshot(f.laptop, f.projectId, done.head)).parents, [f.local.id]); assert.equal((await exchangeStatus(f.laptop, f.projectId)).commonHead, undefined);
});
test("checksum damage and foreign project/device identities cause no staging", async () => {
  const f = await branches(), packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id), bytes = alteredPacket(packet.bytes, value => { value.blobs[0].data = Buffer.from("damaged").toString("base64"); }); await assert.rejects(receiveSyncExchange(f.laptop, f.projectId, bytes), /Damaged|Invalid/);
  await assert.rejects(receiveSyncExchange(f.laptop, "other-project", packet.bytes), /Invalid/); await assert.rejects(receiveSyncExchange(f.desktop, f.projectId, packet.bytes), /identity/);
});
test("missing omitted data or a fraudulent ancestry claim is never treated as complete", async () => {
  const f = await branches(), packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id), omitted = alteredPacket(packet.bytes, value => { value.blobs = []; }); await assert.rejects(receiveSyncExchange(f.laptop, f.projectId, omitted), /ENOENT/);
  const falseInventory = await createSyncInventory(f.laptop, f.projectId); falseInventory.snapshots.push(f.remote.id); falseInventory.blobs.push(...(await readSyncSnapshot(f.remote.path)).records.map(record => record.sha256).filter(hash => !falseInventory.blobs.includes(hash))); const { id: _id, ...body } = falseInventory; falseInventory.id = syncHash(canonical(body));
  const sparse = await exportSyncExchange(f.desktop, f.projectId, f.remote.id, falseInventory); await assert.rejects(receiveSyncExchange(f.laptop, f.projectId, sparse.bytes), /missing or not ready/);
});
test("interrupted receive can resume without applying or duplicating evidence", async () => {
  const f = await branches(), packet = await exportSyncExchange(f.desktop, f.projectId, f.remote.id); await assert.rejects(receiveSyncExchange(f.laptop, f.projectId, packet.bytes, { afterSnapshot: () => { throw new Error("disconnect"); } }), /disconnect/);
  const result = await receiveSyncExchange(f.laptop, f.projectId, packet.bytes); assert.equal(result.received, true); assert.match(await readFile(path.join(f.lPaper, "main.tex"), "utf8"), /Last idea/);
});
test("a stale remembered checkpoint cannot overwrite a later working head", async () => {
  const f = await branches(); await assert.rejects(rememberSyncHead(f.laptop, f.projectId, f.baseline.id), /exact current/); assert.equal((await exchangeStatus(f.laptop, f.projectId)).localHead, f.local.id);
});
test("CLI inventory/export/receive never overwrite existing packet destinations", async () => {
  const f = await branches(), file = path.join(f.desktop, "transfer.aw-sync"), scope = ["--workspace", f.desktop, "--project", f.projectId, "--head", f.remote.id, "--output", file];
  await syncCommand(["export", ...scope]); await assert.rejects(syncCommand(["export", ...scope]), /EEXIST/); const received = await syncCommand(["receive", "--workspace", f.laptop, "--project", f.projectId, "--file", file]); assert.equal((received as any).liveImport, false);
  assert.equal((await syncCommand(["inventory", "--workspace", f.laptop, "--project", f.projectId]) as any).format, "aw-sync-inventory");
});
