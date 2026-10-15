// Additive conversation bundles: prepare new owners/evidence, publish the
// guarded catalogue last. Never replace an existing conversation or source.
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes } from "./deviceSync.ts";
import { checkSyncLocalState, saveImmutableSyncArtifact, stagedPlan, syncStateHash } from "./syncStaging.ts";
import { canonical, syncHash, syncLimits, validateSnapshot, validateSyncJson, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { notebookCollectionEvidence, checkCollectionFootprint, type CollectionDescription } from "./syncCollect.ts";
import { acquireRecordLock, withRecordLock } from "./recordLock.ts";
import { getProject } from "./projects.ts";
import { projectDataPath, projectStorage } from "./projectStorage.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { validateNotebookEntries, writeNotebook } from "./notebookStore.ts";
import { manuscriptRoots } from "./manuscriptRoots.ts";
import type { NotebookEntry, NotebookStore } from "../src/types.ts";

const digest = /^[a-f0-9]{64}$/, cataloguePath = "data/notebook.json";
const recordAt = (snapshot: SyncSnapshot, name: string) => snapshot.records.find(record => record.path === name);
const portableId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
function json(record: SyncRecord) {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"))); validateSyncJson(value); return value;
}
function catalogue(snapshot: SyncSnapshot): NotebookStore {
  const record = recordAt(snapshot, cataloguePath); if (!record) return { version: 1, revision: 0, entries: [] };
  const value = json(record);
  if (record.kind !== "catalogue" || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Unsupported conversation catalogue; preserved.");
  validateNotebookEntries(value.entries); return value;
}
async function optional(target: string) {
  try { const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error("Conversation collection cannot follow linked/special paths."); return stat; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function ownerFolder(workspace: string, projectId: string, owner: string, create = false) {
  const home = await realpath(workspace), data = projectDataPath(home, projectId), target = path.join(data, "experiments", owner);
  let current = home;
  for (const part of path.relative(home, path.dirname(target)).split(path.sep)) {
    current = path.join(current, part); const stat = await optional(current);
    if (!stat && create) await mkdir(current); else if (stat && !stat.isDirectory()) throw new Error("An owner parent is not a directory; preserved.");
  }
  await optional(target); return target;
}
const ownerOf = (entry: NotebookEntry) => entry.experimentNotebookId ?? entry.id;
const taskIds = (entry: NotebookEntry) => [...new Set([...(entry.study?.turns.map(turn => turn.id) ?? []), ...entry.handoffs.map(handoff => handoff.id)])];
export function settledSyncEntry(entry: NotebookEntry) {
  if (entry.recoveryKey || !portableId(entry.id) || !portableId(ownerOf(entry))) throw new Error("Choose an ordinary saved conversation with portable IDs, not a recovery draft.");
  if (entry.study?.turns.some(turn => turn.status === "queued" && turn.closed !== true) || entry.handoffs.some(handoff => !handoff.historyOnly && !(handoff.studyTurnId && entry.study?.turns.some(turn => turn.id === handoff.studyTurnId && (turn.closed === true || turn.status !== "queued"))))) throw new Error("Finish or set aside waiting requests on the sending copy before collecting. Requests are never replayed or closed by transfer.");
  for (const turn of entry.study?.turns ?? []) if (turn.ticket?.notebookTarget && (turn.ticket.notebookTarget.entryId !== entry.id || turn.ticket.notebookTarget.notebookId !== ownerOf(entry))) throw new Error("Historical request ownership does not match this conversation.");
}
export interface ConversationCollectionDescription {
  format: "aw-conversation-collection"; version: 1; projectId: string; planId: string; entries: string[];
  deviceId: string; localStateHash: string; beforeCatalogueHash: string; afterCatalogueHash: string; beforeCatalogueRevision: number; afterCatalogueRevision: number;
  entryHashes: Array<{ id: string; sha256: string }>; selection: CollectionDescription["selection"];
  owners: Array<{ id: string; path: string; afterRevision: string; candidateHash: string; runs: Array<{ path: string; sha256: string; bytes: number }> }>;
}
interface Journal { version: 1; format: "aw-conversation-collection-journal"; collection: ConversationCollectionDescription; backupId: string }
const reviewId = (body: ConversationCollectionDescription) => syncHash(canonical(body));
async function selection(workspace: string, projectId: string) {
  const { root, project } = await getProject(workspace, projectId); return { paperRoot: root, mainFile: project.mainFile, engine: project.engine ?? "auto" };
}
async function context(workspace: string, projectId: string, planId: string, entryIds: string[]) {
  if (!Array.isArray(entryIds) || !entryIds.length || entryIds.length > 8 || new Set(entryIds).size !== entryIds.length || entryIds.some(id => !portableId(id))) throw new Error("Choose 1–8 distinct portable conversation IDs.");
  const staged = await stagedPlan(workspace, projectId, planId), [base, local, remote] = staged.inputs;
  const existing = catalogue(local).entries, oldIds = new Set([...catalogue(base).entries, ...existing].map(entry => entry.id)), incoming = catalogue(remote).entries;
  const entries = entryIds.map(id => {
    if (oldIds.has(id)) throw new Error("Conversation already existed on the shared/local copy. This command only adds new conversations, never replaces them.");
    const entry = incoming.find(item => item.id === id); if (!entry) throw new Error("Selected conversation is not in this exact sending snapshot."); settledSyncEntry(entry); return entry;
  });
  const occupiedOwners = new Set([...catalogue(base).entries, ...existing].map(ownerOf)), owners = entries.map(ownerOf);
  if (new Set(owners).size !== owners.length || owners.some(id => occupiedOwners.has(id))) throw new Error("Each selected conversation needs a distinct new experiment owner; existing/shared owners use their own workflow.");
  const occupiedTasks = new Set([...catalogue(base).entries, ...existing].flatMap(taskIds));
  const workbench = recordAt(local, "data/workbench.json"); if (workbench) for (const task of json(workbench).attentionTasks ?? []) occupiedTasks.add(task.id);
  for (const entry of entries) for (const id of taskIds(entry)) { if (occupiedTasks.has(id)) throw new Error("Historical task IDs collide with local or selected work; do not remap them silently."); occupiedTasks.add(id); }
  const sources: Record<string, string> = {};
  for (const record of local.records.filter(item => item.path.startsWith("source/") && item.path.endsWith(".tex"))) sources[record.path.slice(7)] = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"));
  if (Object.keys(sources).length > 500) throw new Error("Use a project with at most 500 TeX files for this bounded import.");
  const roots = manuscriptRoots(sources, true), currentSelection = await selection(workspace, projectId);
  for (const entry of entries) if (!roots.includes(entry.manuscriptFile ?? entry.source?.rootFile ?? currentSelection.mainFile)) throw new Error("A conversation's manuscript root is not available locally. Source collection is separate; do not reassign its root.");
  const evidence = owners.map(owner => notebookCollectionEvidence(staged, `data/experiments/${owner}/notebook.ipynb`));
  let runBytes = 0, runCount = 0;
  for (const item of evidence) {
    const prefix = `data/experiments/${item.notebookId}/`;
    if ([base, local].some(snapshot => snapshot.records.some(record => record.path.startsWith(prefix)))) throw new Error("Experiment owner already has local/shared evidence, even if its card is absent.");
    for (const cell of item.notebook.cells) {
      const id = cell.metadata.paperfocus?.runId;
      if (id && !item.runs.some(record => record.path === `${prefix}runs/${id}.json` && json(record).cellId === cell.id)) throw new Error("New-owner output has unresolved historical run provenance. Collect the owning evidence explicitly; never invent run records.");
    }
    runBytes += item.runs.reduce((sum, record) => sum + record.bytes, 0); runCount += item.runs.length;
  }
  if (runBytes > 32 * 1024 * 1024 || runCount > 200) throw new Error("Bundle run files exceed 200 records / 32 MB. Select fewer conversations.");
  return { projectId, planId: staged.id, localId: staged.plan.local, local, entries, evidence, heldConflicts: staged.plan.conflicts.length, selection: currentSelection };
}
function describe(ctx: Awaited<ReturnType<typeof context>>, before: SyncSnapshot, selected = ctx.selection) {
  if (before.projectId !== ctx.projectId || before.device.id !== ctx.local.device.id || syncStateHash(before) !== syncStateHash(ctx.local)) throw new Error("The local checkpoint changed; compare a fresh descendant first.");
  const original = catalogue(before), after: NotebookStore = { ...original, version: 1, revision: original.revision + 1, entries: [...original.entries, ...ctx.entries] }; validateNotebookEntries(after.entries);
  const body: ConversationCollectionDescription = { format: "aw-conversation-collection", version: 1, projectId: ctx.projectId, planId: ctx.planId, entries: ctx.entries.map(entry => entry.id), deviceId: before.device.id,
    localStateHash: syncStateHash(before), beforeCatalogueHash: recordAt(before, cataloguePath)?.sha256 ?? "", afterCatalogueHash: syncHash(Buffer.from(JSON.stringify(after, null, 2))),
    beforeCatalogueRevision: original.revision, afterCatalogueRevision: after.revision, entryHashes: ctx.entries.map(entry => ({ id: entry.id, sha256: syncHash(canonical(entry)) })), selection: selected,
    owners: ctx.evidence.map(item => ({ id: item.notebookId, path: item.candidate.path, afterRevision: syncHash(Buffer.from(JSON.stringify(item.notebook, null, 2))), candidateHash: item.candidate.sha256,
      runs: item.runs.map(({ path: name, sha256, bytes }) => ({ path: name, sha256, bytes })) })) };
  checkCollectionFootprint(before, [{ path: cataloguePath, bytes: Buffer.byteLength(JSON.stringify(after, null, 2)) },
    ...ctx.evidence.flatMap(item => [{ path: item.candidate.path, bytes: Buffer.byteLength(JSON.stringify(item.notebook, null, 2)) }, ...item.runs])]);
  return { body, after };
}
export async function previewConversationCollection(workspace: string, projectId: string, planId: string, entryIds: string[]) {
  const ctx = await context(workspace, projectId, planId, entryIds), before = await checkSyncLocalState(workspace, projectId, ctx.localId), { body } = describe(ctx, before);
  for (const owner of body.owners) if (await optional(await ownerFolder(workspace, projectId, owner.id))) throw new Error("A destination owner folder already exists, including excluded/hidden work. It was preserved; do not adopt it automatically.");
  return { collectionId: reviewId(body), projectId, planId, entries: ctx.entries.map(entry => ({ id: entry.id, title: entry.title, notebookId: ownerOf(entry) })), owners: body.owners,
    beforeCatalogueRevision: body.beforeCatalogueRevision, afterCatalogueRevision: body.afterCatalogueRevision, heldConflicts: ctx.heldConflicts,
    planned: true, liveImport: false, sourceWrites: false, existingConversationsChanged: false, codeExecuted: false, tasksCompleted: false, approvalGranted: false,
    note: "Save drafts first. Commit adds these settled conversations and evidence only; existing conversations and all source/review policy remain unchanged." };
}
async function readJournal(workspace: string, projectId: string, id: string) {
  const file = await privateSyncPath(workspace, `collections/${projectId}/${id}/journal.json`); if (!await optional(file)) return undefined;
  const saved: Journal = JSON.parse((await readSyncBytes(file, 200000)).toString()); validateSyncJson(saved);
  if (saved?.version !== 1 || saved.format !== "aw-conversation-collection-journal" || saved.collection?.projectId !== projectId || reviewId(saved.collection) !== id || !digest.test(saved.backupId)) throw new Error("Invalid conversation collection journal; preserved.");
  return saved;
}
function fence(current: SyncSnapshot, before: SyncSnapshot, body: ConversationCollectionDescription) {
  if (current.device.id !== body.deviceId) throw new Error("Receiving device identity changed.");
  const expected = new Map(body.owners.flatMap(owner => [{ path: owner.path, sha256: owner.afterRevision }, ...owner.runs]).map(item => [item.path, item.sha256]));
  const cat = recordAt(current, cataloguePath), hash = cat?.sha256 ?? "", original = recordAt(before, cataloguePath);
  if (![body.beforeCatalogueHash, body.afterCatalogueHash].includes(hash)) throw new Error("Conversation catalogue changed during collection. Later work is preserved; do not force a retry.");
  const restored = current.records.flatMap(record => {
    if (expected.has(record.path)) { if (record.sha256 !== expected.get(record.path)) throw new Error("A prepared notebook/run changed. Its current contents were preserved."); return []; }
    return record.path === cataloguePath ? original ? [original] : [] : [record];
  });
  if (syncStateHash({ ...current, records: restored }) !== body.localStateHash) throw new Error("Other saved local work changed during conversation collection. Inspect partial preparations before proceeding.");
  return { published: hash === body.afterCatalogueHash, records: current.records };
}
export async function conversationCollectionStatus(workspace: string, projectId: string, id: string) {
  if (!digest.test(id)) throw new Error("Use an exact collection ID."); await getProject(workspace, projectId);
  const journal = await readJournal(workspace, projectId, id); if (!journal) throw new Error("Conversation collection journal not found.");
  const file = await privateSyncPath(workspace, `collections/${projectId}/${id}/ready.json`), folder = path.dirname(file);
  if (!await optional(file)) return { collectionId: id, folder, entries: journal.collection.entries, completed: false, partial: true, liveImport: null, liveWritesPossible: true, note: "New owners and/or catalogue may be saved already. Inspect or repeat the identical commit; never replace stores manually." };
  const saved = JSON.parse((await readSyncBytes(file, 10000)).toString()); validateSyncJson(saved);
  if (saved?.version !== 1 || saved.collectionId !== id || saved.projectId !== projectId || saved.planId !== journal.collection.planId || saved.catalogueRevision !== journal.collection.afterCatalogueRevision || saved.liveImport !== true
    || canonical(saved.notebookIds) !== canonical(journal.collection.owners.map(owner => owner.id))
    || canonical(saved.entries) !== canonical(journal.collection.entries) || saved.sourceWrites !== false || saved.existingConversationsChanged !== false || saved.codeExecuted !== false || saved.tasksCompleted !== false || saved.approvalGranted !== false || saved.wholeProjectImported !== false) throw new Error("Conversation collection receipt changed; kept for inspection.");
  return { ...saved, folder, completed: true, partial: false };
}
export async function commitConversationCollection(workspace: string, projectId: string, planId: string, entryIds: string[], id: string, hooks: {
  afterBackup?: () => void | Promise<void>; afterOwner?: (count: number) => void | Promise<void>; afterCatalogue?: () => void | Promise<void>;
} = {}) {
  if (!digest.test(id)) throw new Error("Use the exact conversation review ID from preview.");
  const ctx = await context(workspace, projectId, planId, entryIds);
  return withRecordLock(await privateSyncPath(workspace, `collection-operation-${projectId}`, true), async () => {
    const relative = `collections/${projectId}/${id}`, file = await privateSyncPath(workspace, `${relative}/journal.json`), backup = await privateSyncPath(workspace, `${relative}/before.json`);
    let journal = await readJournal(workspace, projectId, id), before: SyncSnapshot;
    if (journal) {
      before = JSON.parse((await readSyncBytes(backup, syncLimits.packetBytes)).toString()); validateSnapshot(before);
      if (before.id !== journal.backupId || reviewId(describe(ctx, before, journal.collection.selection).body) !== id) throw new Error("Conversation collection scope changed. Preserve the journal and inspect.");
      const status = await conversationCollectionStatus(workspace, projectId, id); if (status.completed) return { ...status, alreadyComplete: true, note: "Already collected; later research was not overwritten." };
    } else {
      before = await checkSyncLocalState(workspace, projectId, ctx.localId); const { body } = describe(ctx, before);
      if (reviewId(body) !== id) throw new Error("Conversation review changed. Preview again; no live writes made.");
      for (const owner of body.owners) if (await optional(await ownerFolder(workspace, projectId, owner.id))) throw new Error("A new owner destination already exists. It was preserved.");
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/before.json`, true), Buffer.from(JSON.stringify(before) + "\n"), syncLimits.packetBytes);
      journal = { version: 1, format: "aw-conversation-collection-journal", collection: body, backupId: before.id };
      await saveImmutableSyncArtifact(file, Buffer.from(JSON.stringify(journal) + "\n"), 200000);
    }
    const { body, after } = describe(ctx, before, journal.collection.selection), releases: Array<() => Promise<void>> = [];
    try {
      const check = async () => {
        if (canonical(await selection(workspace, projectId)) !== canonical(body.selection)) throw new Error("Manuscript/root selection changed. Inspect the retained bundle.");
        return fence(await captureSyncSnapshot(workspace, projectId), before, body);
      };
      await projectStorage(workspace, projectId);
      await check(); await hooks.afterBackup?.(); if (hooks.afterBackup) await check();
      for (const owner of [...body.owners].sort((a, b) => a.id.localeCompare(b.id))) {
        const folder = await ownerFolder(workspace, projectId, owner.id, true), claimFile = path.join(folder, ".aw-collection.json"), claim = Buffer.from(JSON.stringify({ version: 1, projectId, owner: owner.id, collectionId: id }) + "\n");
        if (!await optional(folder)) { await mkdir(folder); await saveImmutableSyncArtifact(claimFile, claim, 2000); }
        else if (!await optional(claimFile) || !(await readSyncBytes(claimFile, 2000)).equals(claim)) throw new Error("Owner folder has no matching collection claim. Orphan/other work retained for explicit inspection.");
        releases.push(await acquireRecordLock(path.join(folder, "python-run"), 0));
      }
      let count = 0;
      for (const owner of body.owners) {
        const item = ctx.evidence.find(item => item.notebookId === owner.id)!, store = await readExperiments(workspace, projectId, owner.id);
        if (store.revision && store.revision !== owner.afterRevision) throw new Error("Prepared owner notebook changed; its evidence was preserved.");
        const runs = path.join(path.dirname(store.path), "runs"), priorRuns = await optional(runs);
        if (priorRuns && !priorRuns.isDirectory()) throw new Error("Owner run path is not a folder.");
        if (owner.runs.length && !priorRuns) await mkdir(runs);
        await readExperiments(workspace, projectId, owner.id);
        for (const run of item.runs) await saveImmutableSyncArtifact(path.join(runs, run.path.split("/").at(-1)!), Buffer.from(run.data, "base64"), syncLimits.fileBytes);
        if (!store.revision) await writeExperiments(workspace, projectId, owner.id, "", item.notebook);
        await hooks.afterOwner?.(++count);
      }
      let checked = await check();
      const expected = body.owners.flatMap(owner => [{ path: owner.path, sha256: owner.afterRevision }, ...owner.runs]);
      const confirmed = () => { for (const item of expected) if (checked.records.find(record => record.path === item.path)?.sha256 !== item.sha256) throw new Error("New evidence was not confirmed. Catalogue is not ready for publication."); };
      confirmed();
      if (!checked.published) await writeNotebook(workspace, projectId, body.beforeCatalogueRevision, after.entries, body.beforeCatalogueHash);
      await hooks.afterCatalogue?.(); checked = await check(); confirmed();
      if (!checked.published) throw new Error("Catalogue publication was not confirmed.");
      const receipt = { version: 1, collectionId: id, projectId, planId, entries: body.entries, notebookIds: body.owners.map(owner => owner.id), catalogueRevision: body.afterCatalogueRevision,
        backupPath: backup, completedAt: new Date().toISOString(), liveImport: true, sourceWrites: false, existingConversationsChanged: false, codeExecuted: false, tasksCompleted: false, approvalGranted: false, wholeProjectImported: false };
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/ready.json`), Buffer.from(JSON.stringify(receipt) + "\n"), 10000);
      return { ...receipt, folder: path.dirname(file), completed: true, alreadyComplete: false };
    } catch (error) { throw new Error(`${(error as Error).message} Conversation bundle retained at ${path.dirname(file)}. Partial live owners/catalogue may exist; inspect or resume the identical review, never overwrite them manually.`); }
    finally {
      const failures: unknown[] = [];
      for (const release of releases.reverse()) { try { await release(); } catch (error) { failures.push(error); } }
      if (failures.length) throw new AggregateError(failures, `Some bundle leases changed; all other owned leases were released. Inspect ${path.dirname(file)} and collect-status. No lock was stolen or record rolled back.`);
    }
  });
}
