import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { inside, registry, safeFolder } from "./projects.ts";

// Metadata only, on demand in the project picker. Never parse manuscripts,
// launch Git, migrate storage, or read potentially enormous experiment arrays.
const ignoredFolders = new Set(["build", "dist", "out", "target", "node_modules", "__pycache__", "venv", "env", "backups"]);
const sourceExtensions = new Set([".tex", ".bib", ".sty", ".cls", ".bst", ".md", ".txt", ".py", ".ipynb", ".r", ".jl", ".m", ".sh", ".c", ".h", ".cpp", ".f90", ".rs", ".js", ".ts", ".tsx", ".html", ".css", ".json", ".yaml", ".yml", ".toml", ".csv", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".eps", ".pdf"]);
function timestamp(value?: string) { const time = Date.parse(value ?? ""); return Number.isFinite(time) ? Math.min(time, Date.now()) : 0; }

async function latestFile(root: string, records: boolean): Promise<number> {
  let latest = 0, remaining = 5000;
  async function visit(folder: string, depth: number) {
    if (depth > 16 || remaining <= 0) return;
    try {
      if ((await lstat(folder)).isSymbolicLink() || !inside(root, await realpath(folder))) return;
      const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      const names = new Set(entries.map(entry => entry.name.toLowerCase()));
      for (const entry of entries) {
        if (--remaining < 0) return;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const target = path.join(folder, entry.name);
        if (entry.isDirectory()) { if (!ignoredFolders.has(entry.name.toLowerCase())) await visit(target, depth + 1); continue; }
        const lower = entry.name.toLowerCase(), extension = path.extname(lower);
        if (!sourceExtensions.has(extension) || /(?:\.previous\.json|\.tmp)$/.test(lower)) continue;
        if (records && ["project.json", "migration.json"].includes(lower)) continue;
        // TeX's generated PDF beside its root is not evidence of an edit.
        if (!records && extension === ".pdf" && names.has(lower.slice(0, -4) + ".tex")) continue;
        const info = await lstat(target).catch(() => undefined);
        if (info?.isFile() && !info.isSymbolicLink()) latest = Math.max(latest, Math.min(info.mtimeMs, Date.now()));
      }
    } catch { /* An unavailable folder must not hide every other paper. */ }
  }
  await visit(root, 0);
  return latest;
}

async function recordsActivity(workspace: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return 0;
  let folder = workspace;
  for (const name of [".paperfocus", "project-data", id]) {
    folder = path.join(folder, name);
    try { const info = await lstat(folder); if (!info.isDirectory() || info.isSymbolicLink() || !inside(workspace, await realpath(folder))) return 0; }
    catch { return 0; }
  }
  return latestFile(folder, true);
}

export async function activityOrderedProjects(workspace: string) {
  const entries = await registry(workspace), projects: typeof entries.projects = [];
  for (let start = 0; start < entries.projects.length; start += 4) {
    projects.push(...await Promise.all(entries.projects.slice(start, start + 4).map(async project => {
      const [source, records] = await Promise.all([
        safeFolder(workspace, project.folder).then(root => latestFile(root, false)).catch(() => 0),
        recordsActivity(workspace, project.id),
      ]);
      const time = Math.max(timestamp(project.createdAt), timestamp(project.lastOpenedAt), source, records);
      return { ...project, lastActivityAt: time ? new Date(time).toISOString() : undefined };
    })));
  }
  // Stable ties retain registry order. Sorting never changes active selection
  // or writes activity estimates back into the shared registry.
  projects.sort((a, b) => timestamp(b.lastActivityAt) - timestamp(a.lastActivityAt));
  return { ...entries, projects };
}
