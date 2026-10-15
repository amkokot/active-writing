// App-only data is linked by registry ID, never by a paper's title or Git branch.
// In particular this path must not be inside the manuscript checkout.
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getProject, inside } from "./projects.ts";
import { run } from "./commands.ts";
import { replaceFile } from "./atomicFile.ts";
import type { PaperProject } from "../src/types.ts";

const ownedNames = new Set(["notebook.json", "notebook.previous.json", "workbench.json", "workbench.previous.json", "experiments", "handoffs", "references", "build", "source-drafts", "research", "study-evidence", "trial-evidence"]);
const pending = new Map<string, Promise<void>>();

export function projectDataPath(workspace: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Choose a registered paper for Aw storage.");
  return path.resolve(workspace, ".paperfocus", "project-data", id);
}
export function projectCatalogue(project: PaperProject, createdAt = new Date().toISOString()) {
  return { version: 1, projectId: project.id, name: project.name, paperFolder: project.folder, createdAt,
    categories: { conversations: "notebook.json", editing: "workbench.json", experiments: "experiments", replies: "handoffs", references: "references", recovery: "source-drafts", compilation: "build", research: "research", sourceBackups: `../../backups/${project.id}` } };
}

async function info(target: string) {
  try {
    const value = await lstat(target);
    if (value.isSymbolicLink()) throw new Error("Aw storage cannot use symbolic links or junctions.");
    if (!value.isFile() && !value.isDirectory()) throw new Error("Aw storage must use regular files and folders.");
    return value;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function directory(parent: string, name: string, create = true) {
  const target = path.join(parent, name);
  let value = await info(target);
  if (!value && !create) return target;
  if (!value) { await mkdir(target).catch(error => { if (error.code !== "EEXIST") throw error; }); value = await info(target); }
  if (!value?.isDirectory() || !inside(parent, await realpath(target))) throw new Error("Aw storage must stay inside its own workspace folder.");
  return target;
}
async function tree(target: string, remaining: { count: number }) {
  if (--remaining.count < 0) throw new Error("Legacy Aw storage is too large to migrate automatically. Its files are preserved.");
  const value = await info(target);
  if (value?.isDirectory()) for (const name of await readdir(target)) await tree(path.join(target, name), remaining);
}
async function sameTree(first: string, second: string): Promise<boolean> {
  const a = await info(first), b = await info(second);
  if (!a || !b || a.isDirectory() !== b.isDirectory()) return false;
  if (a.isFile()) return a.size === b.size && (await readFile(first)).equals(await readFile(second));
  const left = (await readdir(first)).sort(), right = (await readdir(second)).sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) return false;
  for (const name of left) if (!await sameTree(path.join(first, name), path.join(second, name))) return false;
  return true;
}
async function jsonFile(folder: string, name: string, value: unknown) {
  const target = path.join(folder, name); await info(target);
  const temporary = path.join(folder, `${name}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx" });
  await replaceFile(temporary, target);
}

async function migrate(root: string, folder: string) {
  const legacy = path.join(root, ".paperfocus"), value = await info(legacy);
  if (!value) return;
  if (!value.isDirectory()) throw new Error("The old Aw data path is not a folder; it has been preserved.");
  const journalFile = path.join(folder, "migration.json"), journalInfo = await info(journalFile);
  if (journalInfo && (!journalInfo.isFile() || journalInfo.size > 100_000)) throw new Error("The Aw migration record is invalid; all files are preserved.");
  const previous = journalInfo ? JSON.parse(await readFile(journalFile, "utf8")) : undefined;
  if (previous && (previous.version !== 1 || typeof previous.legacyRoot !== "string" || previous.dataRoot !== folder || !["moving", "complete"].includes(previous.phase)
    || !Array.isArray(previous.entries) || previous.entries.length > 1000 || previous.entries.some((name: unknown) => typeof name !== "string" || (!ownedNames.has(name) && !/^(?:notebook|workbench)[\w-]*\.tmp$/.test(name)))
    || [previous.kept, previous.moved].some(list => list !== undefined && (!Array.isArray(list) || list.some(name => !previous.entries.includes(name)))))) throw new Error("The Aw migration record is invalid; all files are preserved.");
  const names = await readdir(legacy);
  // A retained tracked original is a historical copy, not a second live store.
  // Do not compare it against later edits in the new location or import it again.
  const completed: string[] = previous?.phase === "complete" ? previous.entries : [];
  const owned = names.filter(name => !completed.includes(name) && (ownedNames.has(name) || /^(?:notebook|workbench)[\w-]*\.tmp$/.test(name)));
  if (!owned.length && previous?.phase !== "moving") return;
  // Validate the whole batch before moving anything. Never follow linked assets.
  const limit = { count: 50_000 };
  for (const name of owned) {
    await tree(path.join(legacy, name), limit); await tree(path.join(folder, name), limit);
    if (await info(path.join(folder, name)) && !await sameTree(path.join(legacy, name), path.join(folder, name))) throw new Error(`Old and new Aw storage both contain different ${name}. Both copies are preserved; review them before continuing.`);
  }
  let tracked: string[] | undefined;
  try {
    const probe = await run("git", ["ls-files", "-z", "--", ".paperfocus"], root);
    if (probe.code === 0) tracked = probe.output.split("\0").filter(Boolean);
    else if (/not a git repository/i.test(probe.output)) tracked = [];
  } catch { /* Without a reliable Git check, keep the originals. */ }
  const kept: string[] = previous?.kept ?? [], moved: string[] = previous?.moved ?? [];
  const entries = [...new Set<string>([...(previous?.entries ?? []), ...owned])];
  // A crash after a rename can leave only the target. Keep that provenance on retry.
  for (const name of entries) if (!names.includes(name) && await info(path.join(folder, name)) && !moved.includes(name)) moved.push(name);
  await jsonFile(folder, "migration.json", { version: 1, legacyRoot: legacy, dataRoot: folder, phase: "moving", startedAt: previous?.startedAt ?? new Date().toISOString(), entries, moved, kept });
  for (const name of owned) {
    const source = path.join(legacy, name), target = path.join(folder, name);
    const preserve = tracked === undefined || tracked.some(file => file === `.paperfocus/${name}` || file.startsWith(`.paperfocus/${name}/`));
    if (preserve) {
      if (!await info(target)) await cp(source, target, { recursive: true, force: false, errorOnExist: true });
      if (!kept.includes(name)) kept.push(name);
    } else if (!await info(target)) { await rename(source, target); if (!moved.includes(name)) moved.push(name); }
    // Identical retained duplicates are not deleted merely to tidy a folder.
    else if (!kept.includes(name)) kept.push(name);
  }
  await jsonFile(folder, "migration.json", { version: 1, legacyRoot: legacy, dataRoot: folder, phase: "complete", completedAt: new Date().toISOString(), entries, moved, kept, untouched: names.filter(name => !entries.includes(name)) });
  if (!(await readdir(legacy)).length) await rmdir(legacy); // Only this validated, empty legacy folder.
}

/** On first access, relocate recognized legacy app data without editing source,
 * Git history or tracked files. A partial migration is safely resumable. */
export async function projectStorage(workspace: string, projectId?: string) {
  const home = await realpath(workspace), { project, root } = await getProject(home, projectId);
  const expected = projectDataPath(home, project.id);
  if (inside(root, expected)) throw new Error("Keep each paper in its own subfolder, not Aw home or an ancestor of Aw's data folder.");
  const local = await directory(home, ".paperfocus"), data = await directory(local, "project-data"), folder = await directory(data, project.id);
  const key = folder;
  const action = (pending.get(key) ?? Promise.resolve()).then(async () => {
    const catalogue = path.join(folder, "project.json");
    const catalogueInfo = await info(catalogue);
    if (catalogueInfo && (!catalogueInfo.isFile() || catalogueInfo.size > 10_000)) throw new Error("The Aw project catalogue is invalid; it has been preserved.");
    const old = catalogueInfo ? JSON.parse(await readFile(catalogue, "utf8")) : undefined;
    if (old && (old.version !== 1 || old.projectId !== project.id)) throw new Error("Aw storage belongs to another project; it has been preserved.");
    await migrate(root, folder);
    if (!old || old.paperFolder !== project.folder || old.name !== project.name) await jsonFile(folder, "project.json", projectCatalogue(project, old?.createdAt ?? undefined));
  });
  const tail = action.then(() => undefined, () => undefined); pending.set(key, tail);
  void tail.then(() => { if (pending.get(key) === tail) pending.delete(key); });
  await action;
  return { folder, project, paperRoot: root };
}

export async function projectBuildFolder(workspace: string, projectId?: string, mode?: "full" | "focus", key?: string, create = true) {
  const { folder } = await projectStorage(workspace, projectId);
  let target = await directory(folder, "build", create);
  for (const name of ["last-compile.json", "full-compile.json", "focus-compile.json"]) await info(path.join(target, name));
  if (mode) target = await directory(target, mode, create);
  if (key) {
    if (mode !== "focus" || !/^[a-f0-9]{16}$/.test(key)) throw new Error("Invalid focused build identity.");
    target = await directory(target, key, create);
  }
  await info(path.join(target, "compile.json"));
  return target;
}

export async function checkedBuildFile(folder: string, name: string) {
  if (path.basename(name) !== name || name === "." || name === "..") throw new Error("Invalid build filename.");
  const target = path.join(folder, name), value = await info(target);
  if (value && !value.isFile()) throw new Error("Choose a regular build file.");
  return target;
}

/** LaTeX's \include writes child .aux files but does not create their folders. */
export async function prepareBuildFolders(folder: string, sourceFiles: string[]) {
  for (const file of sourceFiles.filter(file => file.endsWith(".tex"))) {
    if (path.isAbsolute(file) || /^[A-Za-z]:/.test(file) || file.includes("\\")) throw new Error("Invalid compiled source path.");
    const parts = file.split("/");
    if (parts.some(part => !part || [".", ".."].includes(part))) throw new Error("Invalid compiled source path.");
    let parent = folder;
    for (const part of parts.slice(0, -1)) parent = await directory(parent, part);
    await checkedBuildFile(parent, parts.at(-1)!.replace(/\.tex$/, ".aux"));
  }
}
