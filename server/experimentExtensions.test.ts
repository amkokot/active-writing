import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerProject } from "./projects.ts";
import { experimentRuntime, readExperimentJob, readExperiments, runExperiment, writeExperiments } from "./experiments.ts";
import { closePythonSessions, pythonSessionStatus, runInPythonSession } from "./pythonSessions.ts";
import { experimentRunBudget, experimentDuration, checkExperimentBudgetRuntime } from "../src/experimentLimits.ts";
import { experimentEvidence } from "../src/experimentEvidence.ts";
import { experimentSweep, sweepDomain, sweepMime, sweepSummary } from "../src/experimentSweep.ts";
import { experimentContext, newExperimentNotebook, newExperimentCell, plotCoordinates, validateExperimentNotebook } from "../src/experiments.ts";
import { nearestPlotPoint, plotViewCoordinates } from "../src/plotInspection.ts";
import { researchOptions } from "../scripts/awResearch.ts";
import { freshExperimentStore } from "../src/freshExperimentContext.ts";
import { registerExperimentDraft } from "../src/experimentDrafts.ts";

test("plots inherit readable themed text and parameter controls announce actual values, not frame indices", async () => {
  const css = await readFile("src/styles.css", "utf8"), view = await readFile("src/components/ExperimentSweepView.tsx", "utf8"), plot = await readFile("src/components/ExperimentPlotView.tsx", "utf8");
  assert.match(css, /\.experiment-plot svg text\s*\{\s*fill:\s*currentColor/);
  assert.match(plot, /light-dark\(#167d8d, #79c5d0\)/);
  assert.match(view, /aria-valuetext=\{`\$\{sweep.parameter\} = \$\{frame.value\}/);
  assert.match(view, /key=\{index\}/, "changing frames resets old point and zoom state");
});

test("longer budgets are explicit, allowlisted, backward compatible and CLI run-only", () => {
  assert.equal(experimentRunBudget(), 30_000);
  for (const n of [30_000, 120_000, 300_000]) assert.equal(experimentRunBudget(n), n);
  for (const n of [null, 0, -1, 300001, Infinity, NaN, "120000", 60000]) assert.throws(() => experimentRunBudget(n));
  checkExperimentBudgetRuntime(undefined, 30_000);
  assert.throws(() => checkExperimentBudgetRuntime(undefined, 120_000), /No run started/);
  assert.throws(() => checkExperimentBudgetRuntime({ runBudgetsMs: [30_000, 120_000] }, 300_000), /restarting/);
  checkExperimentBudgetRuntime({ runBudgetsMs: [30_000, 120_000, 300_000] }, 300_000);
  const args = ["--workspace", process.cwd(), "--project", "p", "--entry", "e"];
  const run = ["run", ...args, "--cell", "c", "--revision", "r", "--allow-python"];
  assert.equal(researchOptions([...run, "--timeout-seconds", "120"]).flags["timeout-seconds"], "120");
  for (const value of ["31", "301", "NaN", "0x78", "1e2", "120.0"]) assert.throws(() => researchOptions([...run, "--timeout-seconds", value]));
  assert.throws(() => researchOptions(["inspect", ...args, "--timeout-seconds", "120"]), /only to run/);
  assert.throws(() => researchOptions([...run.slice(0, -1), "--timeout-seconds", "120"]), /permission/);
  const nb = newExperimentNotebook(), cell = newExperimentCell("code"); nb.cells = [cell];
  cell.metadata.paperfocus!.execution = { mode: "fresh" }; validateExperimentNotebook(nb);
  cell.metadata.paperfocus!.execution.timeoutMs = 120_000; validateExperimentNotebook(nb);
  cell.metadata.paperfocus!.execution.timeoutMs = 600_000; assert.throws(() => validateExperimentNotebook(nb), /run limit/);
  assert.equal(experimentDuration(3), "3 ms"); assert.equal(experimentDuration(1234), "1.23 s");
});

test("fresh and shared runs use the selected timer, save its provenance and discard timed-out state", async context => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/run-budget-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\\begin{document}Test.\\end{document}");
  const project = await registerProject(workspace, "paper"), owner = "budget-check";
  const nb = newExperimentNotebook(); nb.cells = [{ ...newExperimentCell("code"), id: "slow", source: "import time\nx=123\ntime.sleep(2)" }];
  let store = await writeExperiments(workspace, project.id, owner, "", nb);
  const args = [workspace, project.id, owner] as const;
  await assert.rejects(runExperiment(...args, "slow", store.revision, true, "fresh", 900_000), /run limit/);
  await assert.rejects(runExperiment(...args, "slow", store.revision, false, "fresh", 300_000), /permission/);
  const realTimer = globalThis.setTimeout;
  const selectedTimers: number[] = [];
  // Simulate expiration without spending two or five actual minutes.
  context.mock.method(globalThis, "setTimeout", (fn: (...args: any[]) => void, ms: number, ...params: any[]) => {
    if (ms === 120_000 || ms === 300_000) { selectedTimers.push(ms); return realTimer(fn, 80, ...params); }
    return realTimer(fn, ms, ...params);
  });
  const finish = async (id: string) => {
    for (let i = 0; i < 160; i++) {
      const job = await readExperimentJob(...args, id); if (job.status !== "working") return job;
      await new Promise(resolve => realTimer(resolve, 40));
    }
    assert.fail("Fixture did not finish");
  };
  try {
    for (const mode of ["fresh", "session"] as const) {
      const budget = mode === "fresh" ? 120_000 : 300_000;
      const queued = await runExperiment(...args, "slow", store.revision, true, mode, budget);
      assert.ok(queued.startedAt); assert.equal(queued.execution!.timeoutMs, budget);
      const job = await finish(queued.id); assert.equal(job.status, "failed"); assert.match(job.error!, /exceeded.*limit/);
      store = await readExperiments(...args);
      const record = JSON.parse(await readFile(path.join(path.dirname(store.path), "runs", `${job.id}.json`), "utf8"));
      assert.equal(record.execution.timeoutMs, budget); assert.equal(record.status, "failed");
      assert.equal(record.startedAt, queued.startedAt); assert.match(record.source, /x=123/);
      validateExperimentNotebook(store.notebook);
    }
    assert.deepEqual(selectedTimers, [120_000, 300_000]);
    assert.equal((await experimentRuntime()).busy, false);
  } finally { closePythonSessions(); context.mock.restoreAll(); }
});

const fixtureSweep = () => ({ title: "Contraction", parameter: "alpha", initial: 1, frames: [0.1, 0.5, 1.5].map(value => ({ value, plot: { title: "Frame", xLabel: "step", yLabel: "error", yScale: "log" as const, series: [{ name: "error", points: [[0, 100], [1, value]] }] } })) });

test("saved sweep widgets reject invalid frames, excessive complexity and changing axes/series", () => {
  const sweep = fixtureSweep(); assert.equal(experimentSweep(sweep), sweep);
  const reject = (edit: (value: any) => void) => { const copy = structuredClone(sweep); edit(copy); assert.equal(experimentSweep(copy), undefined); };
  reject(s => { s.frames[1].value = s.frames[0].value; });
  reject(s => { s.frames[1].value = Infinity; });
  reject(s => { s.frames[1] = null; }); reject(s => { s.initial = true; });
  reject(s => { s.frames[1].plot.yLabel = "unrelated"; });
  reject(s => { s.frames[1].plot.yScale = "linear"; });
  reject(s => { s.frames[1].plot.series[0].name = "other"; });
  reject(s => { s.frames[1].plot.series[0].points = [[1, -1]]; });
  reject(s => { s.frames[1].plot.series[0].points = []; });
  reject(s => { s.frames = Array.from({ length: 42 }, (_, i) => ({ ...s.frames[0], value: i })); });
  reject(s => { s.frames = Array.from({ length: 21 }, (_, i) => ({ value: i, plot: { ...s.frames[0].plot, series: [{ name: "error", points: Array.from({ length: 2000 }, () => [1, 1]) }] } })); });
  assert.match(sweepSummary(sweep), /alpha=1.5/);
  assert.ok(sweepSummary(sweep).indexOf("alpha=1.5") < sweepSummary(sweep).indexOf("alpha=0.5"), "short excerpts include both extremes before interior frames");
});

test("sweep fixed axes and exact point inspection preserve all saved frames", () => {
  const sweep = fixtureSweep(), before = JSON.stringify(sweep), domain = sweepDomain(sweep);
  const a = plotViewCoordinates(sweep.frames[0].plot, [], undefined, domain)!;
  const b = plotViewCoordinates(sweep.frames[2].plot, [], undefined, domain)!;
  assert.equal(a.ymin, 0.1); assert.equal(a.ymax, 100); assert.equal(a.y(1.5), b.y(1.5));
  assert.deepEqual(nearestPlotPoint(sweep.frames[2].plot, [], undefined, b.x(1), b.y(1.5), domain), { series: 0, point: 1 });
  assert.equal(plotViewCoordinates(sweep.frames[0].plot, [0], undefined, domain), undefined);
  assert.equal(plotCoordinates(domain)!.xmin, 0);
  assert.equal(JSON.stringify(sweep), before);
});

test("Python sweep helper emits numeric and text evidence, rejects bad inputs and never runs on display selection", async () => {
  const runtime = await experimentRuntime(), folder = await mkdtemp(path.resolve(".paperfocus/trials/sweep-python-"));
  try {
    const result = await runInPythonSession("sweep-test", runtime.executable, folder,
      "frames=[{'value':v,'series':[{'name':'error','points':[[0,1],[1,v]]}]} for v in (0.1,0.5,1.5)]\ndisplay_sweep('Contraction','alpha',frames,x_label='step',y_label='error',y_scale='log',initial=1)", "sweep", "run-sweep", () => {}, 120_000);
    assert.equal(result.error, null);
    const output = result.outputs[0]; assert.ok(experimentSweep(output.data![sweepMime]));
    assert.match(String(output.data!["text/plain"]), /alpha=1.5.*last=/);
    assert.equal(pythonSessionStatus("sweep-test").runs, 1);
    const nb = newExperimentNotebook(), cell = newExperimentCell("code"); cell.outputs = result.outputs; nb.cells = [cell];
    validateExperimentNotebook(nb); assert.match(experimentContext(nb, "sweep-owner"), /3 saved frames/);
    const bad = await runInPythonSession("sweep-test", runtime.executable, folder,
      "frames[1]['value']=frames[0]['value']\ndisplay_sweep('bad','alpha',frames)", "bad", "run-bad", () => {});
    assert.match(bad.error!, /strictly increasing/); assert.equal(pythonSessionStatus("sweep-test").active, false);
  } finally { closePythonSessions(); }
});

test("complete evidence excludes filed/trash, preserves hidden/full outputs and marks stale without mutating storage", () => {
  const nb = newExperimentNotebook();
  for (let i = 0; i < 30; i++) nb.cells.push({ ...newExperimentCell("markdown"), id: `note-${i}`, source: `FULL_${i}: ` + "note ".repeat(400) });
  const code = newExperimentCell("code"); code.id = "evidence"; code.source = "new code";
  code.outputs = [{ output_type: "display_data", data: { [sweepMime]: fixtureSweep(), "text/plain": "Saved" } }, { output_type: "error", ename: "ValueError", evalue: "Control" }];
  code.metadata.paperfocus = { lastRunSource: "old code", suppressed: true, runId: "retained-run" };
  nb.cells.push(code); nb.cells[2].metadata.paperfocus!.filed = true; nb.cells[3].metadata.paperfocus!.deleted = true;
  const before = JSON.stringify(nb), store = { notebook: nb, revision: "a".repeat(64), path: "ignored-personal-path" };
  const exportData = experimentEvidence(store, { projectId: "paper", entryId: "conversation", notebookId: "owner" });
  assert.equal(exportData.activeCells, 29); assert.equal(exportData.excludedCells, 2);
  const json = JSON.stringify(exportData.notebook); assert.match(json, /FULL_29/); assert.doesNotMatch(json, /FULL_2:|FULL_3:|ignored-personal-path/);
  const exportedCode = exportData.notebook.cells.at(-1)!;
  assert.deepEqual(exportedCode.outputs, code.outputs); assert.equal(exportedCode.metadata.paperfocus!.suppressed, true);
  assert.match(JSON.stringify(exportedCode.metadata.paperfocus_evidence), /code changed|Failed run/);
  assert.equal(JSON.stringify(nb), before); validateExperimentNotebook(exportData.notebook);
  assert.match(exportData.filename, /^aw-evidence-owner-aaaaaaaaaaaa.ipynb$/);
  assert.throws(() => experimentEvidence({ ...store, revision: "" }, { projectId: "paper", entryId: "e", notebookId: "owner" }), /Save experiments/);
});

test("complete evidence reads the correct fresh owner only after pending drafts flush", async () => {
  const nb = newExperimentNotebook(); nb.cells = [{ ...newExperimentCell("markdown"), id: "late", source: "LATEST_NOTE" }];
  let flushed = false;
  const unregister = registerExperimentDraft("paper", "owner", async () => { flushed = true; });
  try {
    const store = await freshExperimentStore({ id: "entry", experimentNotebookId: "owner" } as any, "paper", (async url => {
      assert.equal(flushed, true); assert.match(String(url), /notebookId=owner/);
      return new Response(JSON.stringify({ notebook: nb, revision: "b".repeat(64), path: "test" }));
    }) as typeof fetch);
    assert.equal(experimentEvidence(store, { projectId: "paper", entryId: "entry", notebookId: "owner" }).notebook.cells[0].source, "LATEST_NOTE");
  } finally { unregister(); }
});
