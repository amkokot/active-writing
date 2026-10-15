// Deliberate, single-notebook collection. No manuscript/catalogue writes,
// deletions, execution, queue completion or all-project synchronization.
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes } from "./deviceSync.ts";
import { saveImmutableSyncArtifact, stagedPlan, syncStateHash, checkSyncLocalState } from "./syncStaging.ts";
import { canonical, syncHash, syncLimits, validateSnapshot, validateSyncJson, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { acquireRecordLock, withRecordLock } from "./recordLock.ts";
import { getProject } from "./projects.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateExperimentNotebook, type ExperimentNotebook } from "../src/experiments.ts";

const digest = /^[a-f0-9]{64}$/;
export function checkCollectionFootprint(before: SyncSnapshot, additions: Array<{ path: string; bytes: number }>) {
  const files = new Map(before.records.map(record => [record.path, record.bytes]));
  for (const record of additions) {
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > syncLimits.fileBytes || record.path.endsWith("/notebook.ipynb") && record.bytes > 5_000_000) throw new Error("Collected files would exceed their saved-record size limit. Nothing imported; choose a smaller scope.");
    files.set(record.path, record.bytes);
  }
  if (files.size > syncLimits.records || [...files.values()].reduce((total, bytes) => total + bytes, 0) > syncLimits.totalBytes) throw new Error("The resulting project would exceed the snapshot file/payload limit. Collect a smaller scope; no live writes made.");
}
export interface CollectionDescription {
  format: "aw-notebook-collection"; version: 1; projectId: string; planId: string; path: string; notebookId: string;
  deviceId: string; localStateHash: string; beforeRevision: string; afterRevision: string; candidateHash: string;
  selection: { paperRoot: string; mainFile: string; engine: string };
  runs: Array<{ path: string; sha256: string; bytes: number }>;
}
interface Journal { version: 1; format: "aw-notebook-collection-journal"; collection: CollectionDescription; backupId: string }
const find = (snapshot: SyncSnapshot, name: string) => snapshot.records.find(record => record.path === name);
function json(record: SyncRecord) {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"))); validateSyncJson(value); return value;
}
async function optional(target: string) {
  try { const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error("Collection cannot use linked/special files."); return stat; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
function owner(name: string) {
  const match = /^data\/experiments\/([A-Za-z0-9_-]{1,64})\/notebook\.ipynb$/.exec(name);
  if (!match || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(match[1])) throw new Error("Collection supports one existing experiment notebook only. Source, catalogue, policy and review records stay held.");
  return match[1];
}
export function notebookCollectionEvidence(staged: Awaited<ReturnType<typeof stagedPlan>>, name: string) {
  const notebookId = owner(name);
  if (staged.plan.conflicts.some(conflict => conflict.path === name || conflict.path.startsWith(`data/experiments/${notebookId}/runs/`))
    || staged.plan.deletions.some(deletion => deletion === name || deletion.startsWith(`data/experiments/${notebookId}/runs/`))) throw new Error("This notebook/run history has unresolved changes or proposed deletions. Keep the detached variants for review.");
  const candidate = staged.plan.records.find(record => record.path === name);
  if (!candidate || candidate.kind !== "experiment") throw new Error("No complete, schema-checked notebook candidate for this exact path.");
  const notebook: ExperimentNotebook = json(candidate); validateExperimentNotebook(notebook);
  const runs = staged.plan.records.filter(record => record.path.startsWith(`data/experiments/${notebookId}/runs/`));
  for (const record of runs) {
    const saved = json(record), filename = record.path.split("/").at(-1)!;
    if (record.kind !== "run" || typeof saved.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(saved.id) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(saved.id)
      || ![`${saved.id}.json`, `${saved.id}.collection.json`].includes(filename) || ["working", "queued"].includes(saved.status)
      || filename.endsWith(".collection.json") && (!['ready', 'failed', 'cancelled'].includes(saved.status) || typeof saved.notebookUpdated !== "boolean")
      || !filename.endsWith(".collection.json") && typeof saved.cellId !== "string") throw new Error("Invalid or unsettled run record. No code will be replayed.");
  }
  if (runs.length > 200 || runs.reduce((bytes, record) => bytes + record.bytes, 0) > 32 * 1024 * 1024) throw new Error("Collect a smaller notebook/run set (200 records / 32 MB).");
  // Keep only the local checkpoint and selected evidence after history validation,
  // not three full packets plus every unrelated candidate for the whole operation.
  return { id: staged.id, projectId: staged.plan.projectId, localId: staged.plan.local, local: staged.inputs[1], heldConflicts: staged.plan.conflicts.length, notebookId, candidate, notebook, runs };
}
async function context(workspace: string, projectId: string, planId: string, name: string) {
  return notebookCollectionEvidence(await stagedPlan(workspace, projectId, planId), name);
}
export async function savedCollectionKind(workspace: string, projectId: string, id: string) {
  if (!digest.test(id)) throw new Error("Use the exact collection ID.");
  const file = await privateSyncPath(workspace, `collections/${projectId}/${id}/journal.json`), saved = JSON.parse((await readSyncBytes(file, 200000)).toString()); validateSyncJson(saved);
  if (saved.format === "aw-notebook-collection-journal") return "notebook";
  if (saved.format === "aw-conversation-collection-journal") return "conversations";
  throw new Error("Unknown collection journal; preserved for inspection.");
}
function describe(ctx: Awaited<ReturnType<typeof context>>, before: SyncSnapshot, selection: CollectionDescription["selection"]): CollectionDescription {
  if (before.projectId !== ctx.projectId || before.device.id !== ctx.local.device.id || syncStateHash(before) !== syncStateHash(ctx.local)) throw new Error("The local checkpoint changed; compare a fresh descendant first.");
  const previous = find(before, ctx.candidate.path), catalogue = find(before, "data/notebook.json");
  if (!previous || previous.kind !== "experiment" || !catalogue || catalogue.kind !== "catalogue") throw new Error("First collection requires an existing notebook and its owning conversation.");
  const entries = json(catalogue).entries; validateNotebookEntries(entries);
  if (!entries.some(entry => (entry.experimentNotebookId ?? entry.id) === ctx.notebookId)) throw new Error("The target notebook has no current conversation owner. Use collect --entries for distinct new conversations/owners.");
  const old: ExperimentNotebook = json(previous); validateExperimentNotebook(old);
  for (const cell of old.cells) {
    const next = ctx.notebook.cells.find(item => item.id === cell.id);
    if (!next || cell.cell_type !== next.cell_type) throw new Error("Removed cells or changed cell kinds need a separate explicit workflow; original evidence was retained.");
    if (['filed', 'deleted'].some(key => cell.metadata.paperfocus?.[key] && !next.metadata.paperfocus?.[key])) throw new Error("Collection cannot resurrect filed/trashed evidence.");
  }
  for (const cell of ctx.notebook.cells) {
    const runId = cell.metadata.paperfocus?.runId, previousId = old.cells.find(item => item.id === cell.id)?.metadata.paperfocus?.runId;
    if (runId && runId !== previousId) {
      const name = `data/experiments/${ctx.notebookId}/runs/${runId}.json`, saved = ctx.runs.find(record => record.path === name) ?? find(before, name);
      if (!saved || json(saved).cellId !== cell.id) throw new Error("New output provenance has no matching immutable run for this cell.");
    }
  }
  const runs = ctx.runs.filter(record => {
    const prior = find(before, record.path);
    if (prior && prior.sha256 !== record.sha256) throw new Error("Existing run history cannot be replaced.");
    return !prior;
  }).map(({ path: name, sha256, bytes }) => ({ path: name, sha256, bytes }));
  checkCollectionFootprint(before, [{ path: ctx.candidate.path, bytes: Buffer.byteLength(JSON.stringify(ctx.notebook, null, 2)) }, ...runs]);
  return { format: "aw-notebook-collection", version: 1, projectId: ctx.projectId, planId: ctx.id, path: ctx.candidate.path, notebookId: ctx.notebookId,
    deviceId: before.device.id, localStateHash: syncStateHash(before), beforeRevision: previous.sha256,
    afterRevision: syncHash(Buffer.from(JSON.stringify(ctx.notebook, null, 2))), candidateHash: ctx.candidate.sha256, selection, runs };
}
const collectionId = (description: CollectionDescription) => syncHash(canonical(description));
async function selection(workspace: string, projectId: string) {
  const { project, root } = await getProject(workspace, projectId); return { paperRoot: root, mainFile: project.mainFile, engine: project.engine ?? "auto" };
}
function summary(ctx: Awaited<ReturnType<typeof context>>, before: SyncSnapshot, description: CollectionDescription) {
  const old: ExperimentNotebook = json(find(before, description.path)!), byId = new Map(old.cells.map(cell => [cell.id, cell]));
  return { collectionId: collectionId(description), projectId: description.projectId, planId: description.planId, path: description.path, notebookId: description.notebookId,
    beforeRevision: description.beforeRevision, afterRevision: description.afterRevision, candidateHash: description.candidateHash,
    changedCells: ctx.notebook.cells.filter(cell => canonical(cell) !== canonical(byId.get(cell.id))).map(cell => cell.id),
    runFiles: description.runs, heldConflicts: ctx.heldConflicts, planned: true, liveImport: false,
    sourceWrites: false, catalogueWrites: false, codeExecuted: false, approvalGranted: false,
    note: "Save drafts first. Exact-review commit collects this notebook only; other project changes remain held. Scientific findings and publication words are not approved." };
}
export async function previewNotebookCollection(workspace: string, projectId: string, planId: string, name: string) {
  const ctx = await context(workspace, projectId, planId, name), before = await checkSyncLocalState(workspace, projectId, ctx.localId);
  const description = describe(ctx, before, await selection(workspace, projectId));
  return summary(ctx, before, description);
}
async function readJournal(workspace: string, projectId: string, id: string) {
  const file = await privateSyncPath(workspace, `collections/${projectId}/${id}/journal.json`);
  if (!await optional(file)) return undefined;
  const journal: Journal = JSON.parse((await readSyncBytes(file, 100000)).toString()); validateSyncJson(journal);
  if (journal?.version !== 1 || journal.format !== "aw-notebook-collection-journal" || journal.collection?.projectId !== projectId || collectionId(journal.collection) !== id || !digest.test(journal.backupId)) throw new Error("Invalid collection journal. Kept for inspection, never repaired automatically.");
  return journal;
}
/** Permit only this journal's exact copied runs and before/after target bytes.
 * All unrelated authored records and source remain fenced; queue clock stays local. */
function fence(current: SyncSnapshot, before: SyncSnapshot, description: CollectionDescription) {
  if (current.device.id !== description.deviceId) throw new Error("Receiving device identity changed.");
  const expected = new Map(description.runs.map(record => [record.path, record.sha256]));
  const target = find(current, description.path), original = find(before, description.path)!;
  if (!target || ![description.beforeRevision, description.afterRevision].includes(target.sha256)) throw new Error("Notebook changed during collection. Current and proposed evidence are preserved; do not force a retry.");
  const restored = current.records.flatMap(record => {
    if (expected.has(record.path)) { if (record.sha256 !== expected.get(record.path)) throw new Error("A prepared run changed. Both copies retained."); return []; }
    return [record.path === description.path ? original : record];
  });
  if (syncStateHash({ ...current, records: restored }) !== description.localStateHash) throw new Error("Other saved local work changed during collection. Partial preparations retained; inspect before proceeding.");
  return target.sha256 === description.afterRevision;
}
export async function notebookCollectionStatus(workspace: string, projectId: string, id: string) {
  if (!digest.test(id)) throw new Error("Use the exact collection ID."); await getProject(workspace, projectId);
  const journal = await readJournal(workspace, projectId, id); if (!journal) throw new Error("Collection journal not found.");
  const ready = await privateSyncPath(workspace, `collections/${projectId}/${id}/ready.json`), folder = path.dirname(ready);
  if (!await optional(ready)) return { collectionId: id, folder, path: journal.collection.path, completed: false, partial: true, liveImport: null, liveWritesPossible: true, note: "Inspect the journal/backup and use the identical commit to resume. Partial live writes may exist; never replace files manually." };
  const receipt = JSON.parse((await readSyncBytes(ready, 10000)).toString()); validateSyncJson(receipt);
  if (receipt?.version !== 1 || receipt.collectionId !== id || receipt.projectId !== projectId || receipt.planId !== journal.collection.planId || receipt.revision !== journal.collection.afterRevision || receipt.path !== journal.collection.path || receipt.codeExecuted !== false || receipt.sourceWrites !== false || receipt.catalogueWrites !== false || receipt.approvalGranted !== false || receipt.liveImport !== true) throw new Error("Collection receipt changed. Kept for inspection.");
  return { ...receipt, folder, completed: true, partial: false };
}
export async function commitNotebookCollection(workspace: string, projectId: string, planId: string, name: string, reviewId: string, hooks: {
  afterBackup?: () => void | Promise<void>; afterRuns?: () => void | Promise<void>; afterSave?: () => void | Promise<void>;
} = {}) {
  if (!digest.test(reviewId)) throw new Error("Use the exact collection review ID from preview.");
  const ctx = await context(workspace, projectId, planId, name);
  return withRecordLock(await privateSyncPath(workspace, `collection-operation-${projectId}`, true), async () => {
    let journal = await readJournal(workspace, projectId, reviewId), before: SyncSnapshot;
    const relative = `collections/${projectId}/${reviewId}`, journalFile = await privateSyncPath(workspace, `${relative}/journal.json`), backupFile = await privateSyncPath(workspace, `${relative}/before.json`);
    if (journal) {
      before = JSON.parse((await readSyncBytes(backupFile, syncLimits.packetBytes)).toString()); validateSnapshot(before);
      if (before.id !== journal.backupId || journal.collection.planId !== planId || journal.collection.path !== name
        || collectionId(describe(ctx, before, journal.collection.selection)) !== reviewId) throw new Error("Collection scope/inputs changed. Preserve the journal and preview a fresh plan.");
      const status = await notebookCollectionStatus(workspace, projectId, reviewId);
      if (status.completed) return { ...status, alreadyComplete: true, note: "This copy was already collected; later local edits were not overwritten." };
    } else {
      before = await checkSyncLocalState(workspace, projectId, ctx.localId);
      const description = describe(ctx, before, await selection(workspace, projectId));
      if (collectionId(description) !== reviewId) throw new Error("Collection review changed. Preview again; no live writes made.");
      if (description.beforeRevision === description.afterRevision && !description.runs.length) throw new Error("No notebook/run changes to collect.");
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/before.json`, true), Buffer.from(JSON.stringify(before) + "\n"), syncLimits.packetBytes);
      journal = { version: 1, format: "aw-notebook-collection-journal", collection: description, backupId: before.id };
      await saveImmutableSyncArtifact(journalFile, Buffer.from(JSON.stringify(journal) + "\n"), 100000);
    }
    const description = journal.collection, store = await readExperiments(workspace, projectId, description.notebookId);
    const release = await acquireRecordLock(path.join(path.dirname(store.path), "python-run"), 0);
    try {
      const check = async () => {
        if (canonical(await selection(workspace, projectId)) !== canonical(description.selection)) throw new Error("Paper root/compiler selection changed. Inspect the retained collection first.");
        const current = await captureSyncSnapshot(workspace, projectId); return { after: fence(current, before, description), current };
      };
      let checked = await check();
      if (hooks.afterBackup) { await hooks.afterBackup(); checked = await check(); }
      const runsFolder = path.join(path.dirname(store.path), "runs");
      const existingRuns = await optional(runsFolder);
      if (existingRuns && !existingRuns.isDirectory()) throw new Error("Run storage is not a folder. It was preserved.");
      if (description.runs.length && !existingRuns) await mkdir(runsFolder);
      // readExperiments checks all owning directories, including runs, for links.
      await readExperiments(workspace, projectId, description.notebookId);
      for (const run of description.runs) {
        const record = ctx.runs.find(item => item.path === run.path)!;
        await saveImmutableSyncArtifact(path.join(runsFolder, run.path.split("/").at(-1)!), Buffer.from(record.data, "base64"), syncLimits.fileBytes);
      }
      await hooks.afterRuns?.();
      if (description.runs.length || hooks.afterRuns) checked = await check();
      if (!checked.after) await writeExperiments(workspace, projectId, description.notebookId, description.beforeRevision, ctx.notebook);
      await hooks.afterSave?.();
      checked = await check();
      if (!checked.after) throw new Error("Notebook save was not confirmed.");
      for (const run of description.runs) if (find(checked.current, run.path)?.sha256 !== run.sha256) throw new Error("Copied run was not confirmed.");
      const receipt = { version: 1, collectionId: reviewId, projectId, planId, path: name, notebookId: description.notebookId, revision: description.afterRevision, wholeProjectImported: false,
        backupPath: backupFile, runFilesAdded: description.runs.length, completedAt: new Date().toISOString(), liveImport: true, sourceWrites: false, catalogueWrites: false, codeExecuted: false, approvalGranted: false };
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/ready.json`), Buffer.from(JSON.stringify(receipt) + "\n"), 10000);
      return { ...receipt, folder: path.dirname(journalFile), completed: true, alreadyComplete: false };
    } catch (error) {
      throw new Error(`${(error as Error).message} Collection retained at ${path.dirname(journalFile)}. Partial live notebook/run writes may exist; inspect or resume the exact review, never overwrite them manually.`);
    } finally { await release(); }
  });
}
