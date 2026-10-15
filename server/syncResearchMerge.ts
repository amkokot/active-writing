// Recoverable research reconciliation. Protected decisions are deliberately
// not imported: no purpose changes, approvals, task completion, code execution,
// deletion, or silent replacement of ownership.
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes, saveSyncSnapshot } from "./deviceSync.ts";
import { checkSyncLocalState, saveImmutableSyncArtifact, stagedPlan, syncStateHash, stageSyncSnapshot } from "./syncStaging.ts";
import { canonical, makeMergedSnapshot, makeSnapshot, syncHash, syncLimits, syncRecord, validateSnapshot, validateSyncJson, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { syncLockedFiles, readReconciliation } from "./syncReconcile.ts";
import { mergeLiteralText } from "./syncText.ts";
import { checkCollectionFootprint, notebookCollectionEvidence } from "./syncCollect.ts";
import { settledSyncEntry } from "./syncConversationCollect.ts";
import { readNotebook, validateNotebookEntries, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { validateExperimentNotebook } from "../src/experiments.ts";
import { getProject } from "./projects.ts";
import { projectStorage } from "./projectStorage.ts";
import { manuscriptRoots } from "./manuscriptRoots.ts";
import { checkedProjectPath } from "./projectFiles.ts";
import { guardedFileHash, guardedTarget, saveGuardedFile } from "./guardedFile.ts";
import { acquireRecordLock, withRecordLock } from "./recordLock.ts";
import { rememberSyncHead, semanticSyncHash, semanticReviewContent } from "./syncExchange.ts";
import type { NotebookEntry, NotebookStore } from "../src/types.ts";

const catPath = "data/notebook.json", digest = /^[a-f0-9]{64}$/;
const ownerOf = (entry: NotebookEntry) => entry.experimentNotebookId ?? entry.id;
const portable = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id);
const at = (snapshot: SyncSnapshot, name: string) => snapshot.records.find(item => item.path === name);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
function json(record: SyncRecord) { const value = JSON.parse(Buffer.from(record.data, "base64").toString()); validateSyncJson(value); return value; }
function catalogue(snapshot: SyncSnapshot): NotebookStore {
  const record = at(snapshot, catPath); if (!record) return { version: 1, revision: 0, entries: [] };
  if (record.kind !== "catalogue") throw new Error("Wrong conversation record kind.");
  const value = json(record); if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error("Invalid conversation catalogue."); validateNotebookEntries(value.entries); return value;
}
const ordinaryFields = new Set(["title", "question", "notes", "reply", "proposal", "experimentContext", "pinned", "pinMode", "filed", "folder", "cataloguePosition"]);
export interface ResearchMergeDecision { conflictId: string; choice: "local" | "remote" | "text"; text?: string }
export interface ResearchMergeOptions { proposalId?: string; decisions?: ResearchMergeDecision[] }
export interface Held { id: string; path: string; field: string; reason: string; ordinary: boolean; base?: unknown; local?: unknown; remote?: unknown }
export interface Change { path: string; kind: SyncRecord["kind"]; before: string; after: string; bytes: number }
interface MergeBody { format: "aw-research-merge"; version: 1; projectId: string; planId: string; options: ResearchMergeOptions; deviceId: string; localStateHash: string;
  selection: { paperRoot: string; mainFile: string; engine: string }; changes: Change[]; held: Held[]; newEntries: string[]; owners: string[]; catalogueRevision: number }
interface Journal { format: "aw-research-merge-journal"; version: 1; body: MergeBody; backupId: string }
async function optional(target: string) { try { const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error("Linked/special destination preserved."); return stat; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
async function selection(workspace: string, projectId: string) { const { project, root } = await getProject(workspace, projectId); return { paperRoot: root, mainFile: project.mainFile, engine: project.engine ?? "auto" }; }
function utf8(record?: SyncRecord) {
  if (!record || record.bytes > 512 * 1024) return undefined;
  try { const bytes = Buffer.from(record.data, "base64"), text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); return Buffer.from(text).equals(bytes) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ? text : undefined; } catch { return undefined; }
}
function normalizeOptions(options: ResearchMergeOptions) {
  validateSyncJson(options);
  if (!options || Object.keys(options).some(key => !["proposalId", "decisions"].includes(key)) || options.proposalId !== undefined && !digest.test(options.proposalId)
    || options.decisions !== undefined && (!Array.isArray(options.decisions) || options.decisions.length > 100)) throw new Error("Invalid merge options.");
  const decisions = options.decisions ?? [], ids = new Set<string>();
  for (const decision of decisions) {
    if (!decision || Object.keys(decision).some(key => !["conflictId", "choice", "text"].includes(key)) || !digest.test(decision.conflictId) || ids.has(decision.conflictId) || !["local", "remote", "text"].includes(decision.choice)
      || (decision.choice === "text" ? typeof decision.text !== "string" || Buffer.byteLength(decision.text) > 512 * 1024 : decision.text !== undefined)) throw new Error("Invalid/duplicate ordinary note decision."); ids.add(decision.conflictId);
  }
  return { ...(options.proposalId ? { proposalId: options.proposalId } : {}), ...(decisions.length ? { decisions } : {}) };
}
async function context(workspace: string, projectId: string, planId: string, input: ResearchMergeOptions = {}) {
  const options = normalizeOptions(input), staged = await stagedPlan(workspace, projectId, planId), [base, local, remote] = staged.inputs;
  const cats = staged.inputs.map(catalogue), currentSelection = await selection(workspace, projectId), held: Held[] = [], resolved = new Set<string>(), records: SyncRecord[] = [];
  const decisions = new Map((options.decisions ?? []).map(item => [item.conflictId, item]));
  const hold = (name: string, field: string, reason: string, ordinary = false, variants?: unknown[]) => {
    const body = { path: name, field, reason, ordinary, ...(variants ? { base: variants[0], local: variants[1], remote: variants[2] } : {}) }, item = { ...body, id: syncHash(canonical(body)) }; held.push(item); return item;
  };
  const locks = syncLockedFiles(staged.inputs), publication = staged.inputs.some(snapshot => Object.values(json(at(snapshot, "project/manuscripts.json")!).manuscriptPurposes ?? {}).includes("publication"));
  const proposed = options.proposalId ? (await readReconciliation(workspace, projectId, planId, options.proposalId)).records : [];
  const pathMap = new Map([...staged.plan.records, ...proposed].map(record => [record.path, record]));
  // Ordinary text / figures only. Run code/config and all request/decision records
  // have their own workflows, even for one-sided changes.
  for (const name of [...new Set([...local.records, ...remote.records, ...base.records].map(record => record.path))].sort()) {
    if (name === catPath || /^data\/experiments\/[^/]+\/(?:notebook\.ipynb|runs\/[^/]+\.json)$/.test(name)) continue;
    const [b, l, r] = staged.inputs.map(snapshot => at(snapshot, name)); if (r?.sha256 === b?.sha256 || l?.sha256 === r?.sha256) continue;
    if (name==="data/workbench.json" && (semanticReviewContent(r)===semanticReviewContent(b) || semanticReviewContent(r)===semanticReviewContent(l))) continue;
    const source = name.startsWith("source/"), note = /^data\/research\/.+\.(?:md|txt|tex)$/.test(name), figure = /\.(?:png|jpe?g|webp|gif|pdf|eps)$/.test(name) && (source || name.startsWith("data/research/"));
    if (!source && !note && !figure || source && !/\.(?:tex|bib|md|txt|png|jpe?g|webp|gif|pdf|eps)$/.test(name)) { hold(name, "", "protected record or executable/configuration file"); continue; }
    if (!r || b && !l) { hold(name, "", "deletion or restoration requires explicit review"); continue; }
    if (source && (publication || locks.unknown || locks.files.has(name))) { hold(name, "", "publication or locked wording requires its writing workflow"); continue; }
    let candidate = pathMap.get(name);
    if (!candidate && !figure && b && l && r && [b, l, r].every(item => utf8(item) !== undefined)) {
      const result = mergeLiteralText(utf8(b)!, utf8(l)!, utf8(r)!); if (result.status === "combined") candidate = syncRecord(name, l.kind, Buffer.from(result.text!));
    }
    if (!candidate || candidate.kind !== r.kind || candidate.kind !== (l ?? r).kind || !figure && utf8(candidate) === undefined) { hold(name, "", "overlap, binary change or oversized text needs a scoped proposal", !figure); continue; }
    if (source) checkedProjectPath(name.slice(7));
    if (candidate.sha256 !== l?.sha256) records.push(candidate);
  }
  const afterCatalogue = structuredClone(cats[1]), entries = afterCatalogue.entries, newEntries: string[] = [];
  const oldMap = new Map(cats[0].entries.map(entry => [entry.id, entry])), localMap = new Map(entries.map(entry => [entry.id, entry]));
  const availableSources: Record<string, string> = {};
  for (const record of [...local.records, ...records].filter(item => item.path.startsWith("source/") && item.path.endsWith(".tex"))) availableSources[record.path.slice(7)] = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"));
  if (Object.keys(availableSources).length > 500) throw new Error("Bounded collection supports at most 500 TeX files.");
  const roots = manuscriptRoots(availableSources, true), takenOwners = new Set(entries.map(ownerOf)), takenTasks = new Set(cats.flatMap(cat => cat === cats[2] ? [] : cat.entries).flatMap(entry => [...entry.handoffs.map(h => h.id), ...(entry.study?.turns.map(t => t.id) ?? [])]));
  const wb = at(local, "data/workbench.json"); if (wb) for (const task of json(wb).attentionTasks ?? []) takenTasks.add(task.id);
  for (const incoming of cats[2].entries) {
    const original = oldMap.get(incoming.id), current = localMap.get(incoming.id);
    if (!current) {
      if (original) { hold(catPath, incoming.id, "deleted conversation remains held"); continue; }
      try {
        settledSyncEntry(incoming);
        if (newEntries.length >= 8 || takenOwners.has(ownerOf(incoming)) || !roots.includes(incoming.manuscriptFile ?? incoming.source?.rootFile ?? currentSelection.mainFile)) throw new Error("New conversation needs a distinct owner, available manuscript and bounded bundle.");
        const tasks = [...new Set([...incoming.handoffs.map(h => h.id), ...(incoming.study?.turns.map(t => t.id) ?? [])])]; if (tasks.some(id => takenTasks.has(id))) throw new Error("Task identity collision; no remapping.");
        const prefix = `data/experiments/${ownerOf(incoming)}/`; if ([base, local].some(snapshot => snapshot.records.some(item => item.path.startsWith(prefix)))) throw new Error("New owner has orphan/shared evidence.");
        if (at(remote, `${prefix}notebook.ipynb`)) notebookCollectionEvidence(staged, `${prefix}notebook.ipynb`);
        entries.push(structuredClone(incoming)); newEntries.push(incoming.id); takenOwners.add(ownerOf(incoming)); tasks.forEach(id => takenTasks.add(id));
      } catch (error) { hold(catPath, incoming.id, (error as Error).message); }
      continue;
    }
    if (!original && !equal(current, incoming)) { hold(catPath, incoming.id, "independent conversation identity collision"); continue; }
    if (ownerOf(current) !== ownerOf(incoming) || !equal(current.manuscriptFile, incoming.manuscriptFile) || !equal(current.source, incoming.source)) { hold(catPath, incoming.id, "conversation ownership/source anchor changed"); continue; }
    for (const field of [...new Set([...Object.keys(original ?? {}), ...Object.keys(current), ...Object.keys(incoming)])]) {
      if (field === "updatedAt") continue;
      const [b, l, r] = [original, current, incoming].map(entry => (entry as any)?.[field]); if (equal(r, b) || equal(l, r)) continue;
      if (!ordinaryFields.has(field)) { hold(catPath, `${incoming.id}/${field}`, "protected conversation state", false); continue; }
      let value = equal(l, b) ? r : undefined, conflict: Held | undefined;
      if (!equal(l, b) && [b, l, r].every(value => typeof value === "string")) { const merged = mergeLiteralText(b, l, r); if (merged.status === "combined") value = merged.text; }
      if (value === undefined && r !== undefined || !equal(l, b) && r === undefined) {
        conflict = hold(catPath, `${incoming.id}/${field}`, "overlapping conversation field", true, [b, l, r]); const decision = decisions.get(conflict.id);
        if (!decision) continue;
        if (decision.choice === "text" && ![b, l, r].every(item => item === undefined || typeof item === "string")) throw new Error("Text choice is only for ordinary text fields.");
        value = decision.choice === "local" ? l : decision.choice === "remote" ? r : decision.text; resolved.add(conflict.id);
      }
      if (value === undefined) delete (current as any)[field]; else (current as any)[field] = value;
    }
    current.updatedAt = [current.updatedAt, incoming.updatedAt].sort().at(-1)!;
  }
  for (const original of cats[0].entries) if (!cats[2].entries.some(entry => entry.id === original.id) && localMap.has(original.id)) hold(catPath, original.id, "conversation deletion requires explicit review");
  // Unknown catalogue metadata is never discarded or implicitly resolved.
  for (const field of new Set([...Object.keys(cats[0]), ...Object.keys(cats[2])])) if (!["version", "revision", "entries"].includes(field) && !equal((cats[2] as any)[field], (cats[0] as any)[field]) && !equal((cats[2] as any)[field], (cats[1] as any)[field])) hold(catPath, field, "unknown catalogue metadata stays local");
  validateNotebookEntries(entries);
  const owners: string[] = [], acceptedOwners = new Set(entries.map(ownerOf));
  for (const name of [...new Set(remote.records.filter(item => item.kind === "experiment").map(item => item.path))]) {
    const match = /^data\/experiments\/([^/]+)\/notebook\.ipynb$/.exec(name)!, owner = match[1], old = at(local, name), incoming = at(remote, name);
    if (incoming?.sha256 === at(base, name)?.sha256 || incoming?.sha256 === old?.sha256) continue;
    if (!acceptedOwners.has(owner) || !portable(owner) || owners.length >= 16) { hold(name, "", "owner not accepted or collection bound exceeded"); continue; }
    try {
      const evidence = notebookCollectionEvidence(staged, name), previous = old ? json(old) : undefined;
      if (previous) { validateExperimentNotebook(previous); for (const cell of previous.cells) { const next = evidence.notebook.cells.find(item => item.id === cell.id); if (!next || next.cell_type !== cell.cell_type || ["filed", "deleted"].some(key => cell.metadata.paperfocus?.[key] && !next.metadata.paperfocus?.[key])) throw new Error("Cell deletion, type change or resurrection remains held."); } }
      for (const cell of evidence.notebook.cells) {
        const runId = cell.metadata.paperfocus?.runId, priorId = previous?.cells.find(item => item.id === cell.id)?.metadata.paperfocus?.runId;
        if (runId && runId !== priorId && !evidence.runs.some(item => item.path === `data/experiments/${owner}/runs/${runId}.json` && json(item).cellId === cell.id)) throw new Error("Output run provenance is unresolved.");
      }
      records.push(syncRecord(name, "experiment", Buffer.from(JSON.stringify(evidence.notebook, null, 2)))); owners.push(owner);
      for (const run of evidence.runs) if (!at(local, run.path)) records.push(run);
    } catch (error) { hold(name, "", (error as Error).message); }
  }
  // New card and its evidence are a unit: never publish a card if its notebook
  // failed later validation (including unresolved historical output provenance).
  for (const id of [...newEntries]) { const entry = entries.find(item => item.id === id)!, name = `data/experiments/${ownerOf(entry)}/notebook.ipynb`; if (at(remote, name) && !records.some(item => item.path === name)) { entries.splice(entries.indexOf(entry), 1); newEntries.splice(newEntries.indexOf(id), 1); } }
  const proposedCatalogue = staged.plan.records.find(item => item.path === catPath);
  if (proposedCatalogue) {
    const ids: string[] = json(proposedCatalogue).entries.map((entry: NotebookEntry) => entry.id);
    if (ids.length === entries.length && entries.every(entry => ids.includes(entry.id))) entries.sort((a,b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  } else if (staged.plan.conflicts.some(item => item.path === catPath && item.reason === "concurrent-reordering")) hold(catPath, "order", "concurrent conversation order remains held");
  if (!equal(entries, cats[1].entries)) { afterCatalogue.revision = cats[1].revision + 1; records.push(syncRecord(catPath, "catalogue", Buffer.from(JSON.stringify(afterCatalogue, null, 2)))); }
  const handled = new Set([...records.map(item => item.path), ...held.map(item => item.path)]);
  for (const r of remote.records.filter(item => item.kind === "run")) if (r.sha256 !== at(local, r.path)?.sha256 && !handled.has(r.path) && !records.some(item => item.path === r.path)) hold(r.path, "", "uncollected run stays with its original owner");
  for (const b of base.records.filter(item => item.kind === "experiment" || item.kind === "run")) if (!at(remote, b.path) && at(local, b.path) && !handled.has(b.path)) hold(b.path, "", "experiment deletion remains held");
  for (const decision of decisions.values()) if (!resolved.has(decision.conflictId)) throw new Error("A decision is not an exact current ordinary-note conflict.");
  return { staged, records: records.filter(item => item.sha256 !== at(local, item.path)?.sha256), held: held.filter(item => !resolved.has(item.id)), newEntries, owners, catalogueRevision: afterCatalogue.revision, options, selection: currentSelection };
}
function describe(ctx: Awaited<ReturnType<typeof context>>, before: SyncSnapshot, selected = ctx.selection): MergeBody {
  if (before.device.id !== ctx.staged.inputs[1].device.id || syncStateHash(before) !== syncStateHash(ctx.staged.inputs[1])) throw new Error("Local work changed; compare a new checkpoint.");
  const changes = ctx.records.map(item => ({ path: item.path, kind: item.kind, before: at(before, item.path)?.sha256 ?? "", after: item.sha256, bytes: item.bytes }));
  if (changes.length > 300 || changes.reduce((sum, item) => sum + item.bytes, 0) > 48 * 1024 * 1024) throw new Error("Merge exceeds 300 files / 48 MB; use selected collection.");
  checkCollectionFootprint(before, changes);
  return { format: "aw-research-merge", version: 1, projectId: before.projectId, planId: ctx.staged.id, options: ctx.options, deviceId: before.device.id, localStateHash: syncStateHash(before), selection: selected,
    changes, held: ctx.held, newEntries: ctx.newEntries, owners: ctx.owners, catalogueRevision: ctx.catalogueRevision };
}
const mergeId = (body: MergeBody) => syncHash(canonical(body));
async function targets(workspace: string, body: MergeBody, create = false) {
  const storage = create ? await projectStorage(workspace, body.projectId) : { folder: path.join(workspace, ".paperfocus/project-data", body.projectId) };
  return { source: body.selection.paperRoot, data: storage.folder };
}
async function checkNewDestinations(workspace: string, body: MergeBody, before: SyncSnapshot) {
  const roots = await targets(workspace, body);
  for (const change of body.changes) if (!change.before) { const source = change.path.startsWith("source/"); if (await guardedFileHash(source ? roots.source : workspace, source ? change.path.slice(7) : `.paperfocus/project-data/${body.projectId}/${change.path.slice(5)}`)) throw new Error("New destination already exists, including excluded work; preserved."); }
  for (const owner of body.owners) if (!at(before, `data/experiments/${owner}/notebook.ipynb`)) {
    const folder = path.dirname(await guardedTarget(workspace, `.paperfocus/project-data/${body.projectId}/experiments/${owner}/notebook.ipynb`));
    if (await optional(folder)) throw new Error("New owner folder already exists, including hidden orphan work; preserved.");
  }
}
export async function previewResearchMerge(workspace: string, projectId: string, planId: string, options: ResearchMergeOptions = {}) {
  const ctx = await context(workspace, projectId, planId, options), before = await checkSyncLocalState(workspace, projectId, ctx.staged.plan.local), body = describe(ctx, before);
  await checkNewDestinations(workspace, body, before);
  return { mergeId: mergeId(body), projectId, planId, changes: body.changes, held: body.held.map(({ base: _b, local: _l, remote: _r, ...item }) => item), newEntries: body.newEntries,
    afterSemanticHash: semanticSyncHash({ ...before, records: [...before.records.filter(item => !ctx.records.some(record => record.path === item.path)), ...ctx.records] }),
    complete: body.held.length === 0, planned: true, liveImport: false, codeExecuted: false, approvalGranted: false, tasksCompleted: false, note: "Save all editor drafts before commit. Ordinary saved research/source only; protected or ambiguous changes remain held." };
}
export async function researchMergeDetails(workspace: string, projectId: string, planId: string, options: ResearchMergeOptions = {}) {
  const ctx = await context(workspace, projectId, planId, options); return { projectId, planId, held: ctx.held, liveImport: false };
}
export async function researchMergeFile(workspace: string, projectId: string, planId: string, name: string) {
  const ctx = await context(workspace, projectId, planId), record = ctx.records.find(item => item.path === name), original = at(ctx.staged.inputs[1], name);
  if (!record) throw new Error("No safe proposed file with this exact path."); const before = original ? utf8(original) : "", after = utf8(record);
  if (before === undefined || after === undefined || Buffer.byteLength(before) + Buffer.byteLength(after) > 80000) throw new Error("Use the offline file/reconciliation tools for a complete large or binary preview; nothing was truncated.");
  return { path: name, before, after, complete: true, liveImport: false };
}
export async function researchMergeCandidate(workspace: string, projectId: string, planId: string, name: string, options: ResearchMergeOptions = {}) {
  const ctx = await context(workspace,projectId,planId,options), candidate = ctx.records.find(record=>record.path===name);
  if (!candidate) throw new Error("No safe proposed file with that exact identity; held/unchanged files are not guessed."); return candidate;
}
async function journal(workspace: string, projectId: string, id: string) {
  if (!digest.test(id)) throw new Error("Use an exact merge review ID."); const file = await privateSyncPath(workspace, `merges/${projectId}/${id}/journal.json`);
  if (!await optional(file)) return undefined; const value: Journal = JSON.parse((await readSyncBytes(file, 4 * 1024 * 1024)).toString()); validateSyncJson(value);
  if (value.format !== "aw-research-merge-journal" || value.version !== 1 || value.body.projectId !== projectId || mergeId(value.body) !== id || !digest.test(value.backupId)) throw new Error("Damaged merge journal; preserved."); return value;
}
export async function researchMergeStatus(workspace: string, projectId: string, id: string) {
  const saved = await journal(workspace, projectId, id); if (!saved) throw new Error("Merge journal not found.");
  const ready = await privateSyncPath(workspace, `merges/${projectId}/${id}/ready.json`), folder = path.dirname(ready);
  if (!await optional(ready)) return { mergeId: id, folder, completed: false, partial: true, liveWritesPossible: true, note: "Repeat the identical commit only after inspecting current work; partial writes are preserved." };
  const result = JSON.parse((await readSyncBytes(ready, 100000)).toString()); validateSyncJson(result);
  const { receiptHash, ...body } = result;
  if (syncHash(canonical(body)) !== receiptHash || result.mergeId !== id || result.projectId !== projectId || result.planId !== saved.body.planId || result.codeExecuted !== false || result.tasksCompleted !== false || result.approvalGranted !== false || !digest.test(result.stateHash) || !digest.test(result.head) || result.historyJoined !== (saved.body.held.length === 0)) throw new Error("Merge receipt changed; preserve and inspect.");
  return { ...result, folder, completed: true, partial: false };
}
function fence(current: SyncSnapshot, before: SyncSnapshot, body: MergeBody) {
  if (current.device.id !== body.deviceId) throw new Error("Receiving device changed.");
  const changes = new Map(body.changes.map(item => [item.path, item])), original = new Map(before.records.map(item => [item.path, item]));
  const restored = current.records.flatMap(item => { const change = changes.get(item.path); if (!change) return [item]; if (![change.before, change.after].includes(item.sha256)) throw new Error(`Changed partial merge file preserved: ${item.path}`); return original.has(item.path) ? [original.get(item.path)!] : []; });
  for (const change of body.changes) if (change.before && !at(current, change.path)) throw new Error(`A merge destination disappeared: ${change.path}`);
  if (syncStateHash({ ...current, records: restored }) !== body.localStateHash) throw new Error("Other local work changed; partial preparations retained, no forced retry.");
  return current;
}
export async function commitResearchMerge(workspace: string, projectId: string, planId: string, id: string, options: ResearchMergeOptions = {}, hooks: { afterBackup?: () => void | Promise<void>; afterFile?: (name: string) => void | Promise<void>; afterCatalogue?: () => void | Promise<void> } = {}) {
  const ctx = await context(workspace, projectId, planId, options);
  return withRecordLock(await privateSyncPath(workspace, `collection-operation-${projectId}`, true), async () => {
    const relative = `merges/${projectId}/${id}`, backupFile = await privateSyncPath(workspace, `${relative}/before.json`); let saved = await journal(workspace, projectId, id), before: SyncSnapshot;
    if (saved) { before = JSON.parse((await readSyncBytes(backupFile, syncLimits.packetBytes)).toString()); validateSnapshot(before); if (before.id !== saved.backupId || mergeId(describe(ctx, before, saved.body.selection)) !== id) throw new Error("Merge scope changed; journal retained."); const status = await researchMergeStatus(workspace, projectId, id); if (status.completed) return { ...status, alreadyComplete: true }; }
    else {
      before = await checkSyncLocalState(workspace, projectId, ctx.staged.plan.local); const body = describe(ctx, before); if (mergeId(body) !== id) throw new Error("Merge review changed; preview again, no live writes."); if (!body.changes.length && body.held.length) throw new Error("No safe changes to collect; inspect the held list.");
      // Preview checks noncaptured destinations before creating the journal.
      await checkNewDestinations(workspace, body, before);
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/before.json`, true), Buffer.from(JSON.stringify(before) + "\n"), syncLimits.packetBytes);
      saved = { format: "aw-research-merge-journal", version: 1, body, backupId: before.id }; await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/journal.json`), Buffer.from(JSON.stringify(saved) + "\n"), 4 * 1024 * 1024);
    }
    const body = saved.body, release: Array<() => Promise<void>> = [], roots = await targets(workspace, body, true);
    const check = async () => { if (!equal(await selection(workspace, projectId), body.selection)) throw new Error("Root/compiler selection changed; retained merge requires inspection."); return fence(await captureSyncSnapshot(workspace, projectId), before, body); };
    try {
      await check(); await hooks.afterBackup?.(); await check();
      for (const owner of [...body.owners].sort()) {
        const folder = path.dirname(await guardedTarget(roots.data, `experiments/${owner}/notebook.ipynb`, true));
        if (!at(before, `data/experiments/${owner}/notebook.ipynb`)) {
          const claim = Buffer.from(JSON.stringify({ version: 1, projectId, owner, mergeId: id }) + "\n"), file = path.join(folder, ".aw-merge.json");
          // guardedTarget made the parents. Reject hidden orphan content unless
          // our exact claim already exists; no existing folder is adopted.
          if (await optional(file)) { if (!(await readSyncBytes(file, 2000)).equals(claim)) throw new Error("Owner claim belongs to another preparation."); }
          else { const { readdir } = await import("node:fs/promises"); if ((await readdir(folder)).length) throw new Error("New owner contains orphan work; preserved."); await saveImmutableSyncArtifact(file, claim, 2000); }
        }
        release.push(await acquireRecordLock(path.join(folder, "python-run"), 0));
      }
      await check();
      const sorted = [...ctx.records].sort((a, b) => (a.kind === "catalogue" ? 3 : a.kind === "experiment" ? 1 : a.kind === "run" ? 0 : 2) - (b.kind === "catalogue" ? 3 : b.kind === "experiment" ? 1 : b.kind === "run" ? 0 : 2) || a.path.localeCompare(b.path));
      for (const record of sorted) {
        const change = body.changes.find(item => item.path === record.path)!, source = record.path.startsWith("source/"), root = source ? roots.source : roots.data, name = record.path.slice(source ? 7 : 5);
        const currentHash = await guardedFileHash(root, name); if (currentHash === change.after) continue;
        if (currentHash !== change.before) throw new Error(`Merge destination changed: ${record.path}`);
        if (record.kind === "catalogue") await check(); // Evidence must be intact before cards are published.
        if (record.kind === "experiment") { const owner = record.path.split("/")[2]; await writeExperiments(workspace, projectId, owner, change.before, json(record)); }
        else if (record.kind === "catalogue") { const value = json(record); await writeNotebook(workspace, projectId, catalogue(before).revision, value.entries, change.before); await hooks.afterCatalogue?.(); }
        else { if (record.kind === "run") await saveImmutableSyncArtifact(await guardedTarget(root, name, true), Buffer.from(record.data, "base64"), syncLimits.fileBytes); else await saveGuardedFile(root, name, change.before, Buffer.from(record.data, "base64")); }
        await hooks.afterFile?.(record.path);
        if (hooks.afterFile) await check();
      }
      const current = await check(); for (const change of body.changes) if (at(current, change.path)?.sha256 !== change.after) throw new Error("Merge save was not confirmed.");
      const headFile = await privateSyncPath(workspace, `${relative}/head.json`);
      let head: SyncSnapshot;
      if (await optional(headFile)) { head = JSON.parse((await readSyncBytes(headFile, syncLimits.packetBytes)).toString()); validateSnapshot(head); if (head.projectId !== projectId || head.device.id !== body.deviceId || syncStateHash(head) !== syncStateHash(current)
        || !equal(head.parents, body.held.length ? [ctx.staged.plan.local] : [ctx.staged.plan.local, ctx.staged.plan.remote])) throw new Error("Prepared merge head changed; retained for inspection."); }
      else { head = body.held.length ? makeSnapshot(projectId, current.device, current.records, ctx.staged.inputs[1]) : makeMergedSnapshot(projectId, current.device, current.records, [ctx.staged.inputs[1], ctx.staged.inputs[2]]);
        await saveImmutableSyncArtifact(headFile, Buffer.from(JSON.stringify(head) + "\n"), syncLimits.packetBytes); }
      await saveSyncSnapshot(workspace, head); await stageSyncSnapshot(workspace, projectId, head);
      await check();
      await rememberSyncHead(workspace, projectId, head.id);
      const receipt = { version: 1, mergeId: id, projectId, planId, backupPath: backupFile, changes: body.changes.map(item => item.path), held: body.held.map(item => ({ id: item.id, path: item.path, field: item.field, reason: item.reason })), stateHash: syncStateHash(current),
        head: head.id, headPath: headFile, historyJoined: body.held.length === 0, completedAt: new Date().toISOString(), liveImport: true, complete: body.held.length === 0, codeExecuted: false, tasksCompleted: false, approvalGranted: false };
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `${relative}/ready.json`), Buffer.from(JSON.stringify({ ...receipt, receiptHash: syncHash(canonical(receipt)) }) + "\n"), 100000);
      return { ...receipt, folder: path.dirname(backupFile), completed: true, partial: false, alreadyComplete: false };
    } catch (error) { throw new Error(`${(error as Error).message} Merge retained at ${path.dirname(backupFile)}; partial live changes may exist. Inspect or resume the exact review, never force or roll back newer work.`); }
    finally { const errors: unknown[] = []; for (const done of release.reverse()) try { await done(); } catch (error) { errors.push(error); } if (errors.length) throw new AggregateError(errors, "Some merge leases changed; all other owned leases released. Inspect before retry."); }
  });
}
