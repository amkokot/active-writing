import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManuscriptVersion, NotebookEntry, NotebookSource, ProjectDocument } from "../src/types.ts";
import { manuscriptPurpose, nextManuscriptVersion } from "../src/manuscripts.ts";
import { addProjectFiles, checkedProjectPath, projectTexSource } from "./projectFiles.ts";
import { getProject, hash, parseProject, projectFiles, projectRevision, publicDocument, registry, saveRegistry } from "./projects.ts";
import { readNotebook, validateNotebookEntries, writeNotebook } from "./notebookStore.ts";
import { experimentRuntime, readExperiments, writeExperiments } from "./experiments.ts";
import { projectStorage } from "./projectStorage.ts";
import { readWorkbench, validateWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { writingLocks } from "../src/writing.ts";
import { captureTaskSource } from "../src/taskSource.ts";

const mask = (text: string) => text.replace(/(?<!\\)%[^\r\n]*/g, value => " ".repeat(value.length));
const inputPattern = /\\(input|include)\b\s*\{([^{}]+)\}/g;

/** Copy literal TeX dependencies in place, so ordinary relative assets keep working.
 * Refuse unsupported imports rather than quietly sharing mutable section source. */
export function versionSources(sources: Record<string, string>, main: string, target: string, suffix: string) {
  checkedProjectPath(target);
  if (!target.endsWith(".tex") || path.posix.dirname(main) !== path.posix.dirname(target)) throw new Error("Keep the new .tex root in the same folder as its previous version.");
  const files = Object.keys(sources), seen = new Set<string>(), references = new Map<string, Array<{ start: number; end: number; child: string }>>();
  const resolve = (from: string, value: string) => {
    if (/[\\#$%{}]/.test(value) || path.posix.isAbsolute(value)) throw new Error("Versioning needs literal project-local input/include paths.");
    const tex = value.trim().endsWith(".tex") ? value.trim() : `${value.trim()}.tex`;
    for (const candidate of [path.posix.normalize(tex), path.posix.normalize(path.posix.join(path.posix.dirname(from), tex))]) {
      const found = files.find(file => process.platform === "win32" ? file.toLowerCase() === candidate.toLowerCase() : file === candidate);
      if (found) return found;
    }
    throw new Error(`Cannot copy missing TeX input: ${value}.`);
  };
  function visit(file: string) {
    if (seen.has(file)) return; seen.add(file);
    if (seen.size > 100) throw new Error("Versioning supports up to 100 included TeX files.");
    const text = sources[file]; if (text === undefined) throw new Error("The selected TeX root is missing.");
    const clean = mask(text);
    if (/\\(?:subfile|import|subimport|inputfrom|includefrom|InputIfFileExists|IfFileExists|verbatiminput|lstinputlisting)\b/.test(clean)
      || /\\(?:input|include)\b(?!\s*\{)/.test(clean)) throw new Error("This manuscript uses an unsupported file-loading command. Version it manually rather than sharing hidden TeX dependencies.");
    const refs = [...clean.matchAll(inputPattern)].map(match => {
      const start = match.index! + match[0].indexOf("{") + 1;
      return { start, end: match.index! + match[0].length - 1, child: resolve(file, text.slice(start, match.index! + match[0].length - 1)) };
    });
    references.set(file, refs); refs.forEach(ref => visit(ref.child));
  }
  visit(main);
  const mapping = Object.fromEntries([...seen].map(file => [file, file === main ? target : file.replace(/\.tex$/i, `-${suffix}.tex`)]));
  const copies = [...seen].map(file => {
    let text = sources[file];
    for (const ref of [...references.get(file)!].reverse()) text = text.slice(0, ref.start) + mapping[ref.child].replace(/\.tex$/i, "") + text.slice(ref.end);
    text = text.replace(/\\includeonly\s*\{([^{}]*)\}/g, (whole, list: string) => {
      const items = list.split(",").map(item => mapping[resolve(file, item)]?.replace(/\.tex$/i, ""));
      if (items.some(item => !item)) throw new Error("An includeonly file is not in the copied TeX tree.");
      return `\\includeonly{${items.join(",")}}`;
    });
    return { path: checkedProjectPath(mapping[file]), data: Buffer.from(text).toString("base64") };
  });
  return { copies, mapping };
}

function copiedSource(source: NotebookSource | undefined, mapping: Record<string, string>, document: ProjectDocument): NotebookSource | undefined {
  if (!source) return;
  // Only an exact unique paragraph is relocated. Ambiguous/stale history stays
  // linked to its original version, never to an invented current passage.
  const relocate = (s: Omit<NotebookSource, "passages">): Omit<NotebookSource, "passages"> => {
    const file = s.file && mapping[s.file], matches = document.paragraphs.filter(p => p.file === file && p.text === s.paragraphText);
    if (matches.length !== 1) return structuredClone(s);
    const p = matches[0];
    return { ...s, rootFile: document.project.mainFile, file: p.file, paragraphId: p.id, nodeId: p.nodeId,
      nodeTitle: document.nodes.find(n => n.id === p.nodeId)?.title ?? s.nodeTitle, revision: document.revision,
      returnAnchor: undefined, duplicateAtCapture: false };
  };
  return { ...relocate(source), passages: source.passages?.map(relocate) };
}

export async function createManuscriptVersion(workspace: string, input: {
  projectId: string; mainFile: string; revision: string; notebookRevision: number; file: string; notebook?: "continue" | "fresh"; preview?: boolean;
}) {
  if (!["continue", "fresh"].includes(input.notebook ?? "continue")) throw new Error("Choose a continued or fresh notebook.");
  if (input.preview !== undefined && typeof input.preview !== "boolean") throw new Error("Preview must be a boolean; omit it only for an explicit creation.");
  const before = await parseProject(workspace, input.projectId), { root } = await getProject(workspace, input.projectId);
  if (before.project.mainFile !== input.mainFile || before.revision !== input.revision) throw new Error("Source changed. Save/reopen this manuscript before making a version.");
  const notes = await readNotebook(workspace, input.projectId);
  const workbench = await readWorkbench(workspace, input.projectId);
  if (notes.revision !== input.notebookRevision) throw new Error("Notebook changed. Wait for saved notes, then make the version again.");
  const carried = notes.entries.filter(entry => !entry.recoveryKey && (entry.manuscriptFile ?? entry.source?.rootFile ?? input.mainFile) === input.mainFile);
  const owners = new Set(carried.map(entry => entry.experimentNotebookId ?? entry.id));
  const busy = () => experimentRuntime().then(runtime => runtime.activeJobs.some(job => job.projectId === input.projectId && owners.has(job.notebookId)));
  if (await busy()) throw new Error("Wait for this manuscript's experiment runs to save before making a version.");
  const sources: Record<string, string> = {}; let bytes = 0;
  for (const file of before.files.filter(file => file.endsWith(".tex"))) {
    const text = await projectTexSource(workspace, input.projectId, file);
    bytes += Buffer.byteLength(text); if (bytes > 20_000_000) throw new Error("TeX sources exceed the 20 MB version-copy limit.");
    sources[file] = text;
  }
  const id = randomUUID(), next = nextManuscriptVersion(before.project), file = checkedProjectPath(input.file), suffix = `v${next.number}-${hash(file).slice(0, 8)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.tex$/.test(path.posix.basename(file))) throw new Error("Use a simple new root filename ending in .tex.");
  const { copies, mapping } = versionSources(sources, input.mainFile, file, suffix);
  for (const copy of copies) if (before.files.some(f => f.toLowerCase() === copy.path.toLowerCase())) throw new Error(`${copy.path} already exists. Choose another filename.`);
  const snapshots = new Map<string, Awaited<ReturnType<typeof readExperiments>>>();
  if (input.notebook !== "fresh") for (const owner of owners) snapshots.set(owner, await readExperiments(workspace, input.projectId, owner));
  const existing = before.project.manuscriptVersions ?? [], now = new Date().toISOString();
  if (existing.length >= 200) throw new Error("This project already has 200 manuscript versions.");
  const current = existing.find(item => item.file === input.mainFile), family = current?.family ?? input.mainFile;
  const version: ManuscriptVersion = { file, family, number: next.number, createdAt: now, previousFile: input.mainFile, notebook: input.notebook ?? "continue" };
  if (input.preview === true) return { preview: true, version, mapping, conversations: input.notebook === "fresh" ? 0 : carried.length, experimentOwners: snapshots.size, sourceRevision: before.revision, notebookRevision: notes.revision, reviewedLocks: writingLocks(workbench.attentionTasks, before, {}).size };
  const versions = [...existing, ...(!current ? [{ file: input.mainFile, family, number: 1, createdAt: now, notebook: "continue" as const }] : []), version];
  const { folder } = await projectStorage(workspace, input.projectId);
  // Exclusive, inspectable preparation. A failed multi-store operation retains
  // these exact copies; it never deletes user edits as a rollback shortcut.
  const journal = path.join(folder, `manuscript-version-${id}.json`);
  await mkdir(folder, { recursive: true });
  await writeFile(journal, JSON.stringify({ version, mapping, sourceRevision: before.revision, notebookRevision: notes.revision, snapshots: [...snapshots].map(([owner, s]) => ({ owner, path: s.path, revision: s.revision })) }, null, 2), { flag: "wx" });
  let prepared = false;
  try {
    await addProjectFiles(workspace, input.projectId, input.revision, input.mainFile, copies); prepared = true;
    const document = publicDocument(await parseProject(workspace, input.projectId, false, file));
    for (const original of Object.keys(mapping)) if (await projectTexSource(workspace, input.projectId, original) !== sources[original]) throw new Error("Original TeX changed while preparing the version.");
    const inheritedLocks = [...writingLocks(workbench.attentionTasks, before, {})].flatMap(([paragraphId, task]) => {
      const old = before.paragraphs.find(p => p.id === paragraphId)!, matches = document.paragraphs.filter(p => p.file === mapping[old.file!] && p.text === old.text);
      if (matches.length !== 1) return []; // Never invent approval of ambiguous text.
      const p = matches[0], snapshot = captureTaskSource(document, document.nodes.find(n => n.id === p.nodeId)!, {}, "paragraph", p.id);
      snapshot.returnAnchor = { rootFile: file, file: p.file, paragraphId: p.id, paragraphText: p.text, revision: document.revision };
      return [{ ...structuredClone(task), id: randomUUID(), nodeId: p.nodeId, paragraphId: p.id, sourceSnapshot: snapshot }];
    });
    const assistance = { ...workbench, attentionTasks: [...workbench.attentionTasks, ...inheritedLocks] };
    validateWorkbench(assistance);
    const ownerMapping = new Map([...owners].map(owner => [owner, randomUUID()]));
    const entryMapping: Record<string, string> = {};
    const clones = input.notebook === "fresh" ? [] : carried.map(entry => {
      const clone = structuredClone(entry), owner = entry.experimentNotebookId ?? entry.id;
      clone.id = randomUUID(); entryMapping[entry.id] = clone.id;
      clone.manuscriptFile = file; clone.experimentNotebookId = ownerMapping.get(owner)!;
      clone.continuedFrom = { entryId: entry.id, notebookId: owner, manuscriptFile: input.mainFile, revision: snapshots.get(owner)!.revision };
      clone.source = copiedSource(entry.source, mapping, document);
      clone.returnView = undefined; clone.createdAt = now; clone.updatedAt = now;
      const turns = new Map((clone.study?.turns ?? []).map(turn => [turn.id, randomUUID()]));
      clone.handoffs = clone.handoffs.map(h => ({ ...h, id: randomUUID(), studyTurnId: h.studyTurnId && turns.get(h.studyTurnId), historyOnly: true }));
      if (clone.study) {
        clone.study.activeTurnId = clone.study.activeTurnId && turns.get(clone.study.activeTurnId);
        clone.study.turns = clone.study.turns.map(turn => ({ ...turn, id: turns.get(turn.id)!, previousTurnId: turn.previousTurnId && turns.get(turn.previousTurnId), closed: true, ticket: undefined, jobId: undefined, subscriptionJobId: undefined,
          ...(turn.status === "queued" ? { status: "failed" as const, error: "Pending request stays in the previous manuscript version." } : {}) }));
      }
      return clone;
    });
    const entries = notes.entries.map(entry => entry.manuscriptFile ? entry : { ...entry, manuscriptFile: entry.source?.rootFile ?? input.mainFile }).concat(clones);
    validateNotebookEntries(entries);
    for (const [owner, snapshot] of snapshots) {
      const notebook = structuredClone(snapshot.notebook);
      notebook.metadata = { ...notebook.metadata, awVersionOrigin: { projectId: input.projectId, notebookId: owner, path: snapshot.path, revision: snapshot.revision, copiedAt: now } };
      await writeExperiments(workspace, input.projectId, ownerMapping.get(owner)!, "", notebook);
    }
    if (await busy()) throw new Error("An experiment started during preparation. Wait for it; prepared copies were kept.");
    for (const [owner, snapshot] of snapshots) if ((await readExperiments(workspace, input.projectId, owner)).revision !== snapshot.revision) throw new Error("Experiment evidence changed during preparation.");
    const latest = await getProject(workspace, input.projectId);
    if (latest.project.mainFile !== input.mainFile || await projectRevision(root, await projectFiles(root)) !== document.revision) throw new Error("Source changed during preparation.");
    const stored = await writeNotebook(workspace, input.projectId, input.notebookRevision, entries);
    const savedWorkbench = inheritedLocks.length ? await writeWorkbench(workspace, input.projectId, workbench.revision, assistance) : workbench;
    const catalogue = await registry(workspace), project = catalogue.projects.find(p => p.id === input.projectId)!;
    if (project.mainFile !== input.mainFile) throw new Error("Another window changed the selected manuscript.");
    project.manuscriptPurposes = { ...project.manuscriptPurposes, [file]: manuscriptPurpose(project, input.mainFile) };
    const overviewTarget = project.manuscriptOverviewTargets?.[input.mainFile];
    if (overviewTarget) project.manuscriptOverviewTargets = { ...project.manuscriptOverviewTargets, [file]: overviewTarget };
    project.manuscriptVersions = versions; project.mainFile = file; project.lastOpenedAt = now;
    await saveRegistry(workspace, catalogue);
    document.project = { ...document.project, manuscriptVersions: versions, manuscriptPurposes: project.manuscriptPurposes, manuscriptOverviewTargets: project.manuscriptOverviewTargets };
    return { document, notebook: stored, workbench: savedWorkbench, version, entryMapping };
  } catch (error) {
    throw new Error(`${(error as Error).message}${prepared ? ` Prepared TeX/notebook copies are kept; inspect ${journal} before retrying. The previous manuscript was not overwritten.` : ""}`);
  }
}
