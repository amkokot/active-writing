// One reviewed two-copy operation. Both original proposals must converge to the
// same authored result. Collection is sequential and journalled, never a rollback
// or a distributed atomic transaction; interrupted/newer work is preserved.
import path from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { privateSyncPath, readSyncBytes, syncStatus } from "./deviceSync.ts";
import { canonical, syncHash, validateSyncJson } from "./syncProtocol.ts";
import { exportExchangeForPeer, createSyncInventory, receiveSyncExchange, acknowledgeSyncHead, semanticSyncHash } from "./syncExchange.ts";
import { saveImmutableSyncArtifact, previewStagedSync, hydrateStagedSnapshot, stagedPlan } from "./syncStaging.ts";
import { commitResearchMerge, previewResearchMerge, researchMergeStatus } from "./syncResearchMerge.ts";
import { readSshPeer, reconnectSshPeer, sshPeerCommand, runSshMessage, type SshRunner } from "./syncSsh.ts";
import { withRecordLock } from "./recordLock.ts";

const digest = /^[a-f0-9]{64}$/;
interface Plan { format: "aw-paired-sync"; version: 1; projectId: string; peerId: string; localDeviceId: string; localHead: string; remoteHead: string; localPlan: string; remotePlan: string;
  localReview: string; remoteReview: string; afterSemanticHash: string; maxBytes: number; timeoutMs: number; id: string }
export interface PairedRuntime { runner?: SshRunner; afterLocal?: () => void | Promise<void>; afterRemote?: () => void | Promise<void> }
async function exists(file: string) { try { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Paired receipt is linked/invalid."); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function message(workspace: string, projectId: string, peerId: string, payload: Record<string, unknown>, maxBytes: number, timeoutMs: number, runner = runSshMessage) {
  const peer = await readSshPeer(workspace, projectId, peerId), limit = Math.ceil(maxBytes / 3) * 4 + 5 * 1024 * 1024;
  const request = { ...payload, version: 1, expectedDeviceId: peer.options.deviceId, maxBytes };
  const raw = await runner(peer.options.host, sshPeerCommand(peer.options, projectId), Buffer.from(JSON.stringify(request)), limit, timeoutMs);
  if (raw.length > limit) throw new Error("Paired SSH reply exceeded its budget."); const value = JSON.parse(raw.toString()); validateSyncJson(value);
  if (value.version !== 1 || value.liveImport !== (payload.action === "commit-merge")) throw new Error("Unexpected paired SSH response."); return value;
}
export async function previewPairedSync(workspace: string, projectId: string, peerId: string, options: { runner?: SshRunner; maxBytes?: number; timeoutMs?: number } = {}) {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024, timeoutMs = options.timeoutMs ?? 60000;
  const exchange = await reconnectSshPeer(workspace, projectId, peerId, { ...options, maxBytes, timeoutMs });
  const other = await message(workspace, projectId, peerId, { action: "preview-merge", localHead: exchange.remoteHead, remoteHead: exchange.localHead }, maxBytes, timeoutMs, options.runner);
  const canJoin = exchange.merge.complete && other.merge.complete && exchange.merge.afterSemanticHash === other.merge.afterSemanticHash;
  if (!canJoin) return { ...exchange, paired: false, remoteMerge: other.merge, note: "Some changes need their own review, or the proposals do not agree. Collect selected safe changes here or ask an assistant to reconcile; no remote source was edited." };
  const incoming = await hydrateStagedSnapshot(workspace,projectId,exchange.remoteHead);
  if (!exchange.merge.changes.length && !other.merge.changes.length && incoming.ancestors.includes(exchange.localHead)) {
    await acknowledgeSyncHead(workspace,projectId,incoming.id);
    return { ...exchange,paired:false,alreadyAligned:true,remoteMerge:other.merge,note:"Saved copies already align. No manuscript/notebook save or new merge head was needed." };
  }
  const localDeviceId = (await syncStatus(workspace)).device!.id;
  const body = { format: "aw-paired-sync" as const, version: 1 as const, projectId, peerId, localDeviceId, localHead: exchange.localHead, remoteHead: exchange.remoteHead, localPlan: exchange.planId, remotePlan: other.planId,
    localReview: exchange.merge.mergeId, remoteReview: other.merge.mergeId, afterSemanticHash: exchange.merge.afterSemanticHash, maxBytes, timeoutMs };
  const plan = { ...body, id: syncHash(canonical(body)) };
  await saveImmutableSyncArtifact(await privateSyncPath(workspace, `paired/${projectId}/${plan.id}/plan.json`, true), Buffer.from(JSON.stringify(plan) + "\n"), 10000);
  return { ...exchange, paired: true, syncId: plan.id, remoteMerge: other.merge, note: "Both checked proposals agree. Save drafts on both copies; exact-review commit will collect both and acknowledge their common result. It does not run experiments or approve publication text." };
}
async function readPlan(workspace: string, projectId: string, id: string): Promise<Plan> {
  if (!digest.test(id)) throw new Error("Use the exact paired preview ID."); const plan: Plan = JSON.parse((await readSyncBytes(await privateSyncPath(workspace, `paired/${projectId}/${id}/plan.json`), 10000)).toString()); validateSyncJson(plan);
  const { id: stored, ...body } = plan;
  if (plan.format !== "aw-paired-sync" || plan.version !== 1 || plan.projectId !== projectId || plan.localDeviceId !== (await syncStatus(workspace)).device?.id || stored !== id || syncHash(canonical(body)) !== id) throw new Error("Paired plan changed or belongs to another installation."); await readSshPeer(workspace, projectId, plan.peerId); return plan;
}
export async function pairedSyncStatus(workspace: string, projectId: string, id: string) {
  await readPlan(workspace, projectId, id); const file = await privateSyncPath(workspace, `paired/${projectId}/${id}/ready.json`);
  if (!await exists(file)) return { syncId: id, completed: false, liveWritesPossible: true, note: "Inspect the two merge journals. Repeat the identical commit to resume; never roll back later work." };
  const result = JSON.parse((await readSyncBytes(file, 10000)).toString()); validateSyncJson(result); const { receiptHash, ...body } = result;
  if (syncHash(canonical(body)) !== receiptHash || result.syncId !== id || result.projectId !== projectId || !digest.test(result.head) || result.codeExecuted !== false || result.approvalGranted !== false || result.tasksCompleted !== false || result.aligned !== true) throw new Error("Paired completion receipt changed; preserved."); return { ...result, completed: true };
}
export async function pendingPairedSyncs(workspace: string, projectId: string) {
  const folder = path.dirname(path.dirname(await privateSyncPath(workspace, `paired/${projectId}/placeholder/plan.json`)));
  let entries; try { entries = await readdir(folder,{ withFileTypes:true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  if (entries.length > 200) throw new Error("Many paired preparations are retained; use explicit sync-status IDs before archiving them.");
  const pending = [];
  for (const entry of entries.filter(item => digest.test(item.name))) {
    const started = await privateSyncPath(workspace, `paired/${projectId}/${entry.name}/started.json`);
    if (!await exists(started)) continue; const marker = JSON.parse((await readSyncBytes(started,2000)).toString()); validateSyncJson(marker);
    if (marker.version !== 1 || marker.syncId !== entry.name || marker.projectId !== projectId || !Number.isFinite(Date.parse(marker.startedAt))) throw new Error("Interrupted-sync marker changed; inspect its exact ID.");
    const status = await pairedSyncStatus(workspace,projectId,entry.name); if (!status.completed) { const plan = await readPlan(workspace,projectId,entry.name); pending.push({ id:entry.name,peerId:plan.peerId,startedAt:marker.startedAt }); }
  }
  return pending;
}
export async function commitPairedSync(workspace: string, projectId: string, id: string, runtime: PairedRuntime = {}) {
  const plan = await readPlan(workspace, projectId, id), peer = await readSshPeer(workspace, projectId, plan.peerId);
  return withRecordLock(await privateSyncPath(workspace, `paired-operation-${projectId}`, true), async () => {
    const status = await pairedSyncStatus(workspace, projectId, id); if (status.completed) return { ...status, alreadyComplete: true };
    const startedFile = await privateSyncPath(workspace, `paired/${projectId}/${id}/started.json`);
    if (!await exists(startedFile)) await saveImmutableSyncArtifact(startedFile,Buffer.from(JSON.stringify({ version:1,syncId:id,projectId,startedAt:new Date().toISOString() })+"\n"),2000);
    try {
      if (!await exists(await privateSyncPath(workspace, `merges/${projectId}/${plan.localReview}/journal.json`))) {
        const remoteCheck = await message(workspace, projectId, plan.peerId, { action: "preview-merge", localHead: plan.remoteHead, remoteHead: plan.localHead }, plan.maxBytes, plan.timeoutMs, runtime.runner);
        if (remoteCheck.planId !== plan.remotePlan || remoteCheck.merge.mergeId !== plan.remoteReview || !remoteCheck.merge.complete || remoteCheck.merge.afterSemanticHash !== plan.afterSemanticHash) throw new Error("Remote saved review changed before collection; neither copy was collected.");
      }
      const local = await commitResearchMerge(workspace, projectId, plan.localPlan, plan.localReview); await runtime.afterLocal?.();
      const outgoing = await exportExchangeForPeer(workspace, projectId, local.head, peer.options.deviceId);
      if (outgoing.bytes.length > plan.maxBytes) throw new Error("Collected exchange exceeds the reviewed bandwidth budget; retained locally, no automatic larger upload.");
      await message(workspace, projectId, plan.peerId, { action: "receive", bytes: outgoing.bytes.toString("base64") }, plan.maxBytes, plan.timeoutMs, runtime.runner);
      const remote = await message(workspace, projectId, plan.peerId, { action: "commit-merge", syncId: id, originalPlan: plan.remotePlan, originalReview: plan.remoteReview, localHead: plan.remoteHead, remoteHead: local.head, afterSemanticHash: plan.afterSemanticHash }, plan.maxBytes, plan.timeoutMs, runtime.runner); await runtime.afterRemote?.();
      if (!digest.test(remote.head) || remote.codeExecuted !== false || remote.approvalGranted !== false || remote.tasksCompleted !== false) throw new Error("Remote collection did not provide a checked completion receipt.");
      const returned = await message(workspace, projectId, plan.peerId, { action: "export", inventory: await createSyncInventory(workspace, projectId) }, plan.maxBytes, plan.timeoutMs, runtime.runner);
      if (typeof returned.bytes !== "string" || returned.bytes.length > Math.ceil(plan.maxBytes / 3) * 4) throw new Error("Collected remote exchange exceeds the reviewed budget."); const bytes = Buffer.from(returned.bytes, "base64"); if (bytes.toString("base64") !== returned.bytes || bytes.length > plan.maxBytes) throw new Error("Invalid returned exchange encoding.");
      const received = await receiveSyncExchange(workspace, projectId, bytes);
      // New desktop work can continue between messages. Do not mistake it for
      // the originally reviewed result, or force an old state over new research.
      if (received.head !== remote.head || semanticSyncHash(await hydrateStagedSnapshot(workspace, projectId, remote.head)) !== plan.afterSemanticHash) throw new Error("Newer desktop work arrived after collection. Both original merges are preserved; make a fresh preview for the new work.");
      await acknowledgeSyncHead(workspace, projectId, remote.head);
      const receipt = { version: 1, syncId: id, projectId, peerId: plan.peerId, head: remote.head, localMerge: local.mergeId, remoteMerge: remote.mergeId, completedAt: new Date().toISOString(), aligned: true, liveImport: true, codeExecuted: false, tasksCompleted: false, approvalGranted: false };
      await saveImmutableSyncArtifact(await privateSyncPath(workspace, `paired/${projectId}/${id}/ready.json`), Buffer.from(JSON.stringify({ ...receipt, receiptHash: syncHash(canonical(receipt)) }) + "\n"), 10000);
      return { ...receipt, completed: true, alreadyComplete: false };
    } catch (error) { throw new Error(`${(error as Error).message} Two-copy operation ${id} retained. One/both copies may already have collected changes; inspect or resume its exact ID, never reset either copy.`); }
  });
}
// Called only by the deliberately authorized SSH commit message. The original
// remote preview authorizes the result, not arbitrary newly supplied text.
export async function remoteReviewedMerge(workspace: string, projectId: string, request: { syncId: string; originalPlan: string; originalReview: string; localHead: string; remoteHead: string; afterSemanticHash: string }) {
  for (const id of Object.values(request)) if (!digest.test(id)) throw new Error("Remote merge requires exact reviewed IDs.");
  const file = await privateSyncPath(workspace, `paired-remote/${projectId}/${request.syncId}/plan.json`, true);
  let saved: { request: typeof request; planId: string; reviewId: string };
  if (await exists(file)) { saved = JSON.parse((await readSyncBytes(file, 10000)).toString()); validateSyncJson(saved); if (!equalRequest(saved.request, request) || !digest.test(saved.planId) || !digest.test(saved.reviewId)) throw new Error("Remote paired preparation belongs to a different scope."); }
  else {
    const reviewed = await stagedPlan(workspace, projectId, request.originalPlan), incoming = await hydrateStagedSnapshot(workspace, projectId, request.remoteHead);
    if (reviewed.plan.local !== request.localHead || !incoming.ancestors.includes(reviewed.plan.local) || !incoming.ancestors.includes(reviewed.plan.remote)) throw new Error("Collected head does not include both originally reviewed branches.");
    const original = await previewResearchMerge(workspace, projectId, request.originalPlan); if (original.mergeId !== request.originalReview || !original.complete || original.afterSemanticHash !== request.afterSemanticHash) throw new Error("Original remote review changed; no live remote writes.");
    const compared = await previewStagedSync(workspace, projectId, request.localHead, request.remoteHead), actual = await previewResearchMerge(workspace, projectId, compared.id);
    if (!actual.complete || actual.afterSemanticHash !== request.afterSemanticHash) throw new Error("Remote candidate differs from the reviewed common result; no live remote writes.");
    saved = { request, planId: compared.id, reviewId: actual.mergeId }; await saveImmutableSyncArtifact(file, Buffer.from(JSON.stringify(saved) + "\n"), 10000);
  }
  const result = await commitResearchMerge(workspace, projectId, saved.planId, saved.reviewId);
  return { version: 1, liveImport: true, head: result.head, mergeId: result.mergeId, codeExecuted: false, tasksCompleted: false, approvalGranted: false };
}
const equalRequest = (a: unknown, b: unknown) => canonical(a) === canonical(b);
