import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { inside } from "./projects.ts";

export interface BuildDependency { file: string; size: number; modified: number }

// TeX on Windows may fail to create the longer temporary SyncTeX filename even
// though its final PDF fits. Preserve ordinary cache names; shorten deep ones.
export function focusedJobName(output: string, platform = process.platform) {
  return platform === "win32" && path.join(output, "paperfocus-focus.synctex.gz(busy)").length >= 260 ? "aw" : "paperfocus-focus";
}

export async function buildDependencies(root: string, output: string, job: string, extraInputs: string[] = []): Promise<BuildDependency[]> {
  const recorder = await readFile(path.join(output, `${job}.fls`), "utf8");
  const inputs = [...new Set([...recorder.split(/\r?\n/).filter(line => line.startsWith("INPUT ")).map(line => path.resolve(root, line.slice(6).replace(/^"|"$/g, ""))), ...extraInputs.map(file => path.resolve(root, file))])];
  // Generated auxiliaries in this build are outputs, not source dependencies.
  // Auxiliaries imported from a different build are dependencies.
  const files = inputs.filter(file => !inside(output, file));
  if (!files.length || files.length > 10000) throw new Error("No usable compilation dependency list.");
  const result = await Promise.all(files.map(async file => { const info = await stat(file); return { file, size: info.size, modified: info.mtimeMs }; }));
  for (const extension of ["tex", "pdf", "synctex.gz"]) {
    const file = path.join(output, `${job}.${extension}`);
    try { const info = await stat(file); result.push({ file, size: info.size, modified: info.mtimeMs }); } catch { if (extension !== "tex") throw new Error("Missing build artifact."); }
  }
  return result;
}

export async function dependenciesUnchanged(dependencies: BuildDependency[] | undefined) {
  if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > 10003) return false;
  try {
    return (await Promise.all(dependencies.map(async item => {
      if (!item || typeof item.file !== "string") return false;
      const info = await stat(item.file); return info.isFile() && info.size === item.size && info.mtimeMs === item.modified;
    }))).every(Boolean);
  } catch { return false; }
}
