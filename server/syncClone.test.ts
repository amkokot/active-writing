import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { previewSyncClone, commitSyncClone } from "./syncClone.ts";
import { captureSyncSnapshot, initializeSyncDevice, saveSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { makeSnapshot, syncRecord, type SyncSnapshot, type SyncRecord } from "./syncProtocol.ts";
import { createPaperProject } from "./projectFiles.ts";
import { getProject, registry, saveRegistry, parseProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { readWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { syncCommand, syncOptions } from "../scripts/awSync.ts";
import { validateLaunchWorkspace } from "../scripts/desktopLauncher.mjs";
import type { NotebookEntry } from "../src/types.ts";
import { researchCommand } from "../scripts/awResearch.ts";

const stamp = "2026-10-14T00:00:00Z";
const note = (id = "question"): NotebookEntry => ({ id, manuscriptFile: "main.tex", experimentNotebookId: "stable-owner", title: "Synthetic question", question: "A test only", notes: "Keep this note", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp });
async function fixture() {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const container = await mkdtemp(path.join(parent, "clone-")), workspace = path.join(container, "donor"); await mkdir(workspace);
  const project = await createPaperProject(workspace, "Synthetic first copy"), root = (await getProject(workspace, project.id)).root;
  await initializeSyncDevice(workspace, "Laptop");
  await mkdir(path.join(root, "sections")); await mkdir(path.join(root, "figures"));
  await writeFile(path.join(root, "main.tex"), "\\documentclass{article}\r\n\\begin{document}\r\n\\input{sections/idea}\r\n\\end{document}\r\n");
  await writeFile(path.join(root, "sections/idea.tex"), "\\section{Idea}\nA stable passage.\n");
  await writeFile(path.join(root, "overview.tex"), "\\documentclass{article}\n\\begin{document}A short overview.\\end{document}");
  await writeFile(path.join(root, "figures/synthetic.png"), Buffer.from([137, 80, 78, 71]));
  await writeFile(path.join(root, "project.json"), JSON.stringify({ name: "Ordinary source config, not Aw ownership" }));
  const registered = await registry(workspace), original = registered.projects.find(item => item.id === project.id)!;
  Object.assign(original, { manuscriptPurposes: { "main.tex": "publication", "overview.tex": "overview" },
    manuscriptOverviewTargets: { "overview.tex": "main.tex" }, manuscriptVersions: [{ file: "main.tex", family: "notes-family", number: 1, createdAt: stamp, notebook: "continue" }] });
  await saveRegistry(workspace, registered);
  await writeNotebook(workspace, project.id, 0, [note()]);
  await writeExperiments(workspace, project.id, "stable-owner", "", { ...newExperimentNotebook(), metadata: { synthetic: true }, cells: [
    { id: "summary", cell_type: "markdown", source: "Synthetic preserved context", metadata: { paperfocus: { pinned: true, highlighted: true } } },
    { id: "code", cell_type: "code", source: "# Fixture only; never executed\nprint('fixture')", execution_count: 1,
      outputs: [{ output_type: "stream", name: "stdout", text: "synthetic fixture, not an experiment\n" }],
      metadata: { paperfocus: { runId: "synthetic-run", lastRunAt: stamp, execution: { mode: "fresh", transport: "offline", runtime: { executable: "C:/old-host/python.exe", python: "test-only", packages: {} } } } } }
  ] });
  await writeWorkbench(workspace, project.id, 0, { ...emptyWorkbench(), attentionTasks: [{ id: "settled", title: "Locked wording", nodeId: "node", paragraphId: "p1", route: "codex", status: "reviewed", createdAt: stamp, updatedAt: stamp,
    sourceSnapshot: { version: 1, scope: "paragraph", projectId: project.id, revision: "old-source", rootFile: "main.tex", nodeId: "node", nodeTitle: "Idea", paragraphs: [{ id: "p1", nodeId: "node", file: "sections/idea.tex", text: "A stable passage." }] },
    writing: { kind: "paragraph", roundId: "round", externalId: "p1", action: "replace", purpose: "Clarify", rationale: "Synthetic fixture", proposedText: "A stable passage.", draftText: "A stable passage.", placement: { text: "A stable passage.", before: "Original.", createdAt: stamp }, decision: "accepted", curatedText: "A stable passage.", decidedAt: stamp }
  }] });
  const data = path.join(workspace, ".paperfocus/project-data", project.id), runFolder = path.join(data, "experiments/stable-owner/runs"); await mkdir(runFolder);
  await writeFile(path.join(runFolder, "synthetic-run.json"), JSON.stringify({ id: "synthetic-run", cellId: "code", status: "ready", synthetic: true, historicalPath: "C:/old-host/results" }));
  const snapshot = await captureSyncSnapshot(workspace, project.id), options = { destination: path.join(container, "desktop-data"), mainFile: "main.tex", label: "Desktop" };
  return { workspace, root, data, snapshot, options, projectId: project.id, container };
}
function replace(snapshot: SyncSnapshot, name: string, value: unknown, kind?: SyncRecord["kind"]) {
  return makeSnapshot(snapshot.projectId, snapshot.device, snapshot.records.map(record => record.path === name ? syncRecord(name, kind ?? record.kind, Buffer.from(JSON.stringify(value))) : record));
}
const missing = (file: string) => assert.rejects(stat(file), /ENOENT/);

test("first-copy preview is read-only, preserves scope and reports notebook counts", async () => {
  const f = await fixture(), preview = await previewSyncClone(f.snapshot, f.options);
  assert.equal(preview.destinationExists, false); assert.equal(preview.projectId, f.projectId);
  assert.equal(preview.counts.notebooks, 1); assert.equal(preview.counts.cells, 2); assert.equal(preview.counts.runs, 1);
  assert.deepEqual(preview.roots.sort(), ["main.tex", "overview.tex"]); assert.deepEqual(preview.pending, []);
  assert.equal(preview.codeExecution, false); assert.equal(preview.remoteEnabled, false); await missing(f.options.destination);
});
test("first copy keeps source structure, IDs, policy, locks, output and historical provenance", async () => {
  const f = await fixture(), preview = await previewSyncClone(f.snapshot, f.options), copied = await commitSyncClone(f.snapshot, f.options, preview.planId);
  assert.equal(copied.alreadyComplete, false); assert.notEqual(copied.deviceId, f.snapshot.device.id);
  const { project, root } = await getProject(copied.workspace, f.projectId);
  assert.equal(project.folder, "paper"); assert.deepEqual(project.manuscriptPurposes, preview.project.manuscriptPurposes);
  assert.deepEqual(project.manuscriptVersions, preview.project.manuscriptVersions); assert.deepEqual(project.manuscriptOverviewTargets, preview.project.manuscriptOverviewTargets);
  assert.equal((await registry(copied.workspace)).projects.length, 1); assert.equal((await parseProject(copied.workspace, f.projectId)).paragraphs[0].text, "A stable passage.");
  assert.deepEqual(await readNotebook(copied.workspace, f.projectId), await readNotebook(f.workspace, f.projectId));
  assert.deepEqual(await readWorkbench(copied.workspace, f.projectId), await readWorkbench(f.workspace, f.projectId));
  assert.deepEqual((await readExperiments(copied.workspace, f.projectId, "stable-owner")).notebook, (await readExperiments(f.workspace, f.projectId, "stable-owner")).notebook);
  for (const record of f.snapshot.records.filter(item => !item.path.startsWith("project/"))) {
    const target = record.path.startsWith("source/") ? path.join(root, record.path.slice(7)) : path.join(copied.workspace, ".paperfocus/project-data", f.projectId, record.path.slice(5));
    assert.deepEqual(await readFile(target), Buffer.from(record.data, "base64"));
  }
  const catalogue = JSON.parse(await readFile(path.join(copied.workspace, ".paperfocus/project-data", f.projectId, "project.json"), "utf8"));
  assert.equal(catalogue.paperFolder, "paper"); await missing(path.join(root, ".paperfocus"));
  const guide = await readFile(path.join(copied.workspace, "AGENTS.md"), "utf8");
  assert.ok(guide.includes(preview.codeRoot)); assert.ok(guide.includes(copied.workspace)); assert.ok(guide.includes(f.projectId));
  assert.match(guide, /inspect --offline --workspace/); assert.match(guide, /Publication text\/locks keep their human-review guards/);
  assert.equal(validateLaunchWorkspace(copied.workspace).toLowerCase(), copied.workspace.toLowerCase());
  assert.equal((await syncStatus(f.workspace)).device?.id, f.snapshot.device.id);
  const inspected = await researchCommand(["inspect", "--offline", "--workspace", copied.workspace, "--project", f.projectId, "--entry", "question"]);
  assert.equal(inspected.projectId, f.projectId); assert.equal(inspected.notebookId, "stable-owner"); assert.equal(inspected.offline, true);
  await missing(path.join(copied.workspace, "package.json"));
  const branch = await captureSyncSnapshot(copied.workspace, f.projectId, f.snapshot); assert.equal(branch.parents[0], f.snapshot.id); assert.equal(branch.device.id, copied.deviceId);
});
test("repeat completed clone never replays the old copy over new receiving-side edits", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options); await commitSyncClone(f.snapshot, f.options, p.planId);
  const file = path.join(f.options.destination, "paper/sections/idea.tex"); await writeFile(file, "New receiving-side work");
  assert.equal((await commitSyncClone(f.snapshot, f.options, p.planId)).alreadyComplete, true); assert.equal(await readFile(file, "utf8"), "New receiving-side work");
});
test("separate data homes support offline guarded saves and reject stale notebook revisions", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options), copied = await commitSyncClone(f.snapshot, f.options, p.planId);
  const scope = ["--offline", "--workspace", copied.workspace, "--project", f.projectId, "--entry", "question"], prior = await readExperiments(copied.workspace, f.projectId, "stable-owner");
  const source = path.join(copied.workspace, "synthetic-summary.txt"); await writeFile(source, "A new receiving-side note");
  const saved = await researchCommand(["put", ...scope, "--cell", "summary", "--revision", prior.revision, "--file", source]);
  assert.equal(saved.saved, true); assert.equal(saved.executed, false);
  const current = await readExperiments(copied.workspace, f.projectId, "stable-owner"); assert.equal(current.notebook.cells[0].source, "A new receiving-side note");
  assert.deepEqual(current.notebook.cells[1], prior.notebook.cells[1]);
  await assert.rejects(() => researchCommand(["put", ...scope, "--cell", "summary", "--revision", prior.revision, "--file", source]), /Notebook changed/);
  assert.deepEqual((await readExperiments(f.workspace, f.projectId, "stable-owner")).notebook, prior.notebook);
});
test("changed scope and existing empty/app homes are refused without changing their contents", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options);
  await assert.rejects(() => commitSyncClone(f.snapshot, { ...f.options, label: "Other desktop" }, p.planId), /scope changed/); await missing(f.options.destination);
  await mkdir(f.options.destination); await assert.rejects(() => commitSyncClone(f.snapshot, f.options, p.planId), /NEW data home/);
  await missing(path.join(f.options.destination, ".paperfocus"));
  const own = { ...f.options, destination: f.workspace }, ownPlan = await previewSyncClone(f.snapshot, own), before = await readFile(path.join(f.workspace, ".paperfocus/projects.json"));
  await assert.rejects(() => commitSyncClone(f.snapshot, own, ownPlan.planId), /NEW data home/); assert.deepEqual(await readFile(path.join(f.workspace, ".paperfocus/projects.json")), before);
});
test("linked parents, linked targets and existing files cannot become receiving homes", async () => {
  const f = await fixture(), link = path.join(f.container, "linked"); await symlink(f.workspace, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => previewSyncClone(f.snapshot, { ...f.options, destination: link }), /linked/);
  await assert.rejects(() => previewSyncClone(f.snapshot, { ...f.options, destination: path.join(link, "new-home") }), /linked/);
  await writeFile(f.options.destination, "Keep this file"); await assert.rejects(() => previewSyncClone(f.snapshot, f.options), /existing file/); assert.equal(await readFile(f.options.destination, "utf8"), "Keep this file");
});
test("partial copy is not launchable and the exact retry resumes completed files", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options);
  await assert.rejects(() => commitSyncClone(f.snapshot, f.options, p.planId, { afterFile: count => { if (count === 2) throw new Error("Simulated interruption"); } }), /Simulated interruption/);
  await missing(path.join(f.options.destination, ".paperfocus/device-sync/clone-ready.json")); assert.throws(() => validateLaunchWorkspace(f.options.destination), /unfinished/);
  await missing(path.join(f.options.destination, ".paperfocus/projects.json"));
  await assert.rejects(() => researchCommand(["inspect", "--offline", "--workspace", f.options.destination, "--project", f.projectId, "--entry", "question"]), /unfinished/);
  assert.equal((await commitSyncClone(f.snapshot, f.options, p.planId)).alreadyComplete, false);
});
test("changed partial files are preserved rather than replaced during retry", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options);
  await assert.rejects(() => commitSyncClone(f.snapshot, f.options, p.planId, { afterFile: () => { throw new Error("Stop"); } }), /Stop/);
  const record = f.snapshot.records.find(item => !item.path.startsWith("project/"))!, relative = record.path.startsWith("source/") ? `paper/${record.path.slice(7)}` : `.paperfocus/project-data/${f.projectId}/${record.path.slice(5)}`;
  const file = path.join(f.options.destination, relative); await writeFile(file, "Receiving-side partial edit");
  await assert.rejects(() => commitSyncClone(f.snapshot, f.options, p.planId), /differ|changed|preserv/); assert.equal(await readFile(file, "utf8"), "Receiving-side partial edit");
  await missing(path.join(f.options.destination, ".paperfocus/device-sync/clone-ready.json"));
});
test("late source additions prevent completion without deleting the new file", async () => {
  const f = await fixture(), p = await previewSyncClone(f.snapshot, f.options);
  await assert.rejects(() => commitSyncClone(f.snapshot, f.options, p.planId, { afterFile: async count => { if (count === f.snapshot.records.length) await writeFile(path.join(f.options.destination, "paper/new-note.tex"), "Concurrent addition"); } }), /changed during preparation/);
  assert.equal(await readFile(path.join(f.options.destination, "paper/new-note.tex"), "utf8"), "Concurrent addition"); await missing(path.join(f.options.destination, ".paperfocus/device-sync/clone-ready.json"));
});
test("pending model/agent requests and working runs block first-copy commit before creation", async () => {
  const f = await fixture(), pending = { ...emptyWorkbench(), attentionTasks: [{ id: "waiting", title: "Pending answer", nodeId: "node", route: "codex", status: "queued", createdAt: stamp, updatedAt: stamp }] };
  for (const snapshot of [replace(f.snapshot, "data/workbench.json", { version: 1, revision: 2, ...pending }), replace(f.snapshot, "data/experiments/stable-owner/runs/synthetic-run.json", { id: "synthetic-run", cellId: "code", status: "working" })]) {
    const p = await previewSyncClone(snapshot, f.options); assert.equal(p.pending.length, 1);
    await assert.rejects(() => commitSyncClone(snapshot, f.options, p.planId), /pending requests/); await missing(f.options.destination);
  }
});
test("invalid/newer stores and relabelled notebook data cannot bypass clone validation", async () => {
  const f = await fixture();
  for (const snapshot of [replace(f.snapshot, "data/notebook.json", { version: 2, revision: 0, entries: [] }), replace(f.snapshot, "data/notebook.json", { version: 1, revision: 0, entries: [] }, "record"), replace(f.snapshot, "data/experiments/stable-owner/notebook.ipynb", { nbformat: 5, cells: [] })]) {
    await assert.rejects(() => previewSyncClone(snapshot, f.options), /Unsupported|classification|nbformat/); await missing(f.options.destination);
  }
});
test("included section selection, reserved filenames and unsupported policy are rejected", async () => {
  const f = await fixture(); await assert.rejects(() => previewSyncClone(f.snapshot, { ...f.options, mainFile: "sections/idea.tex" }), /independent TeX root/);
  const invalidPath = makeSnapshot(f.projectId, f.snapshot.device, [...f.snapshot.records, syncRecord("source/CON.tex", "source", Buffer.from("ordinary text"))]);
  await assert.rejects(() => previewSyncClone(invalidPath, f.options), /not portable/);
  const policy = JSON.parse(Buffer.from(f.snapshot.records.find(item => item.path === "project/manuscripts.json")!.data, "base64").toString());
  await assert.rejects(() => previewSyncClone(replace(f.snapshot, "project/manuscripts.json", { ...policy, newerPolicy: true }), f.options), /newer manuscript policy/); await missing(f.options.destination);
});
test("file-versus-folder and directory-case collisions fail before any copy", async () => {
  const f = await fixture();
  for (const extra of [syncRecord("source/sections", "asset", Buffer.from("file conflicts with folder")), syncRecord("source/Sections/second.tex", "source", Buffer.from("different casing"))]) {
    await assert.rejects(() => previewSyncClone(makeSnapshot(f.projectId, f.snapshot.device, [...f.snapshot.records, extra]), f.options), /Conflicting file\/folder/); await missing(f.options.destination);
  }
});
test("ancestry gaps are reported and never fabricated as checked history", async () => {
  const f = await fixture(), descendant = makeSnapshot(f.projectId, f.snapshot.device, f.snapshot.records, f.snapshot), p = await previewSyncClone(descendant, f.options);
  assert.deepEqual(p.missingHistory, [f.snapshot.id]); const copied = await commitSyncClone(descendant, f.options, p.planId);
  assert.deepEqual(copied.missingHistory, [f.snapshot.id]); await missing(path.join(copied.workspace, ".paperfocus/device-sync/staged", f.projectId, `${f.snapshot.id}.json`));
});
test("CLI first-copy is preview-first and commit requires the exact plan", async () => {
  const f = await fixture(), saved = await saveSyncSnapshot(f.workspace, f.snapshot), scope = ["--file", saved.path, "--destination", f.options.destination, "--main-file", "main.tex", "--label", "Desktop"];
  assert.throws(() => syncOptions(["clone", ...scope, "--commit"]), /--plan/); assert.throws(() => syncOptions(["clone", ...scope, "--commit", "--commit"]), /once/);
  const p = await syncCommand(["clone", ...scope]) as any; await missing(f.options.destination);
  const copied = await syncCommand(["clone", ...scope, "--plan", p.planId, "--commit"]) as any;
  assert.equal(copied.projectId, f.projectId); assert.equal(copied.codeExecution, false); assert.equal(copied.initialCopyOnly, true);
});
