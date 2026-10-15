import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProject, inside, projectFiles, projectRevision, registerProject } from "./projects.ts";
import { isProjectCachePath, maxProjectFileBytes, maxProjectUploadBytes, maxProjectUploadFiles, projectFileKind, type ProjectFilePreview } from "../src/projectFiles.ts";

export function checkedProjectPath(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 240 || /[\\:\x00-\x1f\x7f]/.test(value) || path.posix.isAbsolute(value)) throw new Error("Use a relative project path, such as figures/plot.png.");
  const parts = value.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[<>"|?*]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || isProjectCachePath(value)) throw new Error("Choose a normal file path outside local cache and Git folders.");
  return value;
}

function checkedUploads(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > maxProjectUploadFiles) throw new Error(`Choose between 1 and ${maxProjectUploadFiles} files.`);
  const seen = new Set<string>();
  let total = 0;
  const files = input.map(item => {
    const file = checkedProjectPath(item?.path);
    const key = file.toLowerCase();
    if (seen.has(key)) throw new Error(`Two files have the same path: ${file}.`);
    seen.add(key);
    if (typeof item?.data !== "string" || item.data.length > Math.ceil(maxProjectFileBytes / 3) * 4 || item.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(item.data)) throw new Error(`Invalid or oversized file: ${file}.`);
    const data = Buffer.from(item.data, "base64");
    if (data.length > maxProjectFileBytes || data.toString("base64") !== item.data) throw new Error(`Invalid or oversized file: ${file}.`);
    total += data.length;
    if (total > maxProjectUploadBytes) throw new Error("Add at most 40 MB at a time.");
    return { file, data };
  });
  // A batch cannot create both a file and a directory of the same name.
  for (const { file } of files) {
    const parts = file.toLowerCase().split("/");
    for (let count = 1; count < parts.length; count++) if (seen.has(parts.slice(0, count).join("/"))) throw new Error(`A file and folder share a name: ${file}.`);
  }
  return files;
}

async function safeParents(root: string, file: string, create: boolean) {
  const canonicalRoot = await realpath(root);
  const parts = file.split("/").slice(0, -1);
  let folder = canonicalRoot;
  for (const part of parts) {
    folder = path.join(folder, part);
    let info;
    try { info = await lstat(folder); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !create) throw error;
      await mkdir(folder); info = await lstat(folder);
    }
    if (!info.isDirectory() || info.isSymbolicLink() || !inside(canonicalRoot, await realpath(folder))) throw new Error("Project files cannot pass through links or non-project folders.");
  }
  return path.join(folder, file.split("/").at(-1)!);
}

async function writeNewFiles(root: string, files: ReturnType<typeof checkedUploads>) {
  const existing = new Set((await projectFiles(root)).map(file => file.toLowerCase()));
  // Validate every target before writing any bytes, including hidden/link targets.
  for (const { file } of files) {
    if (existing.has(file.toLowerCase())) throw new Error(`${file} already exists. Rename the new file; existing files are never overwritten.`);
    const target = await safeParents(root, file, true);
    try { await lstat(target); throw new Error(`${file} already exists. Rename the new file.`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const written: string[] = [];
  try {
    for (const { file, data } of files) {
      const target = await safeParents(root, file, false);
      await writeFile(target, data, { flag: "wx" }); written.push(target);
    }
  } catch (error) {
    // Only our newly created files are removed; existing files are never touched.
    await Promise.all(written.map(file => unlink(file).catch(() => undefined)));
    throw error;
  }
}

const starter = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb,amsthm,graphicx,hyperref}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}

\title{Untitled paper}
\author{}
\date{}
\begin{document}
\maketitle

\section{Introduction}
Start writing here.

\end{document}
`;

export async function createPaperProject(workspace: string, name: unknown, uploads?: unknown) {
  if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new Error("Choose a paper name (up to 100 characters).");
  const files = uploads === undefined ? [{ file: "main.tex", data: Buffer.from(starter) }] : checkedUploads(uploads);
  if (!files.some(item => item.file.endsWith(".tex") && /\\documentclass\b/.test(item.data.toString("utf8")))) throw new Error("An imported paper needs a .tex file containing \\documentclass. Start a blank project to add fragments instead.");
  const root = await realpath(workspace);
  await safeParents(root, "papers/placeholder", true);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "paper";
  const folder = `papers/${slug}-${randomUUID().slice(0, 8)}`;
  const target = await safeParents(root, folder, false);
  await mkdir(target);
  await writeNewFiles(target, files);
  return registerProject(workspace, folder, name.trim());
}

export async function addProjectFiles(workspace: string, id: string, revision: string, mainFile: string, uploads: unknown) {
  const files = checkedUploads(uploads);
  const { project, root } = await getProject(workspace, id);
  if (!revision || project.mainFile !== mainFile || await projectRevision(root, await projectFiles(root)) !== revision) throw new Error("The paper changed while files were being added. Reopen Files and try again; no files were replaced.");
  await writeNewFiles(root, files);
}

async function readProjectFile(workspace: string, id: string, value: unknown) {
  const file = checkedProjectPath(value), { root } = await getProject(workspace, id);
  if (!(await projectFiles(root)).includes(file)) throw new Error("Choose a file in this paper.");
  const target = await safeParents(root, file, false), info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("Choose a regular project file, not a link.");
  if (info.size > maxProjectFileBytes) throw new Error("Preview supports files up to 20 MB. Open this larger file from the paper folder.");
  const data = await readFile(target);
  if (data.length > maxProjectFileBytes) throw new Error("This file grew beyond the preview limit.");
  return { file, data, size: data.length };
}

export async function projectFilePreview(workspace: string, id: string, file: unknown): Promise<ProjectFilePreview> {
  const result = await readProjectFile(workspace, id, file), kind = projectFileKind(result.file);
  const limit = 128 * 1024;
  const text = ["tex", "text"].includes(kind) && !result.data.subarray(0, limit).includes(0) ? result.data.subarray(0, limit).toString("utf8") : undefined;
  return { file: result.file, size: result.size, kind, text, truncated: text !== undefined && result.size > limit };
}
/** Complete, guarded source read for version preparation; never a preview excerpt. */
export async function projectTexSource(workspace: string, id: string, file: string) {
  if (!file.endsWith(".tex")) throw new Error("Choose a TeX source file.");
  const result = await readProjectFile(workspace, id, file);
  return new TextDecoder("utf-8", { fatal: true }).decode(result.data);
}

export async function projectFileContent(workspace: string, id: string, file: unknown) {
  const result = await readProjectFile(workspace, id, file), bytes = result.data;
  const extension = result.file.split(".").at(-1)?.toLowerCase();
  const mime = extension === "pdf" && bytes.subarray(0, 5).toString() === "%PDF-" ? "application/pdf"
    : extension === "png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : ["jpg", "jpeg"].includes(extension ?? "") && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : extension === "gif" && /GIF8[79]a/.test(bytes.subarray(0, 6).toString()) ? "image/gif"
    : extension === "webp" && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : undefined;
  if (!mime) throw new Error("This file is not a supported image or PDF. Text formats can be inspected in Files.");
  return { data: bytes, mime };
}
