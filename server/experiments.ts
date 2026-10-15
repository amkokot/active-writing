import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { projectStorage } from "./projectStorage.ts";
import { replaceFile } from "./atomicFile.ts";
import { acquireRecordLock, withRecordLock, RecordLocked } from "./recordLock.ts";
import { pythonPackageFolder } from "./pythonPackages.ts";
import { cellText, newExperimentNotebook, validateExperimentNotebook } from "../src/experiments.ts";
import type { ExperimentJob, ExperimentNotebook, ExperimentOutput, ExperimentStore } from "../src/experiments.ts";
import { pythonEnvironment, pythonSessionStatus, resetPythonSession, runInPythonSession, invalidatePythonSession } from "./pythonSessions.ts";
import { experimentRunBudget, experimentRunBudgets, experimentBudgetLabel, experimentConcurrencyLimit } from "../src/experimentLimits.ts";
import { captureExperimentInputs, checkExperimentInputs } from "./experimentInputs.ts";

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function noLink(target: string) {
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error("Experiment storage cannot use symbolic links/junctions."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function storage(workspace: string, projectId: string, notebookId: string) {
  if (!idPattern.test(notebookId)) throw new Error("Invalid research entry ID.");
  const { folder: data } = await projectStorage(workspace, projectId);
  const parents = [data, path.join(data, "experiments")];
  const folder = path.join(parents[1], notebookId), target = path.join(folder, "notebook.ipynb");
  for (const item of [...parents, folder, target, path.join(folder, "notebook.previous.ipynb"), path.join(folder, "runs")]) await noLink(item);
  return { folder, target };
}
export class ExperimentConflict extends Error {}
export const experimentEtag = (revision: string) => `"${revision || "missing"}"`;
/** Every poll checks the exact file bytes and path protections. Only an exact
 * revision match skips JSON validation/transfer; timestamps are not trusted. */
export async function readExperimentsIfChanged(workspace: string, projectId: string, notebookId: string, ifNoneMatch?: string): Promise<ExperimentStore | undefined> {
  const { target } = await storage(workspace, projectId, notebookId);
  try {
    if ((await lstat(target)).size > 5_000_000) throw new Error("Notebook exceeds 5 MB; preserved on disk.");
    const text = await readFile(target, "utf8"), revision = hash(text);
    if (ifNoneMatch === experimentEtag(revision)) return undefined;
    const notebook = JSON.parse(text);
    validateExperimentNotebook(notebook);
    return { notebook, revision, path: target };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return ifNoneMatch === experimentEtag("") ? undefined : { notebook: newExperimentNotebook(), revision: "", path: target };
    throw error;
  }
}
export async function readExperiments(workspace: string, projectId: string, notebookId: string): Promise<ExperimentStore> {
  return (await readExperimentsIfChanged(workspace, projectId, notebookId))!;
}
const writes = new Map<string, Promise<void>>();
function serialize<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).then(action), tail = result.then(() => undefined, () => undefined);
  writes.set(key, tail); void tail.then(() => { if (writes.get(key) === tail) writes.delete(key); }); return result;
}
const keyFor = (workspace: string, projectId: string, notebookId: string) => `${path.resolve(workspace)}:${projectId}:${notebookId}`;
async function writeNow(workspace: string, projectId: string, notebookId: string, revision: string, notebook: unknown): Promise<ExperimentStore> {
  validateExperimentNotebook(notebook);
  const { folder, target } = await storage(workspace, projectId, notebookId);
  await mkdir(folder, { recursive: true });
  return withRecordLock(target, async () => {
  const previous = await readExperiments(workspace, projectId, notebookId);
  if (previous.revision !== revision) throw new ExperimentConflict("Experiments changed in another editor. Reload before saving.");
  await mkdir(folder, { recursive: true });
  if (previous.revision) await writeFile(path.join(folder, "notebook.previous.ipynb"), JSON.stringify(previous.notebook, null, 2), "utf8");
  const text = JSON.stringify(notebook, null, 2), temp = path.join(folder, `notebook-${randomUUID()}.tmp`);
  await writeFile(temp, text, { encoding: "utf8", flag: "wx" });
  // Recheck external edits immediately before replacement. Agents should also use atomic writes.
  if ((await readExperiments(workspace, projectId, notebookId)).revision !== revision) throw new ExperimentConflict("An external editor changed the experiment file during saving; draft preserved.");
  await replaceFile(temp, target); return { notebook: structuredClone(notebook), revision: hash(text), path: target };
  });
}
export function writeExperiments(workspace: string, projectId: string, notebookId: string, revision: string, notebook: unknown) {
  return serialize(keyFor(workspace, projectId, notebookId), () => writeNow(workspace, projectId, notebookId, revision, notebook));
}
interface Job extends ExperimentJob { workspace: string; projectId: string; notebookId: string; child?: ChildProcess; completion?: Promise<void>; releaseRun?: () => Promise<void>; notebookUpdated?: boolean; runPath?: string }
const jobs = new Map<string, Job>();
// Reservations include validation and result collection, not just live children.
// Reserve synchronously, before disk awaits; release only the owning run's slot.
const activeJobs = new Map<string, Job>();
const maxConcurrentRuns = experimentConcurrencyLimit(process.env.AW_PYTHON_CONCURRENCY);
const activeFor = (workspace: string, projectId: string, notebookId: string) => [...activeJobs.values()].find(job => keyFor(job.workspace, job.projectId, job.notebookId) === keyFor(workspace, projectId, notebookId));
const jobLocation = (job: Job) => `run ${job.id}, project ${job.projectId}, notebook ${job.notebookId}, cell ${job.cellId}, started ${job.startedAt} (${experimentBudgetLabel(job.execution?.timeoutMs ?? 30_000)} limit)`;
export async function experimentRuntime() {
  const bundled = path.join(process.env.USERPROFILE ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe");
  let executable = process.env.PAPERFOCUS_PYTHON;
  if (!executable) { try { await lstat(bundled); executable = bundled; } catch { executable = "python"; } }
  return { executable, mode: "fresh-process", supportedModes: ["fresh", "session"], timeoutMs: 30_000, runBudgetsMs: experimentRunBudgets,
    busy: activeJobs.size > 0, maxConcurrentRuns, maxConcurrentRunsPerNotebook: 1, availableRuns: maxConcurrentRuns - activeJobs.size,
    activeJobs: [...activeJobs.values()].map(job => ({ ...publicJob(job), projectId: job.projectId, notebookId: job.notebookId })) };
}
function publicJob(job: Job): ExperimentJob { const { id, cellId, status, error, durationMs, execution, startedAt } = job; return { id, cellId, status, error, durationMs, execution, startedAt }; }
export async function readExperimentSession(workspace: string, projectId: string, notebookId: string) {
  await storage(workspace, projectId, notebookId);
  return pythonSessionStatus(keyFor(workspace, projectId, notebookId));
}
export async function restartExperimentSession(workspace: string, projectId: string, notebookId: string) {
  await storage(workspace, projectId, notebookId);
  if (activeFor(workspace, projectId, notebookId)) throw new Error("Stop the running cell before restarting its session.");
  return resetPythonSession(keyFor(workspace, projectId, notebookId));
}
export async function readExperimentJob(workspace: string, projectId: string, notebookId: string, id: string) {
  const job = jobs.get(id);
  if (job) {
    if (job.workspace !== path.resolve(workspace) || job.projectId !== projectId || job.notebookId !== notebookId) throw new Error("Experiment run belongs to another notebook.");
    return publicJob(job);
  }
  if (!idPattern.test(id)) throw new Error("Invalid run ID.");
  const { folder } = await storage(workspace, projectId, notebookId), target = path.join(folder, "runs", `${id}.json`);
  await noLink(target);
  try {
    if ((await lstat(target)).size > 2_500_000) throw new Error("Saved run record too large.");
    const record = JSON.parse(await readFile(target, "utf8"));
    if (record.id !== id || typeof record.cellId !== "string") throw new Error("Invalid run record.");
    // Execution evidence is immutable. Collection has its own immutable receipt,
    // so a later CLI also sees a notebook-save failure, not an invented success.
    let collected: { status: ExperimentJob["status"]; error?: string; notebookUpdated?: boolean } | undefined;
    const receipt = path.join(folder, "runs", `${id}.collection.json`);
    await noLink(receipt);
    try {
      if ((await lstat(receipt)).size > 16_000) throw new Error("Run collection receipt too large.");
      const value = JSON.parse(await readFile(receipt, "utf8"));
      if (value.id !== id || !["ready", "failed", "cancelled"].includes(value.status) || value.error !== undefined && typeof value.error !== "string" || typeof value.notebookUpdated !== "boolean") throw new Error("Invalid run collection receipt.");
      collected = value;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return { id, cellId: record.cellId, status: collected?.status ?? (record.status === "cancelled" ? "cancelled" : record.error ? "failed" : "ready"), error: collected?.error ?? record.error, durationMs: record.durationMs, execution: record.execution, startedAt: record.startedAt } as ExperimentJob;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Experiment run not found (a server restart does not rerun it). Saved notebook outputs remain; check the run records before starting again.");
    throw error;
  }
}
export async function cancelExperimentJob(workspace: string, projectId: string, notebookId: string, id: string) {
  const result = await readExperimentJob(workspace, projectId, notebookId, id);
  const job = jobs.get(id); if (!job) return result;
  if (job.status === "working") { job.status = "cancelled"; job.error = "Stopped by the user."; job.child?.kill(); }
  return publicJob(job);
}
async function reserveRun(workspace: string, folder: string) {
  const pool = path.join(path.resolve(workspace), ".paperfocus", "python-runs");
  await noLink(pool); await mkdir(pool, { recursive: true });
  const ownerRelease = await acquireRecordLock(path.join(folder, "python-run"), 0);
  try {
    for (let slot = 0; slot < maxConcurrentRuns; slot++) {
      try {
        const poolRelease = await acquireRecordLock(path.join(pool, `slot-${slot}`), 0);
        return async () => { try { await poolRelease(); } finally { await ownerRelease(); } };
      } catch (error) { if (!(error instanceof RecordLocked)) throw error; }
    }
    throw new Error(`Python execution capacity is full (${maxConcurrentRuns} local-host slots). No run was queued. Inspect locks after a crash; never steal them automatically.`);
  } catch (error) { await ownerRelease(); throw error; }
}
export async function runExperiment(workspace: string, projectId: string, notebookId: string, cellId: string, revision: string, acknowledged: boolean, executionMode: "fresh" | "session" = "fresh", requestedBudget?: number, transport: "service" | "offline" = "service") {
  if (acknowledged !== true) throw new Error("Explicit permission to run trusted local Python is required.");
  if (!["fresh", "session"].includes(executionMode)) throw new Error("Choose fresh or shared-session Python execution.");
  if (transport === "offline" && executionMode !== "fresh") throw new Error("Offline Python uses a fresh process. Shared sessions require the app service; nothing started.");
  const timeoutMs = experimentRunBudget(requestedBudget);
  const ownerRun = activeFor(workspace, projectId, notebookId);
  if (ownerRun) throw new Error(`Another Python cell is running or saving results in this notebook: ${jobLocation(ownerRun)}. Wait for its saved result; no run was queued.`);
  if (activeJobs.size >= maxConcurrentRuns) throw new Error(`Python execution capacity is full (${activeJobs.size}/${maxConcurrentRuns}). Active: ${[...activeJobs.values()].map(jobLocation).join("; ")}. Wait for a result; no run was queued.`);
  // Same-notebook runs are always sequential, including fresh/session mixtures.
  const job: Job = { id: randomUUID(), cellId, status: "working", startedAt: new Date().toISOString(), workspace: path.resolve(workspace), projectId, notebookId, execution: { mode: executionMode, timeoutMs, transport } };
  activeJobs.set(job.id, job);
  try {
    const store = await readExperiments(workspace, projectId, notebookId);
    if (store.revision !== revision) throw new ExperimentConflict("Save the cell and check outside edits before running it.");
    const cell = store.notebook.cells.find((candidate) => candidate.id === cellId);
    if (!cell || cell.cell_type !== "code" || cell.metadata.paperfocus?.deleted || cell.metadata.paperfocus?.filed) throw new Error("Choose an active code cell.");
    if (cell.metadata.paperfocus?.inputs?.length) {
      const roots = await projectStorage(workspace, projectId);
      job.execution!.inputs = await captureExperimentInputs({ paper: roots.paperRoot, data: roots.folder }, cell.metadata.paperfocus.inputs);
      // Hashing inputs must not authorize running a newer, concurrently edited cell.
      if ((await readExperiments(workspace, projectId, notebookId)).revision !== revision) throw new ExperimentConflict("Notebook changed while capturing inputs; no run started.");
    }
    const { folder } = await storage(workspace, projectId, notebookId); await mkdir(folder, { recursive: true });
    job.releaseRun = await reserveRun(workspace, folder);
    // A competing process may have saved while this command acquired its lease.
    if ((await readExperiments(workspace, projectId, notebookId)).revision !== revision) throw new ExperimentConflict("Notebook changed before execution; no run started.");
    jobs.set(job.id, job); job.completion = execute(job, cellText(cell), folder);
    return publicJob(job);
  } catch (error) { activeJobs.delete(job.id); await job.releaseRun?.(); throw error; }
}
/** Same execution/collection pipeline, awaited by a CLI process; no HTTP/listener. */
export async function runExperimentOffline(workspace: string, projectId: string, notebookId: string, cellId: string, revision: string, acknowledged: boolean, requestedBudget?: number) {
  const started = await runExperiment(workspace, projectId, notebookId, cellId, revision, acknowledged, "fresh", requestedBudget, "offline");
  const job = jobs.get(started.id)!;
  await job.completion;
  const current = await readExperiments(workspace, projectId, notebookId);
  return { ...publicJob(job), revision: current.revision, notebookUpdated: Boolean(job.notebookUpdated), runPath: job.runPath,
    note: "Run completed locally without a server. Read cell/output for complete evidence; saved outputs are not a proof." };
}
async function execute(job: Job, source: string, folder: string) {
  const start = Date.now();
  let outputs: ExperimentOutput[] = [];
  try {
    const runtime = await experimentRuntime();
    const packageFolder = await pythonPackageFolder(job.workspace);
    if (job.status === "cancelled") throw new Error("Stopped by the user.");
    const sessionKey = keyFor(job.workspace, job.projectId, job.notebookId);
    const timeoutMs = experimentRunBudget(job.execution?.timeoutMs);
    const result = job.execution?.mode === "session" ? await runInPythonSession(sessionKey, runtime.executable, folder, source, job.cellId, job.id, (child, execution) => { job.child = child; job.execution = { ...execution, transport: job.execution?.transport, inputs: job.execution?.inputs }; }, timeoutMs, packageFolder) : await new Promise<string>((resolve, reject) => {
      const child = spawn(runtime.executable, ["-I", path.resolve(import.meta.dirname, "experiment_runner.py")], { cwd: folder, env: pythonEnvironment(packageFolder), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      job.child = child; let stdout = "", stderr = "";
      const timeout = setTimeout(() => { job.error = `Cell exceeded its ${experimentBudgetLabel(timeoutMs)} limit.`; child.kill(); }, timeoutMs);
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; if (stdout.length > 2_100_000) { job.error = "Output limit exceeded."; child.kill(); } });
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-60_000); });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => { clearTimeout(timeout); if (job.error || code !== 0) reject(new Error(job.error || stderr || `Python exited with ${code}`)); else resolve(stdout); });
      child.stdin.on("error", () => { /* process failure handled above */ }); child.stdin.end(JSON.stringify({ source }));
    });
    const resultData = (typeof result === "string" ? JSON.parse(result) : result) as { outputs: ExperimentOutput[]; error?: string; runtime?: NonNullable<ExperimentJob["execution"]>["runtime"] };
    job.execution!.runtime = resultData.runtime;
    outputs = resultData.outputs;
    const check: ExperimentNotebook = { ...newExperimentNotebook(), cells: [{ id: "output-check", cell_type: "code", source, metadata: {}, execution_count: 1, outputs }] };
    try { validateExperimentNotebook(check); } catch (error) { outputs = []; throw error; }
    if (resultData.error !== null && resultData.error !== undefined) throw new Error(resultData.error || "Python raised an exception.");
  } catch (error) {
    if (job.execution?.mode === "session") invalidatePythonSession(keyFor(job.workspace, job.projectId, job.notebookId));
    job.error = (error as Error).message;
    if (!outputs.some((output) => output.output_type === "error")) outputs.push({ output_type: "error", ename: "ExecutionError", evalue: job.error, traceback: [] });
  }
  job.durationMs = Date.now() - start;
  try {
    if (job.execution?.inputs?.length) {
      const roots = await projectStorage(job.workspace, job.projectId);
      const check = await checkExperimentInputs({ paper: roots.paperRoot, data: roots.folder }, job.execution.inputs);
      job.execution.inputsChanged = check.changed.map(input => `${input.root}:${input.path}`);
    }
    const { folder: safeFolder } = await storage(job.workspace, job.projectId, job.notebookId);
    await mkdir(path.join(safeFolder, "runs"), { recursive: true });
    await writeFile(path.join(safeFolder, "runs", `${job.id}.json`), JSON.stringify({ id: job.id, cellId: job.cellId, source, outputs, execution: job.execution, error: job.error, status: job.status === "cancelled" ? "cancelled" : job.error ? "failed" : "ready", durationMs: job.durationMs, startedAt: job.startedAt, finishedAt: new Date().toISOString() }, null, 2), { encoding: "utf8", flag: "wx" });
    job.runPath = path.join(safeFolder, "runs", `${job.id}.json`);
    await serialize(keyFor(job.workspace, job.projectId, job.notebookId), async () => {
      const current = await readExperiments(job.workspace, job.projectId, job.notebookId);
      const cell = current.notebook.cells.find((candidate) => candidate.id === job.cellId);
      // Preserve edits/catalogue flags made while running. A removed cell is never recreated.
      if (cell?.cell_type === "code") {
        cell.outputs = outputs; cell.execution_count = (cell.execution_count ?? 0) + 1;
        if(cell.metadata.paperfocus?.imagesCleared)cell.metadata.paperfocus.imagesCleared=false;
        cell.metadata.paperfocus = { ...cell.metadata.paperfocus, lastRunSource: source, lastRunAt: new Date().toISOString(), durationMs: job.durationMs, runId: job.id, execution: job.execution?.sessionId || job.execution?.mode === "fresh" ? job.execution : undefined };
        await writeNow(job.workspace, job.projectId, job.notebookId, current.revision, current.notebook);
        job.notebookUpdated = true;
      }
    });
  } catch (error) { if (job.execution?.mode === "session") invalidatePythonSession(keyFor(job.workspace, job.projectId, job.notebookId)); job.error = `${job.error ? `${job.error}\n` : ""}Result retained in runs when possible; notebook save failed: ${(error as Error).message}`; }
  if (job.runPath) {
    try {
      const { folder: safeFolder } = await storage(job.workspace, job.projectId, job.notebookId);
      await writeFile(path.join(safeFolder, "runs", `${job.id}.collection.json`), JSON.stringify({ id: job.id, status: job.status === "cancelled" ? "cancelled" : job.error ? "failed" : "ready", error: job.error, notebookUpdated: Boolean(job.notebookUpdated), finishedAt: new Date().toISOString() }, null, 2), { encoding: "utf8", flag: "wx" });
    } catch (error) { job.error = `${job.error ?? ""}\nCollection receipt could not be saved: ${(error as Error).message}`; }
  }
  try { await job.releaseRun?.(); } catch (error) { job.error = `${job.error ?? ""}\nRun lock release failed: ${(error as Error).message}`; }
  job.status = job.status === "cancelled" ? "cancelled" : job.error ? "failed" : "ready";
  job.child = undefined; activeJobs.delete(job.id);
  for (const [id, prior] of [...jobs].slice(0, -30)) if (prior.status !== "working") jobs.delete(id);
}
