import { createHash } from "node:crypto";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateExperimentNotebook } from "../src/experiments.ts";

export const syncLimits = { version: 1, records: 5000, fileBytes: 24 * 1024 * 1024, totalBytes: 96 * 1024 * 1024, packetBytes: 140 * 1024 * 1024, ancestors: 256 };
export interface SyncDevice { version: 1; id: string; label: string }
export type SyncKind = "source" | "catalogue" | "experiment" | "run" | "review" | "asset" | "record" | "policy";
export interface SyncRecord { path: string; kind: SyncKind; sha256: string; bytes: number; data: string }
export interface SyncSnapshot {
  format: "aw-device-snapshot"; version: 1; id: string; projectId: string; device: SyncDevice;
  createdAt: string; parents: string[]; ancestors: string[]; records: SyncRecord[];
  tombstones: Array<{ path: string; previousHash: string }>;
}
export interface SyncConflict { path: string; field: string; reason: string; base?: unknown; local?: unknown; remote?: unknown }
export interface SyncPlan {
  format: "aw-device-merge-preview"; version: 1; projectId: string; base: string; local: string; remote: string;
  applySupported: false; records: SyncRecord[]; deletions: string[]; conflicts: SyncConflict[];
  summary: { unchanged: number; automatic: number; conflicts: number; retainedRuns: number };
}
export const syncHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const digest = /^[a-f0-9]{64}$/;
const kinds = new Set<SyncKind>(["source", "catalogue", "experiment", "run", "review", "asset", "record", "policy"]);
export const safeSyncId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id);
export function safeSyncPath(name: unknown): name is string {
  return typeof name === "string" && name.length <= 500 && /^(?:source|data|project)\//.test(name) && !/[\\:\x00-\x1f]/.test(name)
    && name.split("/").every(part => part && ![".", ".."].includes(part) && !part.endsWith(".") && !part.endsWith(" "));
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
function safeJson(value: unknown, depth = 0, budget = { count: 100000 }) {
  if (depth > 48 || --budget.count < 0) throw new Error("Sync record is too complex.");
  if (Array.isArray(value)) for (const item of value) safeJson(item, depth + 1, budget);
  else if (object(value)) for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Unsafe sync record key.");
    safeJson(item, depth + 1, budget);
  }
}
export const validateSyncJson = safeJson;
export function syncRecord(name: string, kind: SyncKind, bytes: Buffer): SyncRecord {
  return { path: name, kind, bytes: bytes.length, sha256: syncHash(bytes), data: bytes.toString("base64") };
}
export function validSyncReference(record: Omit<SyncRecord, "data">): boolean {
  return Boolean(record && safeSyncPath(record.path) && kinds.has(record.kind) && digest.test(record.sha256) && Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= syncLimits.fileBytes
    && (record.kind !== "catalogue" || record.path === "data/notebook.json")
    && (record.kind !== "review" || record.path === "data/workbench.json")
    && (record.kind !== "policy" || record.path === "project/manuscripts.json")
    && (record.kind !== "experiment" || /^data\/experiments\/[^/]+\/notebook\.ipynb$/.test(record.path))
    && (record.kind !== "run" || /^data\/experiments\/[^/]+\/runs\/[^/]+\.json$/.test(record.path))
    && (record.kind !== "source" || record.path.startsWith("source/")));
}
export function validateDevice(device: unknown): asserts device is SyncDevice {
  if (!object(device) || device.version !== 1 || !safeSyncId(device.id) || typeof device.label !== "string" || !device.label.trim() || device.label.length > 60 || /[\x00-\x1f]/.test(device.label)) throw new Error("Invalid device identity.");
}
export function validateSnapshot(value: unknown): asserts value is SyncSnapshot {
  const packet = value as SyncSnapshot;
  if (!packet || packet.format !== "aw-device-snapshot" || packet.version !== syncLimits.version) throw new Error("Unsupported sync format. Update Aw before comparing; no records changed.");
  safeJson(packet);
  validateDevice(packet.device);
  if (Object.keys(packet).some(key => !["format", "version", "id", "projectId", "device", "createdAt", "parents", "ancestors", "records", "tombstones"].includes(key))) throw new Error("Unsupported snapshot header fields.");
  if (!safeSyncId(packet.projectId) || !digest.test(packet.id) || typeof packet.createdAt !== "string" || !Number.isFinite(Date.parse(packet.createdAt)) || !Array.isArray(packet.parents) || packet.parents.length > 2 || !Array.isArray(packet.ancestors) || packet.ancestors.length > syncLimits.ancestors || !Array.isArray(packet.records) || packet.records.length > syncLimits.records || !Array.isArray(packet.tombstones) || packet.tombstones.length > syncLimits.records) throw new Error("Invalid snapshot header.");
  if ([...packet.parents, ...packet.ancestors].some(id => !digest.test(id) || id === packet.id) || new Set(packet.ancestors).size !== packet.ancestors.length || new Set(packet.parents).size !== packet.parents.length || packet.parents.some(id => !packet.ancestors.includes(id))) throw new Error("Invalid snapshot ancestry.");
  const paths = new Set<string>(); let total = 0;
  for (const record of packet.records) {
    if (!validSyncReference(record) || paths.has(record.path.toLowerCase()) || (total += record.bytes) > syncLimits.totalBytes || typeof record.data !== "string" || record.data.length > Math.ceil(record.bytes / 3) * 4) throw new Error("Invalid or oversized snapshot file.");
    paths.add(record.path.toLowerCase());
    const bytes = Buffer.from(record.data, "base64");
    if (bytes.length !== record.bytes || bytes.toString("base64") !== record.data || syncHash(bytes) !== record.sha256) throw new Error("Snapshot checksum mismatch. Keep the original and transfer again.");
  }
  for (const item of packet.tombstones) {
    if (!item || !safeSyncPath(item.path) || paths.has(item.path.toLowerCase()) || !digest.test(item.previousHash)) throw new Error("Invalid deletion history.");
    paths.add(item.path.toLowerCase());
  }
  const { id, ...body } = packet;
  if (syncHash(canonical(body)) !== id) throw new Error("Snapshot manifest checksum mismatch.");
}
export function makeSnapshot(projectId: string, device: SyncDevice, records: SyncRecord[], parent?: SyncSnapshot): SyncSnapshot {
  if (parent) { validateSnapshot(parent); if (parent.projectId !== projectId) throw new Error("The parent belongs to another project."); }
  const paths = new Set(records.map(record => record.path));
  if (parent?.tombstones.some(item => paths.has(item.path))) throw new Error("A previously deleted path reappeared. Preserve both versions for deliberate restoration.");
  const body = { format: "aw-device-snapshot" as const, version: 1 as const, projectId, device, createdAt: new Date().toISOString(),
    parents: parent ? [parent.id] : [], ancestors: parent ? [...new Set([parent.id, ...parent.ancestors])] : [],
    records: [...records].sort((a, b) => a.path.localeCompare(b.path)),
    tombstones: [...(parent?.tombstones ?? []), ...(parent?.records.filter(record => !paths.has(record.path)).map(record => ({ path: record.path, previousHash: record.sha256 })) ?? [])].sort((a, b) => a.path.localeCompare(b.path)) };
  const snapshot = { ...body, id: syncHash(canonical(body)) }; validateSnapshot(snapshot); return snapshot;
}

/** Both inputs must have been collected/reconciled, not merely received. A
 * merge head preserves their complete graph; it is never used for a partial batch. */
export function makeMergedSnapshot(projectId: string, device: SyncDevice, records: SyncRecord[], parents: [SyncSnapshot, SyncSnapshot]): SyncSnapshot {
  parents.forEach(validateSnapshot);
  if (parents.some(parent => parent.projectId !== projectId) || parents[0].id === parents[1].id) throw new Error("Merge head needs two distinct parents of this project.");
  const paths = new Set(records.map(record => record.path)), deleted = new Map<string, string>();
  for (const parent of parents) {
    for (const item of parent.tombstones) {
      if (paths.has(item.path) || deleted.has(item.path) && deleted.get(item.path) !== item.previousHash) throw new Error("Merge head cannot erase or resurrect deletion history."); deleted.set(item.path, item.previousHash);
    }
    for (const record of parent.records) if (!paths.has(record.path)) { if (deleted.has(record.path) && deleted.get(record.path) !== record.sha256) throw new Error("Ambiguous deleted variants remain held."); deleted.set(record.path, record.sha256); }
  }
  const body = { format: "aw-device-snapshot" as const, version: 1 as const, projectId, device, createdAt: new Date().toISOString(), parents: parents.map(parent => parent.id),
    ancestors: [...new Set(parents.flatMap(parent => [parent.id, ...parent.ancestors]))].sort(), records: [...records].sort((a,b) => a.path.localeCompare(b.path)),
    tombstones: [...deleted].sort(([a],[b]) => a.localeCompare(b)).map(([name,previousHash]) => ({ path:name,previousHash })) };
  const snapshot = { ...body, id: syncHash(canonical(body)) }; validateSnapshot(snapshot); return snapshot;
}

function mergeJson(base: unknown, local: unknown, remote: unknown, file: string, field: string, conflicts: SyncConflict[]): unknown {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  // Display-only chronology is not a winner for authored content. Keep a
  // deterministic timestamp without turning independent note fields into conflicts.
  if (field.split("/").at(-1) === "updatedAt" && typeof local === "string" && typeof remote === "string") return [local, remote].sort().at(-1);
  const conflict = (reason: string) => { conflicts.push({ path: file, field, reason, base, local, remote }); return local; };
  if (local === undefined || remote === undefined) return conflict("deletion-versus-edit");
  if (base === undefined && object(local) && object(remote) && typeof local.id === "string") return conflict("independent-id-collision");
  // Source captures/return anchors are indivisible ownership statements.
  if (["source", "returnAnchor", "ticket", "notebookResult"].includes(field.split("/").at(-1) ?? "")) return conflict("overlapping-text-or-anchor");
  // A code cell is an execution/provenance unit, not independent JSON fields.
  if (object(local) && object(remote) && (local.cell_type === "code" || remote.cell_type === "code")) return conflict("experiment-code-or-output");
  if (object(local) && object(remote) && (base === undefined || object(base))) {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of [...new Set([...Object.keys((base ?? {}) as object), ...Object.keys(local), ...Object.keys(remote)])].sort()) {
      const merged = mergeJson(object(base) ? base[key] : undefined, local[key], remote[key], file, `${field}/${encodeURIComponent(key)}`, conflicts);
      if (merged !== undefined) result[key] = merged;
    }
    return result;
  }
  const keyed = (array: unknown[]): array is Array<Record<string, unknown> & { id: string }> => array.every(item => object(item) && typeof item.id === "string") && new Set(array.map(item => (item as { id: string }).id)).size === array.length;
  if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base)) && keyed(local) && keyed(remote) && keyed((base ?? []) as unknown[])) {
    const old = new Map(((base ?? []) as Array<{ id: string }>).map(item => [item.id, item])), left = new Map(local.map(item => [item.id, item])), right = new Map(remote.map(item => [item.id, item]));
    const common = [...old.keys()].filter(id => left.has(id) && right.has(id));
    const order = (array: Array<{ id: string }>) => array.map(item => item.id).filter(id => common.includes(id));
    const b = order([...old.values()]), l = order(local), r = order(remote);
    if (!same(l, r) && !same(l, b) && !same(r, b)) conflicts.push({ path: file, field: `${field}/order`, reason: "concurrent-reordering", base: b, local: l, remote: r });
    const preferred = !same(r, b) && same(l, b) ? remote : !same(l, b) && same(r, b) ? local
      : canonical(local.map(item => item.id)) < canonical(remote.map(item => item.id)) ? local : remote;
    const ids = [...new Set([...preferred.map(item => item.id), ...[...left.keys(), ...right.keys(), ...old.keys()].sort()])];
    return ids.map(id => mergeJson(old.get(id), left.get(id), right.get(id), file, `${field}/${encodeURIComponent(id)}`, conflicts)).filter(item => item !== undefined);
  }
  return conflict("overlapping-change");
}

export function previewSync(base: SyncSnapshot, local: SyncSnapshot, remote: SyncSnapshot): SyncPlan {
  for (const snapshot of [base, local, remote]) validateSnapshot(snapshot);
  if (base.projectId !== local.projectId || base.projectId !== remote.projectId) throw new Error("Snapshots belong to different projects.");
  if (local.device.id === remote.device.id) throw new Error("Both copies have the same device ID. Set up a distinct identity before synchronizing.");
  if (![local, remote].every(snapshot => snapshot.id === base.id || snapshot.ancestors.includes(base.id))) throw new Error("No confirmed shared baseline. Do not guess from dates or filenames.");
  const maps = [base, local, remote].map(snapshot => new Map(snapshot.records.map(record => [record.path, record])));
  const plan: SyncPlan = { format: "aw-device-merge-preview", version: 1, projectId: base.projectId, base: base.id, local: local.id, remote: remote.id,
    applySupported: false, records: [], deletions: [], conflicts: [], summary: { unchanged: 0, automatic: 0, conflicts: 0, retainedRuns: 0 } };
  const paths = [...new Set([...maps.flatMap(map => [...map.keys()]), ...base.tombstones.map(item => item.path)])].sort();
  // Reject cross-platform casing ambiguity across packets, not just within one.
  if (new Set(paths.map(name => name.toLowerCase())).size !== paths.length) throw new Error("File paths differ only by letter case. Keep both and rename deliberately before syncing.");
  for (const name of paths) {
    const [b, l, r] = maps.map(map => map.get(name)), hashes = [b, l, r].map(record => record?.sha256);
    const conflict = (reason: string) => plan.conflicts.push({ path: name, field: "", reason, base: b, local: l, remote: r });
    try {
      for (const record of [b, l, r]) {
        if (!record || !["catalogue", "experiment"].includes(record.kind)) continue;
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(record.data, "base64"))); safeJson(value);
        if (record.kind === "catalogue") {
          if (!object(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error("Unknown catalogue schema.");
          validateNotebookEntries(value.entries);
        } else validateExperimentNotebook(value);
      }
    } catch { conflict("unsupported-or-invalid-record-schema"); continue; }
    if (base.tombstones.some(item => item.path === name) && (l || r)) { conflict("resurrection-needs-review"); continue; }
    if (new Set([b, l, r].filter(Boolean).map(record => record!.kind)).size > 1) { conflict("record-kind-changed"); continue; }
    if ((b?.kind === "run") && (hashes[0] !== hashes[1] || hashes[0] !== hashes[2])) { conflict("immutable-run-changed-or-removed"); continue; }
    let selected: SyncRecord | undefined;
    if (hashes[1] === hashes[2]) { selected = l; plan.summary.unchanged += hashes[1] === hashes[0] ? 1 : 0; }
    else if (hashes[0] === hashes[1]) selected = r;
    else if (hashes[0] === hashes[2]) selected = l;
    else if (!l || !r) { conflict("deletion-versus-edit"); continue; }
    else if (["catalogue", "experiment"].includes(l.kind)) {
      try {
        const data = [b, l, r].map(record => record ? JSON.parse(Buffer.from(record.data, "base64").toString("utf8")) : undefined);
        for (const value of data) safeJson(value);
        // Per-host counters are not distributed revisions. Preview rebases them
        // only as a candidate; a future guarded collector assigns the real one.
        if (l.kind === "catalogue") for (const value of data) {
          if (value && (!object(value) || value.version !== 1 || !Array.isArray(value.entries))) throw new Error("Unknown catalogue schema.");
          if (value) { validateNotebookEntries(value.entries); delete value.revision; }
        }
        if (l.kind === "experiment") for (const value of data) if (value) validateExperimentNotebook(value);
        const count = plan.conflicts.length, merged = mergeJson(data[0], data[1], data[2], name, "", plan.conflicts);
        if (plan.conflicts.length === count) {
          if (l.kind === "catalogue") validateNotebookEntries((merged as { entries: unknown }).entries);
          else validateExperimentNotebook(merged);
          selected = syncRecord(name, l.kind, Buffer.from(JSON.stringify(merged, null, 2) + "\n"));
        }
      } catch { conflict("unsupported-or-invalid-record-schema"); }
    } else { conflict(l.kind === "source" ? "overlapping-manuscript-edits" : "protected-or-binary-record"); continue; }
    if (selected) { plan.records.push(selected); if (selected.kind === "run") plan.summary.retainedRuns++; }
    else if (b && !l && !r || b && hashes[0] === hashes[1] && !r || b && hashes[0] === hashes[2] && !l) plan.deletions.push(name);
    if (selected && selected.sha256 !== b?.sha256 || plan.deletions.at(-1) === name) plan.summary.automatic++;
  }
  plan.summary.conflicts = plan.conflicts.length;
  return plan;
}
