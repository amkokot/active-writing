import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerProject } from "./projects.ts";
import { cancelExperimentJob, experimentRuntime, readExperimentJob, readExperiments, readExperimentSession, restartExperimentSession, runExperiment, writeExperiments } from "./experiments.ts";
import { closePythonSessions, pythonSessionStatus, resetPythonSession, runInPythonSession } from "./pythonSessions.ts";
import { experimentContext, experimentStaleness, newExperimentCell, newExperimentNotebook, plotCoordinates, validateExperimentNotebook } from "../src/experiments.ts";
import { freshExperimentContext } from "../src/freshExperimentContext.ts";
import { registerExperimentDraft, flushExperimentDraft } from "../src/experimentDrafts.ts";
import { nearestPlotPoint, plotWindow } from "../src/plotInspection.ts";
import { researchOptions } from "../scripts/awResearch.ts";

test("real shared Python session retains variables/functions, isolates owners and clears after failure/restart", async () => {
  const runtime = await experimentRuntime();
  await mkdir(".paperfocus/trials", { recursive: true });
  const folder = await mkdtemp(path.resolve(".paperfocus/trials/session-protocol-"));
  let execution: any;
  const run = (key: string, source: string, cellId: string, runId: string) => runInPythonSession(key, runtime.executable, folder, source, cellId, runId, (_child, value) => { execution = value; });
  try {
    assert.equal(pythonSessionStatus("owner-a").active, false);
    const start = await run("owner-a", "value=21\ndef double(x):\n return 2*x\nprint('setup')", "setup", "run-a");
    assert.equal(start.error, null); assert.equal(execution.sequence, 1);
    const sessionId = execution.sessionId;
    const answer = await run("owner-a", "print(double(value))\ndisplay_table([{'answer': double(value)}])", "compute", "run-b");
    assert.match(String(answer.outputs[0].text), /42/); assert.equal(execution.sessionId, sessionId);
    assert.deepEqual(execution.priorRuns, [{ cellId: "setup", runId: "run-a" }]);
    const other = await run("owner-b", "print('value' in globals())", "independent", "other-run");
    assert.match(String(other.outputs[0].text), /False/);
    const fail = await run("owner-a", "value=999\nraise ValueError('negative control')", "bad", "run-c");
    assert.match(fail.error!, /negative control/); assert.equal(pythonSessionStatus("owner-a").active, false);
    const after = await run("owner-a", "print('value' in globals())", "check", "run-d");
    assert.match(String(after.outputs[0].text), /False/); assert.notEqual(execution.sessionId, sessionId);
    resetPythonSession("owner-a"); assert.equal(pythonSessionStatus("owner-a").active, false);
    assert.equal(pythonSessionStatus("owner-b").active, true, "restarting one owner leaves the other alone");
    await run("owner-a", "print('a')", "a", "a"); await run("owner-c", "print('c')", "c", "c");
    await assert.rejects(run("owner-d", "print('d')", "d", "d"), /Three Python sessions/);
  } finally { closePythonSessions(); }
});

test("session execution is explicit, revision guarded, recorded and cancelable; fresh cells still isolate state", async () => {
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/session-store-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}Test.\\end{document}");
  const project = await registerProject(workspace, "paper"), owner = "session-trial";
  const nb = newExperimentNotebook();
  const setup = { ...newExperimentCell("code"), id: "setup", source: "x=7\nprint('setup saved')" };
  const result = { ...newExperimentCell("code"), id: "result", source: "print(x*6)" };
  const slow = { ...newExperimentCell("code"), id: "slow", source: "import time\ntime.sleep(20)" };
  nb.cells = [setup, result, slow];
  let store = await writeExperiments(workspace, project.id, owner, "", nb);
  const args = [workspace, project.id, owner] as const;
  const finish = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const job = await readExperimentJob(...args, id);
      if (job.status !== "working") return job;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.fail("Python run did not finish within the trial budget");
  };
  try {
    await assert.rejects(runExperiment(...args, "setup", store.revision, false, "session"), /permission/);
    await assert.rejects(runExperiment(...args, "setup", "old-revision", true, "session"), /Save the cell/);
    assert.equal((await readExperimentSession(...args)).active, false);
    assert.equal((await finish((await runExperiment(...args, "setup", store.revision, true, "session")).id)).status, "ready");
    store = await readExperiments(...args);
    const job = await finish((await runExperiment(...args, "result", store.revision, true, "session")).id);
    assert.equal(job.status, "ready"); assert.equal(job.execution?.sequence, 2);
    store = await readExperiments(...args);
    assert.match(String(store.notebook.cells[1].outputs![0].text), /42/);
    assert.equal(store.notebook.cells[1].metadata.paperfocus!.execution!.priorRuns![0].runId, store.notebook.cells[0].metadata.paperfocus!.runId);
    const record = JSON.parse(await readFile(path.join(path.dirname(store.path), "runs", `${job.id}.json`), "utf8"));
    assert.deepEqual(record.execution, store.notebook.cells[1].metadata.paperfocus!.execution);
    store.notebook.cells[0].source = "x=8";
    assert.match(experimentStaleness(store.notebook.cells[1], store.notebook)!, /earlier session cells/);
    assert.match(experimentContext(store.notebook, owner), /execution history matters/);
    store = await writeExperiments(...args, store.revision, store.notebook);
    const fresh = await finish((await runExperiment(...args, "result", store.revision, true)).id);
    assert.equal(fresh.status, "failed"); assert.match(fresh.error!, /x.*not defined/);
    assert.equal((await readExperimentSession(...args)).active, true, "fresh failures do not clear an unrelated shared session");
    store = await readExperiments(...args);
    const running = await runExperiment(...args, "slow", store.revision, true, "session");
    await assert.rejects(restartExperimentSession(...args), /Stop the running cell/);
    await new Promise(resolve => setTimeout(resolve, 100));
    await cancelExperimentJob(...args, running.id);
    // Cancellation status is immediate; wait until the retained record is complete.
    for (let i = 0; i < 100; i++) {
      try { await readFile(path.join(path.dirname(store.path), "runs", `${running.id}.json`)); break; } catch { await new Promise(resolve => setTimeout(resolve, 40)); }
    }
    assert.equal((await readExperimentSession(...args)).active, false);
    store = await readExperiments(...args); validateExperimentNotebook(store.notebook);
    assert.equal(store.notebook.cells.length, 3);
    const canceled = JSON.parse(await readFile(path.join(path.dirname(store.path), "runs", `${running.id}.json`), "utf8"));
    assert.equal(canceled.status, "cancelled");
  } finally { closePythonSessions(); }
});

test("shared sessions bound run count and reject stray protocol output without reusing state", async () => {
  const runtime = await experimentRuntime();
  const folder = await mkdtemp(path.resolve(".paperfocus/trials/session-limits-"));
  const run = (key: string, source: string, id: string) => runInPythonSession(key, runtime.executable, folder, source, "cell", id, () => {});
  try {
    for (let i = 0; i < 100; i++) await run("bounded", "pass", `run-${i}`);
    assert.equal(pythonSessionStatus("bounded").runs, 100);
    await assert.rejects(run("bounded", "pass", "too-many"), /100 runs/);
    resetPythonSession("bounded");
    await assert.rejects(run("protocol", "import sys\nsys.__stdout__.write('not JSON\\n')\nsys.__stdout__.flush()", "rogue"));
    assert.equal(pythonSessionStatus("protocol").active, false);
    const clean = await run("protocol", "print('clean')", "clean"); assert.match(String(clean.outputs[0].text), /clean/);
  } finally { closePythonSessions(); }
});

test("shared-session staleness detects changed/missing upstream runs and validates imported provenance", () => {
  const nb = newExperimentNotebook(), a = newExperimentCell("code"), b = newExperimentCell("code");
  a.id = "setup"; a.source = "a=1"; a.metadata.paperfocus = { lastRunSource: "a=1", runId: "run-a" };
  b.id = "result"; b.source = "print(a)"; b.metadata.paperfocus = { lastRunSource: "print(a)", runId: "run-b", execution: { mode: "session", sessionId: "session-a", sequence: 2, priorRuns: [{ cellId: a.id, runId: "run-a" }] } };
  nb.cells = [a, b]; validateExperimentNotebook(nb); assert.equal(experimentStaleness(b, nb), undefined);
  a.metadata.paperfocus.runId = "new-run"; assert.match(experimentStaleness(b, nb)!, /earlier session/);
  nb.cells = [b]; assert.ok(experimentStaleness(b, nb));
  b.metadata.paperfocus.execution!.sequence = -1; assert.throws(() => validateExperimentNotebook(nb), /execution history/);
  b.metadata.paperfocus.execution!.sequence = 2; b.metadata.paperfocus.execution!.priorRuns = [null] as any;
  assert.throws(() => validateExperimentNotebook(nb), /execution history/);
});

test("fresh context flushes only its owner's draft, reads disk and keeps expanded evidence transient", async () => {
  const nb = newExperimentNotebook();
  for (let i = 0; i < 30; i++) { const cell = newExperimentCell("markdown"); cell.id = `note-${i}`; cell.source = `EVIDENCE_${i}\n` + "note ".repeat(400); cell.metadata.paperfocus = { title: `Trial ${i}` }; nb.cells.push(cell); }
  nb.cells[29].metadata.paperfocus!.highlighted = true;
  nb.cells[28].metadata.paperfocus!.filed = true;
  let flushed = false, count = 0;
  const unregister = registerExperimentDraft("paper", "owner", async () => { flushed = true; });
  const entry = { id: "conversation", experimentNotebookId: "owner", experimentContext: "OLD_EVIDENCE" } as any;
  const request = (async (url, options) => {
    assert.equal(flushed, true); assert.match(String(url), /projectId=paper&notebookId=owner/); assert.equal(options!.cache, "no-store"); count++;
    return new Response(JSON.stringify({ notebook: nb, revision: String(count), path: "test" }));
  }) as typeof fetch;
  try {
    const first = await freshExperimentContext(entry, "paper", "compact", request);
    const expanded = await freshExperimentContext(entry, "paper", "expanded", request);
    assert.equal(entry.experimentContext, "OLD_EVIDENCE", "helper does not overwrite stored entry");
    assert.doesNotMatch(first.context, /OLD_EVIDENCE|EVIDENCE_28/); assert.match(first.context, /EVIDENCE_29/);
    assert.equal(expanded.revision, "2"); assert.ok(expanded.context.length <= 18000); assert.ok(expanded.compact.length <= 6000);
    assert.match(expanded.context, /EVIDENCE_20/); assert.doesNotMatch(first.context, /EVIDENCE_20/);
    await assert.rejects(freshExperimentContext(entry, "paper", "compact", (async () => new Response("failed", { status: 500 })) as typeof fetch), /question is kept/);
  } finally { unregister(); }
  const cancel = registerExperimentDraft("paper", "owner", async () => { throw new Error("conflicting draft"); });
  try {
    await assert.rejects(freshExperimentContext(entry, "paper", "compact", request), /conflicting draft/);
    assert.equal(count, 2, "conflicts prevent sending stale disk context");
    await flushExperimentDraft("different", "owner");
  } finally { cancel(); }
});

test("plot inspection and zoom preserve full original data, log geometry and hidden-series indices", () => {
  const plot = { title: "Error", xLabel: "step", yLabel: "error", yScale: "log" as const, series: [{ name: "first", points: [[0, 100], [1, 10], [2, 1]] }, { name: "control", points: [[0, 1000], [1, 100], [2, 10]] }] };
  const original = JSON.stringify(plot), view = plotWindow(plot, [1], [0, 1]);
  assert.equal(view.series.length, 2); assert.equal(view.series[1].points.length, 0); assert.equal(view.series[0].points.length, 2);
  const coords = plotCoordinates(view)!;
  assert.deepEqual(nearestPlotPoint(plot, [1], [0, 1], coords.x(1), coords.y(10)), { series: 0, point: 1 });
  assert.equal(nearestPlotPoint(plot, [0, 1], undefined, 100, 100), undefined);
  assert.equal(nearestPlotPoint(plot, [], undefined, 0, 0), undefined);
  assert.equal(JSON.stringify(plot), original);
  const huge = plotCoordinates({ ...plot, yScale: "linear", series: [{ name: "finite but wide", points: [[-1e308, -1e308], [0, 0], [1e308, 1e308]] }] })!;
  assert.equal(huge.x(0), 290); assert.equal(huge.y(0), 137.5);
  assert.ok(Number.isFinite(huge.x(1e308)) && Number.isFinite(huge.y(-1e308)));
  const args = ["--workspace", process.cwd(), "--project", "p", "--entry", "e"];
  assert.equal(researchOptions(["run", ...args, "--cell", "c", "--revision", "r", "--allow-python", "--session"]).flags.session, "true");
  assert.throws(() => researchOptions(["put", ...args, "--cell", "c", "--revision", "r", "--file", "x", "--session"]), /only to run/);
});
