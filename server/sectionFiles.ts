import { randomUUID } from "node:crypto";
import { lstat, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { addProjectFiles, checkedProjectPath } from "./projectFiles.ts";
import { getProject, hash, parseProject, projectFiles, projectRevision, publicDocument } from "./projects.ts";
import { saveGuardedFile } from "./guardedFile.ts";
import { replaceFile } from "./atomicFile.ts";
import { saveSourceDraftCopy } from "./sourceDrafts.ts";
import { latexText } from "../src/manuscripts.ts";
import { projectStorage } from "./projectStorage.ts";

/** One explicit structural edit. Creates only a new child file, never replaces
 * one. A complete parent recovery copy precedes the atomic parent save. */
export async function createSectionFile(workspace: string, input: { projectId: string; mainFile: string; revision: string; file: string; title?: string; nodeId?: string }) {
  const file = checkedProjectPath(input.file), before = await parseProject(workspace, input.projectId, true);
  if (!/^[A-Za-z0-9_./-]+\.tex$/.test(file)) throw new Error("Use a simple .tex path, such as sections/introduction.tex.");
  if (!input.revision || before.revision !== input.revision || before.project.mainFile !== input.mainFile) throw new Error("The manuscript changed before creating the section file. Recheck and retry.");
  const { root } = await getProject(workspace, input.projectId);
  const node = input.nodeId ? before.nodes.find(node => node.id === input.nodeId && ["section", "subsection"].includes(node.kind) && !node.environment) : undefined;
  if (input.nodeId && !node?.sourceOpening) throw new Error("Choose a complete section heading, not a theorem or a loose block.");
  const parentFile = node?.sourceOpening?.file ?? before.project.mainFile, original = before.sources[parentFile];
  if (original === undefined || original.length > 400_000) throw new Error("This parent cannot be safely split here. Keep it intact and reorganize it in your source editor.");
  const parent = path.join(root, parentFile), info = await lstat(parent);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Choose a regular parent source file.");
  let start: number, end: number, child: string;
  const masked = original.replace(/(?<!\\)%[^\r\n]*/g, match => " ".repeat(match.length));
  if (node?.sourceOpening) {
    start = node.sourceOpening.start;
    if (Object.values(before.environmentRanges ?? {}).some(range => range.file === parentFile && range.start < start && range.end > start)) throw new Error("A section inside an environment cannot be moved independently.");
    const next = before.nodes.filter(other => other.sourceOpening?.file === parentFile && ["section", "subsection"].includes(other.kind) && !other.environment && other.depth <= node.depth && other.sourceOpening.start > start)
      .sort((a, b) => a.sourceOpening!.start - b.sourceOpening!.start)[0]?.sourceOpening?.start;
    const documentEnd = masked.indexOf("\\end{document}", start);
    end = Math.min(next ?? original.length, documentEnd >= 0 ? documentEnd : original.length);
    child = original.slice(start, end);
    // Keep literal inputs rooted at the same files after relocating the parent.
    // Aw/ordinary LaTeX resolve project-root paths first, then the source folder.
    const childMasked = masked.slice(start, end);
    for (const match of [...childMasked.matchAll(/\\(input|include)\s*\{([^{}]+)\}/g)].reverse()) {
      const target = match[2], tex = target.trim().endsWith(".tex") ? target.trim() : `${target.trim()}.tex`;
      if (before.files.includes(tex)) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(parentFile), tex));
      if (!before.files.includes(resolved) || !/^[A-Za-z0-9_./-]+\.tex$/.test(resolved)) throw new Error("An input in this section cannot be relocated safely. Use the source editor instead.");
      child = child.slice(0, match.index) + `\\${match[1]}{${resolved}}` + child.slice(match.index! + match[0].length);
    }
    if (/\\(?:import|subimport|subfile)\b/.test(childMasked)) throw new Error("Imported/subfile sections need manual path review; the source is kept intact.");
  } else {
    const title = input.title?.trim();
    if (!title || title.length > 200 || /[\r\n\x00-\x1f]/.test(title)) throw new Error("Use a one-line section title of 1–200 characters.");
    start = masked.lastIndexOf("\\end{document}"); end = start;
    if (start < 0) throw new Error("Finish the parent document before adding a section file.");
    child = `\\section{${latexText(title)}}\nStart writing here.\n\n`;
  }
  if (before.files.some(existing => existing.toLowerCase() === file.toLowerCase())) throw new Error("That file already exists. Choose another; existing files are never replaced.");
  const replacement = `${start && !/\s/.test(original[start - 1]) ? "\n" : ""}\\input{${file}}\n\n`;
  const updated = original.slice(0, start) + replacement + original.slice(end);
  const recovery = await saveSourceDraftCopy(workspace, input.projectId, { version: 1, projectId: input.projectId, rootFile: input.mainFile,
    baseRevision: input.revision, incomingRevision: input.revision, drafts: [{ paragraphId: `parent-${randomUUID()}`, file: parentFile, draftText: original, reason: "unknown-base" },
      { paragraphId: `child-${randomUUID()}`, file, draftText: child, reason: "unknown-base" }] });
  const operationId = randomUUID(), { folder } = await projectStorage(workspace, input.projectId);
  const operationPath = path.join(folder, "source-drafts", `section-${operationId}.json`);
  const operation = { version: 1, projectId: input.projectId, mainFile: input.mainFile, file, parentFile, original, updated, child, recoveryId: recovery.id, revision: "" };
  await writeFile(operationPath, JSON.stringify(operation), { flag: "wx" });
  const temporary = path.join(path.dirname(parent), `.aw-section-${randomUUID()}.tmp`);
  let created = false;
  try {
    await addProjectFiles(workspace, input.projectId, input.revision, input.mainFile, [{ path: file, data: Buffer.from(child).toString("base64") }]); created = true;
    // Stage beside the parent, then recheck all source and root ownership. No
    // delete-original fallback. The only removed file is our staging file.
    await writeFile(temporary, updated, { flag: "wx" });
    const files = (await projectFiles(root)).filter(name => name !== file && path.join(root, name) !== temporary);
    const current = await getProject(workspace, input.projectId);
    if (current.project.mainFile !== input.mainFile || await projectRevision(root, files) !== input.revision || await readFile(parent, "utf8") !== original) throw new Error("Source changed during section creation. The parent was not replaced.");
    await saveGuardedFile(root, parentFile, hash(original), Buffer.from(updated));
  } catch (reason) {
    throw new Error(`${(reason as Error).message}${created ? ` The new child ${file} is kept; check it before retrying.` : ""} Parent recovery copy: ${recovery.id}.`);
  } finally { await unlink(temporary).catch(() => undefined); }
  const after = await parseProject(workspace, input.projectId, true);
  operation.revision = after.revision;
  const operationTemporary = `${operationPath}.tmp`;
  await writeFile(operationTemporary, JSON.stringify(operation), { flag: "wx" }); await replaceFile(operationTemporary, operationPath);
  // Exact ordered matches only; duplicates are not reattached by fuzzy text.
  const relocations = before.paragraphs.length === after.paragraphs.length && before.paragraphs.every((p, index) => p.text === after.paragraphs[index].text)
    ? before.paragraphs.map((p, index) => ({ before: p, after: after.paragraphs[index] })).filter(pair => pair.before.id !== pair.after.id || pair.before.file !== pair.after.file || pair.before.nodeId !== pair.after.nodeId) : [];
  return { document: publicDocument(after), relocations, file, parentFile, recoveryId: recovery.id, operationId };
}

export async function undoSectionFile(workspace: string, input: { projectId: string; mainFile: string; revision: string; operationId: string }) {
  if (!/^[a-f0-9-]{36}$/.test(input.operationId)) throw new Error("Choose a saved section operation.");
  const { folder } = await projectStorage(workspace, input.projectId), operationPath = path.join(folder, "source-drafts", `section-${input.operationId}.json`);
  const folderInfo = await lstat(path.dirname(operationPath)), info = await lstat(operationPath);
  if (!folderInfo.isDirectory() || folderInfo.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 2_000_000) throw new Error("The section recovery record is invalid; all source is kept.");
  const operation = JSON.parse(await readFile(operationPath, "utf8"));
  if (operation.version !== 1 || operation.projectId !== input.projectId || operation.mainFile !== input.mainFile || operation.revision !== input.revision
    || !input.revision || operation.undone || [operation.original, operation.updated, operation.child].some(value => typeof value !== "string")) throw new Error("This section operation cannot be undone at the current saved version.");
  const parentFile = checkedProjectPath(operation.parentFile), file = checkedProjectPath(operation.file);
  const before = await parseProject(workspace, input.projectId, true), { root } = await getProject(workspace, input.projectId);
  if (before.project.mainFile !== input.mainFile || before.revision !== input.revision || !before.files.includes(parentFile) || !before.files.includes(file)) throw new Error("Source changed since this section operation. Undo will not overwrite later edits; use the kept recovery copy.");
  const parent = path.join(root, parentFile), child = path.join(root, file);
  for (const target of [parent, child]) { const value = await lstat(target); if (!value.isFile() || value.isSymbolicLink()) throw new Error("Undo requires the original regular source files."); }
  if (await readFile(parent, "utf8") !== operation.updated || await readFile(child, "utf8") !== operation.child) throw new Error("These source files changed. Undo will not overwrite them.");
  const temporary = path.join(path.dirname(parent), `.aw-undo-section-${randomUUID()}.tmp`);
  let warning: string | undefined;
  try {
    await writeFile(temporary, operation.original, { flag: "wx" });
    const files = (await projectFiles(root)).filter(name => path.join(root, name) !== temporary);
    const current = await getProject(workspace, input.projectId);
    if (current.project.mainFile !== input.mainFile || await projectRevision(root, files) !== input.revision) throw new Error("Source changed before undo could finish. All source is kept.");
    await saveGuardedFile(root, parentFile, hash(operation.updated), Buffer.from(operation.original));
    // Only the unchanged child created by this operation is removed. Its exact
    // contents, and the original parent, remain in the immutable recovery copy.
    try { if (await readFile(child, "utf8") !== operation.child) throw new Error("Child changed"); await unlink(child); }
    catch { warning = "Parent restored; the child was retained because it changed or could not be removed."; }
    const journalTemporary = `${operationPath}.undone.tmp`;
    await writeFile(journalTemporary, JSON.stringify({ ...operation, undone: true }), { flag: "wx" }); await replaceFile(journalTemporary, operationPath);
  } finally { await unlink(temporary).catch(() => undefined); }
  const after = await parseProject(workspace, input.projectId, true);
  const relocations = before.paragraphs.length === after.paragraphs.length && before.paragraphs.every((p, index) => p.text === after.paragraphs[index].text)
    ? before.paragraphs.map((p, index) => ({ before: p, after: after.paragraphs[index] })).filter(pair => pair.before.id !== pair.after.id || pair.before.file !== pair.after.file || pair.before.nodeId !== pair.after.nodeId) : [];
  return { document: publicDocument(after), relocations, warning, file, recoveryId: operation.recoveryId };
}
