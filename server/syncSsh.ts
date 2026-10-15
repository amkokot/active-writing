// SSH transports bounded exchange messages, not Python jobs or editor HTTP.
// Credentials/host trust stay in the user's SSH configuration. No listener,
// password prompt, host-key acceptance, automatic retry, or imported execution.
import { spawn } from "node:child_process";
import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { readSyncBytes, privateSyncPath, syncStatus } from "./deviceSync.ts";
import { canonical, safeSyncId, syncHash, validateSyncJson } from "./syncProtocol.ts";
import { createSyncInventory, exchangeLimits, exportExchangeForPeer, exportSyncExchange, receiveSyncExchange, syncWorkingCheckpoint, validateSyncInventory } from "./syncExchange.ts";
import { saveImmutableSyncArtifact, previewStagedSync } from "./syncStaging.ts";
import { previewResearchMerge } from "./syncResearchMerge.ts";

const digest = /^[a-f0-9]{64}$/;
export interface SshPeerOptions { host: string; platform: "windows" | "posix"; tool: string; workspace: string; deviceId: string }
interface Peer { version: 1; format: "aw-ssh-peer"; projectId: string; localDeviceId: string; options: SshPeerOptions; id: string }
export type SshRunner = (host: string, command: string, input: Buffer, maximum: number, timeoutMs: number) => Promise<Buffer>;
function peerOptions(options: SshPeerOptions) {
  validateSyncJson(options);
  if (!options || Object.keys(options).some(key => !["host", "platform", "tool", "workspace", "deviceId"].includes(key)) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.host)
    || !["windows", "posix"].includes(options.platform) || !safeSyncId(options.deviceId)) throw new Error("Use a saved SSH host alias, OS and exact other device ID. Credentials stay outside Aw.");
  for (const value of [options.tool, options.workspace]) {
    if (typeof value !== "string" || value.length > 500 || /[\x00-\x1f\x7f]/.test(value) || (options.platform === "windows" ? !/^[A-Za-z]:[\\/]/.test(value) : !/^\/(?!\/)/.test(value)) || value.replaceAll("\\", "/").split("/").some(part => part === "..")) throw new Error("Use absolute remote paths without control characters or parent traversal.");
  }
  if (!/[\\/]scripts[\\/]awSync\.ts$/.test(options.tool)) throw new Error("Point to the installed remote scripts/awSync.ts tool, not arbitrary shell code.");
  return options;
}
export function sshPeerCommand(options: SshPeerOptions, projectId: string) {
  peerOptions(options); if (!safeSyncId(projectId)) throw new Error("Use an exact project ID.");
  if (options.platform === "windows") {
    const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const script = `& node ${q(options.tool)} exchange-stdio --workspace ${q(options.workspace)} --project ${q(projectId)}; exit $LASTEXITCODE`;
    return `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
  }
  const q = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  return `exec node ${q(options.tool)} exchange-stdio --workspace ${q(options.workspace)} --project ${q(projectId)}`;
}
export async function previewSshPeer(workspace: string, projectId: string, options: SshPeerOptions) {
  peerOptions(options); if (!safeSyncId(projectId)) throw new Error("Use an exact project."); const device = (await syncStatus(workspace)).device;
  if (!device || device.id === options.deviceId) throw new Error("Name this installation and select a distinct other device.");
  const body = { version: 1 as const, format: "aw-ssh-peer" as const, projectId, localDeviceId: device.id, options }, peer = { ...body, id: syncHash(canonical(body)) };
  return { ...peer, configured: false, networkContacted: false, note: "This pins the SSH alias, remote tool/data home and device identity. Install Node/Aw and clone the project there separately; verify its SSH host key outside Aw first." };
}
export async function commitSshPeer(workspace: string, projectId: string, options: SshPeerOptions, id: string) {
  const preview = await previewSshPeer(workspace, projectId, options); if (preview.id !== id) throw new Error("Peer settings changed. Preview again; no network contact made.");
  const peer: Peer = { version: 1, format: "aw-ssh-peer", projectId, localDeviceId: preview.localDeviceId, options, id };
  const file = await privateSyncPath(workspace, `peers/${projectId}/${id}.json`, true); await saveImmutableSyncArtifact(file, Buffer.from(JSON.stringify(peer) + "\n"), 10000);
  return { id, projectId, host: options.host, deviceId: options.deviceId, configured: true, networkContacted: false, path: file };
}
export async function readSshPeer(workspace: string, projectId: string, id: string) {
  if (!digest.test(id) || !safeSyncId(projectId)) throw new Error("Use exact project/peer plan IDs."); const peer: Peer = JSON.parse((await readSyncBytes(await privateSyncPath(workspace, `peers/${projectId}/${id}.json`), 10000)).toString()); validateSyncJson(peer);
  const { id: stored, ...body } = peer;
  if (peer.format !== "aw-ssh-peer" || peer.version !== 1 || peer.projectId !== projectId || stored !== id || syncHash(canonical(body)) !== id || peer.localDeviceId !== (await syncStatus(workspace)).device?.id) throw new Error("Peer configuration changed or belongs to another installation."); peerOptions(peer.options); return peer;
}
export async function listSshPeers(workspace: string, projectId: string) {
  const folder = path.dirname(await privateSyncPath(workspace, `peers/${projectId}/placeholder.json`));
  try { if (!(await lstat(folder)).isDirectory()) throw new Error("Peer records are not a directory."); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const entries = await readdir(folder, { withFileTypes: true }); if (entries.length > 50) throw new Error("Use explicit IDs for more than fifty peer preparations.");
  const result = [];
  for (const entry of entries.filter(item => /^[a-f0-9]{64}\.json$/.test(item.name))) { const peer = await readSshPeer(workspace, projectId, entry.name.slice(0,-5)); result.push({ id: peer.id, host: peer.options.host, deviceId: peer.options.deviceId, platform: peer.options.platform }); }
  return result;
}
export const runSshMessage: SshRunner = async (host, command, input, maximum, timeoutMs) => {
  if (input.length > exchangeLimits.expanded) throw new Error("SSH input exceeds transfer limit.");
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=8", "--", host, command], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [], errors: Buffer[] = []; let size = 0, errorSize = 0, failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error("SSH exchange timed out. Staged/checkpoint files are retained; nothing was retried or executed."); child.kill(); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { if ((size += chunk.length) > maximum) { failure = new Error("SSH response exceeds its bounded transfer budget."); child.kill(); } else chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { if (errorSize < 8192) { errors.push(chunk.subarray(0, 8192 - errorSize)); errorSize += Math.min(chunk.length, 8192 - errorSize); } });
    child.stdin.on("error", error => { failure ??= error; }); child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0) reject(new Error(`SSH exchange unavailable (${code}). ${Buffer.concat(errors).toString().slice(0, 2000)} Work stays local; verify SSH setup outside Aw.`)); else resolve(Buffer.concat(chunks)); });
    child.stdin.end(input);
  });
};
interface Message { version: 1; expectedDeviceId: string; action: "inventory" | "export" | "receive" | "preview-merge" | "commit-merge"; inventory?: unknown; bytes?: string; maxBytes: number;
  localHead?: string; remoteHead?: string; syncId?: string; originalPlan?: string; originalReview?: string; afterSemanticHash?: string }
export async function handleExchangeMessage(workspace: string, projectId: string, value: unknown) {
  validateSyncJson(value); const message = value as Message;
  const extras = message?.action === "preview-merge" ? ["localHead", "remoteHead"] : message?.action === "commit-merge" ? ["localHead", "remoteHead", "syncId", "originalPlan", "originalReview", "afterSemanticHash"] : message?.action === "export" ? ["inventory"] : message?.action === "receive" ? ["bytes"] : [];
  if (!message || message.version !== 1 || !safeSyncId(message.expectedDeviceId) || !["inventory", "export", "receive", "preview-merge", "commit-merge"].includes(message.action) || !Number.isSafeInteger(message.maxBytes) || message.maxBytes < 1024 || message.maxBytes > exchangeLimits.compressed
    || Object.keys(message).some(key => !["version", "expectedDeviceId", "action", "maxBytes", ...extras].includes(key)) || message.expectedDeviceId !== (await syncStatus(workspace)).device?.id) throw new Error("Invalid SSH message or wrong remote device. Nothing was executed/imported.");
  if (message.action === "preview-merge") {
    if (!digest.test(message.localHead ?? "") || !digest.test(message.remoteHead ?? "")) throw new Error("Use exact staged heads.");
    const compared = await previewStagedSync(workspace, projectId, message.localHead!, message.remoteHead!); return { version: 1, planId: compared.id, merge: await previewResearchMerge(workspace, projectId, compared.id), liveImport: false };
  }
  if (message.action === "commit-merge") {
    const { remoteReviewedMerge } = await import("./syncPaired.ts");
    return remoteReviewedMerge(workspace, projectId, { syncId: message.syncId!, originalPlan: message.originalPlan!, originalReview: message.originalReview!, localHead: message.localHead!, remoteHead: message.remoteHead!, afterSemanticHash: message.afterSemanticHash! });
  }
  if (message.action === "inventory") { if (message.inventory !== undefined || message.bytes !== undefined) throw new Error("Inventory message accepts no payload."); return { version: 1, inventory: await createSyncInventory(workspace, projectId), liveImport: false }; }
  if (message.action === "export") {
    if (message.bytes !== undefined) throw new Error("Export accepts only the recipient inventory."); validateSyncInventory(message.inventory);
    if (message.inventory.projectId !== projectId || message.inventory.device.id === message.expectedDeviceId) throw new Error("Wrong project/recipient inventory.");
    const checkpoint = await syncWorkingCheckpoint(workspace, projectId), result = await exportSyncExchange(workspace, projectId, checkpoint.id, message.inventory);
    if (result.bytes.length > message.maxBytes) throw new Error("Remote exchange exceeds the approved byte budget. Checkpoint retained; use an explicit larger budget or file transfer.");
    return { version: 1, head: result.head, bytes: result.bytes.toString("base64"), liveImport: false };
  }
  if (message.inventory !== undefined || typeof message.bytes !== "string" || message.bytes.length > Math.ceil(message.maxBytes / 3) * 4) throw new Error("Oversized/invalid received SSH message.");
  const bytes = Buffer.from(message.bytes, "base64"); if (bytes.length > message.maxBytes || bytes.toString("base64") !== message.bytes) throw new Error("Invalid received transfer encoding."); return { version: 1, ...await receiveSyncExchange(workspace, projectId, bytes) };
}
export async function reconnectSshPeer(workspace: string, projectId: string, peerId: string, options: { maxBytes?: number; timeoutMs?: number; runner?: SshRunner } = {}) {
  const peer = await readSshPeer(workspace, projectId, peerId), maximum = options.maxBytes ?? 16 * 1024 * 1024, timeout = options.timeoutMs ?? 60000;
  if (!Number.isSafeInteger(maximum) || maximum < 1024 || maximum > exchangeLimits.compressed || !Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 120000) throw new Error("Use a bounded SSH transfer budget (at most 64 MB and 120 seconds per message).");
  const runner = options.runner ?? runSshMessage, command = sshPeerCommand(peer.options, projectId), local = await syncWorkingCheckpoint(workspace, projectId);
  const send = async (action: Message["action"], payload: Partial<Message> = {}) => {
    const input = Buffer.from(JSON.stringify({ version: 1, expectedDeviceId: peer.options.deviceId, action, maxBytes: maximum, ...payload })), output = await runner(peer.options.host, command, input, Math.ceil(maximum / 3) * 4 + 5 * 1024 * 1024, timeout);
    if (output.length > Math.ceil(maximum / 3) * 4 + 5 * 1024 * 1024) throw new Error("SSH adapter exceeded the response budget."); const result = JSON.parse(output.toString()); validateSyncJson(result); if (result.version !== 1 || result.liveImport !== false) throw new Error("Unexpected SSH reply; no remote live imports are allowed."); return result;
  };
  const remote = await send("inventory"); validateSyncInventory(remote.inventory); if (remote.inventory.device.id !== peer.options.deviceId || remote.inventory.projectId !== projectId) throw new Error("Remote identity/project does not match the pinned peer.");
  const response = await send("export", { inventory: await createSyncInventory(workspace, projectId) });
  if (typeof response.bytes !== "string" || response.bytes.length > Math.ceil(maximum / 3) * 4) throw new Error("Remote exchange exceeds the pinned budget."); const bytes = Buffer.from(response.bytes, "base64"); if (bytes.toString("base64") !== response.bytes || bytes.length > maximum) throw new Error("Invalid remote encoding.");
  const received = await receiveSyncExchange(workspace, projectId, bytes); if (received.sender.id !== peer.options.deviceId) throw new Error("Received snapshot is not from the pinned peer; staged variants retained.");
  const outgoing = await exportExchangeForPeer(workspace, projectId, local.id, peer.options.deviceId); if (outgoing.bytes.length > maximum) throw new Error("Local exchange exceeds the approved byte budget; nothing sent for remote collection.");
  await send("receive", { bytes: outgoing.bytes.toString("base64") });
  const compared = await previewStagedSync(workspace, projectId, local.id, received.head), merge = await previewResearchMerge(workspace, projectId, compared.id);
  return { projectId, peerId, host: peer.options.host, localHead: local.id, remoteHead: received.head, planId: compared.id, merge, connected: true, receivedBytes: bytes.length, sentBytes: outgoing.bytes.length, liveImport: false, codeExecuted: false,
    note: "Both copies have staged the other's saved work. Collect this preview explicitly; the remote editor and compute were not started/stopped or edited." };
}
