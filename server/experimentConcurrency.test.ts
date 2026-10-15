import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerProject } from "./projects.ts";
import { newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import { experimentConcurrencyLimit } from "../src/experimentLimits.ts";
import { closePythonSessions } from "./pythonSessions.ts";

// Each test file has its own service module/process; never reconfigure live Aw.
process.env.AW_PYTHON_CONCURRENCY = "2";
const { cancelExperimentJob, experimentRuntime, readExperimentJob, readExperiments, readExperimentSession, restartExperimentSession, runExperiment, writeExperiments } = await import("./experiments.ts");

test("local concurrency is bounded, explicit and independent of CPU count", () => {
  assert.equal(experimentConcurrencyLimit(undefined), 2);
  for (const value of ["1", "2", "3", "4"]) assert.equal(experimentConcurrencyLimit(value), Number(value));
  for (const value of ["", "0", "5", "2.5", "Infinity", " 2", "auto"]) assert.throws(() => experimentConcurrencyLimit(value), /1 to 4/);
});

test("independent notebooks overlap, owners stay sequential, and rejected/cancelled/failed runs release only their slot", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/concurrency-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}Concurrency trial.\\end{document}");
  const project = await registerProject(workspace, "paper");
  const notebook = () => {
    const nb = newExperimentNotebook();
    nb.cells = [{ ...newExperimentCell("code"), id: "slow", source: "import time\nvalue=41\ntime.sleep(20)\nprint(value)" },
      { ...newExperimentCell("code"), id: "check", source: "print('value' in globals())" },
      { ...newExperimentCell("code"), id: "bad", source: "raise ValueError('concurrency negative control')" }];
    return nb;
  };
  const owners = ["alpha", "beta", "gamma"];
  const args = (owner: string) => [workspace, project.id, owner] as const;
  const saved = await Promise.all(owners.map(owner => writeExperiments(...args(owner), "", notebook())));
  const started: Array<{ owner: string; id: string }> = [];
  const until = async (condition: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) {
      if (await condition()) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    assert.fail("Concurrent trial did not settle within 8 seconds");
  };
  const start = async (owner: string, cell: string, revision: string, mode: "fresh" | "session" = "fresh") => {
    const job = await runExperiment(...args(owner), cell, revision, true, mode);
    started.push({ owner, id: job.id }); return job;
  };
  const settled = async (owner: string, id: string) => {
    await until(async () => !(await experimentRuntime()).activeJobs.some(job => job.id === id));
    return readExperimentJob(...args(owner), id);
  };
  try {
    // The reservations, not just spawned children, enforce capacity under races.
    const simultaneous = await Promise.allSettled(owners.map((owner, i) => start(owner, "slow", saved[i].revision, i === 1 ? "session" : "fresh")));
    assert.equal(simultaneous.filter(result => result.status === "fulfilled").length, 2);
    const rejected = simultaneous.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert.match(rejected.reason.message, /capacity is full \(2\/2\)/);
    assert.match(rejected.reason.message, /started .*30 seconds limit/);
    assert.match(rejected.reason.message, /no run was queued/);
    const active = await experimentRuntime();
    assert.equal(active.busy, true); assert.equal(active.availableRuns, 0);
    assert.equal(active.maxConcurrentRunsPerNotebook, 1);
    assert.equal(active.activeJobs.length, 2);
    assert.ok(active.activeJobs.every(job => job.projectId === project.id && owners.includes(job.notebookId) && job.id && job.startedAt));
    assert.ok(active.activeJobs.every(job => !("workspace" in job) && !("source" in job)));
    const a = started[0], b = started[1], spare = owners.find(owner => !started.some(job => job.owner === owner))!;
    const shared = started.find(job => job.owner === "beta");
    if (shared) await until(async () => (await readExperimentSession(...args(shared.owner))).busy);
    await assert.rejects(runExperiment(...args(a.owner), "check", saved[owners.indexOf(a.owner)].revision, true, "session"), /this notebook.*run/);
    await assert.rejects(restartExperimentSession(...args(b.owner)), /Stop the running cell/);
    // An unrelated idle notebook can still restart its own session.
    await restartExperimentSession(...args(spare));
    await assert.rejects(cancelExperimentJob(...args(spare), a.id), /another notebook/);
    await cancelExperimentJob(...args(a.owner), a.id);
    assert.equal((await settled(a.owner, a.id)).status, "cancelled");
    assert.equal((await readExperimentJob(...args(b.owner), b.id)).status, "working");
    assert.equal((await experimentRuntime()).availableRuns, 1);
    // A validation failure releases its reservation without clearing the other run.
    await assert.rejects(runExperiment(...args(spare), "check", "stale", true), /Save the cell/);
    await assert.rejects(runExperiment(...args(spare), "missing", saved[owners.indexOf(spare)].revision, true), /active code cell/);
    assert.equal((await experimentRuntime()).availableRuns, 1);
    const failure = await start(spare, "bad", saved[owners.indexOf(spare)].revision);
    assert.equal((await settled(spare, failure.id)).status, "failed");
    assert.equal((await readExperimentJob(...args(b.owner), b.id)).status, "working");
    const freshStore = await readExperiments(...args(a.owner));
    const independent = await start(a.owner, "check", freshStore.revision);
    assert.equal((await settled(a.owner, independent.id)).status, "ready");
    assert.match(String((await readExperiments(...args(a.owner))).notebook.cells[1].outputs![0].text), /False/);
    assert.equal((await readExperimentJob(...args(b.owner), b.id)).status, "working");
    // Concurrent collection preserves each notebook's source and unrelated metadata.
    const edited = await readExperiments(...args(b.owner));
    edited.notebook.cells[0].source = "print('author edit while running')";
    edited.notebook.cells[0].metadata.custom = "retain this";
    await writeExperiments(...args(b.owner), edited.revision, edited.notebook);
    await cancelExperimentJob(...args(b.owner), b.id);
    assert.equal((await settled(b.owner, b.id)).status, "cancelled");
    const after = await readExperiments(...args(b.owner));
    assert.equal(after.notebook.cells[0].metadata.custom, "retain this");
    assert.equal(after.notebook.cells[0].source, "print('author edit while running')");
    assert.equal(after.notebook.cells[0].metadata.paperfocus?.runId, b.id);
    assert.equal((await readExperimentSession(...args(b.owner))).active, false);
    assert.equal((await experimentRuntime()).availableRuns, 2);
    assert.equal((await experimentRuntime()).busy, false);
    // Also finish two genuinely independent fresh children and retain both outputs.
    const shortStores = await Promise.all([a.owner, b.owner].map(async owner => {
      const current = await readExperiments(...args(owner));
      current.notebook.cells[1].source = "import os, time\ntime.sleep(0.2)\nprint(os.getpid())";
      return writeExperiments(...args(owner), current.revision, current.notebook);
    }));
    const children = await Promise.all([a.owner, b.owner].map((owner, i) => start(owner, "check", shortStores[i].revision)));
    const completed = await Promise.all(children.map((job, i) => settled([a.owner, b.owner][i], job.id)));
    assert.ok(completed.every(job => job.status === "ready"));
    const pids = await Promise.all([a.owner, b.owner].map(async owner => Number(String((await readExperiments(...args(owner))).notebook.cells[1].outputs![0].text).trim())));
    assert.ok(pids.every(pid => Number.isInteger(pid) && pid > 0));
    assert.notEqual(pids[0], pids[1]);
  } finally {
    for (const run of started) await cancelExperimentJob(...args(run.owner), run.id);
    await until(async () => (await experimentRuntime()).activeJobs.length === 0);
    closePythonSessions();
  }
});
