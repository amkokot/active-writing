import { lstat, link, open, readdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes, syncStatus } from "./deviceSync.ts";
import { getProject, inside } from "./projects.ts";
import { withRecordLock } from "./recordLock.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { canonical, previewSync, safeSyncId, safeSyncPath, syncHash, syncLimits, validateDevice, validateSnapshot, validateSyncJson, validSyncReference, type SyncPlan, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";

const digest = /^[a-f0-9]{64}$/;
type Reference = Omit<SyncRecord, "data">;
type Metadata = Omit<SyncSnapshot, "records">;
interface Manifest { format: "aw-staged-snapshot"; version: 1; metadata: Metadata; references: Reference[]; referenceHash: string }
interface PlanRecord { format: "aw-staged-plan"; version: 1; id: string; projectId: string; base: string; local: string; remote: string; summary: SyncPlan["summary"]; recordHash: string }
async function exists(target: string) {
  try { return await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
function ids(projectId: string, id?: string) {
  if (!safeSyncId(projectId) || id !== undefined && !digest.test(id)) throw new Error("Use the exact project and snapshot/plan IDs.");
}
function manifestFor(snapshot: SyncSnapshot): Manifest {
  const { records, ...metadata } = snapshot, references = records.map(({ data: _data, ...reference }) => reference);
  const body = { format: "aw-staged-snapshot" as const, version: 1 as const, metadata, references };
  return { ...body, referenceHash: syncHash(canonical(body)) };
}
function validateManifest(value: unknown): asserts value is Manifest {
  validateSyncJson(value);
  const manifest = value as Manifest, m = manifest?.metadata;
  if (!manifest || manifest.format !== "aw-staged-snapshot" || manifest.version !== 1 || !m || m.format !== "aw-device-snapshot" || m.version !== 1) throw new Error("Unsupported staged snapshot format.");
  validateDevice(m.device); ids(m.projectId, m.id);
  if (typeof m.createdAt !== "string" || !Number.isFinite(Date.parse(m.createdAt)) || Object.keys(m).some(key => !["format", "version", "id", "projectId", "device", "createdAt", "parents", "ancestors", "tombstones"].includes(key))) throw new Error("Invalid staged metadata.");
  if (!Array.isArray(m.parents) || m.parents.length > 2 || !Array.isArray(m.ancestors) || m.ancestors.length > syncLimits.ancestors || !Array.isArray(m.tombstones) || m.tombstones.length > syncLimits.records || !Array.isArray(manifest.references) || manifest.references.length > syncLimits.records || !digest.test(manifest.referenceHash)) throw new Error("Invalid staged snapshot header.");
  if ([...m.parents, ...m.ancestors].some(id => !digest.test(id) || id === m.id) || new Set(m.parents).size !== m.parents.length || new Set(m.ancestors).size !== m.ancestors.length || m.parents.some(id => !m.ancestors.includes(id))) throw new Error("Invalid staged ancestry.");
  const paths = new Set<string>(); let total = 0;
  for (const r of manifest.references) {
    if (!validSyncReference(r) || paths.has(r.path.toLowerCase()) || (total += r.bytes) > syncLimits.totalBytes) throw new Error("Invalid staged file reference.");
    paths.add(r.path.toLowerCase());
  }
  for (const t of m.tombstones) { if (!safeSyncPath(t.path) || paths.has(t.path.toLowerCase()) || !digest.test(t.previousHash)) throw new Error("Invalid staged deletion history."); paths.add(t.path.toLowerCase()); }
  const { referenceHash, ...body } = manifest;
  if (syncHash(canonical(body)) !== referenceHash) throw new Error("Staged manifest changed. Original artifacts were preserved.");
}

/** Atomic immutable publication: interrupted .part files never become complete
 * records. The hard link refuses replacement even if a non-participating writer
 * creates the destination while our lock is held. Only our generated part is removed. */
async function immutable(target: string, bytes: Buffer, maximum: number) {
  if (bytes.length > maximum) throw new Error("Sync artifact exceeds its storage limit. No replacement made.");
  return withRecordLock(target, async () => {
    if (await exists(target)) {
      if (!(await readSyncBytes(target, maximum)).equals(bytes)) throw new Error("An immutable sync artifact differs. Both preparations were preserved.");
      return false;
    }
    const temporary = `${target}.${randomUUID()}.part`;
    if (!inside(path.dirname(target), temporary)) throw new Error("Invalid sync preparation path.");
    const handle = await open(temporary, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await readSyncBytes(target, maximum)).equals(bytes)) throw error;
    }
    await unlink(temporary);
    return true;
  });
}
export const saveImmutableSyncArtifact = immutable;
async function stagedManifest(workspace: string, projectId: string, id: string) {
  ids(projectId, id);
  const file = await privateSyncPath(workspace, `staged/${projectId}/${id}.json`);
  const manifest = JSON.parse((await readSyncBytes(file, 4 * 1024 * 1024)).toString()); validateManifest(manifest);
  if (manifest.metadata.id !== id || manifest.metadata.projectId !== projectId) throw new Error("Staged snapshot belongs to another identity/project.");
  return manifest;
}
async function blob(workspace: string, reference: Reference) {
  const target = await privateSyncPath(workspace, `blobs/${reference.sha256}.blob`);
  const bytes = await readSyncBytes(target, syncLimits.fileBytes);
  if (bytes.length !== reference.bytes || syncHash(bytes) !== reference.sha256) throw new Error("Staged blob checksum mismatch. Nothing was imported.");
  return bytes;
}
export async function hydrateStagedSnapshot(workspace: string, projectId: string, id: string) {
  const manifest = await stagedManifest(workspace, projectId, id), records: SyncRecord[] = [];
  for (const reference of manifest.references) records.push({ ...reference, data: (await blob(workspace, reference)).toString("base64") });
  const snapshot = { ...manifest.metadata, records }; validateSnapshot(snapshot); return snapshot;
}
export async function stageSyncSnapshot(workspace: string, projectId: string, snapshot: SyncSnapshot, options: { afterBlob?: (count: number) => void | Promise<void> } = {}) {
  ids(projectId); await getProject(workspace, projectId); validateSnapshot(snapshot);
  if (snapshot.projectId !== projectId) throw new Error("Snapshot belongs to another project. No files staged.");
  const manifest = manifestFor(snapshot), target = await privateSyncPath(workspace, `staged/${projectId}/${snapshot.id}.json`, true);
  await immutable(target, Buffer.from(JSON.stringify(manifest) + "\n"), 4 * 1024 * 1024);
  let createdBlobs = 0, reusedBlobs = 0, count = 0;
  const unique = new Map(snapshot.records.map(record => [record.sha256, record]));
  for (const record of unique.values()) {
    const filename = await privateSyncPath(workspace, `blobs/${record.sha256}.blob`, true);
    if (await immutable(filename, Buffer.from(record.data, "base64"), syncLimits.fileBytes)) createdBlobs++; else reusedBlobs++;
    await options.afterBlob?.(++count);
  }
  // The small receipt is last. Repeating an interrupted stage reuses checked
  // bytes, never duplicates evidence and never claims an unfinished stage is ready.
  const ready = await privateSyncPath(workspace, `receipts/${projectId}/${snapshot.id}.json`, true);
  const receipt = { version: 1, id: snapshot.id, projectId, referenceHash: manifest.referenceHash };
  await immutable(ready, Buffer.from(JSON.stringify(receipt) + "\n"), 2000);
  return { id: snapshot.id, projectId, files: snapshot.records.length, createdBlobs, reusedBlobs, staged: true, liveImport: false, transportSupported: false };
}
export async function stagedSnapshots(workspace: string, projectId: string) {
  ids(projectId); await getProject(workspace, projectId);
  const directory = path.dirname(await privateSyncPath(workspace, `staged/${projectId}/placeholder.json`));
  if (!await exists(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length > 1500) throw new Error("Too many staged artifacts to list. Inspect the explicit IDs.");
  const result = [];
  for (const entry of entries.filter(entry => /^[a-f0-9]{64}\.json$/.test(entry.name))) {
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("Staged artifacts cannot be linked.");
    const id = entry.name.slice(0, -5), manifest = await stagedManifest(workspace, projectId, id), receiptFile = await privateSyncPath(workspace, `receipts/${projectId}/${id}.json`);
    let ready = false;
    if (await exists(receiptFile)) {
      const receipt = JSON.parse((await readSyncBytes(receiptFile, 2000)).toString());
      if (receipt.version !== 1 || receipt.id !== id || receipt.projectId !== projectId || receipt.referenceHash !== manifest.referenceHash) throw new Error("Invalid staged receipt.");
      ready = true;
    }
    result.push({ id, device: manifest.metadata.device, createdAt: manifest.metadata.createdAt, files: manifest.references.length, ready, parents: manifest.metadata.parents });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/** Ancestry must be an actual scoped graph, not a list of claimed common IDs.
 * Every parent manifest was created by staging a checksum-validated packet. */
export async function stagedHistory(workspace: string, projectId: string, heads: string[]) {
  const graph = new Map<string, Manifest>(), missing = new Set<string>(), pending = new Set<string>(), visiting = new Set<string>();
  async function visit(id: string, depth = 0) {
    ids(projectId, id);
    if (visiting.has(id) || depth > syncLimits.ancestors) throw new Error("Cyclic or excessive snapshot history.");
    if (graph.has(id) || missing.has(id)) return;
    if (graph.size + missing.size >= syncLimits.ancestors + 3) throw new Error("Snapshot history exceeds the bounded verification window.");
    let manifest: Manifest;
    try { manifest = await stagedManifest(workspace, projectId, id); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { missing.add(id); return; } throw error; }
    const ready = await privateSyncPath(workspace, `receipts/${projectId}/${id}.json`);
    if (!await exists(ready)) pending.add(id);
    else {
      const receipt = JSON.parse((await readSyncBytes(ready, 2000)).toString());
      if (receipt.version !== 1 || receipt.id !== id || receipt.projectId !== projectId || receipt.referenceHash !== manifest.referenceHash) throw new Error("Invalid history receipt.");
    }
    visiting.add(id);
    for (const parent of manifest.metadata.parents) await visit(parent, depth + 1);
    visiting.delete(id); graph.set(id, manifest);
    if (manifest.metadata.parents.every(parent => graph.has(parent))) {
      const expected = [...new Set(manifest.metadata.parents.flatMap(parent => [parent, ...graph.get(parent)!.metadata.ancestors]))].sort();
      if (canonical(expected) !== canonical([...manifest.metadata.ancestors].sort())) throw new Error("Claimed ancestry does not match staged parent history.");
      const current = new Map(manifest.references.map(record => [record.path, record]));
      const deleted = new Map(manifest.metadata.tombstones.map(item => [item.path, item.previousHash]));
      for (const parent of manifest.metadata.parents) {
        const previous = graph.get(parent)!;
        for (const item of previous.metadata.tombstones) if (current.has(item.path) || deleted.get(item.path) !== item.previousHash) throw new Error("Deletion history was lost or a removed path was resurrected.");
        for (const record of previous.references) if (!current.has(record.path) && deleted.get(record.path) !== record.sha256) throw new Error("Missing file has no matching deletion history.");
      }
    }
  }
  for (const head of heads) await visit(head);
  return { graph, missing: [...missing].sort(), pending: [...pending].sort() };
}
export async function previewStagedSync(workspace: string, projectId: string, localId: string, remoteId: string, requestedBase?: string, save = true) {
  await getProject(workspace, projectId);
  const { graph, missing, pending } = await stagedHistory(workspace, projectId, [localId, remoteId]);
  if (missing.length) throw new Error(`Stage the missing parent snapshots first: ${missing.join(", ")}. No merge was prepared.`);
  if (pending.length) throw new Error(`Finish staging incomplete snapshots first: ${pending.join(", ")}. No merge was prepared.`);
  const left = graph.get(localId)!, right = graph.get(remoteId)!;
  const common = [localId, ...left.metadata.ancestors].filter(id => [remoteId, ...right.metadata.ancestors].includes(id));
  const best = common.filter(id => !common.some(other => other !== id && graph.get(other)!.metadata.ancestors.includes(id)));
  const base = requestedBase ?? (best.length === 1 ? best[0] : undefined);
  if (!base || !common.includes(base)) throw new Error(best.length > 1 ? "Several shared baselines exist. Choose an exact --base ID for review." : "No staged shared baseline. Never guess from timestamps.");
  const inputs = await Promise.all([base, localId, remoteId].map(id => hydrateStagedSnapshot(workspace, projectId, id)));
  const plan = previewSync(inputs[0], inputs[1], inputs[2]);
  const id = syncHash(canonical(plan));
  const body = { format: "aw-staged-plan" as const, version: 1 as const, id, projectId, base, local: localId, remote: remoteId, summary: plan.summary };
  const saved: PlanRecord = { ...body, recordHash: syncHash(canonical(body)) };
  const target = await privateSyncPath(workspace, `plans/${projectId}/${id}.json`, save);
  if (save) await immutable(target, Buffer.from(JSON.stringify(saved) + "\n"), 10000);
  return { id, path: target, plan, inputs, historyChecked: true, applySupported: false };
}
export async function stagedPlan(workspace: string, projectId: string, id: string) {
  ids(projectId, id);
  const target = await privateSyncPath(workspace, `plans/${projectId}/${id}.json`), record = JSON.parse((await readSyncBytes(target, 10000)).toString()) as PlanRecord;
  validateSyncJson(record);
  const { recordHash, ...body } = record;
  if (record.format !== "aw-staged-plan" || record.version !== 1 || record.id !== id || record.projectId !== projectId || syncHash(canonical(body)) !== recordHash) throw new Error("Invalid staged plan. Nothing was imported.");
  const result = await previewStagedSync(workspace, projectId, record.local, record.remote, record.base, false);
  if (result.id !== id) throw new Error("Plan inputs changed. The original plan was preserved.");
  return result;
}
function stateRecords(snapshot: SyncSnapshot) {
  return snapshot.records.map(record => {
    let sha256 = record.sha256;
    if (record.path === "data/workbench.json" && record.kind === "review") {
      // Visiting the comparison UI advances queue activity. That housekeeping
      // must not block a detached review. Every authored/protected field stays
      // fenced. A future live collector must still acquire current revisions
      // and preserve the current clock, never replace this store with candidates.
      const saved = JSON.parse(Buffer.from(record.data, "base64").toString()) as Record<string, unknown>;
      validateSyncJson(saved); validateWorkbench(saved);
      const { revision: _revision, queueLastActiveAt: _activity, ...protectedData } = saved;
      sha256 = syncHash(canonical(protectedData));
    }
    return { path: record.path, kind: record.kind, sha256 };
  }).sort((a, b) => a.path.localeCompare(b.path));
}
export const syncStateHash = (snapshot: SyncSnapshot) => syncHash(canonical(stateRecords(snapshot)));
export async function checkSyncLocalState(workspace: string, projectId: string, localId: string) {
  const original = await hydrateStagedSnapshot(workspace, projectId, localId), status = await syncStatus(workspace);
  if (!status.device || status.device.id !== original.device.id) throw new Error("The local side of this plan belongs to another installation.");
  const current = await captureSyncSnapshot(workspace, projectId);
  if (syncStateHash(current) !== syncStateHash(original)) {
    const old = new Map(stateRecords(original).map(record => [record.path, record.sha256])), now = new Map(stateRecords(current).map(record => [record.path, record.sha256]));
    const changed = [...new Set([...old.keys(), ...now.keys()])].filter(name => old.get(name) !== now.get(name)).sort();
    throw new Error(`Saved local files changed after this plan: ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", …" : ""}. Capture a fresh local snapshot and compare again; no live records changed.`);
  }
  return current;
}
export async function prepareSyncReview(workspace: string, projectId: string, planId: string) {
  const { plan } = await stagedPlan(workspace, projectId, planId), current = await checkSyncLocalState(workspace, projectId, plan.local);
  const directory = path.dirname(await privateSyncPath(workspace, `prepared/${projectId}/${planId}/review.json`, true));
  // Detached candidates are deliberately not a registered project or executable
  // import. Conflicting files are omitted, with full variants in review.json.
  for (const record of plan.records) {
    if (!safeSyncPath(record.path)) throw new Error("Unsafe review-copy path.");
    const target = await privateSyncPath(workspace, `prepared/${projectId}/${planId}/candidates/${record.path}`, true);
    await immutable(target, Buffer.from(record.data, "base64"), syncLimits.fileBytes);
  }
  const review = { version: 1, projectId, planId, applySupported: false, baseline: plan.base, local: plan.local, remote: plan.remote,
    summary: plan.summary, conflicts: plan.conflicts, deletions: plan.deletions, candidateFiles: plan.records.map(({ path: name, sha256 }) => ({ path: name, sha256 })) };
  const reviewFile = await privateSyncPath(workspace, `prepared/${projectId}/${planId}/review.json`);
  await immutable(reviewFile, Buffer.from(JSON.stringify(review, null, 2) + "\n"), syncLimits.packetBytes * 3);
  if (syncStateHash(await captureSyncSnapshot(workspace, projectId)) !== syncStateHash(current)) throw new Error(`Local work changed during preparation. Detached drafts kept at ${directory}; no live records changed.`);
  const ready = await privateSyncPath(workspace, `prepared/${projectId}/${planId}/ready.json`);
  await immutable(ready, Buffer.from(JSON.stringify({ version: 1, projectId, planId, stateHash: syncStateHash(current), liveImport: false }) + "\n"), 2000);
  return { projectId, planId, folder: directory, conflicts: plan.conflicts.length, candidateFiles: plan.records.length, prepared: true, liveImport: false, applySupported: false };
}
