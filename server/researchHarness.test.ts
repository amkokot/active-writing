import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { desktopServer } from "../scripts/desktopServer.mjs";
import { researchCommand, researchOptions } from "../scripts/awResearch.ts";
import { registerProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { experimentRuntime, readExperiments, writeExperiments } from "./experiments.ts";
import { experimentContext, experimentPlot, newExperimentCell, newExperimentNotebook, plotCoordinates, plotTicks } from "../src/experiments.ts";
import { experimentAgentInstructions } from "../src/researchInstructions.ts";
import { researchReadiness, probeResearchPython } from "./researchReadiness.ts";
import { arrangeExperimentCell, experimentCellDomId, featuredOutputIndex, savedOutputLabel, notebookShortcut } from "../src/experimentActions.ts";
import { createHandoff, readHandoff } from "./handoffs.ts";
import { studyState } from "../src/study.ts";
import type { NotebookEntry } from "../src/types.ts";

test("agent options require exact identity, local origin, revision and execution permission", () => {
  const identity = ["--workspace", process.cwd(), "--project", "paper", "--entry", "thread"];
  assert.throws(() => researchOptions(["inspect"]), /workspace/);
  assert.throws(() => researchOptions(["inspect", ...identity, "--url", "https://example.com"]), /loopback/);
  assert.throws(() => researchOptions(["inspect", ...identity, "--url", "http://localhost:4173/path"]), /loopback/);
  assert.throws(() => researchOptions(["run", ...identity, "--cell", "test", "--revision", "rev"]), /permission/);
  assert.throws(() => researchOptions(["put", ...identity, "--cell", "test"]), /revision/);
  assert.throws(() => researchOptions(["inspect", ...identity, "--entry", "other"]), /repeated/);
  assert.throws(() => researchOptions(["organize", ...identity, "--cell", "test", "--revision", "rev", "--pin", "yes"]), /true or false/);
  assert.throws(() => researchOptions(["organize", ...identity, "--cell", "test", "--revision", "rev"]), /arrangement/);
  assert.throws(() => researchOptions(["finish", ...identity, "--revision", "rev"]), /--task/);
  assert.throws(() => researchOptions(["inspect", ...identity, "--after", "note"]), /silently ignored/);
  assert.equal(researchOptions(["preflight", ...identity]).command, "preflight");
  assert.throws(() => researchOptions(["preflight", ...identity, "--allow-python"]), /silently ignored/);
});

test("setup checks preserve research records, verify owners before probes and never execute saved code", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/research-ready-")); await mkdir(path.join(workspace, "paper"));
  const manuscript = "\\documentclass{article}\n\\begin{document}Keep the author's statement.\\end{document}";
  await writeFile(path.join(workspace, "paper/main.tex"), manuscript);
  const project = await registerProject(workspace, "paper"), now = new Date().toISOString();
  const entry: NotebookEntry = { id: "conversation", experimentNotebookId: "owner", title: "First session", question: "Keep this question", notes: "Human note", reply: "", proposal: "", status: "open", route: "local", effort: 0, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await writeNotebook(workspace, project.id, 0, [entry]);
  const notebook = newExperimentNotebook(), cell = newExperimentCell("code");
  cell.id = "do-not-run"; cell.source = "raise RuntimeError('setup must not run me')";
  cell.outputs = [{ output_type: "stream", text: "Imported evidence, not checked" }]; notebook.cells = [cell];
  const saved = await writeExperiments(workspace, project.id, "owner", "", notebook);
  let probes = 0;
  const probe = async () => { probes++; return { available: true, checkedAt: now, version: "3.test", packages: { numpy: "test", scipy: null, matplotlib: null } }; };
  const report = await researchReadiness(workspace, project.id, entry.id, probe);
  assert.equal(report.notebookId, "owner"); assert.equal(report.revisions.notebook, saved.revision);
  const capacity = await experimentRuntime();
  assert.equal(report.execution.maxConcurrentRuns, capacity.maxConcurrentRuns);
  assert.equal(report.execution.maxConcurrentRunsPerNotebook, 1);
  assert.equal(report.execution.availableRuns, capacity.availableRuns);
  assert.deepEqual(report.execution.targets, ["local"]); assert.equal(report.execution.remoteEnabled, false);
  assert.equal(report.python.available, true); assert.match(report.warnings.join("\n"), /1 active code cells/); assert.match(report.warnings.join("\n"), /scipy is not installed/);
  await assert.rejects(researchReadiness(workspace, project.id, "wrong-conversation", probe), /Conversation not found/);
  assert.equal(probes, 1, "unknown owners never start diagnostics");
  const missing = await researchReadiness(workspace, project.id, entry.id, async () => ({ available: false, checkedAt: now, packages: {}, error: "Missing interpreter" }));
  assert.match(missing.warnings.join("\n"), /Missing interpreter/);
  const disk = await readExperiments(workspace, project.id, "owner"); assert.equal(disk.revision, saved.revision); assert.deepEqual(disk.notebook, notebook);
  assert.deepEqual((await readNotebook(workspace, project.id)).entries, [entry]);
  assert.equal(await (await import("node:fs/promises")).readFile(path.join(workspace, "paper/main.tex"), "utf8"), manuscript);
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const headers of [{}, { Origin: "http://untrusted.example" }]) {
      const denied = await fetch(`${origin}/api/paperfocus/research/preflight`, { method: "POST", headers, body: JSON.stringify({ projectId: project.id, entryId: entry.id }) });
      assert.equal(denied.status, 403);
    }
    assert.equal((await fetch(`${origin}/api/paperfocus/research/preflight`)).status, 405);
    const checked = await researchCommand(["preflight", "--url", origin, "--workspace", workspace, "--project", project.id, "--entry", entry.id]);
    assert.equal(checked.notebookId, "owner"); assert.equal(typeof checked.python.available, "boolean");
    assert.equal((await readExperiments(workspace, project.id, "owner")).revision, saved.revision);
    assert.equal((await readExperiments(workspace, project.id, "owner")).notebook.cells[0].execution_count, null);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  const failed = await probeResearchPython(path.join(workspace, "not-installed-python"));
  assert.equal(failed.available, false); assert.match(failed.error!, /could not start/);
});

test("human and agent cell arrangement keeps complete evidence; shortcuts never hijack plain Enter or composition", () => {
  const nb = newExperimentNotebook(); nb.cells = [newExperimentCell("code"), newExperimentCell("markdown")];
  nb.cells[0].id = "code"; nb.cells[1].id = "note"; nb.cells[0].outputs = [{ output_type: "stream", text: "evidence" }];
  nb.cells[0].metadata.custom = "human annotation";
  const changed = arrangeExperimentCell(nb, "code", { after: "note", pinned: true, suppressed: true, filed: true, deleted: true, folder: "Negative controls" });
  assert.deepEqual(changed.cells.map(cell => cell.id), ["note", "code"]); assert.equal(changed.cells[1].metadata.paperfocus?.suppressed, false);
  assert.deepEqual(changed.cells[1].outputs, nb.cells[0].outputs); assert.equal(changed.cells[1].metadata.custom, "human annotation");
  const restored = arrangeExperimentCell(changed, "code", { deleted: false, filed: false, before: "note" });
  assert.deepEqual(restored.cells.map(cell => cell.id), ["code", "note"]); assert.equal(restored.cells[0].metadata.paperfocus?.folder, "Negative controls");
  assert.throws(() => arrangeExperimentCell(nb, "code", { after: "absent" }), /existing/);
  assert.throws(() => arrangeExperimentCell(nb, "code", { before: "note", after: "note" }), /not both/);
  assert.throws(() => arrangeExperimentCell(nb, "code", { featuredOutput: 1 }), /existing saved output/);
  assert.equal(featuredOutputIndex(nb.cells[0]), 0);
  nb.cells[0].outputs!.push({ output_type: "display_data", data: { "application/vnd.paperfocus.plot+json": { title: "Control" } } });
  assert.equal(featuredOutputIndex(nb.cells[0]), 1); assert.equal(savedOutputLabel(nb.cells[0].outputs![1], 1), "2. Control");
  const focused = arrangeExperimentCell(nb, "code", { featuredOutput: 0 }); assert.equal(featuredOutputIndex(focused.cells[0]), 0);
  assert.deepEqual(focused.cells[0].outputs, nb.cells[0].outputs, "display selection never filters evidence");
  nb.cells[0].outputs!.push({ output_type: "error", ename: "Failure" }); assert.equal(featuredOutputIndex(nb.cells[0]), 2);
  const key = { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false };
  assert.equal(notebookShortcut(key), undefined); assert.equal(notebookShortcut({ ...key, shiftKey: true }), "advance");
  assert.equal(notebookShortcut({ ...key, ctrlKey: true }), "stay"); assert.equal(notebookShortcut({ ...key, shiftKey: true, isComposing: true }), undefined);
  assert.notEqual(experimentCellDomId("question", "shared"), experimentCellDomId("other", "shared"));
  assert.notEqual(experimentCellDomId("a-b", "c"), experimentCellDomId("a", "b-c"), "composite IDs cannot collide");
});

test("direct notebook research completion uses exact ownership and revision, never response files or human resolution", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/direct-notebook-test-")); await mkdir(path.join(workspace, "paper"));
  const manuscript = "\\documentclass{article}\n\\begin{document}Author text.\\end{document}";
  await writeFile(path.join(workspace, "paper/main.tex"), manuscript);
  const project = await registerProject(workspace, "paper"), now = new Date().toISOString();
  const entry: NotebookEntry = { id: "conversation", experimentNotebookId: "owner", title: "Question", question: "Check assumptions", notes: "Human notes stay", reply: "", proposal: "", status: "open", route: "codex", effort: 1, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const args = ["--url", origin, "--workspace", workspace, "--project", project.id, "--entry", entry.id];
  try {
    const target = { entryId: entry.id, notebookId: "owner" }, packet = "Derive a careful bound. Preserve human comments.";
    const ticket = await createHandoff(workspace, project.id, { packet, transport: "files", notebookTarget: target, origin });
    assert.match(ticket.copyText, /No response file/);
    assert.deepEqual(await createHandoff(workspace, project.id, { id: ticket.id, packet, transport: "files", notebookTarget: target, origin }), ticket);
    await assert.rejects(createHandoff(workspace, project.id, { id: ticket.id, packet, transport: "files", notebookTarget: { ...target, entryId: "other" }, origin }), /another request/);
    await assert.rejects(createHandoff(workspace, project.id, { packet, transport: "paste", notebookTarget: target }), /destination/);
    entry.study = { ...studyState(entry), turns: [{ id: ticket.id, action: "assumptions", depth: "derivation", route: "codex", status: "queued", packet, reply: "", createdAt: now, ticket }], activeTurnId: ticket.id };
    await writeNotebook(workspace, project.id, 0, [entry]);
    const source = path.join(workspace, "summary.txt"); await writeFile(source, "## Conclusion\nThe bound needs $q<1$. Evidence is not proof.");
    const before = await researchCommand(["inspect", ...args]); assert.equal(before.requests[0].requestHash, ticket.requestHash);
    const saved = await researchCommand(["put", ...args, "--cell", "summary", "--file", source, "--revision", "missing"]);
    const arranged = await researchCommand(["organize", ...args, "--cell", "summary", "--revision", saved.revision, "--pin", "true", "--highlight", "true"]);
    assert.equal((await readHandoff(workspace, project.id, ticket.id)).status, "pending", "ordinary cell changes aren't completion");
    await writeFile(ticket.responsePath, JSON.stringify({ version: 1, taskId: ticket.id, requestHash: ticket.requestHash, complete: true, reply: "Wrong return channel" }));
    assert.equal((await readHandoff(workspace, project.id, ticket.id)).status, "pending", "direct tasks ignore response files");
    const finish = ["finish", ...args, "--task", ticket.id, "--request-hash", ticket.requestHash, "--summary-cell", "summary", "--revision", arranged.revision];
    await assert.rejects(researchCommand(finish.map(value => value === arranged.revision ? saved.revision : value)), /Notebook changed/);
    await assert.rejects(researchCommand(finish.map(value => value === ticket.requestHash ? "a".repeat(64) : value)), /different notebook or prompt/);
    const filed = await researchCommand(["organize", ...args, "--cell", "summary", "--revision", arranged.revision, "--filed", "true"]);
    await assert.rejects(researchCommand(finish.map(value => value === arranged.revision ? filed.revision : value)), /active Markdown summary/);
    const unfiled = await researchCommand(["organize", ...args, "--cell", "summary", "--revision", filed.revision, "--filed", "false"]);
    const final = finish.map(value => value === arranged.revision ? unfiled.revision : value);
    const denied = await fetch(`${origin}/api/paperfocus/research/finish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); assert.equal(denied.status, 400);
    assert.equal((await researchCommand(final)).finished, true); assert.equal((await researchCommand(final)).reused, true);
    const received = await readHandoff(workspace, project.id, ticket.id); assert.equal(received.status, "ready"); assert.match(received.reply!, /bound needs/);
    const disk = await readNotebook(workspace, project.id); assert.equal(disk.entries[0].notes, entry.notes); assert.equal(disk.entries[0].status, "open");
    assert.equal(disk.entries[0].study!.turns[0].closed, undefined); assert.equal(disk.entries[0].study!.turns[0].notebookResult!.summaryCellId, "summary");
    await writeFile(source, "Later revision; don't replace the old completed answer.");
    const later = await researchCommand(["put", ...args, "--cell", "summary", "--file", source, "--revision", unfiled.revision]);
    await assert.rejects(researchCommand(final.map(value => value === unfiled.revision ? later.revision : value)), /already has findings/);
    assert.equal((await readHandoff(workspace, project.id, ticket.id)).reply, received.reply);
    disk.entries[0].study!.turns[0].closed = true; await writeNotebook(workspace, project.id, disk.revision, disk.entries);
    await assert.rejects(researchCommand(final.map(value => value === unfiled.revision ? later.revision : value)), /closed/);
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(workspace, "paper/main.tex"), "utf8"), manuscript);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("agent cell edits preserve owners, independent notes, outputs and flags; stale writes/runs reject", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/harness-test-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}Test.\\end{document}");
  const project = await registerProject(workspace, "paper");
  const store = await readNotebook(workspace, project.id), now = new Date().toISOString();
  const entry = { id: "conversation", experimentNotebookId: "owner", title: "Target", question: "Question", notes: "Human notes", reply: "", proposal: "", status: "open", route: "local", effort: 0, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await writeNotebook(workspace, project.id, store.revision, [entry]);
  const nb = newExperimentNotebook(), cell = newExperimentCell("code"), note = newExperimentCell("markdown");
  cell.id = "code"; cell.source = "print('previous')"; cell.outputs = [{ output_type: "stream", text: "Previous evidence" }]; cell.metadata.paperfocus = { pinned: true, lastRunSource: "print('previous')", runId: "prior" };
  cell.metadata.custom = "retained"; note.id = "author-note"; note.source = "Do not replace this"; nb.cells = [cell, note];
  const saved = await writeExperiments(workspace, project.id, "owner", "", nb);
  const source = path.join(workspace, "source.txt"); await writeFile(source, "print('updated')");
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const args = ["--url", origin, "--workspace", workspace, "--project", project.id, "--entry", "conversation"];
  try {
    const before = await researchCommand(["inspect", ...args]);
    assert.equal(before.notebookId, "owner"); assert.equal(before.paperRoot, path.join(workspace, "paper"));
    assert.equal(before.awDataRoot, path.join(workspace, ".paperfocus/project-data", project.id));
    assert.equal(before.path, path.join(before.awDataRoot, "experiments/owner/notebook.ipynb"));
    assert.ok(before.context.includes(before.path));
    assert.equal(before.cells[0].flags.lastRunSource, undefined, "manifest does not duplicate full code");
    const changed = await researchCommand(["put", ...args, "--cell", "code", "--file", source, "--revision", before.revision]);
    assert.equal(changed.executed, false);
    const read = await researchCommand(["cell", ...args, "--cell", "code"]);
    const one = await researchCommand(["output", ...args, "--cell", "code", "--output", "0"]);
    assert.deepEqual(one.output, cell.outputs[0]); assert.equal(one.cell, undefined); assert.match(one.staleReason, /code changed/);
    await assert.rejects(researchCommand(["output", ...args, "--cell", "code", "--output", "1"]), /output not found/);
    assert.equal(read.cell.metadata.custom, "retained"); assert.equal(read.cell.metadata.paperfocus.pinned, true);
    assert.deepEqual(read.cell.outputs, cell.outputs); assert.equal(read.cell.source, "print('updated')");
    assert.equal((await researchCommand(["inspect", ...args])).cells[0].stale, true);
    await assert.rejects(researchCommand(["run", ...args, "--cell", "code", "--revision", saved.revision, "--allow-python"]), /Notebook changed/);
    await assert.rejects(researchCommand(["put", ...args, "--cell", "code", "--file", source, "--revision", saved.revision]), /Notebook changed/);
    await assert.rejects(researchCommand(["inspect", ...args.map(value => value === workspace ? path.join(workspace, "paper") : value)]), /Wrong Aw workspace/);
    await assert.rejects(researchCommand(["put", ...args, "--cell", "code", "--kind", "markdown", "--file", source, "--revision", changed.revision]), /kind is preserved/);
    const added = await researchCommand(["put", ...args, "--cell", "new-note", "--after", "code", "--file", source, "--revision", changed.revision]);
    const current = await readExperiments(workspace, project.id, "owner");
    assert.equal(current.revision, added.revision); assert.deepEqual(current.notebook.cells.map(c => c.id), ["code", "new-note", "author-note"]);
    assert.equal(current.notebook.cells[2].source, "Do not replace this");
    assert.deepEqual((await readNotebook(workspace, project.id)).entries, [entry], "no comments or conversation states were resolved");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("log plots retain original values and use evenly spaced decades, rejecting zero and negative data", () => {
  const plot = { title: "Convergence", xLabel: "Step", yLabel: "Error", yScale: "log" as const, series: [{ name: "Curve", points: [[0, 0.01], [1, 0.1], [2, 1]] }] };
  assert.ok(experimentPlot(plot));
  const coords = plotCoordinates(plot)!;
  assert.equal(coords.y(0.1), (coords.y(0.01) + coords.y(1)) / 2);
  assert.equal(coords.x(1), (coords.x(0) + coords.x(2)) / 2);
  assert.equal(experimentPlot({ ...plot, yScale: "unknown" }), undefined);
  for (const y of [0, -1]) assert.equal(experimentPlot({ ...plot, series: [{ name: "Bad", points: [[0, y]] }] }), undefined);
  assert.deepEqual(plot.series[0].points[1], [1, 0.1]);
  assert.deepEqual(plotTicks(0.234, 2048, "log"), [1, 10, 100, 1000]);
  assert.equal(plotTicks(1e-100, 1e100, "log").length <= 6, true);
  assert.deepEqual(plotTicks(0, 80), [20, 40, 60]);
  assert.deepEqual(plotTicks(1, 1), []);
  const nb = newExperimentNotebook(), cell = newExperimentCell("code"); cell.outputs = [{ output_type: "display_data", data: { "application/vnd.paperfocus.plot+json": plot, "text/plain": "Title only" } }]; nb.cells = [cell];
  const context = experimentContext(nb, "owner"); assert.match(context, /first=\[0,0.01\]/); assert.match(context, /last=\[2,1\]/); assert.match(context, /Error \(log\)/);
  cell.outputs = [{ output_type: "display_data", data: { "text/markdown": "A derived bound: $q<1$." } }];
  assert.match(experimentContext(nb, "owner"), /derived bound/);
});

test("instructions can locate installed tools when app code and research data are separate", () => {
  const text = experimentAgentInstructions({ origin: "http://127.0.0.1:4173", workspace: "C:/Research data", codeRoot: "C:/App's tools", projectId: "paper", entryId: "conversation", notebookId: "owner", path: "notebook.ipynb" });
  assert.match(text, /node 'C:\/App''s tools\/scripts\/awResearch\.ts' inspect --offline/);
  assert.match(text, /--workspace 'C:\/Research data'/); assert.match(text, /node 'C:\/App''s tools\/scripts\/awVersions\.ts' inspect/);
  assert.match(text, /not necessarily the code folder/); assert.match(text, /sections in the code folder/);
});
test("copied instructions bind the conversation and preserve ownership and permission boundaries", () => {
  const text = experimentAgentInstructions({ origin: "http://127.0.0.1:4173", workspace: "C:/Author's papers", projectId: "paper", entryId: "conversation", notebookId: "owner", path: "notebook.ipynb" });
  assert.match(text, /--workspace 'C:\/Author''s papers'/); assert.match(text, /--entry 'conversation'/);
  assert.match(text, /experiment owner: owner/); assert.match(text, /human permission/); assert.match(text, /--revision REVISION/);
  assert.match(text, /not proof/); assert.match(text, /human Resolve/);
  assert.match(text, /preflight/); assert.match(text, /REMOTE_RESEARCH.md/); assert.match(text, /remote submission is not connected/);
  assert.match(text, /For longer-form explanations, derivations, literature reviews, or evolving research summaries, create or reuse an informative-notes manuscript/);
  assert.match(text, /Reuse an existing notes root/); assert.match(text, /separate from the publication manuscript/);
  assert.match(text, /Keep experimental code, outputs, execution records and short result summaries in this notebook/);
  assert.match(text, /link the exposition to exact cells or saved outputs/);
  assert.match(text, /do not open or browse Aw by default/);
  assert.match(text, /Keep this conversation, experiment owner, evidence links and saved-task completion connected/);
  assert.match(text, /Reserve opening Aw and checking its renderer for the human's review/);
  assert.match(text, /without starting or checking the Aw server/);
  assert.match(text, /Do not launch Aw just for rendering/);
  assert.match(text, /do not repeatedly probe, rebuild or start\/restart/);
  assert.match(text, /notebook import\/finish that is pending/);
  assert.match(text, /saved Aw stores without HTTP or a server/);
  assert.match(text, /inspect --offline/);
  assert.match(text, /run --offline --allow-python/);
  assert.match(text, /no manual import/);
  assert.match(text, /job --offline reads saved runs/);
  assert.match(text, /no separate health\/registry\/UI startup ritual/);
});

test("real Python display helper saves log data and Markdown, retaining invalid-log failures", async () => {
  const runtime = await experimentRuntime();
  for (const positive of [true, false]) {
    const source = `display_data({'text/markdown':'A bound: $q<1$.'})\ndisplay_plot('Trial', [{'name':'error','points':[[0,${positive ? "0.1" : "0"}],[1,1]]}], y_scale='log')`;
    const run = spawnSync(runtime.executable, ["-I", path.resolve("server/experiment_runner.py")], { input: JSON.stringify({ source }), encoding: "utf8", windowsHide: true, timeout: 5000 });
    assert.ifError(run.error); assert.equal(run.status, 0);
    const record = JSON.parse(run.stdout);
    assert.equal(record.outputs[0].data["text/markdown"], "A bound: $q<1$.");
    if (positive) { assert.equal(record.error, null); assert.equal(record.outputs[1].data["application/vnd.paperfocus.plot+json"].yScale, "log"); }
    else { assert.match(record.error, /strictly positive/); assert.equal(record.outputs[1].output_type, "error"); }
  }
});
