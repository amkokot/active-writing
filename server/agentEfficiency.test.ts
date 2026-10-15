import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopServer } from "../scripts/desktopServer.mjs";
import { researchCommand, researchOptions } from "../scripts/awResearch.ts";
import { agentManifest, manifestChanges, prepareAgentBatch, createAgentJson } from "../scripts/awAgentState.ts";
import { newExperimentNotebook, experimentStaleness, validateExperimentNotebook } from "../src/experiments.ts";
import { captureExperimentInputs, checkExperimentInputs } from "./experimentInputs.ts";
import { registerProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import type { NotebookEntry } from "../src/types.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withRecordLock } from "./recordLock.ts";
import { pythonPackageFolder } from "./pythonPackages.ts";
import { pythonEnvironment } from "./pythonSessions.ts";
import { probeResearchPython } from "./researchReadiness.ts";
import { experimentRuntime } from "./experiments.ts";
import { createHandoff } from "./handoffs.ts";
import { studyState, makeStudyTurn } from "../src/study.ts";
import { parseProject } from "./projects.ts";

async function offlineFixture() {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/offline-research-"));
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "active-writing" }));
  await mkdir(path.join(workspace, "paper"));
  const source = "\\documentclass{article}\n\\begin{document}Human source.\\end{document}";
  await writeFile(path.join(workspace, "paper/main.tex"), source);
  const project = await registerProject(workspace, "paper"), now = new Date().toISOString();
  const entry: NotebookEntry = { id: "conversation", experimentNotebookId: "owner", title: "Research question", question: "Keep the question", notes: "Human notes", reply: "", proposal: "", status: "open", route: "codex", effort: 1, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await writeNotebook(workspace, project.id, 0, [entry]);
  const notebook = newExperimentNotebook();
  notebook.cells = [{ id: "human", cell_type: "markdown", source: "Keep me", metadata: { custom: true } }, { id: "result", cell_type: "code", source: "print('do not run')", metadata: {}, execution_count: 1, outputs: [{ output_type: "stream", text: "saved output" }] }];
  const store = await writeExperiments(workspace, project.id, "owner", "", notebook);
  const scope = ["--offline", "--workspace", workspace, "--project", project.id, "--entry", entry.id];
  return { workspace, project, entry, source, store, scope };
}

test("offline notebook loop never fetches, preserves evidence and becomes visible to a later service", async () => {
  const f = await offlineFixture(), originalFetch = globalThis.fetch;
  const file = path.join(f.workspace, "note.md"); await writeFile(file, "## Deduction\nA saved argument, not an executed proof.");
  globalThis.fetch = async () => { throw new Error("Unexpected network access"); };
  try {
    const inspected = await researchCommand(["inspect", ...f.scope]);
    assert.equal(inspected.offline, true); assert.equal(inspected.runtime.offline, true); assert.equal(inspected.runtime.interpreterChecked, false);
    assert.ok(inspected.actions.includes("finish")); assert.ok(inspected.actions.includes("run")); assert.ok(!inspected.actions.includes("phase"));
    assert.equal(inspected.manuscriptPurpose, "notes"); assert.equal(inspected.paperRoot, path.join(f.workspace, "paper"));
    const read = await researchCommand(["output", ...f.scope, "--cell", "result", "--output", "0"]); assert.equal(read.output.text, "saved output");
    const saved = await researchCommand(["put", ...f.scope, "--cell", "deduction", "--revision", inspected.revision, "--file", file, "--after", "human"]);
    assert.equal(saved.saved, true); assert.equal(saved.executed, false);
    await assert.rejects(researchCommand(["put", ...f.scope, "--cell", "deduction", "--revision", inspected.revision, "--file", file]), /changed/);
    const arranged = await researchCommand(["organize", ...f.scope, "--cell", "deduction", "--revision", saved.revision, "--pin", "true"]);
    const batchFile = path.join(f.workspace, "batch.json"); await writeFile(batchFile, JSON.stringify({ version: 1, changes: [{ cell: "deduction", source: "Updated argument" }] }));
    const plan = await researchCommand(["batch", ...f.scope, "--revision", arranged.revision, "--file", batchFile]); assert.equal(plan.saved, false);
    await researchCommand(["batch", ...f.scope, "--revision", arranged.revision, "--file", batchFile, "--commit"]);
    const binding = path.join(f.workspace, "scope.json"); await researchCommand(["bind", ...f.scope, "--file", binding]);
    const manifest = await researchCommand(["manifest", "--offline", "--scope", binding]); assert.ok(manifest.cells.some((cell: any) => cell.id === "deduction"));
    await assert.rejects(researchCommand(["run", ...f.scope, "--cell", "result", "--revision", saved.revision, "--allow-python", "--session"]), /Offline Python uses a fresh process/);
    await assert.rejects(researchCommand(["discover", "--offline", "--workspace", f.workspace, "--project", "foreign"]), /no longer registered/);
    const conversations = await readNotebook(f.workspace, f.project.id);
    await writeNotebook(f.workspace, f.project.id, conversations.revision, [{ ...f.entry, experimentNotebookId: "different-owner" }]);
    await assert.rejects(researchCommand(["inspect", "--offline", "--scope", binding]), /ownership changed/);
    await writeNotebook(f.workspace, f.project.id, conversations.revision + 1, [f.entry]);
  } finally { globalThis.fetch = originalFetch; }
  const server = desktopServer(f.workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const read = await researchCommand(["cell", "--url", origin, ...f.scope.filter(flag => flag !== "--offline"), "--cell", "deduction"]);
    assert.equal(read.cell.source, "Updated argument"); assert.equal(read.cell.metadata.paperfocus.pinned, true);
    const current = await readExperiments(f.workspace, f.project.id, "owner");
    assert.deepEqual(current.notebook.cells.find(cell => cell.id === "result"), f.store.notebook.cells[1]);
    assert.deepEqual(current.notebook.cells[0], f.store.notebook.cells[0]);
    assert.equal(await readFile(path.join(f.workspace, "paper/main.tex"), "utf8"), f.source);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("offline finish uses the real saved ticket and preserves human decisions", async () => {
  const f = await offlineFixture(), parsed = await parseProject(f.workspace, f.project.id);
  f.entry.study = studyState(f.entry);
  const turn = makeStudyTurn(f.entry, parsed);
  const ticket = await createHandoff(f.workspace, f.project.id, { packet: "Saved request", transport: "files", notebookTarget: { entryId: f.entry.id, notebookId: "owner" }, origin: "http://127.0.0.1:4173" });
  f.entry.study.turns = [{ ...turn, id: ticket.id, ticket }]; f.entry.study.activeTurnId = ticket.id;
  await writeNotebook(f.workspace, f.project.id, 1, [f.entry]);
  const file = path.join(f.workspace, "summary.md"); await writeFile(file, "An honest saved summary.");
  const saved = await researchCommand(["put", ...f.scope, "--cell", "summary", "--revision", f.store.revision, "--file", file]);
  const args = ["finish", ...f.scope, "--task", ticket.id, "--request-hash", ticket.requestHash, "--summary-cell", "summary", "--revision", saved.revision];
  await assert.rejects(researchCommand(args.map(value => value === ticket.requestHash ? "a".repeat(64) : value)), /different notebook or prompt/);
  assert.equal((await researchCommand(args)).finished, true);
  assert.equal((await researchCommand(args)).reused, true);
  const conversations = await readNotebook(f.workspace, f.project.id);
  assert.equal(conversations.entries[0].notes, "Human notes"); assert.equal(conversations.entries[0].study!.turns[0].reply, "An honest saved summary.");
  conversations.entries[0].study!.turns[0].closed = true;
  await writeNotebook(f.workspace, f.project.id, conversations.revision, conversations.entries);
  await assert.rejects(researchCommand(args), /closed/);
});

test("offline fresh Python saves rich evidence, actual runtime and failures without HTTP or manual import", async () => {
  const f = await offlineFixture(), fetchBefore = globalThis.fetch;
  const packages = path.join(f.workspace, ".paperfocus", "python-packages");
  await mkdir(packages); await writeFile(path.join(packages, "aw_probe.py"), "VALUE = 19\n");
  const sourceFile = path.join(f.workspace, "probe.py");
  await writeFile(sourceFile, "import aw_probe\nprint(aw_probe.VALUE)\ndisplay_table([{'answer': 19}])\ndisplay_plot('Control', [{'name': 'trial', 'points': [[0, 0], [1, 1]]}])\ndisplay_heatmap('Grid', [0, 1], [0], [[1, 2]])\ndisplay_sweep('Sweep', 't', [{'value': 0, 'series': [{'name': 's', 'points': [[0, 0]]}]}, {'value': 1, 'series': [{'name': 's', 'points': [[0, 1]]}]}])");
  globalThis.fetch = async () => { throw new Error("No HTTP allowed"); };
  try {
    const saved = await researchCommand(["put", ...f.scope, "--cell", "probe", "--kind", "code", "--revision", f.store.revision, "--file", sourceFile]);
    assert.throws(() => researchOptions(["run", ...f.scope, "--cell", "probe", "--revision", saved.revision]), /human/);
    await assert.rejects(researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", f.store.revision, "--allow-python"]), /Notebook changed/);
    const result = await researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", saved.revision, "--allow-python"]);
    assert.equal(result.job.status, "ready", result.job.error); assert.equal(result.job.notebookUpdated, true);
    assert.notEqual(result.revision, saved.revision); assert.equal(result.job.execution.transport, "offline");
    assert.equal(result.job.execution.runtime.packageFolder, packages); assert.match(result.job.execution.runtime.python, /3\./);
    const exact = await researchCommand(["cell", ...f.scope, "--cell", "probe"]);
    assert.match(exact.cell.outputs[0].text, /19/); assert.equal(exact.cell.outputs.length, 5);
    assert.equal(exact.cell.metadata.paperfocus.runId, result.job.id); assert.equal(exact.cell.execution_count, 1);
    const record = JSON.parse(await readFile(result.job.runPath, "utf8")); assert.equal(record.source, await readFile(sourceFile, "utf8"));
    assert.deepEqual(record.outputs, exact.cell.outputs);
    assert.equal((await researchCommand(["job", ...f.scope, "--job", result.job.id])).status, "ready");
    await assert.rejects(researchCommand(["job", ...f.scope, "--job", result.job.id, "--wait-seconds", "1"]), /no live wait/);
    await writeFile(sourceFile, "print('partial result')\nraise ValueError('expected test failure')");
    const changed = await researchCommand(["put", ...f.scope, "--cell", "probe", "--revision", result.revision, "--file", sourceFile]);
    const failed = await researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", changed.revision, "--allow-python"]);
    assert.equal(failed.job.status, "failed");
    const failure = await researchCommand(["cell", ...f.scope, "--cell", "probe"]);
    assert.match(failure.cell.outputs[0].text, /partial result/); assert.equal(failure.cell.outputs[1].ename, "ValueError");
    const store = await readExperiments(f.workspace, f.project.id, "owner");
    assert.deepEqual(store.notebook.cells[0], f.store.notebook.cells[0]); assert.deepEqual(store.notebook.cells[1], f.store.notebook.cells[1]);
    assert.equal(await readFile(path.join(f.workspace, "paper/main.tex"), "utf8"), f.source);
    const exec = promisify(execFile);
    const readAgain = await exec(process.execPath, [path.resolve("scripts/awResearch.ts"), "job", ...f.scope, "--job", failed.job.id], { cwd: f.workspace, windowsHide: true });
    assert.equal(JSON.parse(readAgain.stdout).status, "failed");
    // A separate CLI working directory must not affect locating the trusted runner.
    await writeFile(sourceFile, "print('fresh independent CLI')");
    const ready = await researchCommand(["put", ...f.scope, "--cell", "probe", "--revision", store.revision, "--file", sourceFile]);
    const cliRun = await exec(process.execPath, [path.resolve("scripts/awResearch.ts"), "run", ...f.scope, "--cell", "probe", "--revision", ready.revision, "--allow-python"], { cwd: f.workspace, windowsHide: true });
    assert.equal(JSON.parse(cliRun.stdout).job.status, "ready");
  } finally { globalThis.fetch = fetchBefore; }
});

test("offline/live run leases prevent competing processes and retain edited or removed cells honestly", async () => {
  const f = await offlineFixture(), sourceFile = path.join(f.workspace, "wait.py");
  // Coordinate the intended overlap explicitly. A competing CLI can take longer
  // than a short sleep under full-suite load; revision refusal is then correct,
  // but no longer tests an edit during the run. Both barriers are bounded.
  const waitingCode = (phase: string, output: string) => `import time\nfrom pathlib import Path\nPath('${phase}-started').write_text('started')\ndeadline = time.monotonic() + 15\nwhile not Path('${phase}-release').exists() and time.monotonic() < deadline:\n    time.sleep(0.01)\nif not Path('${phase}-release').exists():\n    raise RuntimeError('Synthetic test barrier was not released')\nprint('${output}')`;
  await writeFile(sourceFile, waitingCode("first", "original run"));
  const saved = await researchCommand(["put", ...f.scope, "--cell", "probe", "--kind", "code", "--revision", f.store.revision, "--file", sourceFile]);
  const run = researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", saved.revision, "--allow-python"]);
  const ownerFolder = path.dirname(f.store.path), lock = path.join(ownerFolder, "python-run.aw-lock");
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(lock); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(await readFile(lock));
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(path.join(ownerFolder, "first-started")); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(await readFile(path.join(ownerFolder, "first-started")));
  const exec = promisify(execFile);
  let updated: any;
  try {
    await assert.rejects(exec(process.execPath, [path.resolve("scripts/awResearch.ts"), "run", ...f.scope, "--cell", "probe", "--revision", saved.revision, "--allow-python"], { windowsHide: true }), error => /locked by another writer/.test(String((error as any).stderr)));
    await writeFile(sourceFile, "print('new source must survive')");
    updated = await researchCommand(["put", ...f.scope, "--cell", "probe", "--revision", saved.revision, "--file", sourceFile]);
  } finally { await writeFile(path.join(ownerFolder,"first-release"),"release"); }
  const completed = await run; assert.equal(completed.job.status, "ready", completed.job.error);
  const exact = await researchCommand(["cell", ...f.scope, "--cell", "probe"]);
  assert.match(exact.cell.source, /new source/); assert.match(exact.cell.outputs[0].text, /original run/); assert.match(exact.staleReason, /code changed/);
  assert.notEqual(completed.revision, updated.revision);
  await writeFile(sourceFile, waitingCode("second", "saved despite removal"));
  const next = await researchCommand(["put", ...f.scope, "--cell", "probe", "--revision", completed.revision, "--file", sourceFile]);
  const second = researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", next.revision, "--allow-python"]);
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(path.join(ownerFolder, "second-started")); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(await readFile(path.join(ownerFolder, "second-started")));
  try {
    const current = await readExperiments(f.workspace, f.project.id, "owner");
    current.notebook.cells = current.notebook.cells.filter(cell => cell.id !== "probe");
    await writeExperiments(f.workspace, f.project.id, "owner", current.revision, current.notebook);
  } finally { await writeFile(path.join(ownerFolder,"second-release"),"release"); }
  const removed = await second; assert.equal(removed.job.notebookUpdated, false);
  assert.match(await readFile(removed.job.runPath, "utf8"), /saved despite removal/);
  assert.ok(!(await readExperiments(f.workspace, f.project.id, "owner")).notebook.cells.some(cell => cell.id === "probe"));
});

test("independent CLI processes cannot both save the same notebook revision", async () => {
  const f = await offlineFixture(), file = path.join(f.workspace, "note.md"); await writeFile(file, "A competing note.");
  const cli = path.resolve("scripts/awResearch.ts"), exec = promisify(execFile);
  const args = [cli, "put", ...f.scope, "--cell", "new-note", "--revision", f.store.revision, "--file", file];
  const outcomes = await Promise.allSettled([exec(process.execPath, args, { windowsHide: true }), exec(process.execPath, args, { windowsHide: true })]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.match(String((outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult).reason.stderr), /changed/);
  const current = await readExperiments(f.workspace, f.project.id, "owner"); assert.equal(current.notebook.cells.length, 3);
  const lock = `${current.path}.aw-lock`; await writeFile(lock, "stale lock");
  await assert.rejects(withRecordLock(current.path, async () => "never", 0), /never automatically stolen/);
  assert.equal(await readFile(lock, "utf8"), "stale lock");
});

test("package overlay is explicit, readiness includes it, and inspection never runs cell source", async () => {
  const f = await offlineFixture();
  assert.equal(await pythonPackageFolder(f.workspace), undefined);
  const packages = path.join(f.workspace, ".paperfocus", "python-packages"); await mkdir(packages);
  const metadata = path.join(packages, "scipy-0.0.0.dist-info"); await mkdir(metadata);
  await writeFile(path.join(metadata, "METADATA"), "Metadata-Version: 2.1\nName: scipy\nVersion: 0.0.0\n");
  assert.equal(await pythonPackageFolder(f.workspace), packages);
  assert.equal(pythonEnvironment().AW_PYTHON_PACKAGES, undefined); assert.equal(pythonEnvironment(packages).AW_PYTHON_PACKAGES, packages);
  const runtime = await experimentRuntime(), before = await probeResearchPython(runtime.executable), checked = await probeResearchPython(runtime.executable, packages);
  assert.notEqual(before.packages.scipy, "0.0.0"); assert.equal(checked.packages.scipy, "0.0.0");
  assert.deepEqual((await readExperiments(f.workspace, f.project.id, "owner")).notebook, f.store.notebook);
  const invalid = await offlineFixture(); await writeFile(path.join(invalid.workspace, ".paperfocus", "python-packages"), "not a directory");
  await assert.rejects(pythonPackageFolder(invalid.workspace), /regular directories/);
});

test("failed offline result collection retains evidence and a later process reports the failure", async () => {
  const f = await offlineFixture(), sourceFile = path.join(f.workspace, "control.py");
  await writeFile(sourceFile, "import time\nfrom pathlib import Path\nPath('started').write_text('started')\ntime.sleep(0.2)\nprint('evidence survives locked store')");
  const saved = await researchCommand(["put", ...f.scope, "--cell", "probe", "--kind", "code", "--revision", f.store.revision, "--file", sourceFile]);
  const run = researchCommand(["run", ...f.scope, "--cell", "probe", "--revision", saved.revision, "--allow-python"]);
  const marker = path.join(path.dirname(f.store.path), "started");
  for (let attempt = 0; attempt < 100; attempt++) { try { await readFile(marker); break; } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
  assert.ok(await readFile(marker));
  await writeFile(`${f.store.path}.aw-lock`, "simulated crashed competing writer", { flag: "wx" });
  const result = await run; assert.equal(result.job.status, "failed"); assert.equal(result.job.notebookUpdated, false);
  assert.match(result.job.error, /notebook save failed/); assert.match(await readFile(result.job.runPath, "utf8"), /evidence survives/);
  const exec = promisify(execFile);
  const read = await exec(process.execPath, [path.resolve("scripts/awResearch.ts"), "job", ...f.scope, "--job", result.job.id], { windowsHide: true });
  assert.equal(JSON.parse(read.stdout).status, "failed"); assert.match(JSON.parse(read.stdout).error, /notebook save failed/);
  assert.equal((await readExperiments(f.workspace, f.project.id, "owner")).revision, saved.revision);
});

test("offline help covers scopes, safe batches and no dependency downloads", async () => {
  assert.equal(researchOptions(["--help"]).command, "help");
  assert.equal(researchOptions(["inspect", "--help"]).command, "help");
  const help = await researchCommand(["--help"]);
  assert.match(help, /No tsx\/npx installation/);
  assert.match(help, /--commit/);
  assert.match(help, /never restart an occupied/);
  const scope = ["--workspace", process.cwd(), "--project", "p", "--entry", "e"];
  assert.throws(() => researchOptions(["job", ...scope, "--job", "id", "--wait-seconds", "61"]), /1\.\.60/);
  assert.throws(() => researchOptions(["batch", ...scope, "--file", "x"]), /revision/);
  assert.throws(() => researchOptions(["manifest", ...scope, "--commit"]), /silently ignored/);
});

test("batch preparation preserves unknown fields, outputs, IDs and original notebook; invalid edits cannot partially save", async () => {
  const original = newExperimentNotebook();
  original.cells = [{ id: "code", cell_type: "code", source: "print(1)", outputs: [{ output_type: "stream", text: "saved" }], execution_count: 1, metadata: { custom: { human: true }, paperfocus: { pinned: true, suppressed: true, runId: "old", lastRunSource: "print(1)" } } },
    { id: "human", cell_type: "markdown", source: "Keep this", metadata: {} }];
  const before = structuredClone(original);
  const next = await prepareAgentBatch(original, { version: 1, changes: [{ cell: "code", source: "print(2)", arrange: { pinned: true } }, { cell: "summary", source: "## Result\nA gap remains.", after: "code", arrange: { pinned: true } }] }, process.cwd());
  assert.deepEqual(original, before);
  assert.deepEqual(next.cells.map(cell => cell.id), ["code", "summary", "human"]);
  assert.deepEqual(next.cells[0].outputs, before.cells[0].outputs);
  assert.deepEqual(next.cells[0].metadata.custom, before.cells[0].metadata.custom);
  assert.equal(next.cells[0].metadata.paperfocus!.suppressed, false);
  assert.match(experimentStaleness(next.cells[0], next)!, /code changed/);
  await assert.rejects(prepareAgentBatch(original, { version: 1, changes: [{ cell: "code", source: "candidate" }, { cell: "bad", source: "x", outputs: [] }] }, process.cwd()), /outputs\/execution/);
  await assert.rejects(prepareAgentBatch(original, { version: 1, changes: [{ cell: "code", kind: "markdown", source: "x" }] }, process.cwd()), /kinds/);
  await assert.rejects(prepareAgentBatch(original, { version: 1, changes: [{ cell: "code", inputs: [{ root: "data", path: "../foreign.py" }] }] }, process.cwd()), /traversal/);
  assert.deepEqual(original, before);
});

test("manifest changes detect exact sources, outputs, metadata, order and external-input state without claiming verification", () => {
  const identity = { workspace: process.cwd(), projectId: "p", entryId: "e", notebookId: "o", revision: "one" }, origin = "http://127.0.0.1:4173";
  const nb = newExperimentNotebook(); nb.cells = [{ id: "note", cell_type: "markdown", source: "original", metadata: {} }];
  const before = agentManifest(identity, origin, nb);
  assert.equal(manifestChanges(before, before).changed.length, 0);
  nb.cells[0].source = "new";
  let after = agentManifest({ ...identity, revision: "two" }, origin, nb);
  assert.deepEqual(manifestChanges(before, after).changed, [{ id: "note", fields: ["source"] }]);
  after = agentManifest({ ...identity, revision: "two" }, origin, nb, new Map([["note", ["file changed"]]]));
  assert.deepEqual(manifestChanges(before, after).changed[0].fields, ["source", "inputs"]);
  assert.throws(() => manifestChanges({ ...before, notebookId: "different" }, after), /another scope/);
  nb.cells = []; assert.deepEqual(manifestChanges(before, agentManifest(identity, origin, nb)).removed, ["note"]);
  assert.match(before.note, /does not mean complete outputs/);
});

test("new commands work through isolated live stores; fast reads omit unrelated data and legacy fallback stays guarded", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/agent-efficiency-"));
  await mkdir(path.join(workspace, "paper"));
  const manuscript = "\\documentclass{article}\n\\begin{document}Untouched.\\end{document}";
  await writeFile(path.join(workspace, "paper/main.tex"), manuscript);
  await writeFile(path.join(workspace, "paper/control.py"), "old input");
  const project = await registerProject(workspace, "paper"), now = new Date().toISOString();
  const entry: NotebookEntry = { id: "conversation", experimentNotebookId: "owner", title: "Human target", question: "Retain", notes: "Human private notes", reply: "", proposal: "", status: "open", route: "local", effort: 0, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await writeNotebook(workspace, project.id, 0, [entry]);
  const nb = newExperimentNotebook();
  nb.cells = [{ id: "human", cell_type: "markdown", source: "Keep all human text", metadata: { human: true } },
    { id: "large", cell_type: "code", source: "print('never run')", metadata: {}, outputs: [{ output_type: "stream", text: "X".repeat(100_000) }], execution_count: 1 }];
  const saved = await writeExperiments(workspace, project.id, "owner", "", nb);
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const args = ["--url", origin, "--workspace", workspace, "--project", project.id, "--entry", entry.id];
  const binding = path.join(workspace, "agent.json"), checkpoint = path.join(workspace, "seen.json"), batch = path.join(workspace, "edits.json");
  try {
    const discovery = await researchCommand(["discover", "--url", origin, "--workspace", workspace, "--project", project.id]);
    assert.equal(discovery.entries[0].title, entry.title); assert.equal(discovery.entries[0].notes, undefined);
    await researchCommand(["bind", ...args, "--file", binding]);
    await assert.rejects(researchCommand(["bind", ...args, "--file", binding]), /EEXIST/);
    assert.throws(() => researchOptions(["inspect", "--scope", binding, "--entry", "foreign"]), /scope differ/);
    await researchCommand(["manifest", "--scope", binding, "--file", checkpoint]);
    const unchanged = await researchCommand(["inspect", "--scope", binding, "--since", checkpoint]); assert.equal(unchanged.cells.length, 0);
    const edit = { version: 1, changes: [{ cell: "protocol", source: "## Target\nA finite control, not proof.", after: "human", arrange: { pinned: true } },
      { cell: "control", kind: "code", source: "import time\ntime.sleep(0.4)\nprint('small isolated control')", inputs: [{ root: "paper", path: "control.py" }] }] };
    await writeFile(batch, JSON.stringify(edit));
    const plan = await researchCommand(["batch", "--scope", binding, "--revision", saved.revision, "--file", batch]);
    assert.equal(plan.saved, false); assert.equal((await readExperiments(workspace, project.id, "owner")).revision, saved.revision);
    const commit = await researchCommand(["batch", "--scope", binding, "--revision", saved.revision, "--file", batch, "--commit"]);
    assert.equal(commit.executed, false);
    await assert.rejects(researchCommand(["batch", "--scope", binding, "--revision", saved.revision, "--file", batch, "--commit"]), /changed/);
    const changes = await researchCommand(["inspect", "--scope", binding, "--since", checkpoint]);
    assert.deepEqual(changes.cells.map((cell: any) => cell.id), ["protocol", "control"]);
    assert.deepEqual(changes.cells[0].headings, ["Target"]); assert.match(changes.cells[0].link, /awCell=protocol/);
    const exact = await researchCommand(["cell", "--scope", binding, "--cell", "protocol"]);
    assert.ok(JSON.stringify(exact).length < 5000); assert.equal(exact.cell.source, edit.changes[0].source);
    const denied = await fetch(`${origin}/api/paperfocus/research/cell?projectId=${project.id}&entryId=${entry.id}&cellId=control&owner=foreign`); assert.equal(denied.status, 400);
    const normalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const response = await normalFetch(input, init);
      if (String(input).endsWith("/health")) { const data = await response.json(); data.features.researchCells = false; data.features.experimentInputs = false; return new Response(JSON.stringify(data), { status: 200 }); }
      return response;
    };
    try {
      assert.equal((await researchCommand(["cell", "--scope", binding, "--cell", "protocol"])).cell.source, exact.cell.source);
      await assert.rejects(researchCommand(["run", "--scope", binding, "--cell", "control", "--revision", commit.revision, "--allow-python"]), /No run started/);
    } finally { globalThis.fetch = normalFetch; }
    const result = await researchCommand(["run", "--scope", binding, "--cell", "control", "--revision", commit.revision, "--allow-python"]);
    await writeFile(path.join(workspace, "paper/control.py"), "changed input");
    const job = await researchCommand(["job", "--scope", binding, "--job", result.job.id, "--wait-seconds", "10"]);
    assert.equal(job.status, "ready", job.error);
    const output = await researchCommand(["output", "--scope", binding, "--cell", "control", "--output", "0"]);
    assert.match(output.output.text, /isolated control/); assert.equal(output.inputCheck.changed.length, 1); assert.match(output.staleReason, /input files changed/);
    const disk = await readExperiments(workspace, project.id, "owner");
    const record = JSON.parse(await readFile(path.join(path.dirname(disk.path), "runs", `${job.id}.json`), "utf8"));
    assert.equal(record.execution.inputs[0].path, "control.py"); assert.deepEqual(record.execution.inputsChanged, ["paper:control.py"]);
    assert.deepEqual(disk.notebook.cells.find(cell => cell.id === "human"), nb.cells[0]);
    assert.equal(await readFile(path.join(workspace, "paper/main.tex"), "utf8"), manuscript);
    const conversation = await readNotebook(workspace, project.id); assert.equal(conversation.entries[0].notes, entry.notes); assert.equal(conversation.entries[0].status, "open");
    conversation.entries[0].experimentNotebookId = "new-owner"; await writeNotebook(workspace, project.id, conversation.revision, conversation.entries);
    await assert.rejects(researchCommand(["inspect", "--scope", binding]), /ownership changed/);
    await assert.rejects(createAgentJson(path.join(workspace, "paper/main.tex"), workspace, {}), /EEXIST/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("input hashes detect mutation/missing files, refuse traversal and leave old notebooks valid", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const root = await mkdtemp(path.resolve(".paperfocus/trials/input-hashes-"));
  const roots = { paper: root, data: root }; await writeFile(path.join(root, "script.py"), "first");
  const captured = await captureExperimentInputs(roots, [{ root: "paper", path: "script.py" }]);
  assert.equal((await checkExperimentInputs(roots, captured)).changed.length, 0);
  await writeFile(path.join(root, "script.py"), "second"); assert.equal((await checkExperimentInputs(roots, captured)).changed.length, 1);
  await assert.rejects(captureExperimentInputs(roots, [{ root: "paper", path: "../elsewhere" }]), /traversal/);
  assert.equal((await checkExperimentInputs(roots, [{ ...captured[0], path: "missing.py" }])).changed.length, 1);
  const legacy = newExperimentNotebook(); legacy.cells = [{ id: "old", cell_type: "code", source: "x", outputs: [], execution_count: null, metadata: {} }];
  validateExperimentNotebook(legacy); assert.equal(experimentStaleness(legacy.cells[0], legacy), undefined);
});
