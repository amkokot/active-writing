import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getProject } from "./projects.ts";
import type { WorkspaceFolders } from "../src/workspaceFolders.ts";
import { projectStorage } from "./projectStorage.ts";
import { appCodeRoot } from "./appPaths.ts";

export async function workspaceFolders(workspace: string, projectId?: string): Promise<WorkspaceFolders> {
  const home = await realpath(workspace);
  const selected = projectId ? await getProject(workspace, projectId) : undefined;
  const data = projectId ? (await projectStorage(workspace, projectId)).folder : undefined;
  return {
    home: { path: home, link: pathToFileURL(home + path.sep).href },
    code: { path: appCodeRoot, link: pathToFileURL(appCodeRoot + path.sep).href },
    ...(selected ? { paper: { id: selected.project.id, name: selected.project.name,
      path: selected.root, link: pathToFileURL(selected.root + path.sep).href, mainFile: selected.project.mainFile, manuscriptPurposes: selected.project.manuscriptPurposes, manuscriptOverviewTargets: selected.project.manuscriptOverviewTargets } } : {}),
    ...(data ? { data: { path: data, link: pathToFileURL(data + path.sep).href } } : {}),
    guidePath: path.join(appCodeRoot, "docs", "RESEARCH_WORKFLOW.md"),
    canOpen: process.platform === "win32",
  };
}

export function selectedFolder(folders: WorkspaceFolders, target: unknown) {
  if (target === "home") return folders.home.path;
  if (target === "paper" && folders.paper) return folders.paper.path;
  if (target === "data" && folders.data) return folders.data.path;
  throw new Error("Choose Aw home, the current paper folder, or its Aw files.");
}

async function openExplorer(folder: string) {
  if (process.platform !== "win32") throw new Error("Copy the folder path to your file manager on this system.");
  await new Promise<void>((resolve, reject) => {
    // Fixed executable, validated directory and argument array: never a shell command.
    const child = spawn("explorer.exe", [folder], { windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

export async function openWorkspaceFolder(workspace: string, projectId: string | undefined, target: unknown, open = openExplorer) {
  const folders = await workspaceFolders(workspace, projectId);
  const folder = selectedFolder(folders, target);
  await open(folder);
  return { success: true, path: folder };
}
