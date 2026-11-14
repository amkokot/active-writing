// Opt-in coordinator for a pinned project/peer. Reuses the exact guarded paired
// protocol; never guesses conflicts, replays experiments or resumes partial saves.
import { open, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { privateSyncPath, readSyncBytes } from "./deviceSync.ts";
import { safeSyncId, validateSyncJson } from "./syncProtocol.ts";
import { readSshPeer, type SshRunner } from "./syncSsh.ts";
import { previewPairedSync, commitPairedSync, pendingPairedSyncs } from "./syncPaired.ts";
import { withRecordLock,acquireRecordLock,RecordLocked } from "./recordLock.ts";
import {syncNetworkAllowed} from './syncNetwork.ts';
import {readWorkbench} from './workbenchStore.ts';
import {commentContent} from './syncComments.ts';
import {canonical,syncHash} from './syncProtocol.ts';
import {syncReadingRecords} from './syncReading.ts';
import {acquireSyncSchedule} from './syncScheduleLock.ts';

interface AutoConfig { version: 1; projectId: string; peerId: string; enabled: boolean; mode: "stage" | "safe"; intervalSeconds: number; timeoutSeconds?: number; generation: string;pauseReason?:string;readingOnly?:boolean }
interface AutoState { version: 1; projectId: string; status: "disabled" | "aligned" | "staged" | "synced" | "held" | "interrupted" | "unavailable" | "following"; checkedAt: string; nextCheckAt?: string; failures: number; syncId?: string; detail?: string; commentHash?:string;scope?:'reading';maintenance?:{phase:string;detail?:string;updatedAt:string} }
interface NetworkWake { version: 1; projectId: string; waiting: boolean }
async function savedCommentHash(workspace:string,projectId:string){const store=await readWorkbench(workspace,projectId),comments=store.attentionTasks.filter(t=>t.review?.kind==='comment').map(commentContent).sort((a:any,b:any)=>a.id.localeCompare(b.id));return comments.length?syncHash(canonical(comments)):undefined;}
async function optionalJson<T>(file: string): Promise<T | undefined> {
  try { const value = JSON.parse((await readSyncBytes(file, 20000)).toString()); validateSyncJson(value); return value; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
async function paths(workspace: string, projectId: string, create = false) {
  if (!safeSyncId(projectId)) throw new Error("Use an exact project ID.");
  return { config: await privateSyncPath(workspace, `auto/${projectId}/config.json`, create), state: await privateSyncPath(workspace, `auto/${projectId}/state.json`, create), cycle: await privateSyncPath(workspace, `auto/${projectId}/cycle`, create), network: await privateSyncPath(workspace, `auto/${projectId}/network-wake.json`, create) };
}
async function save(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.part`, handle = await open(temp, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, file);
}
async function readConfig(file: string): Promise<AutoConfig | undefined> {
  const config = await optionalJson<AutoConfig>(file);
  if(config?.readingOnly!==undefined&&typeof config.readingOnly!=='boolean')throw Error('Invalid reading-sync setting.');
  if(config?.pauseReason!==undefined&&(typeof config.pauseReason!=='string'||config.pauseReason.length>3000))throw new Error('Invalid saved sync pause reason.');
  if (config?.timeoutSeconds !== undefined && (!Number.isSafeInteger(config.timeoutSeconds) || config.timeoutSeconds < 10 || config.timeoutSeconds > 120)) throw new Error("Auto-sync timeout must be 10–120 seconds; inspect the settings.");
  if (config && (config.version !== 1 || !safeSyncId(config.projectId) || !/^[a-f0-9]{64}$/.test(config.peerId) || typeof config.enabled !== "boolean" || !["stage", "safe"].includes(config.mode) || !Number.isSafeInteger(config.intervalSeconds) || config.intervalSeconds < 120 || config.intervalSeconds > 3600 || !safeSyncId(config.generation))) throw new Error("Auto-sync settings changed or are invalid; inspect them before continuing.");
  return config;
}
/** Live loop needs configuration only, not status files and process/lock probes. */
export async function readAutoSyncConfig(workspace:string,projectId:string) {
  if(!safeSyncId(projectId))throw Error('Use an exact project ID.');
  const config=await readConfig(await privateSyncPath(workspace,`auto/${projectId}/config.json`));
  if(config && config.projectId!==projectId)throw Error('Automatic-sync scope does not match this project.');
  return config;
}
export async function configureAutoSync(workspace: string, projectId: string, options: { peerId: string; mode: "stage" | "safe"; intervalSeconds?: number; timeoutSeconds?: number; savedDraftsConfirmed: boolean }) {
  if (!options.savedDraftsConfirmed) throw new Error("Save drafts on both copies before enabling automatic saved-work synchronization.");
  await readSshPeer(workspace, projectId, options.peerId);
  const intervalSeconds = options.intervalSeconds ?? 180;
  const timeoutSeconds = options.timeoutSeconds ?? 30;
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 120) throw new Error("Choose a bounded 10–120 second SSH timeout.");
  if (!["stage", "safe"].includes(options.mode) || !Number.isSafeInteger(intervalSeconds) || intervalSeconds < 120 || intervalSeconds > 3600) throw new Error("Choose stage/safe and a 120–3600 second interval.");
  const target = await paths(workspace, projectId, true);
  return withRecordLock(target.config, async () => {
    const config: AutoConfig = { version: 1, projectId, peerId: options.peerId, mode: options.mode, intervalSeconds, timeoutSeconds, enabled: true, generation: randomUUID() };
    await save(target.config, config); return config;
  });
}
export async function disableAutoSync(workspace: string, projectId: string,reason?:string) {
  if(reason!==undefined&&(!reason.trim()||reason.length>3000))throw new Error('Use a brief nonempty sync pause reason.');
  const target = await paths(workspace, projectId, true);
  return withRecordLock(target.config, async () => {
    const config = await readConfig(target.config);
    if (config) await save(target.config, { ...config, enabled: false, generation: randomUUID(),pauseReason:reason });
    return { enabled: false, note: "No further cycles or new commits. An already started guarded commit may finish; never kill its process to undo it." };
  });
}
/** Upgrade an already authorized safe pair; never enable a new peer or resume a partial pair. */
export async function followReadingSync(workspace:string,projectId:string){
 const target=await paths(workspace,projectId,true);
 return withSyncCycle(workspace,projectId,()=>withRecordLock(target.config,async()=>{
  const current=await readConfig(target.config);
  if(!current?.enabled||current.mode!=='safe')throw Error('Enable the exact safe peer before choosing reading sync.');
  if((await pendingPairedSyncs(workspace,projectId)).length)throw Error('Inspect the interrupted pair before changing sync mode.');
  const updated={...current,readingOnly:true,intervalSeconds:180,generation:randomUUID()};await save(target.config,updated);return updated;
 }));
}
export async function autoSyncStatus(workspace: string, projectId: string) {
  const target = await paths(workspace, projectId);
  const inspectLock=async(file:string)=>{
    let owner:{pid:number;token:string;createdAt:string}|undefined;
    try{owner=await optionalJson<typeof owner>(file+'.aw-lock');}catch{return {status:'invalid' as const};}
    if(!owner)return {status:'absent' as const};
    if(!Number.isSafeInteger(owner.pid)||owner.pid<1||typeof owner.token!=='string'||!Number.isFinite(Date.parse(owner.createdAt)))return {status:'invalid' as const};
    try{process.kill(owner.pid,0);return {status:'active' as const,pid:owner.pid};}
    catch(error){return {status:(error as NodeJS.ErrnoException).code==='ESRCH'?'owner-missing' as const:'unknown' as const,pid:owner.pid};}
  };
  const state=await optionalJson<AutoState>(target.state),live=await optionalJson<AutoState>(await privateSyncPath(workspace,`auto/${projectId}/fast-state.json`));
  const needsReview=(s:AutoState|undefined)=>s?.status==='held'||s?.status==='interrupted';
  return { config: await readConfig(target.config), state:needsReview(live)?live:needsReview(state)?state:live&&(!state||live.checkedAt>state.checkedAt)?live:state,live, locks:{project:await inspectLock(target.cycle),coordinator:await inspectLock(await privateSyncPath(workspace,'auto/coordinator')),readingCoordinator:await inspectLock(await privateSyncPath(workspace,'auto/reading-coordinator'))},networkContacted: false };
}
export async function withSyncCycle<T>(workspace:string,projectId:string,work:()=>Promise<T>,waitMs=0){
 const target=await paths(workspace,projectId,true);let release:()=>Promise<void>;
 try{release=await acquireSyncSchedule(target.cycle,waitMs);}catch(error){if(error instanceof RecordLocked)throw new Error('A sync is already running for this project. Nothing changed; try again shortly.');throw error;}
 try{return await work();}finally{await release();}
}
export async function autoSyncCycle(workspace: string, projectId: string, runtime: { runner?: SshRunner; now?: () => number; networkCheck?:()=>Promise<{allowed:boolean;reason:string}>; checkNow?: boolean;fastOnly?:boolean } = {}) {
  const target = await paths(workspace, projectId, true), now = runtime.now ?? Date.now;
  if(runtime.fastOnly)target.state=await privateSyncPath(workspace,`auto/${projectId}/fast-state.json`,true);
  return withSyncCycle(workspace,projectId, async () => {
    const config = await readConfig(target.config), previous = await optionalJson<AutoState>(target.state), time = now();
    if (!config?.enabled) return { status: "disabled", networkContacted: false };
    if(runtime.fastOnly&&(!config.readingOnly||config.mode!=='safe'))throw Error('Fast reading needs the enabled safe reading pair.');
    const beforeDue=!!(previous?.nextCheckAt && Date.parse(previous.nextCheckAt)>time);
    // Coalesce rapid invocations; a manual check skips timing, never network/merge guards.
    if(beforeDue && !runtime.checkNow && time-Date.parse(previous!.checkedAt)<20000)return {...previous,deferred:true,networkContacted:false};
    let release:()=>Promise<void>;
    // One bounded text/comment pass may accompany the single bulk worker. Native
    // per-file/revision leases still arbitrate actual writes. Never wait minutes
    // behind another project's archives just to deliver a saved comment.
    try{release=await acquireSyncSchedule(await privateSyncPath(workspace,runtime.fastOnly?'auto/reading-coordinator':'auto/coordinator',true));}
    catch(error){if(error instanceof RecordLocked)return {status:'busy' as const,networkContacted:false,note:'Another automatic project sync owns the laptop slot. This project will try on its next scheduled check.'};throw error;}
    try{
    // Observe the cached, gated route even during backoff. No project scan or SSH
    // happens offline. Persist the wake across short-lived scheduled processes.
    const wake = await optionalJson<NetworkWake>(target.network);
    if(wake && (wake.version!==1 || wake.projectId!==projectId || typeof wake.waiting!=='boolean'))throw new Error('Invalid sync reconnect state; inspect it before continuing.');
    const network=await (runtime.networkCheck?runtime.networkCheck():syncNetworkAllowed(workspace));
    if(!network.allowed){
      if(!wake?.waiting)await save(target.network,{version:1,projectId,waiting:true});
      return {status:'waiting-network' as const,networkContacted:false,note:network.reason};
    }
    // One early catch-up after an observed reconnect, with a two-minute floor
    // between attempts so a flapping VPN cannot trigger a scan/SSH storm.
    const reconnect = wake?.waiting === true;
    const reconnectReady = reconnect && (!previous || time-Date.parse(previous.checkedAt)>=120000);
    if(beforeDue && !runtime.checkNow && !reconnectReady){
      if(previous!.failures || reconnect)return {...previous,deferred:true,networkContacted:false};
      const hash=await savedCommentHash(workspace,projectId);if(hash===previous!.commentHash || !hash)return {...previous,deferred:true,networkContacted:false};
    }
    if(reconnect)await save(target.network,{version:1,projectId,waiting:false});
    const state: AutoState = { version: 1, projectId, status: "unavailable", checkedAt: new Date(time).toISOString(), failures: 0 };
    let networkContacted = false;
    try {
      if (config.projectId !== projectId) throw new Error("Automatic-sync scope does not match this project.");
      await readSshPeer(workspace, projectId, config.peerId);
      const pending = await pendingPairedSyncs(workspace, projectId);
      if (pending.length) {
        state.status = "interrupted"; state.syncId = pending[0].id;
        state.detail = "A partial two-copy operation needs inspection/resume of its exact ID. No new exchange or commit started.";
      } else if(config.readingOnly&&config.mode==='safe'){
        networkContacted=true;
        const result=await syncReadingRecords(workspace,projectId,config.peerId,runtime.runner,{fastOnly:runtime.fastOnly,timeoutMs:(config.timeoutSeconds??30)*1000,mayWrite:async()=>{const current=await readConfig(target.config);return !!current?.enabled&&current.readingOnly===true&&current.mode==='safe'&&current.generation===config.generation;}});
        state.maintenance=result.maintenance;state.scope='reading';state.status=result.held.length?'held':result.deferred.length?'following':result.copied.length?'synced':'aligned';
        state.detail=(`${runtime.fastOnly?'Fast TeX/comments':'Reading'} sync: ${result.copied.length} updated, ${result.checked} checked. Whole-project history and raw experiments are not acknowledged by this lane.`+(result.held.length?` Needs review: ${result.held.slice(0,6).join(', ')}.`:'')+(result.deferred.length?` Still changing or busy: ${result.deferred.slice(0,6).join(', ')}; later passes follow them.`:'')+result.issues.slice(0,2).map(issue=>` ${issue.key}: ${issue.reason}`).join('')).slice(0,3000);
      } else {
        networkContacted = true;
        const preview = await previewPairedSync(workspace, projectId, config.peerId, { runner: runtime.runner, timeoutMs: (config.timeoutSeconds ?? 30) * 1000, maxBytes: 16 * 1024 * 1024 });
        if ("alreadyAligned" in preview && preview.alreadyAligned) state.status = "aligned";
        else if (!preview.paired || !("syncId" in preview) || !preview.syncId) {
          state.status = "held"; state.detail = "Saved work was exchanged, but conflicts/protected changes require review. Neither copy was automatically collected.";
        } else if (config.mode === "stage") { state.status = "staged"; state.syncId = preview.syncId; }
        else {
          // Configuration may have been disabled/changed while SSH was working.
          const current = await readConfig(target.config);
          if (!current?.enabled || current.generation !== config.generation) { state.status = "staged"; state.syncId = preview.syncId; state.detail = "Settings changed; no commit started."; }
          else {
            state.syncId = preview.syncId;
            await commitPairedSync(workspace, projectId, preview.syncId, { runner: runtime.runner });
            state.status = "synced";
          }
        }
      }
    } catch (error) {
      state.status = state.syncId ? "interrupted" : "unavailable";
      state.detail = (error as Error).message.slice(0, 3000);
      // A fresh preview lost a race with ordinary saved work. Preserve it and
      // retry a NEW snapshot later, not the stale plan or a partial collection.
      const changedDuringPreview = !state.syncId && /Saved local files changed after this plan:|Source or research records changed during capture\. No snapshot saved;/.test(state.detail);
      state.failures = changedDuringPreview ? 0 : Math.min(10, (previous?.failures ?? 0) + 1);
      if(changedDuringPreview)state.nextCheckAt = new Date(now() + 120000).toISOString();
    }
    state.commentHash=await savedCommentHash(workspace,projectId);
    const delay = state.failures ? Math.min(1800, config.intervalSeconds * 2 ** Math.min(state.failures - 1, 5)) : config.intervalSeconds;
    state.nextCheckAt ??= new Date(now() + delay * 1000).toISOString();
    await save(target.state, state);
    return { ...state, networkContacted };
    }finally{await release();}
  }, 0);
}
