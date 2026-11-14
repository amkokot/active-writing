import { copyFile, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { inside } from "./projects.ts";
import { checkedBuildFile } from "./projectStorage.ts";

/** Copy only auxiliaries; new source still runs through TeX in a new folder. */
export async function seedFocusedBuild(previous: string, output: string) {
  const oldJob = focusedJobName(previous), job = focusedJobName(output);
  let copied = 0;
  for (const extension of ["aux", "toc", "out", "lof", "lot", "bbl"]) {
    const source = await checkedBuildFile(previous, `${oldJob}.${extension}`);
    const destination = await checkedBuildFile(output, `${job}.${extension}`);
    try {
      if ((await stat(source)).size > 16 * 1024 * 1024) continue;
      await copyFile(source, destination, constants.COPYFILE_EXCL); copied++;
    } catch (error) { if (!["ENOENT", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  }
  return copied;
}

export function compilationCommand(engine: string | undefined, input: string, output: string, draft = false, force = false) {
  const common = ["-file-line-error", "-interaction=nonstopmode", "-halt-on-error", "-synctex=1", "-recorder"];
  return draft
    ? { command: engine === "xelatex" ? "xelatex" : engine === "lualatex" ? "lualatex" : "pdflatex", args: ["-no-shell-escape", ...common, `-output-directory=${output}`, input] }
    : { command: "latexmk", args: ["-norc", engine === "xelatex" ? "-xelatex" : engine === "lualatex" ? "-lualatex" : "-pdf", "-latexoption=-no-shell-escape", ...common, ...(force ? ["-g"] : []), `-outdir=${output}`, input] };
}

export interface BuildDependency { file: string; size: number; modified: number; changed?: number; digest?: string }

async function dependency(file: string): Promise<BuildDependency> {
  const info = await stat(file);
  if (!info.isFile()) throw new Error("Compilation input is not a file.");
  const result: BuildDependency = { file, size: info.size, modified: info.mtimeMs, changed: info.ctimeMs };
  // Text dependencies are cheap to hash and are often rewritten identically by
  // sync or another TeX build. Do not read large figures merely for this cache.
  if (info.size <= 2 * 1024 * 1024 && /\.(tex|bib|bst|aux|bbl|sty|cls|def|cfg|fd|clo|toc|out)$/i.test(file)) {
    result.digest = createHash("sha256").update(await readFile(file)).digest("hex");
    const after = await stat(file);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error("Compilation input changed while checking it.");
  }
  return result;
}

// TeX on Windows may fail to create the longer temporary SyncTeX filename even
// though its final PDF fits. Preserve ordinary cache names; shorten deep ones.
export function focusedJobName(output: string, platform = process.platform) {
  return platform === "win32" && path.join(output, "paperfocus-focus.synctex.gz(busy)").length >= 260 ? "aw" : "paperfocus-focus";
}

export async function buildDependencies(root: string, output: string, job: string, extraInputs: string[] = [], snapshot = output): Promise<BuildDependency[]> {
  const recorder = await readFile(path.join(output, `${job}.fls`), "utf8");
  const inputs = [...new Set([...recorder.split(/\r?\n/).filter(line => line.startsWith("INPUT ")).map(line => path.resolve(root, line.slice(6).replace(/^"|"$/g, ""))), ...extraInputs.map(file => path.resolve(root, file))])];
  // Generated auxiliaries in this build are outputs, not source dependencies.
  // Auxiliaries imported from a different build are dependencies.
  const files = inputs.filter(file => !inside(output, file));
  if (!files.length || files.length > 10000) throw new Error("No usable compilation dependency list.");
  const result = await Promise.all(files.map(dependency));
  for (const extension of ["tex", "pdf", "synctex.gz"]) {
    const file = path.join(snapshot, `${job}.${extension}`);
    try { result.push(await dependency(file)); } catch { if (extension !== "tex") throw new Error("Missing build artifact."); }
  }
  return result;
}

export async function dependenciesUnchanged(dependencies: BuildDependency[] | undefined) {
  if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > 10003) return false;
  try {
    const checked = await Promise.all(dependencies.map(async item => {
      if (!item || typeof item.file !== "string") return false;
      // Windows can give two rapid same-size writes identical timestamps.
      // Small text must be checked by content, not treated as unchanged merely
      // because sync preserved its mtime (or ctime has coarse resolution).
      if (item.digest) {
        const fresh = await dependency(item.file);
        return fresh.digest === item.digest ? fresh : false;
      }
      const info = await stat(item.file);
      if (!info.isFile() || info.size !== item.size) return false;
      if (info.mtimeMs === item.modified && (item.changed === undefined || info.ctimeMs === item.changed)) return item;
      return false;
    }));
    if (checked.some(item => !item)) return false;
    // Persist refreshed timestamps only after the complete dependency set agrees.
    checked.forEach((item, index) => Object.assign(dependencies[index], item));
    return true;
  } catch { return false; }
}
