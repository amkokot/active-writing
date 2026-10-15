// Private, compressed, content-addressed exchanges. Receiving stages evidence
// only; no project store, manuscript, job or application code is replaced.
import { lstat } from "node:fs/promises";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes, saveSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { hydrateStagedSnapshot, saveImmutableSyncArtifact, stageSyncSnapshot, stagedHistory, stagedSnapshots, syncStateHash } from "./syncStaging.ts";
import { canonical, safeSyncId, syncHash, syncLimits, validateDevice, validateSnapshot, validateSyncJson, validSyncReference, type SyncDevice, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { validateExperimentNotebook } from "../src/experiments.ts";
import { saveGuardedFile } from "./guardedFile.ts";
import { getProject } from "./projects.ts";

const digest = /^[a-f0-9]{64}$/;
export const exchangeLimits = { compressed: 64 * 1024 * 1024, expanded: 192 * 1024 * 1024, blobs: 128 * 1024 * 1024, references: 50000 };
type Reference = Omit<SyncRecord, "data">;
type Manifest = Omit<SyncSnapshot, "records"> & { references: Reference[] };
export interface SyncInventory { format: "aw-sync-inventory"; version: 1; projectId: string; device: SyncDevice; snapshots: string[]; blobs: string[]; id: string }
interface Exchange { format: "aw-sync-exchange"; version: 1; projectId: string; sender: SyncDevice; head: string; inventory: SyncInventory; manifests: Manifest[]; blobs: Array<{ sha256: string; bytes: number; data: string }>; id: string }
interface Ledger { version: 1; projectId: string; deviceId: string; revision: number; localHead?: string; commonHead?: string; received: Record<string, { head: string; inventory: string; receivedAt: string }>; acknowledged: Record<string, string> }
async function optional(target: string) { try { const stat = await lstat(target); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Private exchange record is linked or invalid."); return stat; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
export function validateSyncInventory(value: unknown): asserts value is SyncInventory {
  validateSyncJson(value); const saved = value as SyncInventory;
  if (!saved || saved.format !== "aw-sync-inventory" || saved.version !== 1 || !safeSyncId(saved.projectId) || !Array.isArray(saved.snapshots) || saved.snapshots.length > 1500 || !Array.isArray(saved.blobs) || saved.blobs.length > exchangeLimits.references
    || [...saved.snapshots, ...saved.blobs].some(id => !digest.test(id)) || new Set(saved.snapshots).size !== saved.snapshots.length || new Set(saved.blobs).size !== saved.blobs.length || Object.keys(saved).some(key => !["format", "version", "projectId", "device", "snapshots", "blobs", "id"].includes(key))) throw new Error("Invalid exchange inventory.");
  validateDevice(saved.device); const { id, ...body } = saved; if (syncHash(canonical(body)) !== id) throw new Error("Inventory checksum changed.");
}
export async function createSyncInventory(workspace: string, projectId: string): Promise<SyncInventory> {
  const status = await syncStatus(workspace); if (!status.device) throw new Error("Name this installation before exchanging data.");
  const ready = (await stagedSnapshots(workspace, projectId)).filter(item => item.ready), references = new Map<string, Reference>();
  const history = await stagedHistory(workspace, projectId, ready.map(item => item.id));
  if (history.missing.length || history.pending.length) throw new Error("Complete staged parent history before creating an inventory.");
  for (const saved of history.graph.values()) saved.references.forEach(record => references.set(record.sha256, record));
  if (references.size > exchangeLimits.references) throw new Error("Inventory exceeds its bounded window; archive explicitly, never discard sync history automatically.");
  // Each content hash is read once, not once for every historical snapshot.
  for (const ref of references.values()) { const data = await readSyncBytes(await privateSyncPath(workspace, `blobs/${ref.sha256}.blob`), syncLimits.fileBytes); if (data.length !== ref.bytes || syncHash(data) !== ref.sha256) throw new Error("Inventory blob changed; receive it again, never claim it is available."); }
  const body = { format: "aw-sync-inventory" as const, version: 1 as const, projectId, device: status.device, snapshots: ready.map(item => item.id).sort(), blobs: [...references.keys()].sort() };
  const result = { ...body, id: syncHash(canonical(body)) }; validateSyncInventory(result); return result;
}
export async function readSyncInventory(file: string) { const inventory = JSON.parse((await readSyncBytes(path.resolve(file), 4 * 1024 * 1024)).toString()); validateSyncInventory(inventory); return inventory; }
async function readLedger(workspace: string, projectId: string) {
  if (!safeSyncId(projectId)) throw new Error("Use an exact registered project."); await getProject(workspace, projectId);
  const status = await syncStatus(workspace); if (!status.device) throw new Error("Name this installation first.");
  const file = await privateSyncPath(workspace, `exchange/${projectId}/state.json`), stat = await optional(file);
  const bytes = stat ? await readSyncBytes(file, 200000) : undefined;
  const state: Ledger = bytes ? JSON.parse(bytes.toString()) : { version: 1, projectId, deviceId: status.device.id, revision: 0, received: {}, acknowledged: {} }; validateSyncJson(state);
  if (state.version !== 1 || state.projectId !== projectId || state.deviceId !== status.device.id || !Number.isSafeInteger(state.revision) || state.revision < 0 || !state.received || !state.acknowledged
    || Object.keys(state).some(key => !["version", "projectId", "deviceId", "revision", "localHead", "commonHead", "received", "acknowledged"].includes(key)) || [state.localHead, state.commonHead].some(id => id !== undefined && !digest.test(id))) throw new Error("Exchange state changed or belongs to another installation; inspect it, never reset automatically.");
  if (Object.keys(state.received).length > 20 || Object.keys(state.acknowledged).length > 20) throw new Error("Too many peers in this bounded project state.");
  for (const [peer, item] of Object.entries(state.received)) if (!safeSyncId(peer) || !digest.test(item.head) || !digest.test(item.inventory) || !Number.isFinite(Date.parse(item.receivedAt))) throw new Error("Invalid received-head record.");
  for (const [peer, id] of Object.entries(state.acknowledged)) if (!safeSyncId(peer) || !digest.test(id)) throw new Error("Invalid acknowledgement.");
  return { file, state, hash: bytes ? syncHash(bytes) : "" };
}
async function writeLedger(workspace: string, original: Awaited<ReturnType<typeof readLedger>>, state: Ledger) {
  const file = await privateSyncPath(workspace, `exchange/${state.projectId}/state.json`, true);
  await saveGuardedFile(path.dirname(file), path.basename(file), original.hash, Buffer.from(JSON.stringify({ ...state, revision: original.state.revision + 1 }, null, 2)), 200000);
}
export async function exchangeStatus(workspace: string, projectId: string) {
  const { state } = await readLedger(workspace, projectId); return { ...state, transport: "private files" as const, networkConnected: false, autoApply: false };
}
export async function rememberSyncHead(workspace: string, projectId: string, headId: string) {
  const saved = await readLedger(workspace, projectId), head = await hydrateStagedSnapshot(workspace, projectId, headId), status = await syncStatus(workspace);
  if (head.device.id !== status.device!.id || syncStateHash(head) !== syncStateHash(await captureSyncSnapshot(workspace, projectId))) throw new Error("Only an exact current local checkpoint can become the working head.");
  if (saved.state.localHead && saved.state.localHead !== headId && !head.ancestors.includes(saved.state.localHead)) throw new Error("A different local branch is already remembered; inspect it rather than choosing by date.");
  if (saved.state.localHead !== headId) await writeLedger(workspace, saved, { ...saved.state, localHead: headId }); return { projectId, head: headId, remembered: true, liveImport: false };
}
/** Known store counters/formatting are host-local, not authored differences.
 * Immutable runs and all unknown metadata remain exact and significant. */
export function semanticReviewContent(record?: SyncRecord) {
  if (!record) return undefined;
  if (record.path !== "data/workbench.json" || record.kind !== "review") throw new Error("Use the exact review record.");
  const data=JSON.parse(Buffer.from(record.data,"base64").toString()); validateSyncJson(data);
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Unknown review schema cannot be acknowledged."); validateWorkbench(data);
  delete (data as any).revision; delete data.queueLastActiveAt;
  const content=canonical(data); return content===canonical({ version:1,...emptyWorkbench() }) ? undefined : content;
}
export function semanticSyncHash(snapshot: SyncSnapshot) {
  return syncHash(canonical(snapshot.records.flatMap<Pick<SyncRecord,"path" | "kind" | "sha256">>(record => {
    let hash = record.sha256;
    if (record.kind === "review") { const content=semanticReviewContent(record); if (content===undefined) return []; return [{ path:record.path,kind:record.kind,sha256:syncHash(content) }]; }
    if (["catalogue", "experiment", "review", "policy"].includes(record.kind)) {
      const data = JSON.parse(Buffer.from(record.data, "base64").toString()); validateSyncJson(data);
      if (record.kind === "catalogue") { if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error("Invalid catalogue counters cannot be acknowledged."); validateNotebookEntries(data.entries); delete data.revision; }
      if (record.kind === "experiment") validateExperimentNotebook(data);
      hash = syncHash(canonical(data));
    }
    return [{ path: record.path, kind: record.kind, sha256: hash }];
  }).sort((a,b) => a.path.localeCompare(b.path))));
}
export async function acknowledgeSyncHead(workspace: string, projectId: string, headId: string) {
  const saved = await readLedger(workspace, projectId), head = await hydrateStagedSnapshot(workspace, projectId, headId), history = await stagedHistory(workspace, projectId, [headId]);
  if (history.missing.length || history.pending.length) throw new Error("Complete the checked head history before acknowledging.");
  const current = await captureSyncSnapshot(workspace, projectId);
  if (head.device.id === current.device.id || semanticSyncHash(current) !== semanticSyncHash(head)) throw new Error("Copies do not yet agree. Collect/review their differences first; receipt is not acceptance.");
  if (saved.state.localHead && head.id !== saved.state.localHead && !head.ancestors.includes(saved.state.localHead)) throw new Error("Incoming head does not include the remembered local branch.");
  const state = { ...saved.state, commonHead: headId, acknowledged: { ...saved.state.acknowledged, [head.device.id]: headId } };
  if (saved.state.commonHead !== headId || saved.state.acknowledged[head.device.id] !== headId) await writeLedger(workspace, saved, state);
  return { projectId, commonHead: headId, agrees: true, liveImport: false, approvalGranted: false, tasksCompleted: false, codeExecuted: false };
}
export async function syncWorkingCheckpoint(workspace: string, projectId: string, explicitParent?: string) {
  const saved = await readLedger(workspace, projectId); let parentId = explicitParent ?? saved.state.commonHead ?? saved.state.localHead;
  if (!parentId) {
    const cloneFile = await privateSyncPath(workspace, "clone-ready.json"); if (await optional(cloneFile)) { const receipt = JSON.parse((await readSyncBytes(cloneFile, 10000)).toString()); if (receipt.version !== 1 || receipt.projectId !== projectId || receipt.deviceId !== saved.state.deviceId || !digest.test(receipt.snapshotId)) throw new Error("First-copy scope does not match this working home."); parentId = receipt.snapshotId; }
    else if ((await stagedSnapshots(workspace, projectId)).length) throw new Error("Existing history needs an explicit initial --parent; do not reset it automatically.");
  }
  const local = saved.state.localHead ? await hydrateStagedSnapshot(workspace, projectId, saved.state.localHead) : undefined;
  // Prefer the current local descendant once it already includes the common head.
  if (!explicitParent && local && (!saved.state.commonHead || local.id === saved.state.commonHead || local.ancestors.includes(saved.state.commonHead))) parentId = local.id;
  const parent = parentId ? parentId === local?.id ? local : await hydrateStagedSnapshot(workspace, projectId, parentId) : undefined, snapshot = await captureSyncSnapshot(workspace, projectId, parent);
  const noAuthoredChanges = Boolean(local && semanticSyncHash(local) === semanticSyncHash(snapshot));
  if (local && noAuthoredChanges && syncStateHash(local) === syncStateHash(snapshot)
    && (!parent || local.id === parent.id || local.ancestors.includes(parent.id) || !explicitParent && parent.ancestors.includes(local.id) && semanticSyncHash(parent) === semanticSyncHash(snapshot))) return { ...(await saveSyncSnapshot(workspace, local)), ...(await stageSyncSnapshot(workspace, projectId, local)), reused: true, noAuthoredChanges: true };
  const result = await saveSyncSnapshot(workspace, snapshot), staged = await stageSyncSnapshot(workspace, projectId, snapshot);
  try { await rememberSyncHead(workspace, projectId, snapshot.id); } catch (error) { throw new Error(`Checkpoint preserved at ${result.path}; head not advanced: ${(error as Error).message}`); }
  return { ...result, ...staged, noAuthoredChanges };
}
export async function exportSyncExchange(workspace: string, projectId: string, headId: string, recipient?: SyncInventory) {
  const status = await syncStatus(workspace); if (!status.device || !digest.test(headId)) throw new Error("Use a named installation and exact staged head.");
  if (recipient) { validateSyncInventory(recipient); if (recipient.projectId !== projectId || recipient.device.id === status.device.id) throw new Error("Recipient inventory belongs to a different project or this same device."); }
  const history = await stagedHistory(workspace, projectId, [headId]); if (history.missing.length || history.pending.length) throw new Error("Export needs complete checked history; finish staging parents first.");
  const manifests: Manifest[] = [], wanted = new Map<string, Reference>(), knownSnapshots = new Set(recipient?.snapshots), knownBlobs = new Set(recipient?.blobs);
  let count = 0;
  for (const saved of history.graph.values()) {
    if ((count += saved.references.length) > exchangeLimits.references) throw new Error("Exchange history reference limit reached; use explicit archival planning.");
    if (!knownSnapshots.has(saved.metadata.id)) manifests.push({ ...saved.metadata, references: saved.references });
    for (const reference of saved.references) if (!knownBlobs.has(reference.sha256)) wanted.set(reference.sha256, reference);
  }
  const blobs: Exchange["blobs"] = []; let total = 0;
  for (const reference of wanted.values()) { const bytes = await readSyncBytes(await privateSyncPath(workspace, `blobs/${reference.sha256}.blob`), syncLimits.fileBytes); if (syncHash(bytes) !== reference.sha256 || bytes.length !== reference.bytes) throw new Error("Changed staged blob; export stopped."); if ((total += bytes.length) > exchangeLimits.blobs) throw new Error("Exchange exceeds 128 MB of unique data; supply the recipient's inventory."); blobs.push({ sha256: reference.sha256, bytes: reference.bytes, data: bytes.toString("base64") }); }
  const inventory = await createSyncInventory(workspace, projectId), body = { format: "aw-sync-exchange" as const, version: 1 as const, projectId, sender: status.device, head: headId, inventory, manifests, blobs }, packet: Exchange = { ...body, id: syncHash(canonical(body)) };
  const raw = Buffer.from(JSON.stringify(packet)); if (raw.length > exchangeLimits.expanded) throw new Error("Exchange exceeds expanded transfer limit."); const bytes = gzipSync(raw, { level: 6 }); if (bytes.length > exchangeLimits.compressed) throw new Error("Exchange exceeds 64 MB compressed; use a recipient inventory.");
  return { bytes, id: packet.id, head: headId, manifests: manifests.length, blobCount: blobs.length, dataBytes: total, compressedBytes: bytes.length, historyChecked: true, liveImport: false };
}
export async function exportExchangeForPeer(workspace: string, projectId: string, headId: string, peerId?: string) {
  const saved = await readLedger(workspace, projectId), known = peerId ? saved.state.received[peerId] : undefined;
  if (peerId && !known) throw new Error("No checked inventory from this peer; receive its exchange/inventory first.");
  const inventory = known ? await readSyncInventory(await privateSyncPath(workspace, `exchange/${projectId}/inventories/${known.inventory}.json`)) : undefined;
  return exportSyncExchange(workspace, projectId, headId, inventory);
}
export async function receiveSyncExchange(workspace: string, projectId: string, bytes: Buffer, hooks: { afterSnapshot?: (count: number) => void | Promise<void> } = {}) {
  if (bytes.length > exchangeLimits.compressed) throw new Error("Transfer exceeds 64 MB compressed.");
  const raw = gunzipSync(bytes, { maxOutputLength: exchangeLimits.expanded }), packet: Exchange = JSON.parse(raw.toString()); validateSyncJson(packet);
  const { id, ...body } = packet;
  if (packet.format !== "aw-sync-exchange" || packet.version !== 1 || packet.projectId !== projectId || !digest.test(packet.head) || syncHash(canonical(body)) !== id || Object.keys(packet).some(key => !["format", "version", "projectId", "sender", "head", "inventory", "manifests", "blobs", "id"].includes(key))
    || !Array.isArray(packet.manifests) || packet.manifests.length > syncLimits.ancestors + 3 || !Array.isArray(packet.blobs) || packet.blobs.length > exchangeLimits.references) throw new Error("Invalid/damaged exchange; nothing staged.");
  validateDevice(packet.sender); validateSyncInventory(packet.inventory);
  const local = await syncStatus(workspace); if (!local.device || packet.sender.id === local.device.id || packet.inventory.device.id !== packet.sender.id || packet.inventory.projectId !== projectId) throw new Error("Exchange sender/recipient identity is wrong.");
  const blobs = new Map<string, Buffer>(); let total = 0;
  for (const item of packet.blobs) { if (!item || !digest.test(item.sha256) || blobs.has(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > syncLimits.fileBytes || typeof item.data !== "string" || item.data.length > Math.ceil(item.bytes / 3) * 4) throw new Error("Invalid exchange blob."); const data = Buffer.from(item.data, "base64"); if (data.length !== item.bytes || data.toString("base64") !== item.data || syncHash(data) !== item.sha256 || (total += data.length) > exchangeLimits.blobs) throw new Error("Damaged or oversized exchange data."); blobs.set(item.sha256, data); }
  const snapshots = new Map<string, SyncSnapshot>(); let references = 0;
  for (const manifest of packet.manifests) {
    const { references: refs, ...metadata } = manifest;
    if (!Array.isArray(refs) || (references += refs.length) > exchangeLimits.references || refs.some(item => !validSyncReference(item)) || snapshots.has(metadata.id)) throw new Error("Invalid/duplicate exchange manifest.");
    const records: SyncRecord[] = [];
    for (const ref of refs) { const data = blobs.get(ref.sha256) ?? await readSyncBytes(await privateSyncPath(workspace, `blobs/${ref.sha256}.blob`), syncLimits.fileBytes); records.push({ ...ref, data: data.toString("base64") }); }
    const snapshot = { ...metadata, records }; validateSnapshot(snapshot); if (snapshot.projectId !== projectId) throw new Error("Manifest belongs to another project."); snapshots.set(snapshot.id, snapshot);
  }
  // Prevalidate the complete graph before publishing even a staging manifest.
  const available = new Map(snapshots), visiting = new Set<string>(), done = new Set<string>(), readyIds = new Set((await stagedSnapshots(workspace, projectId)).filter(item => item.ready).map(item => item.id));
  const ordered: SyncSnapshot[] = [];
  async function visit(head: string, depth = 0) {
    if (visiting.has(head) || depth > syncLimits.ancestors || available.size > syncLimits.ancestors + 3) throw new Error("Cyclic/excessive exchange history."); if (done.has(head)) return;
    let snapshot = available.get(head); if (!snapshot) { if (!readyIds.has(head)) throw new Error("Omitted exchange parent is missing or not ready; receive the full exchange first."); snapshot = await hydrateStagedSnapshot(workspace, projectId, head); available.set(head, snapshot); }
    visiting.add(head); for (const parent of snapshot.parents) await visit(parent, depth + 1); visiting.delete(head);
    const ancestors = [...new Set(snapshot.parents.flatMap(parent => [parent, ...available.get(parent)!.ancestors]))].sort();
    if (canonical(ancestors) !== canonical([...snapshot.ancestors].sort())) throw new Error("Exchange ancestry is not its actual checked graph.");
    const deleted = new Map(snapshot.tombstones.map(item => [item.path, item.previousHash])), paths = new Set(snapshot.records.map(item => item.path));
    for (const parent of snapshot.parents.map(id => available.get(id)!)) { for (const item of parent.tombstones) if (paths.has(item.path) || deleted.get(item.path) !== item.previousHash) throw new Error("Deletion history changed in exchange."); for (const record of parent.records) if (!paths.has(record.path) && deleted.get(record.path) !== record.sha256) throw new Error("Exchange lost file/deletion history."); }
    done.add(head); if (snapshots.has(head)) ordered.push(snapshot);
  }
  await visit(packet.head); if ([...snapshots.keys()].some(head => !done.has(head))) throw new Error("Exchange contains unrelated extra manifests.");
  if (!packet.inventory.snapshots.includes(packet.head)) throw new Error("Sender inventory does not include its advertised head.");
  const original = await readLedger(workspace, projectId); let count = 0;
  for (const snapshot of ordered) { await stageSyncSnapshot(workspace, projectId, snapshot); await hooks.afterSnapshot?.(++count); }
  const inventoryFile = await privateSyncPath(workspace, `exchange/${projectId}/inventories/${packet.inventory.id}.json`, true);
  await saveImmutableSyncArtifact(inventoryFile, Buffer.from(JSON.stringify(packet.inventory) + "\n"), 4 * 1024 * 1024);
  const prior = original.state.received[packet.sender.id];
  if (prior && prior.head !== packet.head) { const old = await hydrateStagedSnapshot(workspace, projectId, prior.head); if (!available.get(packet.head)!.ancestors.includes(old.id)) throw new Error("Peer offered a different branch; both staged copies retained. Compare explicitly, never pick a winner by date."); }
  if (prior?.head !== packet.head || prior.inventory !== packet.inventory.id) await writeLedger(workspace, original, { ...original.state, received: { ...original.state.received, [packet.sender.id]: { head: packet.head, inventory: packet.inventory.id, receivedAt: new Date().toISOString() } } });
  return { id, projectId, sender: packet.sender, head: packet.head, snapshotsStaged: ordered.length, dataBytes: total, received: true, liveImport: false, approvalGranted: false, codeExecuted: false, note: "Received evidence is staged, not accepted. Preview and explicitly collect before acknowledging agreement." };
}
