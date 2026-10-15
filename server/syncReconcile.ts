import path from "node:path";
import { captureSyncSnapshot, privateSyncPath, readSyncBytes } from "./deviceSync.ts";
import { checkSyncLocalState, saveImmutableSyncArtifact, stagedPlan, syncStateHash } from "./syncStaging.ts";
import { canonical, safeSyncId, safeSyncPath, syncHash, syncLimits, syncRecord, validateSyncJson, type SyncConflict, type SyncPlan, type SyncRecord, type SyncSnapshot } from "./syncProtocol.ts";
import { mergeLiteralText, textMergeLimits } from "./syncText.ts";
import { validateWorkbench } from "./workbenchStore.ts";

const proposalLimit = 4 * 1024 * 1024, digest = /^[a-f0-9]{64}$/;
export interface Decision { conflictId: string; choice: "local" | "remote" | "text"; text?: string; note?: string }
export interface Decisions { version: 1; projectId: string; planId: string; decisions: Decision[] }
export interface ProposedFile { path: string; sha256: string; method: "literal-text" | Decision["choice"]; conflictId: string }
export interface Proposal extends Decisions { format: "aw-sync-reconciliation"; id: string; files: ProposedFile[]; remaining: string[]; liveImport: false; approvalGranted: false }
export const syncConflictId = (conflict: SyncConflict) => syncHash(canonical(conflict));
function text(record?: SyncRecord) {
  if (!record || record.bytes > textMergeLimits.bytes) return undefined;
  try {
    const bytes = Buffer.from(record.data, "base64"), result = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result) && Buffer.from(result).equals(bytes) ? result : undefined;
  } catch { return undefined; }
}
function record(value: unknown): SyncRecord | undefined {
  return value && typeof value === "object" && "data" in value ? value as SyncRecord : undefined;
}
export function syncLockedFiles(snapshots: SyncSnapshot[]) {
  const files = new Set<string>(); let unknown = false;
  for (const snapshot of snapshots) {
    const saved = snapshot.records.find(item => item.path === "data/workbench.json"); if (!saved) continue;
    try {
      const data = JSON.parse(Buffer.from(saved.data, "base64").toString()); validateSyncJson(data); if (data.version !== undefined && data.version !== 1) throw new Error("Unknown review schema"); validateWorkbench(data);
      for (const task of data.attentionTasks) {
        const writing = task.writing;
        const locked = writing?.kind === "paragraph" && writing.decision === "accepted" && !writing.unlockedAt;
        const requestedLocks = writing?.kind === "request" ? writing.lockedParagraphIds : undefined;
        if (!locked && !requestedLocks?.length) continue;
        const paragraphs = locked ? task.sourceSnapshot?.paragraphs : task.sourceSnapshot?.paragraphs.filter(paragraph => requestedLocks!.includes(paragraph.id));
        if (!paragraphs?.length) { unknown = true; continue; }
        for (const paragraph of paragraphs) {
          // Without a saved source-file identity, do not guess the included child.
          if (!paragraph.file || !safeSyncPath(`source/${paragraph.file}`)) unknown = true;
          else files.add(`source/${paragraph.file}`);
        }
      }
    } catch { unknown = true; }
  }
  return { files, unknown };
}
function eligibility(conflict: SyncConflict, locks: ReturnType<typeof syncLockedFiles>) {
  if (conflict.field || !["overlapping-manuscript-edits", "protected-or-binary-record"].includes(conflict.reason)) return "protected-or-structured-conflict";
  const variants = [conflict.base, conflict.local, conflict.remote].map(record), chosen = variants.find(Boolean);
  if (!chosen || !["source", "record"].includes(chosen.kind) || variants.filter(Boolean).some(item => item!.kind !== chosen.kind) || !/\.(?:tex|bib|md|txt)$/i.test(conflict.path)) return "not-ordinary-text";
  if (conflict.path.startsWith("source/") && (locks.unknown || locks.files.has(conflict.path))) return "locked-or-unverified-wording";
  if (variants.filter(Boolean).some(item => text(item) === undefined)) return "non-text-or-oversized";
  return undefined;
}
function validateDecisions(value: unknown, projectId: string, planId: string): asserts value is Decisions {
  validateSyncJson(value); const packet = value as Decisions;
  if (!packet || packet.version !== 1 || packet.projectId !== projectId || packet.planId !== planId || Object.keys(packet).some(key => !["version", "projectId", "planId", "decisions"].includes(key)) || !Array.isArray(packet.decisions) || packet.decisions.length > 200) throw new Error("Invalid or foreign reconciliation decisions.");
  const seen = new Set<string>();
  for (const item of packet.decisions) {
    if (!item || !digest.test(item.conflictId) || seen.has(item.conflictId) || !["local", "remote", "text"].includes(item.choice) || Object.keys(item).some(key => !["conflictId", "choice", "text", "note"].includes(key))
      || (item.choice === "text" ? typeof item.text !== "string" || Buffer.byteLength(item.text) > textMergeLimits.bytes : item.text !== undefined) || item.note !== undefined && (typeof item.note !== "string" || item.note.length > 2000)) throw new Error("Invalid, duplicate or oversized conflict decision.");
    seen.add(item.conflictId);
  }
  if (Buffer.byteLength(JSON.stringify(packet)) > proposalLimit) throw new Error("Reconciliation decisions exceed 4 MB.");
}
async function context(workspace: string, projectId: string, planId: string) {
  const { plan, inputs: snapshots } = await stagedPlan(workspace, projectId, planId);
  return { plan, snapshots, locks: syncLockedFiles(snapshots) };
}
function propose(plan: SyncPlan, decisions: Decisions, locks: ReturnType<typeof syncLockedFiles>) {
  const byId = new Map(plan.conflicts.map(item => [syncConflictId(item), item])), requested = new Map(decisions.decisions.map(item => [item.conflictId, item]));
  for (const item of decisions.decisions) {
    const conflict = byId.get(item.conflictId); if (!conflict) throw new Error("Decision does not belong to this exact plan.");
    const blocked = eligibility(conflict, locks); if (blocked) throw new Error(`Cannot propose ordinary-text resolution for ${conflict.path}: ${blocked}. Preserve it for its protected workflow.`);
  }
  const files: ProposedFile[] = [], records: SyncRecord[] = [], remaining: string[] = []; let attempted = 0;
  for (const conflict of plan.conflicts) {
    const conflictId = syncConflictId(conflict), choice = requested.get(conflictId);
    if (eligibility(conflict, locks)) { remaining.push(conflictId); continue; }
    const [base, local, remote] = [conflict.base, conflict.local, conflict.remote].map(record);
    let candidate: SyncRecord | undefined, method: ProposedFile["method"] = "literal-text";
    if (choice) {
      method = choice.choice;
      candidate = choice.choice === "text" ? syncRecord(conflict.path, (local ?? remote)!.kind, Buffer.from(choice.text!)) : choice.choice === "local" ? local : remote;
      if (!candidate || text(candidate) === undefined) throw new Error("A proposed choice cannot remove a file or turn text into binary data.");
    } else if (++attempted <= 64 && base && local && remote) {
      const merged = mergeLiteralText(text(base)!, text(local)!, text(remote)!);
      if (merged.status === "combined") candidate = syncRecord(conflict.path, local.kind, Buffer.from(merged.text!));
    }
    if (!candidate) { remaining.push(conflictId); continue; }
    records.push(candidate); files.push({ path: conflict.path, sha256: candidate.sha256, method, conflictId });
  }
  const body = { ...decisions, format: "aw-sync-reconciliation" as const, files, remaining, liveImport: false as const, approvalGranted: false as const };
  const proposal: Proposal = { ...body, id: syncHash(canonical(body)) };
  return { proposal, records };
}
export async function syncAgentSummary(workspace: string, projectId: string, planId: string) {
  const { plan, snapshots, locks } = await context(workspace, projectId, planId), maps = snapshots.map(snapshot => new Map(snapshot.records.map(item => [item.path, item])));
  return { projectId, planId, local: plan.local, remote: plan.remote, baseline: plan.base, applySupported: false, approvalGranted: false,
    summary: plan.summary, lockedSourceFiles: [...locks.files].sort(), unknownLocks: locks.unknown,
    changedFiles: [...new Set([...maps.flatMap(map => [...map.keys()])])].sort().flatMap(name => {
      const variants = maps.map(map => map.get(name)), hashes = variants.map(item => item?.sha256);
      if (hashes.every(hash => hash === hashes[0])) return [];
      return [{ path: name, kind: variants.find(Boolean)?.kind, localChanged: hashes[1] !== hashes[0], remoteChanged: hashes[2] !== hashes[0],
        candidate: plan.records.some(item => item.path === name), deletionProposed: plan.deletions.includes(name) }];
    }), conflicts: plan.conflicts.map(item => ({ id: syncConflictId(item), path: item.path, field: item.field, reason: item.reason, ordinaryTextAllowed: !eligibility(item, locks), blockedReason: eligibility(item, locks) })) };
}
export async function syncExactConflict(workspace: string, projectId: string, planId: string, conflictId: string) {
  if (!digest.test(conflictId)) throw new Error("Use the exact conflict ID.");
  const { plan, locks } = await context(workspace, projectId, planId), item = plan.conflicts.find(conflict => syncConflictId(conflict) === conflictId);
  if (!item) throw new Error("Conflict not found in this exact plan.");
  const variant = (value: unknown) => { const r = record(value), decoded = text(r); return r ? { path: r.path, kind: r.kind, sha256: r.sha256, bytes: r.bytes, text: decoded, binaryOrLarge: decoded === undefined } : value; };
  return { id: conflictId, path: item.path, field: item.field, reason: item.reason, ordinaryTextAllowed: !eligibility(item, locks), base: variant(item.base), local: variant(item.local), remote: variant(item.remote), approvalGranted: false };
}
export async function syncExactFile(workspace: string, projectId: string, planId: string, name: string, side: string) {
  if (!safeSyncPath(name) || !["base", "local", "remote", "candidate"].includes(side)) throw new Error("Use an exact packet path and base/local/remote/candidate side.");
  const { plan, inputs } = await stagedPlan(workspace, projectId, planId);
  const records = side === "candidate" ? plan.records : inputs[["base", "local", "remote"].indexOf(side)].records;
  const found = records.find(item => item.path === name); if (!found) throw new Error("No file on this side; a missing/conflicting file was not guessed.");
  return found;
}
export async function saveSyncReconciliation(workspace: string, projectId: string, planId: string, input?: unknown) {
  const decisions = input ?? { version: 1, projectId, planId, decisions: [] }; validateDecisions(decisions, projectId, planId);
  const { plan, locks } = await context(workspace, projectId, planId), result = propose(plan, decisions, locks);
  const target = await privateSyncPath(workspace, `reconciliations/${projectId}/${result.proposal.id}.json`, true);
  await saveImmutableSyncArtifact(target, Buffer.from(JSON.stringify(result.proposal) + "\n"), proposalLimit);
  return { id: result.proposal.id, path: target, proposedFiles: result.proposal.files, remaining: result.proposal.remaining, liveImport: false, approvalGranted: false };
}
export async function readReconciliation(workspace: string, projectId: string, planId: string, id: string) {
  if (!safeSyncId(projectId) || !digest.test(id)) throw new Error("Use exact project/proposal identities.");
  const target = await privateSyncPath(workspace, `reconciliations/${projectId}/${id}.json`), saved = JSON.parse((await readSyncBytes(target, proposalLimit)).toString()) as Proposal;
  validateSyncJson(saved);
  const { id: storedId, ...body } = saved;
  if (storedId !== id || saved.format !== "aw-sync-reconciliation" || saved.version !== 1 || saved.planId !== planId || saved.projectId !== projectId || syncHash(canonical(body)) !== id) throw new Error("Reconciliation changed or belongs to another plan. Original variants preserved.");
  const decisions = { version: saved.version, projectId, planId, decisions: saved.decisions }; validateDecisions(decisions, projectId, planId);
  const { plan, locks } = await context(workspace, projectId, planId), result = propose(plan, decisions, locks);
  if (result.proposal.id !== id) throw new Error("Reconciliation no longer matches its exact inputs/algorithm. Do not overwrite it.");
  return { plan, ...result };
}
export async function prepareSyncReconciliation(workspace: string, projectId: string, planId: string, id: string, options: { afterCandidate?: (count: number) => void | Promise<void> } = {}) {
  const { plan, proposal, records } = await readReconciliation(workspace, projectId, planId, id), current = await checkSyncLocalState(workspace, projectId, plan.local);
  const folder = path.dirname(await privateSyncPath(workspace, `reconciled/${projectId}/${id}/review.json`, true));
  const candidates = [...plan.records, ...records];
  let count = 0;
  for (const candidate of candidates) {
    await saveImmutableSyncArtifact(await privateSyncPath(workspace, `reconciled/${projectId}/${id}/candidates/${candidate.path}`, true), Buffer.from(candidate.data, "base64"), syncLimits.fileBytes);
    await options.afterCandidate?.(++count);
  }
  const review = { version: 1, projectId, planId, baseline: plan.base, local: plan.local, remote: plan.remote, proposal, deletions: plan.deletions, unresolved: plan.conflicts.filter(item => proposal.remaining.includes(syncConflictId(item))), candidateFiles: candidates.map(({ path: file, sha256 }) => ({ path: file, sha256 })), liveImport: false, approvalGranted: false };
  await saveImmutableSyncArtifact(await privateSyncPath(workspace, `reconciled/${projectId}/${id}/review.json`), Buffer.from(JSON.stringify(review, null, 2) + "\n"), syncLimits.packetBytes * 3);
  if (syncStateHash(await captureSyncSnapshot(workspace, projectId)) !== syncStateHash(current)) throw new Error(`Local work changed during reconciliation. Detached copies kept at ${folder}; no live records changed.`);
  await saveImmutableSyncArtifact(await privateSyncPath(workspace, `reconciled/${projectId}/${id}/ready.json`), Buffer.from(JSON.stringify({ version: 1, projectId, planId, proposalId: id, stateHash: syncStateHash(current), liveImport: false, approvalGranted: false }) + "\n"), 2000);
  return { folder, projectId, planId, proposalId: id, candidateFiles: candidates.length, remaining: proposal.remaining.length, prepared: true, liveImport: false, approvalGranted: false };
}
