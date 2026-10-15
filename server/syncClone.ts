// First-copy import into an exclusively NEW research-data home. No live merge,
// registry replacement, process replay, credential transfer or code installation.
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { initializeSyncDevice, privateSyncPath, readSyncBytes, saveSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { saveImmutableSyncArtifact, stageSyncSnapshot } from "./syncStaging.ts";
import { canonical, safeSyncId, safeSyncPath, syncHash, syncLimits, validateSnapshot, validateSyncJson, type SyncSnapshot } from "./syncProtocol.ts";
import { withRecordLock } from "./recordLock.ts";
import { projectCatalogue } from "./projectStorage.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { validateExperimentNotebook } from "../src/experiments.ts";
import { manuscriptRoots } from "./manuscriptRoots.ts";
import type { NotebookEntry, PaperProject } from "../src/types.ts";
import { appCodeRoot } from "./appPaths.ts";

export interface CloneOptions { destination: string; mainFile: string; label: string; engine?: PaperProject["engine"] }
const ownedFolders = new Set(["experiments", "handoffs", "references", "research", "study-evidence", "trial-evidence"]);
function portable(name: string) {
  return typeof name === "string" && safeSyncPath(`source/${name}`) && name.split("/").length <= 32 && name.split("/").every(part => !part.startsWith(".") && !/[<>"|?*]/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
async function info(target: string) {
  try { const stat = await lstat(target); if (stat.isSymbolicLink()) throw new Error("First copy cannot use linked destinations."); return stat; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
function json(snapshot: SyncSnapshot, name: string) {
  const record = snapshot.records.find(item => item.path === name); if (!record) return undefined;
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"))); validateSyncJson(value); return value;
}
function inspectPacket(snapshot: SyncSnapshot, options: CloneOptions) {
  validateSnapshot(snapshot);
  if (!portable(snapshot.projectId)) throw new Error("Project identity is not portable to a new desktop.");
  if (!portable(options.mainFile) || !options.mainFile.endsWith(".tex") || !options.label?.trim() || options.label.length > 60 || /[\x00-\x1f]/.test(options.label) || options.engine && !["pdflatex", "xelatex", "lualatex"].includes(options.engine)) throw new Error("Choose an exact TeX root, device name and supported compiler.");
  const sources: Record<string, string> = {}, notebooks = new Set<string>(), pending: string[] = []; let cells = 0, runs = 0;
  const files = new Set(snapshot.records.map(record => record.path.toLowerCase())), components = new Map<string, string>();
  for (const record of snapshot.records) {
    const [namespace, ...parts] = record.path.split("/"), name = parts.join("/");
    if (!portable(name)) throw new Error(`This path is not portable to a new desktop: ${record.path}. Nothing copied.`);
    const segments = record.path.split("/");
    for (let length = 1; length <= segments.length; length++) {
      const prefix = segments.slice(0, length).join("/"), lower = prefix.toLowerCase(), previous = components.get(lower);
      if (previous && previous !== prefix || length < segments.length && files.has(lower)) throw new Error("Conflicting file/folder paths or letter casing are not portable. Nothing copied.");
      components.set(lower, prefix);
    }
    if (namespace === "source") {
      const kind = /\.(tex|bib|md|txt|py|json|yaml|yml|sty|cls)$/i.test(name) ? "source" : "asset";
      if (record.kind !== kind) throw new Error("Invalid source record classification.");
      if (name.endsWith(".tex")) sources[name] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(record.data, "base64"));
    } else if (namespace === "project") {
      if (record.path !== "project/manuscripts.json" || record.kind !== "policy") throw new Error("Unsupported first-copy policy record.");
    } else if (namespace !== "data" || !["notebook.json", "workbench.json"].includes(name) && !ownedFolders.has(parts[0])) throw new Error("Unsupported first-copy data namespace.");
    if (namespace === "data") {
      const kind = name === "notebook.json" ? "catalogue" : name === "workbench.json" ? "review"
        : /^experiments\/[^/]+\/notebook\.ipynb$/.test(name) ? "experiment" : /^experiments\/[^/]+\/runs\/[^/]+\.json$/.test(name) ? "run"
        : /\.(png|jpe?g|webp|gif|pdf|svg|npy|npz|csv)$/i.test(name) ? "asset" : "record";
      if (record.kind !== kind) throw new Error("Invalid research record classification; no schema checks were bypassed.");
    }
    if (record.kind === "experiment") {
      const owner = parts[1]; if (!safeSyncId(owner) || owner.length > 64) throw new Error("Invalid experiment owner.");
      const notebook = json(snapshot, record.path); validateExperimentNotebook(notebook); notebooks.add(owner); cells += notebook.cells.length;
    }
    if (record.kind === "run") {
      const saved = json(snapshot, record.path), filename = parts.at(-1)!;
      if (!saved || !safeSyncId(saved.id) || ![`${saved.id}.json`, `${saved.id}.collection.json`].includes(filename) || filename === `${saved.id}.json` && typeof saved.cellId !== "string") throw new Error("Invalid saved-run identity; original packet preserved.");
      if (saved.status === "working" || saved.status === "queued") pending.push(record.path);
      if (!filename.endsWith(".collection.json")) runs++;
    }
  }
  if (Object.keys(sources).length > 500) throw new Error("First copy supports up to 500 TeX files; use the paper's smaller project scope.");
  const roots = manuscriptRoots(sources, true);
  if (!roots.includes(options.mainFile)) throw new Error("Choose an independent TeX root present in the packet, not an included section.");
  const policy = json(snapshot, "project/manuscripts.json");
  if (!policy || typeof policy.name !== "string" || !policy.name.trim() || policy.name.length > 200 || typeof policy.createdAt !== "string" || !Number.isFinite(Date.parse(policy.createdAt))
    || Object.keys(policy).some(key => !["name", "createdAt", "manuscriptPurposes", "manuscriptVersions", "manuscriptOverviewTargets"].includes(key))) throw new Error("Invalid or newer manuscript policy. No copy made.");
  for (const field of ["manuscriptPurposes", "manuscriptOverviewTargets"]) {
    const map = policy[field];
    if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 1000) throw new Error("Invalid manuscript policy map.");
    for (const [name, value] of Object.entries(map)) if (!portable(name) || !name.endsWith(".tex") || field === "manuscriptPurposes" && (typeof value !== "string" || !["notes", "overview", "publication"].includes(value))
      || field === "manuscriptOverviewTargets" && (typeof value !== "string" || !portable(value) || !value.endsWith(".tex"))) throw new Error("Unsafe purpose/overview metadata.");
  }
  if (!Array.isArray(policy.manuscriptVersions) || policy.manuscriptVersions.length > 1000) throw new Error("Invalid manuscript lineage.");
  for (const version of policy.manuscriptVersions) if (!version || !portable(version.file) || !version.file.endsWith(".tex") || typeof version.family !== "string" || !version.family || version.family.length > 100 || !Number.isSafeInteger(version.number) || version.number < 1 || typeof version.createdAt !== "string" || !Number.isFinite(Date.parse(version.createdAt))
    || !["fresh", "continue"].includes(version.notebook) || version.previousFile !== undefined && (!portable(version.previousFile) || !version.previousFile.endsWith(".tex"))) throw new Error("Invalid version ancestry.");
  const catalogue = json(snapshot, "data/notebook.json");
  if (catalogue) {
    if (catalogue.version !== 1 || !Number.isSafeInteger(catalogue.revision) || catalogue.revision < 0) throw new Error("Unsupported notebook catalogue.");
    validateNotebookEntries(catalogue.entries);
    for (const entry of catalogue.entries as NotebookEntry[]) {
      const owner = entry.experimentNotebookId ?? entry.id;
      if (!safeSyncId(owner) || owner.length > 64) throw new Error("Invalid notebook owner identity.");
      for (const turn of entry.study?.turns ?? []) if (turn.status === "queued" && !turn.closed) pending.push(`conversation ${entry.id}, request ${turn.id}`);
      if (entry.handoffs.some(item => !item.historyOnly && !item.studyTurnId) && !entry.reply.trim() && entry.status === "open") pending.push(`conversation ${entry.id}, legacy handoff`);
    }
  }
  const workbench = json(snapshot, "data/workbench.json");
  if (workbench) {
    if (workbench.version !== 1 || !Number.isSafeInteger(workbench.revision) || workbench.revision < 0) throw new Error("Unsupported assistance store.");
    validateWorkbench(workbench);
    for (const task of workbench.attentionTasks) if (["queued", "working"].includes(task.status) && !task.reminder && task.review?.kind !== "comment" && task.writing?.kind !== "paragraph") pending.push(`manuscript request ${task.id}`);
  }
  const project: PaperProject = { id: snapshot.projectId, name: policy.name, folder: "paper", mainFile: options.mainFile, createdAt: policy.createdAt,
    ...(options.engine ? { engine: options.engine } : {}), manuscriptPurposes: policy.manuscriptPurposes, manuscriptVersions: policy.manuscriptVersions, manuscriptOverviewTargets: policy.manuscriptOverviewTargets };
  return { project, roots, pending, cells, notebooks: notebooks.size, runs, sourceFiles: snapshot.records.filter(record => record.path.startsWith("source/")).length };
}
async function newHome(options: CloneOptions) {
  const requested = path.resolve(options.destination), parent = await realpath(path.dirname(requested));
  if (!portable(path.basename(requested))) throw new Error("Choose a new, ordinary data-home folder.");
  // Validate every existing parent, not just its resolved final target.
  let current = path.parse(requested).root;
  for (const part of path.relative(current, path.dirname(requested)).split(path.sep).filter(Boolean)) { current = path.join(current, part); await info(current); }
  const destination = path.join(parent, path.basename(requested)), existing = await info(destination);
  if (existing && !existing.isDirectory()) throw new Error("Destination is an existing file. It was preserved.");
  return { destination, existing: Boolean(existing) };
}
async function verifyCopiedFiles(home: string, projectId: string, expected: Array<{ path: string; bytes: Buffer }>) {
  const wanted = new Map(expected.map(file => [file.path, file.bytes])), seen = new Set<string>(); let visited = 0;
  async function walk(relative: string) {
    if (++visited > 10000) throw new Error("First-copy verification exceeded its bounded file window.");
    const target = path.join(home, ...relative.split("/")), stat = await info(target);
    if (stat?.isDirectory()) for (const entry of await readdir(target)) await walk(`${relative}/${entry}`);
    else if (stat?.isFile()) {
      const original = wanted.get(relative);
      if (!original || !(await readSyncBytes(target, syncLimits.fileBytes)).equals(original)) throw new Error(`Copied records changed during preparation: ${relative}. Copy retained; no overwrite allowed.`);
      seen.add(relative);
    } else throw new Error("A copied file/folder disappeared or changed type.");
  }
  await walk("paper");
  await walk(`.paperfocus/project-data/${projectId}`);
  await walk("AGENTS.md");
  if (seen.size !== wanted.size) throw new Error("Incomplete first copy. Original packet retained.");
}
export async function previewSyncClone(snapshot: SyncSnapshot, options: CloneOptions) {
  const packet = inspectPacket(snapshot, options), target = await newHome(options);
  const normalized = { destination: target.destination, mainFile: options.mainFile, label: options.label.trim(), ...(options.engine ? { engine: options.engine } : {}) };
  const planId = syncHash(canonical({ version: 1, snapshotId: snapshot.id, projectId: snapshot.projectId, options: normalized, codeRoot: appCodeRoot }));
  return { planId, snapshotId: snapshot.id, projectId: snapshot.projectId, options: normalized, destinationExists: target.existing,
    project: packet.project, roots: packet.roots, pending: packet.pending, counts: { sourceFiles: packet.sourceFiles, notebooks: packet.notebooks, cells: packet.cells, runs: packet.runs },
    missingHistory: [...snapshot.ancestors], sourceDevice: snapshot.device, codeRoot: appCodeRoot, remoteEnabled: false, codeExecution: false, initialCopyOnly: true };
}
function cloneGuide(home: string, codeRoot: string, project: PaperProject) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return `# Active Writing research workspace

This is an Aw research-data home, not the app-code installation.
Data home: ${home}
App code and tools: ${codeRoot}
Project registry ID: ${project.id}; selected TeX root: ${project.mainFile}
Paper files: paper/; Aw records: .paperfocus/project-data/${project.id}/.

Before work, read the installed code's AGENTS.md and docs/AGENT_GUIDE.md.
For notebook/research work, read the relevant docs/RESEARCH_WORKFLOW.md sections;
for publication writing, read docs/WRITING_WORKFLOW.md. Those paths belong to the
app-code folder above, not this data home. The human's narrower request controls
scope. Re-read the owning root's current writing policy and confirm conversation
identity. Publication text/locks keep their human-review guards; do not assume
that copied notes, outputs or task history are approved or proven.

Run tools by their installed code path with explicit data-home scope. No service
or UI is needed for ordinary offline work. For example, after choosing the owner:

node ${quote(path.join(codeRoot, "scripts/awResearch.ts"))} inspect --offline --workspace ${quote(home)} --project ${project.id} --entry CONFIRMED_CONVERSATION_ID

Use revision-guarded notebook tools, retain cell IDs and full evidence/provenance,
and keep one writer per owner. Do not replace live JSON, flatten source includes,
resume copied requests, execute cells, install dependencies, restart services,
upload, push or connect another computer without the human's applicable scope.
Read docs/DEVICE_SYNC.md before a transfer; detached merge proposals are not live
imports. Existing saved run paths are historical, not the current interpreter.
If the app code moves later, update this local pointer deliberately.
`;
}
export async function commitSyncClone(snapshot: SyncSnapshot, options: CloneOptions, expectedPlan: string, hooks: { afterFile?: (count: number) => void | Promise<void> } = {}) {
  const plan = await previewSyncClone(snapshot, options);
  if (plan.planId !== expectedPlan) throw new Error("Clone scope changed. Preview again; no destination changes made.");
  if (plan.pending.length) throw new Error(`Use a settled first-copy checkpoint; pending requests are not replayed: ${plan.pending.slice(0, 8).join("; ")}. No destination changes made.`);
  const home = plan.options.destination;
  let fresh = false;
  try { await mkdir(home); fresh = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const journalPath = await privateSyncPath(home, "clone.json", fresh);
  if (!fresh && !await info(journalPath)) throw new Error("First copy needs a NEW data home, not an existing app, project or empty folder. Existing contents preserved.");
  const journal = fresh ? { version: 1, format: "aw-first-copy", planId: plan.planId, snapshotId: snapshot.id, projectId: snapshot.projectId, options: plan.options, codeRoot: plan.codeRoot, createdAt: new Date().toISOString() }
    : JSON.parse((await readSyncBytes(journalPath, 10000)).toString());
  validateSyncJson(journal);
  if (journal.version !== 1 || journal.format !== "aw-first-copy" || journal.planId !== plan.planId || journal.snapshotId !== snapshot.id || journal.projectId !== snapshot.projectId || journal.codeRoot !== plan.codeRoot || canonical(journal.options) !== canonical(plan.options) || !Number.isFinite(Date.parse(journal.createdAt))) throw new Error("Destination has another or damaged clone journal. It was preserved.");
  await saveImmutableSyncArtifact(journalPath, Buffer.from(JSON.stringify(journal) + "\n"), 10000);
  return withRecordLock(await privateSyncPath(home, "clone-operation"), async () => {
    const readyPath = await privateSyncPath(home, "clone-ready.json");
    if (await info(readyPath)) {
      const ready = JSON.parse((await readSyncBytes(readyPath, 5000)).toString());
      if (ready.version !== 1 || ready.planId !== plan.planId || ready.snapshotId !== snapshot.id || ready.projectId !== snapshot.projectId || (await syncStatus(home)).device?.id !== ready.deviceId) throw new Error("Invalid first-copy receipt/device. No existing work changed.");
      return { ...ready, workspace: home, alreadyComplete: true, noExistingWorkChanged: true };
    }
    const device = await initializeSyncDevice(home, plan.options.label);
    if (device.device?.id === snapshot.device.id) throw new Error("Destination copied the source device identity. It must have its own identity.");
    const expected: Array<{ path: string; bytes: Buffer }> = snapshot.records.filter(record => !record.path.startsWith("project/")).map(record => ({
      path: record.path.startsWith("source/") ? `paper/${record.path.slice(7)}` : `.paperfocus/project-data/${snapshot.projectId}/${record.path.slice(5)}`, bytes: Buffer.from(record.data, "base64") }));
    expected.push({ path: `.paperfocus/project-data/${snapshot.projectId}/project.json`, bytes: Buffer.from(JSON.stringify(projectCatalogue(plan.project, journal.createdAt), null, 2)) });
    expected.push({ path: "AGENTS.md", bytes: Buffer.from(cloneGuide(home, plan.codeRoot, plan.project)) });
    let count = 0;
    for (const file of expected) {
      const target = path.join(home, ...file.path.split("/"));
      // Creating destination parents through privateSyncPath's validated walk
      // is not possible outside its namespace; guard each new-home component.
      let directory = home;
      for (const part of file.path.split("/").slice(0, -1)) {
        directory = path.join(directory, part); const prior = await info(directory);
        if (!prior) await mkdir(directory); else if (!prior.isDirectory()) throw new Error("A clone destination parent is not a folder.");
      }
      await saveImmutableSyncArtifact(target, file.bytes, syncLimits.fileBytes); await hooks.afterFile?.(++count);
    }
    const registryFile = path.join(home, ".paperfocus/projects.json");
    await saveImmutableSyncArtifact(registryFile, Buffer.from(JSON.stringify({ activeId: plan.projectId, projects: [plan.project] }, null, 2)), 100000);
    const saved = await saveSyncSnapshot(home, snapshot); await stageSyncSnapshot(home, snapshot.projectId, snapshot);
    await verifyCopiedFiles(home, snapshot.projectId, expected);
    if (!(await readSyncBytes(registryFile, 100000)).equals(Buffer.from(JSON.stringify({ activeId: plan.projectId, projects: [plan.project] }, null, 2)))) throw new Error("First-copy registration changed. It was preserved; no completion claimed.");
    const ready = { version: 1, planId: plan.planId, snapshotId: snapshot.id, projectId: snapshot.projectId, deviceId: device.device!.id,
      mainFile: plan.options.mainFile, codeRoot: plan.codeRoot, snapshotPath: saved.path, initialCopyOnly: true, codeExecution: false, remoteEnabled: false, missingHistory: plan.missingHistory };
    await saveImmutableSyncArtifact(readyPath, Buffer.from(JSON.stringify(ready) + "\n"), 5000);
    return { ...ready, workspace: home, alreadyComplete: false, noExistingWorkChanged: true };
  });
}
