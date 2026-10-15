import { spawn } from "node:child_process";
import { readNotebook } from "./notebookStore.ts";
import { readExperiments, experimentRuntime, readExperimentSession } from "./experiments.ts";
import { readWorkbench } from "./workbenchStore.ts";
import { parseProject } from "./projects.ts";
import { workspaceFolders } from "./workspaceFolders.ts";
import { pythonEnvironment } from "./pythonSessions.ts";
import { pythonPackageFolder } from "./pythonPackages.ts";
import { experimentStaleness } from "../src/experiments.ts";
import type { ResearchReadiness } from "../src/researchReadiness.ts";

// Only our fixed standard-library diagnostic. Never import or execute cell source.
const probeSource = `import json, platform, os, sys
if os.environ.get('AW_PYTHON_PACKAGES'): sys.path.insert(0, os.environ['AW_PYTHON_PACKAGES'])
import importlib.metadata as m
packages = {}
for name in ('numpy', 'scipy', 'matplotlib'):
    try: packages[name] = m.version(name)
    except m.PackageNotFoundError: packages[name] = None
print(json.dumps({'version': platform.python_version(), 'packages': packages}))`;
let probeCache: { executable: string; packageFolder?: string; expires: number; result: Promise<ResearchReadiness["python"]> } | undefined;
export function probeResearchPython(executable: string, packageFolder?: string): Promise<ResearchReadiness["python"]> {
  if (probeCache?.executable === executable && probeCache.packageFolder === packageFolder && Date.now() < probeCache.expires) return probeCache.result;
  const result = new Promise<ResearchReadiness["python"]>(resolve => {
    let output = "", settled = false;
    const child = spawn(executable, ["-I", "-c", probeSource], { env: pythonEnvironment(packageFolder), windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const finish = (data: Omit<ResearchReadiness["python"], "checkedAt">) => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve({ ...data, checkedAt: new Date().toISOString() });
    };
    const timer = setTimeout(() => { child.kill(); finish({ available: false, packages: {}, error: "Python setup check timed out; no experiment ran." }); }, 4000);
    child.stdout.on("data", chunk => { output += String(chunk); if (output.length > 16_000) { child.kill(); finish({ available: false, packages: {}, error: "Unexpected Python diagnostic output." }); } });
    child.stderr.resume();
    child.once("error", () => finish({ available: false, packages: {}, error: "Python could not start. Set PAPERFOCUS_PYTHON to an installed interpreter and restart Aw." }));
    child.once("close", code => {
      if (settled) return;
      try {
        const data = JSON.parse(output);
        if (code !== 0 || typeof data.version !== "string" || !data.packages || ["numpy", "scipy", "matplotlib"].some(name => data.packages[name] !== null && typeof data.packages[name] !== "string")) throw new Error("Invalid probe");
        finish({ available: true, version: data.version, packages: data.packages });
      } catch { finish({ available: false, packages: {}, error: "Python did not return a valid setup check. No experiment ran." }); }
    });
  });
  probeCache = { executable, packageFolder, expires: Date.now() + 15_000, result };
  return result;
}

export async function researchReadiness(workspace: string, projectId: string, entryId: string, probe = probeResearchPython): Promise<ResearchReadiness> {
  if (!projectId || !entryId) throw new Error("Choose an explicit paper and conversation for the setup check.");
  const conversation = await readNotebook(workspace, projectId);
  const entry = conversation.entries.find(entry => entry.id === entryId);
  if (!entry) throw new Error("Conversation not found in this paper. No setup check or experiment started.");
  const notebookId = entry.experimentNotebookId ?? entry.id;
  const [store, document, workbench, folders, runtime, session] = await Promise.all([
    readExperiments(workspace, projectId, notebookId), parseProject(workspace, projectId), readWorkbench(workspace, projectId),
    workspaceFolders(workspace, projectId), experimentRuntime(), readExperimentSession(workspace, projectId, notebookId),
  ]);
  const python = await probe(runtime.executable, await pythonPackageFolder(workspace));
  const active = store.notebook.cells.filter(cell => !cell.metadata.paperfocus?.filed && !cell.metadata.paperfocus?.deleted);
  const stale = active.filter(cell => cell.cell_type === "code" && (experimentStaleness(cell, store.notebook) || cell.outputs?.length && (cell.metadata.paperfocus?.lastRunSource === undefined || !cell.metadata.paperfocus?.lastRunAt)));
  const warnings = [
    "This checks saved files only; unfinished browser drafts and backups are not checked. No cell ran and no manuscript or notebook content was edited.",
    "Use several tabs/windows of one Aw service, not independent servers writing the same Aw data folder.",
    ...(runtime.busy ? [`${runtime.activeJobs.length}/${runtime.maxConcurrentRuns} local execution slots are occupied. ${runtime.availableRuns} available; each notebook remains sequential. Do not stop another notebook's run without permission.`] : []),
    ...(session.active ? [`This notebook has a live shared Python session (${session.runs} runs). Reproduce it by explicitly replaying setup after a restart.`] : []),
    ...(stale.length ? [`${stale.length} active code cells have older or unverified outputs. Inspect them before using their findings.`] : []),
    ...(!python.available ? [python.error ?? "Python is unavailable; notes and manuscript editing still work."] : Object.entries(python.packages).filter(([, version]) => version === null).map(([name]) => `${name} is not installed in this interpreter; only experiments needing it are affected.`)),
    "Remote submission is not connected. Heavy work belongs in an explicitly authorized external run; retain its source, inputs and result provenance.",
  ];
  return { checkedAt: new Date().toISOString(), workspace: folders.home.path, projectId, entryId, notebookId,
    paths: { paper: folders.paper!.path, data: folders.data!.path, notebook: store.path },
    revisions: { source: document.revision, conversation: conversation.revision, notebook: store.revision || "missing", workbench: workbench.revision },
    python, execution: { targets: ["local"], maxConcurrentRuns: runtime.maxConcurrentRuns, maxConcurrentRunsPerNotebook: 1, availableRuns: runtime.availableRuns, busy: runtime.busy, runBudgetsMs: [...runtime.runBudgetsMs], remoteEnabled: false }, warnings };
}
