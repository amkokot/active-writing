import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, cp, symlink, stat } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { makeSnapshot, previewSync, syncRecord, validateSnapshot, type SyncDevice, type SyncRecord } from "./syncProtocol.ts";
import { captureSyncSnapshot, initializeSyncDevice, readSyncSnapshot, saveSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { createPaperProject } from "./projectFiles.ts";
import { getProject, registry, saveRegistry } from "./projects.ts";
import { writeNotebook } from "./notebookStore.ts";
import { writeExperiments } from "./experiments.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import { syncCommand, syncOptions } from "../scripts/awSync.ts";
import { latexMiddleware } from "./latexPlugin.ts";
import type { NotebookEntry } from "../src/types.ts";

const laptop: SyncDevice = { version: 1, id: "laptop-device", label: "Laptop" }, desktop: SyncDevice = { version: 1, id: "desktop-device", label: "Desktop" };
const text = (name: string, value: string) => syncRecord(`source/${name}`, "source", Buffer.from(value));
const json = (name: string, kind: SyncRecord["kind"], value: unknown) => syncRecord(name, kind, Buffer.from(JSON.stringify(value)));
const decoded = (record: SyncRecord) => JSON.parse(Buffer.from(record.data, "base64").toString());
function branch(records: SyncRecord[]) {
  const base = makeSnapshot("same-project", laptop, records);
  return { base, local: (records: SyncRecord[]) => makeSnapshot("same-project", laptop, records, base), remote: (records: SyncRecord[]) => makeSnapshot("same-project", desktop, records, base) };
}
function entry(id: string, notes = "Original note"): NotebookEntry {
  return { id, title: id, question: "A question", notes, reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" };
}
const catalogue = (entries: NotebookEntry[], revision = 1) => json("data/notebook.json", "catalogue", { version: 1, revision, entries });
const notebook = (cells: unknown[]) => json("data/experiments/question/notebook.ipynb", "experiment", { ...newExperimentNotebook(), cells });
const markdown = (id: string, source: string) => ({ id, cell_type: "markdown", source, metadata: {} });
const code = (source: string, outputs: unknown[] = []) => ({ id: "code", cell_type: "code", source, metadata: {}, execution_count: outputs.length ? 1 : null, outputs });

test("run history changes/removals conflict even when both choose the same altered bytes", () => {
  const run = json("data/experiments/question/runs/saved.json", "run", { source: "original" }), f = branch([run]), changed = json(run.path, "run", { source: "replaced" });
  assert.equal(previewSync(f.base, f.local([changed]), f.remote([changed])).conflicts[0].reason, "immutable-run-changed-or-removed");
  assert.equal(previewSync(f.base, f.local([]), f.remote([run])).conflicts[0].reason, "immutable-run-changed-or-removed");
});
test("deletion history prevents resurrection and deletion versus edit stays a conflict", () => {
  const old = text("note.tex", "Original"), f = branch([old]), deleted = f.local([]);
  assert.deepEqual(deleted.tombstones, [{ path: old.path, previousHash: old.sha256 }]); assert.deepEqual(previewSync(f.base, deleted, f.remote([old])).deletions, [old.path]);
  assert.equal(previewSync(f.base, deleted, f.remote([text("note.tex", "Changed")])).conflicts[0].reason, "deletion-versus-edit");
  assert.throws(() => makeSnapshot("same-project", laptop, [old], deleted), /deleted path reappeared/);
});
test("duplicate new identities and competing reorders need review", () => {
  const f = branch([catalogue([])]);
  assert.equal(previewSync(f.base, f.local([catalogue([entry("collision", "L")])]), f.remote([catalogue([entry("collision", "R")])])).conflicts[0].reason, "independent-id-collision");
  const cells = [markdown("a", "a"), markdown("b", "b"), markdown("c", "c")], ordered = branch([notebook(cells)]);
  const plan = previewSync(ordered.base, ordered.local([notebook([cells[1], cells[0], cells[2]])]), ordered.remote([notebook([cells[0], cells[2], cells[1]])]));
  assert.ok(plan.conflicts.some(item => item.reason === "concurrent-reordering"));
});
test("review/wording locks cannot be combined by semantic inference", () => {
  const review = json("data/workbench.json", "review", { locked: true, resolved: false }), f = branch([review]);
  const plan = previewSync(f.base, f.local([json(review.path, "review", { locked: true, resolved: false, note: "More detail" })]), f.remote([json(review.path, "review", { locked: false, resolved: true })]));
  assert.equal(plan.records.length, 0); assert.equal(plan.conflicts[0].reason, "protected-or-binary-record"); assert.equal((plan.conflicts[0].base as SyncRecord).sha256, review.sha256);
});
test("baseline, device, project, checksum, size, casing and schema gates reject ambiguity", () => {
  const f = branch([text("a.tex", "a")]), left = f.local([text("a.tex", "L")]), right = f.remote([text("a.tex", "R")]);
  const corrupt = structuredClone(left); corrupt.records[0].data = Buffer.from("bad").toString("base64"); assert.throws(() => validateSnapshot(corrupt), /Invalid|checksum/);
  const traversal = structuredClone(left); traversal.records[0].path = "source/../auth.json"; assert.throws(() => validateSnapshot(traversal), /Invalid/);
  const newer = structuredClone(left) as any; newer.version = 2; assert.throws(() => validateSnapshot(newer), /Unsupported/);
  const oversized = structuredClone(left); oversized.records[0].bytes = 25 * 1024 * 1024; assert.throws(() => validateSnapshot(oversized), /oversized/);
  assert.throws(() => previewSync(f.base, left, f.local([text("a.tex", "R")])), /same device ID/);
  assert.throws(() => previewSync(f.base, left, makeSnapshot("other-project", desktop, [])), /different projects/);
  assert.throws(() => previewSync(f.base, left, makeSnapshot("same-project", desktop, [text("a.tex", "R")])), /shared baseline/);
  const casing = branch([]); assert.throws(() => previewSync(casing.base, casing.local([text("A.tex", "L")]), casing.remote([text("a.tex", "R")])), /letter case/);
  const oldFormat = branch([catalogue([entry("a")])]), plan = previewSync(oldFormat.base, oldFormat.local([json("data/notebook.json", "catalogue", { version: 2, entries: [] })]), oldFormat.remote([catalogue([entry("a", "other")])]));
  assert.ok(plan.conflicts.some(item => item.reason === "unsupported-or-invalid-record-schema"));
});

async function fixture(label: string) {
  const parent = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(parent, { recursive: true });
  const workspace = await mkdtemp(path.join(parent, "device-sync-")), project = await createPaperProject(workspace, "Synthetic two-device project");
  await initializeSyncDevice(workspace, label); return { workspace, project, root: (await getProject(workspace, project.id)).root };
}
test("two independent workspaces diverge and preview notes without importing into live stores", async () => {
  const a = await fixture("Laptop"), b = await fixture("Desktop"), rightRegistry = await registry(b.workspace);
  rightRegistry.projects = rightRegistry.projects.map(project => project.id === b.project.id ? { ...a.project, folder: b.project.folder } : project); await saveRegistry(b.workspace, rightRegistry); await cp(a.root, b.root, { recursive: true, force: true });
  await writeNotebook(a.workspace, a.project.id, 0, [entry("question")]); await writeNotebook(b.workspace, a.project.id, 0, [entry("question")]);
  const shared = await captureSyncSnapshot(a.workspace, a.project.id), common = await saveSyncSnapshot(a.workspace, shared);
  await writeNotebook(a.workspace, a.project.id, 1, [entry("question", "Human offline note")]); await writeNotebook(b.workspace, a.project.id, 1, [entry("question"), entry("new-finding", "Desktop research")]);
  const left = await saveSyncSnapshot(a.workspace, await captureSyncSnapshot(a.workspace, a.project.id, shared)), right = await saveSyncSnapshot(b.workspace, await captureSyncSnapshot(b.workspace, a.project.id, shared));
  const output = path.join(a.workspace, "preview.json"), brief = path.join(a.workspace, "brief.md");
  const result = await syncCommand(["preview", "--base", common.path, "--local", left.path, "--remote", right.path, "--output", output, "--brief", brief]);
  assert.equal((result as any).conflicts.length, 0); assert.equal((result as any).applySupported, false);
  const plan = JSON.parse(await readFile(output, "utf8")), merged = decoded(plan.records.find((record: SyncRecord) => record.kind === "catalogue"));
  assert.equal(merged.entries.length, 2); assert.equal(merged.entries.find((item: NotebookEntry) => item.id === "question").notes, "Human offline note");
  const leftDisk = JSON.parse(await readFile(path.join(a.workspace, ".paperfocus/project-data", a.project.id, "notebook.json"), "utf8")); assert.equal(leftDisk.entries.length, 1); assert.match(await readFile(brief, "utf8"), /not an applied synchronization/);
  await assert.rejects(() => syncCommand(["preview", "--base", common.path, "--local", left.path, "--remote", right.path, "--output", output]), /EEXIST/);
});
test("capture refuses linked record directories", async () => {
  const f = await fixture("Laptop"); await writeNotebook(f.workspace, f.project.id, 0, [entry("question")]);
  const records = path.join(f.workspace, ".paperfocus/project-data", f.project.id), elsewhere = path.join(f.workspace, "external-data"); await mkdir(elsewhere); await symlink(elsewhere, path.join(records, "research"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => captureSyncSnapshot(f.workspace, f.project.id), /linked/);
});
test("endpoint never connects, requires origin for naming, and reads do not initialize", async () => {
  const parent = path.join(process.cwd(), ".paperfocus", "trials"), workspace = await mkdtemp(path.join(parent, "sync-api-")), middleware = latexMiddleware(workspace);
  const server = createServer((req, res) => { void middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, url = `${origin}/api/paperfocus/device-sync`;
  try {
    const status = await (await fetch(url)).json(); assert.equal(status.device, undefined); assert.equal(status.folder, undefined); assert.equal(status.connected, false); assert.equal(status.capabilities.reviewedTwoCopySync,true); assert.equal(status.capabilities.automaticSync,false); assert.equal(status.capabilities.remoteCompute,false);
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 403); assert.equal((await fetch(url, { method: "POST", headers: { Origin: "https://foreign.example" }, body: "{}" })).status, 403);
    const saved = await fetch(url, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ label: "Laptop" }) }); assert.equal(saved.status, 200); assert.equal((await saved.json()).device.label, "Laptop");
    assert.equal((await fetch(url, { method: "DELETE", headers: { Origin: origin } })).status, 405);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("offline commands cannot imply apply, pairing, upload or compute", async () => {
  assert.match(String((await syncCommand(["--help"]) as { help: string }).help), /no server or model calls/);
  assert.match(String((await syncCommand(["--help"]) as { help: string }).help), /Only explicit paired commands contact SSH/);
  assert.match(String((await syncCommand(["--help"]) as { help: string }).help), /Ordinary proposals never import live data/);
  assert.throws(() => syncOptions(["apply", "--workspace", "anything"]), /not implemented/);
  assert.throws(() => syncOptions(["snapshot", "--workspace", "anything", "--project", "a", "--project", "b"]), /Unknown/);
});
test("status is read-only and explicit device identity persists without silent renaming", async () => {
  const parent = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, "sync-status-"));
  assert.equal((await syncStatus(root)).device, undefined); await assert.rejects(stat(path.join(root, ".paperfocus/device-sync")), /ENOENT/);
  const first = await initializeSyncDevice(root, "Laptop"), second = await initializeSyncDevice(root, "Laptop"); assert.deepEqual(first, second); assert.equal(first.connected, false);
  await assert.rejects(() => initializeSyncDevice(root, "Desktop"), /preserved/); assert.equal((await syncStatus(root)).device?.id, first.device?.id);
});
test("capture preserves saved work, excludes app caches and never overwrites a snapshot", async () => {
  const f = await fixture("Laptop"); await writeNotebook(f.workspace, f.project.id, 0, [entry("question")]);
  await writeExperiments(f.workspace, f.project.id, "question", "", { ...newExperimentNotebook(), cells: [markdown("summary", "Saved reasoning")] } as any);
  const data = path.join(f.workspace, ".paperfocus/project-data", f.project.id); await mkdir(path.join(data, "build")); await writeFile(path.join(data, "build/private.pdf"), "CACHE");
  await writeFile(path.join(f.workspace, ".paperfocus/private-secret.json"), "CREDENTIAL"); const before = await readFile(path.join(data, "notebook.json"));
  const snapshot = await captureSyncSnapshot(f.workspace, f.project.id); validateSnapshot(snapshot);
  assert.ok(snapshot.records.some(record => record.path === "data/notebook.json")); assert.ok(snapshot.records.some(record => record.kind === "experiment"));
  assert.ok(snapshot.records.every(record => !record.path.includes("build") && !record.path.includes("secret"))); assert.deepEqual(await readFile(path.join(data, "notebook.json")), before);
  const saved = await saveSyncSnapshot(f.workspace, snapshot); assert.equal(saved.reused, false); assert.equal((await saveSyncSnapshot(f.workspace, snapshot)).reused, true); assert.deepEqual(await readSyncSnapshot(saved.path), snapshot);
});

test("independent source files converge without either device winning", () => {
  const f = branch([text("intro.tex", "Old introduction"), text("appendix.tex", "Old appendix")]);
  const left = f.local([text("intro.tex", "Laptop edit"), text("appendix.tex", "Old appendix")]), right = f.remote([text("intro.tex", "Old introduction"), text("appendix.tex", "Desktop edit")]);
  const plan = previewSync(f.base, left, right);
  assert.equal(plan.applySupported, false); assert.equal(plan.conflicts.length, 0); assert.equal(plan.summary.automatic, 2);
  assert.deepEqual(plan.records, previewSync(f.base, right, left).records);
});
test("overlapping manuscript edits preserve all variants and no automatic candidate", () => {
  const f = branch([text("main.tex", "Common proof")]), plan = previewSync(f.base, f.local([text("main.tex", "Human idea")]), f.remote([text("main.tex", "Agent idea")]));
  assert.equal(plan.records.length, 0); assert.equal(plan.conflicts[0].reason, "overlapping-manuscript-edits");
  assert.equal(Buffer.from((plan.conflicts[0].local as SyncRecord).data, "base64").toString(), "Human idea");
  assert.equal(Buffer.from((plan.conflicts[0].remote as SyncRecord).data, "base64").toString(), "Agent idea");
});
test("independent notes and new conversations merge by ID, not host revision", () => {
  const first = entry("first"), second = entry("second"), f = branch([catalogue([first, second])]);
  const left = f.local([catalogue([{ ...first, notes: "Laptop note" }, second, entry("new-laptop")], 2)]), right = f.remote([catalogue([first, { ...second, reply: "Desktop finding" }, entry("new-desktop")], 99)]);
  const plan = previewSync(f.base, left, right); assert.equal(plan.conflicts.length, 0); assert.deepEqual(plan.records, previewSync(f.base, right, left).records);
  const merged = decoded(plan.records[0]); assert.equal(merged.revision, undefined); assert.equal(merged.entries.length, 4);
  assert.equal(merged.entries.find((item: NotebookEntry) => item.id === "first").notes, "Laptop note");
  assert.equal(merged.entries.find((item: NotebookEntry) => item.id === "second").reply, "Desktop finding");
});
test("contested notes retain exact text instead of selecting the latest timestamp", () => {
  const first = entry("first"), f = branch([catalogue([first])]);
  const plan = previewSync(f.base, f.local([catalogue([{ ...first, notes: "Human", updatedAt: "2026-10-13T01:00:00Z" }], 2)]), f.remote([catalogue([{ ...first, notes: "Agent", updatedAt: "2026-10-13T02:00:00Z" }], 3)]));
  assert.equal(plan.records.length, 0); assert.ok(plan.conflicts.some(item => item.field.endsWith("/notes") && item.local === "Human" && item.remote === "Agent"));
});
test("independent fields on one conversation merge despite different update timestamps", () => {
  const first = entry("first"), f = branch([catalogue([first])]);
  const left = f.local([catalogue([{ ...first, notes: "Human note", updatedAt: "2026-10-13T01:00:00Z" }], 2)]), right = f.remote([catalogue([{ ...first, reply: "Agent result", updatedAt: "2026-10-13T02:00:00Z" }], 2)]);
  const plan = previewSync(f.base, left, right); assert.equal(plan.conflicts.length, 0); assert.deepEqual(plan.records, previewSync(f.base, right, left).records);
  assert.equal(decoded(plan.records[0]).entries[0].notes, "Human note"); assert.equal(decoded(plan.records[0]).entries[0].reply, "Agent result");
});
test("one-sided unsupported notebook schemas are blocked rather than called automatic", () => {
  const f = branch([catalogue([entry("first")])]), bad = json("data/notebook.json", "catalogue", { version: 9, revision: 2, entries: [] });
  assert.equal(previewSync(f.base, f.local([bad]), f.remote(f.base.records)).conflicts[0].reason, "unsupported-or-invalid-record-schema");
});
test("different markdown cells merge and new cells remain independent", () => {
  const cells = [markdown("a", "A"), markdown("b", "B")], f = branch([notebook(cells)]);
  const left = f.local([notebook([markdown("a", "Laptop"), cells[1], markdown("l", "New laptop")])]), right = f.remote([notebook([cells[0], markdown("b", "Desktop"), markdown("r", "New desktop")])]);
  const plan = previewSync(f.base, left, right); assert.equal(plan.conflicts.length, 0); assert.deepEqual(plan.records, previewSync(f.base, right, left).records); assert.equal(decoded(plan.records[0]).cells.length, 4);
});
test("edited code and a completed old-code experiment cannot be silently spliced", () => {
  const original = "print(1)", f = branch([notebook([code(original)])]), outputs = [{ output_type: "stream", name: "stdout", text: "1\n" }];
  const run = json("data/experiments/question/runs/run-one.json", "run", { id: "run-one", source: original, outputs, status: "ready" });
  const plan = previewSync(f.base, f.local([notebook([code("print(2)")])]), f.remote([notebook([code(original, outputs)]), run]));
  assert.ok(plan.conflicts.some(item => item.reason === "experiment-code-or-output")); assert.ok(!plan.records.some(record => record.kind === "experiment")); assert.equal(plan.summary.retainedRuns, 1);
  assert.equal(decoded(plan.records.find(record => record.kind === "run")!).source, original);
});
