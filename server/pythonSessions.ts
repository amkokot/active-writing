import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { ExperimentExecution, ExperimentOutput } from "../src/experiments.ts";
import { experimentRunBudget, experimentBudgetLabel } from "../src/experimentLimits.ts";

interface Pending {
  id: string; resolve: (value: Result) => void; reject: (error: Error) => void; timer: NodeJS.Timeout;
}
interface Result { outputs: ExperimentOutput[]; error?: string | null; requestId: string }
interface Session {
  id: string; child: ChildProcessWithoutNullStreams; runs: Array<{ cellId: string; runId: string }>;
  buffer: string; stderr: string; pending?: Pending; idle?: NodeJS.Timeout; packageFolder?: string;
}
const sessions = new Map<string, Session>();
const idleMs = 15 * 60_000;
const maxRuns = 100;
const maxSessions = 3;
export function pythonEnvironment(packageFolder?: string) {
  const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8", MPLBACKEND: "Agg", OMP_NUM_THREADS: "1", OPENBLAS_NUM_THREADS: "1", MKL_NUM_THREADS: "1" };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"]) if (process.env[key]) env[key] = process.env[key];
  if (packageFolder) env.AW_PYTHON_PACKAGES = packageFolder;
  return env;
}
function discard(key: string, session: Session, error: string) {
  if (sessions.get(key) === session) sessions.delete(key);
  clearTimeout(session.idle);
  if (session.pending) { clearTimeout(session.pending.timer); session.pending.reject(new Error(error)); session.pending = undefined; }
  session.child.kill();
}
export function pythonSessionStatus(key: string) {
  const session = sessions.get(key);
  return { active: Boolean(session), sessionId: session?.id, runs: session?.runs.length ?? 0, busy: Boolean(session?.pending), idleMs, maxRuns };
}
export function resetPythonSession(key: string) {
  const session = sessions.get(key);
  if (session?.pending) throw new Error("Stop the running cell before restarting its session.");
  if (session) discard(key, session, "Python session restarted.");
  return pythonSessionStatus(key);
}
export function closePythonSessions() { for (const [key, session] of sessions) discard(key, session, "Python server stopped."); }
process.once("exit", closePythonSessions);

function createSession(key: string, executable: string, folder: string, packageFolder?: string) {
  if (sessions.size >= maxSessions) throw new Error("Three Python sessions are already open. Restart an unused session first.");
  const child = spawn(executable, ["-I", path.resolve(import.meta.dirname, "experiment_runner.py"), "--session"], { cwd: folder, env: pythonEnvironment(packageFolder), windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const session: Session = { id: randomUUID(), child, runs: [], buffer: "", stderr: "", packageFolder };
  sessions.set(key, session);
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { session.stderr = (session.stderr + chunk).slice(-60_000); });
  child.stdout.on("data", (chunk: string) => {
    session.buffer += chunk;
    if (session.buffer.length > 2_100_000) { discard(key, session, "Output limit exceeded; shared session cleared."); return; }
    const end = session.buffer.indexOf("\n");
    if (end < 0) return;
    try {
      const result = JSON.parse(session.buffer.slice(0, end)) as Result;
      const pending = session.pending;
      if (!pending || result.requestId !== pending.id || session.buffer.slice(end + 1).trim()) throw new Error("Unexpected Python output; shared session cleared.");
      clearTimeout(pending.timer); session.pending = undefined; session.buffer = "";
      if (result.error !== null && result.error !== undefined) discard(key, session, "Failed cell; shared session cleared.");
      else { session.idle = setTimeout(() => discard(key, session, "Idle Python session cleared."), idleMs); session.idle.unref(); }
      pending.resolve(result);
    } catch (error) { discard(key, session, (error as Error).message); }
  });
  child.once("error", error => discard(key, session, error.message));
  child.once("close", code => discard(key, session, session.stderr || `Python session ended (${code}); rerun setup cells explicitly.`));
  child.stdin.on("error", error => discard(key, session, error.message));
  return session;
}
export async function runInPythonSession(key: string, executable: string, folder: string, source: string, cellId: string, runId: string, attach: (child: ChildProcessWithoutNullStreams, execution: ExperimentExecution) => void, requestedBudget?: number, packageFolder?: string) {
  const timeoutMs = experimentRunBudget(requestedBudget);
  const session = sessions.get(key) ?? createSession(key, executable, folder, packageFolder);
  if (session.packageFolder !== packageFolder) throw new Error("Python package folder changed; restart the shared session explicitly.");
  if (session.pending) throw new Error("This notebook's Python session is already running.");
  if (session.runs.length >= maxRuns) throw new Error("Restart the Python session after 100 runs, then explicitly rerun setup cells.");
  clearTimeout(session.idle);
  const execution: ExperimentExecution = { mode: "session", timeoutMs, sessionId: session.id, sequence: session.runs.length + 1, priorRuns: [...session.runs] };
  attach(session.child, execution);
  const result = await new Promise<Result>((resolve, reject) => {
    const id = randomUUID();
    session.pending = { id, resolve, reject, timer: setTimeout(() => discard(key, session, `Cell exceeded its ${experimentBudgetLabel(timeoutMs)} limit; shared session cleared.`), timeoutMs) };
    session.child.stdin.write(JSON.stringify({ source, requestId: id }) + "\n");
  });
  if (sessions.get(key) === session) session.runs.push({ cellId, runId });
  return result;
}
export function invalidatePythonSession(key: string) {
  const session = sessions.get(key);
  if (session) discard(key, session, "Shared session cleared after a failed run.");
}
