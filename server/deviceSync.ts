import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getProject, inside } from "./projects.ts";
import { projectDataPath } from "./projectStorage.ts";
import { sourceEntries } from "./sourceZip.ts";
import { withRecordLock } from "./recordLock.ts";
import { canonical, makeSnapshot, safeSyncId, syncLimits, syncRecord, validateDevice, validateSnapshot, type SyncDevice, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";

async function optionalStat(target: string) {
  try { return await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function safePath(root: string, relative: string, missing = false) {
  let target = root;
  for (const part of relative.split("/")) {
    if (!part || [".", ".."].includes(part) || /[\\:\x00-\x1f]/.test(part)) throw new Error("Invalid sync storage path.");
    target = path.join(target, part); const stat = await optionalStat(target);
    if (!stat && missing) continue;
    if (!stat || stat.isSymbolicLink() || !inside(root, await realpath(target))) throw new Error("Sync storage cannot follow links or leave Aw home.");
  }
  return target;
}
async function syncFolder(workspace: string, create = false) {
  const root = await realpath(workspace), folder = await safePath(root, ".paperfocus/device-sync", true);
  if (create) { await mkdir(folder, { recursive: true }); await safePath(root, ".paperfocus/device-sync"); }
  return { root, folder };
}
async function boundedFile(filename: string, maximum: number) {
  const info = await lstat(filename);
  if (info.isSymbolicLink() || !info.isFile() || info.size > maximum) throw new Error("Linked or oversized sync input. Nothing was imported.");
  const handle = await open(filename, "r");
  try {
    const before = await handle.stat();
    if (before.size !== info.size || before.mtimeMs !== info.mtimeMs || before.ctimeMs !== info.ctimeMs) throw new Error("A sync input changed while reading.");
    const bytes = Buffer.alloc(info.size + 1); let size = 0;
    while (size < bytes.length) { const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size); if (!bytesRead) break; size += bytesRead; }
    const after = await handle.stat();
    if (size !== info.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("A sync input changed while reading.");
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}
/** Fixed private sync namespace. Never a path into a manuscript checkout. */
export async function privateSyncPath(workspace: string, relative: string, createParent = false) {
  const { root } = await syncFolder(workspace, createParent);
  const target = await safePath(root, `.paperfocus/device-sync/${relative}`, true);
  if (createParent) {
    await mkdir(path.dirname(target), { recursive: true });
    const parent = relative.split("/").slice(0, -1).join("/");
    await safePath(root, `.paperfocus/device-sync${parent ? `/${parent}` : ""}`);
  }
  return target;
}
export const readSyncBytes = boundedFile;
export async function syncStatus(workspace: string) {
  const { root, folder } = await syncFolder(workspace), target = await safePath(root, ".paperfocus/device-sync/device.json", true);
  let device: SyncDevice | undefined;
  if (await optionalStat(target)) { device = JSON.parse((await boundedFile(target, 2000)).toString()); validateDevice(device); }
  return { version: 1, device, stage: "preview-only" as const, connected: false, applySupported: false, transportSupported: true,
    capabilities: { researchMerge: true, privateExchange: true, sshExchange: true, reviewedTwoCopySync: true, automaticSync: false, remoteCompute: false, protectedStateImport: false }, folder };
}
export async function initializeSyncDevice(workspace: string, label: string) {
  const device: SyncDevice = { version: 1, id: randomUUID(), label: label?.trim() }; validateDevice(device);
  const { root, folder } = await syncFolder(workspace, true), target = await safePath(root, ".paperfocus/device-sync/device.json", true);
  return withRecordLock(target, async () => {
    if (await optionalStat(target)) {
      const existing = await syncStatus(workspace);
      if (existing.device?.label !== device.label) throw new Error("This installation already has a device name. It was preserved; renaming/identity migration is not implemented yet.");
      return existing;
    }
    const handle = await open(path.join(folder, "device.json"), "wx");
    try { await handle.writeFile(JSON.stringify(device, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
    return syncStatus(workspace);
  });
}

const dataFolders = new Set(["experiments", "handoffs", "references", "research", "study-evidence", "trial-evidence"]);
function recordKind(name: string): SyncRecord["kind"] {
  if (name === "data/notebook.json") return "catalogue";
  if (name === "data/workbench.json") return "review";
  if (/^data\/experiments\/[^/]+\/notebook\.ipynb$/.test(name)) return "experiment";
  if (/^data\/experiments\/[^/]+\/runs\/[^/]+\.json$/.test(name)) return "run";
  return /\.(png|jpe?g|webp|gif|pdf|svg|npy|npz|csv)$/i.test(name) ? "asset" : "record";
}
async function captureRecords(workspace: string, projectId: string) {
  const home = await realpath(workspace), { project, root } = await getProject(home, projectId);
  if (!safeSyncId(projectId)) throw new Error("Choose a registered project.");
  const records = (await sourceEntries(home, projectId)).map(entry => syncRecord(`source/${entry.name}`, /\.(tex|bib|md|txt|py|json|yaml|yml|sty|cls)$/i.test(entry.name) ? "source" : "asset", entry.data));
  const data = projectDataPath(home, projectId), relativeData = path.relative(home, data).replaceAll("\\", "/");
  await safePath(home, relativeData, true);
  if (await optionalStat(path.join(root, ".paperfocus"))) throw new Error("Paper-local legacy Aw storage must be checked/migrated before making a sync snapshot. It was not changed.");
  if (await optionalStat(data)) {
    const catalogue = await safePath(home, `${relativeData}/project.json`, true);
    if (!(await optionalStat(catalogue))) throw new Error("Aw project data has no owning catalogue. Check it before capturing.");
    const owner = JSON.parse((await boundedFile(catalogue, 10000)).toString());
    if (owner.version !== 1 || owner.projectId !== projectId) throw new Error("Aw data belongs to another project.");
    let count = records.length, total = records.reduce((n, record) => n + record.bytes, 0);
    async function walk(relative: string, depth = 0) {
      if (depth > 24) throw new Error("Aw records are too deeply nested.");
      const folder = await safePath(home, `${relativeData}${relative ? `/${relative}` : ""}`);
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || /(?:\.tmp|\.aw-lock|\.previous\.(?:json|ipynb)|\.pyc)$/.test(entry.name) || entry.name === "__pycache__") continue;
        if (!relative && !(dataFolders.has(entry.name) || ["notebook.json", "workbench.json"].includes(entry.name))) continue;
        if (entry.isSymbolicLink()) throw new Error("Aw records contain a linked path; snapshot stopped.");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(name, depth + 1);
        else if (entry.isFile()) {
          if (++count > syncLimits.records) throw new Error("Too many sync records. No snapshot saved.");
          const bytes = await boundedFile(await safePath(home, `${relativeData}/${name}`), syncLimits.fileBytes);
          if ((total += bytes.length) > syncLimits.totalBytes) throw new Error("Sync snapshot exceeds 96 MB. No snapshot saved.");
          records.push(syncRecord(`data/${name}`, recordKind(`data/${name}`), bytes));
        }
      }
    }
    await walk("");
  }
  // Device-local paths, active UI selection, credentials and Git remotes are
  // not project policy. Publication purpose/lineage remain protected records.
  records.push(syncRecord("project/manuscripts.json", "policy", Buffer.from(JSON.stringify({ name: project.name, createdAt: project.createdAt,
    manuscriptPurposes: project.manuscriptPurposes ?? {}, manuscriptVersions: project.manuscriptVersions ?? [], manuscriptOverviewTargets: project.manuscriptOverviewTargets ?? {} }))));
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
export async function captureSyncSnapshot(workspace: string, projectId: string, parent?: SyncSnapshot) {
  const status = await syncStatus(workspace);
  if (!status.device) throw new Error("Name this installation with awSync init before capturing.");
  if (parent) { validateSnapshot(parent); if (parent.projectId !== projectId) throw new Error("Parent snapshot belongs to another project."); }
  const before = await captureRecords(workspace, projectId), after = await captureRecords(workspace, projectId);
  const fingerprint = (records: SyncRecord[]) => canonical(records.map(({ path: name, sha256, kind }) => ({ path: name, sha256, kind })));
  if (fingerprint(before) !== fingerprint(after)) throw new Error("Source or research records changed during capture. No snapshot saved; retry after saves settle.");
  const current = await syncStatus(workspace);
  if (current.device?.id !== status.device.id) throw new Error("Device identity changed during capture.");
  return makeSnapshot(projectId, status.device, before, parent);
}
export async function readSyncSnapshot(file: string): Promise<SyncSnapshot> {
  const snapshot = JSON.parse((await boundedFile(path.resolve(file), syncLimits.packetBytes)).toString("utf8"));
  validateSnapshot(snapshot); return snapshot;
}
export async function saveSyncSnapshot(workspace: string, snapshot: SyncSnapshot) {
  validateSnapshot(snapshot);
  const { root, folder } = await syncFolder(workspace, true), directory = path.join(folder, "snapshots");
  await safePath(root, ".paperfocus/device-sync/snapshots", true); await mkdir(directory, { recursive: true });
  const target = await safePath(root, `.paperfocus/device-sync/snapshots/${snapshot.id}.json`, true);
  return withRecordLock(target, async () => {
    if (await optionalStat(target)) {
      if (canonical(await readSyncSnapshot(target)) !== canonical(snapshot)) throw new Error("Saved snapshot differs; it was preserved.");
      return { path: target, reused: true, id: snapshot.id };
    }
    const handle = await open(target, "wx");
    try { await handle.writeFile(JSON.stringify(snapshot) + "\n"); await handle.sync(); } finally { await handle.close(); }
    return { path: target, reused: false, id: snapshot.id };
  });
}
