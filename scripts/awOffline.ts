import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readNotebook } from "../server/notebookStore.ts";
import { readExperiments, writeExperiments, runExperimentOffline, readExperimentJob } from "../server/experiments.ts";
import { experimentRunBudgets } from "../src/experimentLimits.ts";
import { pythonPackageFolder } from "../server/pythonPackages.ts";
import { workspaceFolders } from "../server/workspaceFolders.ts";
import { readResearchCell } from "../server/researchCell.ts";
import { finishResearch } from "../server/researchFinish.ts";
import { validateLaunchWorkspace } from "./desktopLauncher.mjs";
import { readSyncBytes, syncStatus } from "../server/deviceSync.ts";
import { appCodeRoot } from "../server/appPaths.ts";

const supported = new Set(["discover", "bind", "inspect", "cell", "output", "inputs", "manifest", "put", "batch", "organize", "finish", "run", "job"]);
/** Local adapter for records and explicitly authorized fresh Python. No fetch/listener. */
export async function offlineResearchRequest(command: string, flags: Record<string, string>, expectedOwner?: string) {
  if (!supported.has(command)) throw new Error(`Offline mode does not support ${command}. Use the live service deliberately for sessions, preflight, evidence or phase rollover. Nothing started.`);
  if (flags.session) throw new Error("Offline Python uses a fresh process. Shared sessions require the app service; nothing started.");
  if (command === "job" && flags["wait-seconds"]) throw new Error("Offline job reads saved runs only; no live wait. Offline run already waits for collection. Nothing rerun.");
  const workspace = await realpath(flags.workspace);
  // Disk-only identity check, not a launcher/server probe. Refuse incomplete copies.
  validateLaunchWorkspace(workspace);
  for (const target of [path.join(workspace, ".paperfocus"), path.join(workspace, ".paperfocus", "projects.json")]) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() && (!info.isFile() || info.size > 2_000_000)) throw new Error("Offline Aw identity needs regular bounded workspace/registry files, not linked paths.");
  }
  try {
    const pkg = JSON.parse((await readSyncBytes(path.join(workspace, "package.json"), 2_000_000)).toString());
    if (pkg.name !== "active-writing") throw new Error("Wrong Aw workspace. No changes made.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A separate data home has no fake app package. Its guarded first-copy
    // receipt and distinct saved device identity provide explicit ownership.
    const copied = JSON.parse((await readSyncBytes(path.join(workspace, ".paperfocus/device-sync/clone-ready.json"), 5000)).toString());
    if (copied.version !== 1 || copied.initialCopyOnly !== true || copied.deviceId !== (await syncStatus(workspace)).device?.id) throw new Error("Wrong or incomplete Aw data home. No changes made.");
  }
  const registry = JSON.parse(await readFile(path.join(workspace, ".paperfocus", "projects.json"), "utf8"));
  if (!Array.isArray(registry.projects) || registry.projects.some((p: any) => !p || typeof p.id !== "string" || typeof p.folder !== "string" || typeof p.mainFile !== "string")) throw new Error("Invalid Aw project registry; preserved. No demo fallback.");
  if (flags.project && !registry.projects.some((p: any) => p.id === flags.project)) throw new Error("This paper is no longer registered. No changes made.");
  const owner = async () => {
    const conversations = await readNotebook(workspace, flags.project), entry = conversations.entries.find(entry => entry.id === flags.entry);
    if (!entry) throw new Error("Conversation not found in this paper. No changes made.");
    const id = entry.experimentNotebookId ?? entry.id;
    if (expectedOwner && id !== expectedOwner) throw new Error("Bound notebook ownership changed. No changes made.");
    return id;
  };
  const initialOwner = flags.entry ? await owner() : undefined;
  return async (endpoint: string, body?: any): Promise<any> => {
    const url = new URL(endpoint, "http://offline.invalid/"), name = url.pathname.slice(1);
    if (name === "health" && body === undefined) return { app: "active-writing", workspaceRoot: workspace, codeRoot: appCodeRoot, offline: true, features: { researchCells: true, experimentInputs: true } };
    if (name === "projects" && body === undefined) return registry;
    if (name === "notebook" && body === undefined) return readNotebook(workspace, flags.project);
    if (name === "workspace-folders" && body === undefined) return workspaceFolders(workspace, flags.project);
    const currentOwner = await owner();
    if (currentOwner !== initialOwner) throw new Error("Notebook ownership changed during this command. No changes made.");
    if (body && (body.projectId !== flags.project || body.notebookId !== currentOwner)) throw new Error("Offline write scope differs. No changes made.");
    if (name === "research/cell" && body === undefined) return { ...await readResearchCell(workspace, flags.project, flags.entry, flags.cell, command === "output" ? flags.output : undefined, expectedOwner), offline: true };
    if (name === "experiments" && body === undefined) return { ...await readExperiments(workspace, flags.project, currentOwner), runtime: { offline: true, interpreterChecked: false, packageFolder: await pythonPackageFolder(workspace), supportedModes: ["fresh"], runBudgetsMs: experimentRunBudgets, note: "Fresh Python requires explicit permission. Interpreter/capacity are checked at run time; live sessions are unknown. Reading never executes code." } };
    if (name === "experiments" && body) return writeExperiments(workspace, flags.project, currentOwner, body.revision, body.notebook);
    if (name === "experiments/run" && body) return runExperimentOffline(workspace, flags.project, currentOwner, body.cellId, body.revision, body.acknowledgeLocalExecution, body.timeoutMs);
    if (name === "experiments/job" && body === undefined) return readExperimentJob(workspace, flags.project, currentOwner, flags.job);
    if (name === "research/finish" && body) return finishResearch(workspace, body);
    throw new Error(`Unsupported offline operation: ${name}. No service started.`);
  };
}
