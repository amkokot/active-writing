import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPaperProject } from "./projectFiles.ts";
import { getProject } from "./projects.ts";
import { initializeSyncDevice, readSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { syncWorkingCheckpoint } from "./syncExchange.ts";
import { previewSyncClone, commitSyncClone } from "./syncClone.ts";
import { previewSshPeer, commitSshPeer, handleExchangeMessage } from "./syncSsh.ts";
import { configureAutoSync, autoSyncStatus, autoSyncCycle, disableAutoSync, followReadingSync } from "./syncAuto.ts";
import {acquireRecordLock} from './recordLock.ts';
import {privateSyncPath} from './deviceSync.ts';

const source = "\\documentclass{article}\n\\begin{document}\nFirst idea.\n\nContext.\n\nLast idea.\n\\end{document}\n";
test('off-campus automatic sync does no SSH/capture and does not count as a failure',async()=>{
 const f=await fixture(),result=await autoSyncCycle(f.laptop,f.projectId,{runner:f.runner,networkCheck:async()=>({allowed:false,reason:'Waiting for campus/VPN.'})});assert.equal(result.status,'waiting-network');assert.equal(f.calls(),0);assert.equal((await autoSyncStatus(f.laptop,f.projectId)).state,undefined);
});
test('automatic projects share one laptop slot and never steal another worker lock',async()=>{
 const f=await fixture(),release=await acquireRecordLock(await privateSyncPath(f.laptop,'auto/coordinator',true),0);
 try{assert.equal((await autoSyncCycle(f.laptop,f.projectId,{runner:f.runner})).status,'busy');assert.equal(f.calls(),0);assert.equal((await autoSyncStatus(f.laptop,f.projectId)).state,undefined);}finally{await release();}
 assert.equal((await autoSyncCycle(f.laptop,f.projectId,{runner:f.runner})).status,'aligned');
});
test('saved status exposes an abandoned or damaged coordinator without stealing its lock',async()=>{
 const f=await fixture(),file=await privateSyncPath(f.laptop,'auto/coordinator.aw-lock',true);
 const original=JSON.stringify({pid:2147483647,token:'diagnostic-dead-owner',createdAt:'2026-10-23T00:00:00.000Z'});await writeFile(file,original);
 assert.equal((await autoSyncStatus(f.laptop,f.projectId)).locks.coordinator.status,'owner-missing');
 assert.equal(await readFile(file,'utf8'),original);assert.equal(f.calls(),0);
 await writeFile(file,'invalid JSON');assert.equal((await autoSyncStatus(f.laptop,f.projectId)).locks.coordinator.status,'invalid');assert.equal(await readFile(file,'utf8'),'invalid JSON');
});
async function fixture(mode: "safe" | "stage" = "safe") {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true });
  const laptop = await mkdtemp(path.join(parent, "auto-sync-")), project = await createPaperProject(laptop, "Synthetic automatic sync"), projectId = project.id;
  const localRoot = (await getProject(laptop, projectId)).root; await writeFile(path.join(localRoot, "main.tex"), source);
  await initializeSyncDevice(laptop, "Laptop");
  const base = await syncWorkingCheckpoint(laptop, projectId), snapshot = await readSyncSnapshot(base.path), desktop = path.join(laptop, "desktop");
  const options = { destination: desktop, mainFile: "main.tex", label: "Desktop" }, plan = await previewSyncClone(snapshot, options);
  await commitSyncClone(snapshot, options, plan.planId);
  const remoteRoot = (await getProject(desktop, projectId)).root;
  const peerOptions = { host: "test-desktop", platform: "posix" as const, tool: "/opt/aw/scripts/awSync.ts", workspace: "/data/aw", deviceId: (await syncStatus(desktop)).device!.id };
  const peer = await previewSshPeer(laptop, projectId, peerOptions); await commitSshPeer(laptop, projectId, peerOptions, peer.id);
  await configureAutoSync(laptop, projectId, { peerId: peer.id, mode, intervalSeconds: 120, savedDraftsConfirmed: true });
  let calls = 0;
  const runner = async (_host: string, _command: string, input: Buffer) => { calls++; return Buffer.from(JSON.stringify(await handleExchangeMessage(desktop, projectId, JSON.parse(input.toString())))); };
  return { laptop, desktop, projectId, localRoot, remoteRoot, peer, runner, calls: () => calls };
}
test("automatic safe mode combines independent research edits and preserves original checkpoints", async () => {
  const f = await fixture();
  await writeFile(path.join(f.localRoot, "main.tex"), source.replace("First idea.", "Laptop explanation."));
  await writeFile(path.join(f.remoteRoot, "main.tex"), source.replace("Last idea.", "Desktop finding."));
  const result = await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner });
  assert.equal(result.status, "synced");
  const local = await readFile(path.join(f.localRoot, "main.tex"), "utf8"), remote = await readFile(path.join(f.remoteRoot, "main.tex"), "utf8");
  assert.equal(local, remote); assert.match(local, /Laptop explanation/); assert.match(local, /Desktop finding/);
  assert.equal((await autoSyncStatus(f.laptop, f.projectId)).state?.status, "synced");
  const calls = f.calls(); assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner })).networkContacted, false); assert.equal(f.calls(), calls);
});
test("stage mode exchanges but never imports authored research", async () => {
  const f = await fixture("stage"); await writeFile(path.join(f.remoteRoot, "main.tex"), source.replace("Last idea.", "Desktop finding."));
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner })).status, "staged");
  assert.equal(await readFile(path.join(f.localRoot, "main.tex"), "utf8"), source);
});
test("same-passage conflicts are held with both variants intact", async () => {
  const f = await fixture(); const left = source.replace("First idea.", "Human idea."), right = source.replace("First idea.", "Different desktop idea.");
  await writeFile(path.join(f.localRoot, "main.tex"), left); await writeFile(path.join(f.remoteRoot, "main.tex"), right);
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner })).status, "held");
  assert.equal(await readFile(path.join(f.localRoot, "main.tex"), "utf8"), left); assert.equal(await readFile(path.join(f.remoteRoot, "main.tex"), "utf8"), right);
});
test("offline failure backs off without retrying the network or changing source", async () => {
  const f = await fixture(); let calls = 0, clock = Date.now();
  const runner = async () => { calls++; throw new Error("Offline desktop"); };
  const first = await autoSyncCycle(f.laptop, f.projectId, { runner, now: () => clock });
  assert.equal(first.status, "unavailable"); assert.equal(calls, 1);
  clock += 1000; await autoSyncCycle(f.laptop, f.projectId, { runner, now: () => clock }); assert.equal(calls, 1);
  clock += 120000; const second = await autoSyncCycle(f.laptop, f.projectId, { runner, now: () => clock });
  assert.ok("failures" in second && "nextCheckAt" in second);
  assert.equal(second.failures, 2); assert.equal(Date.parse(second.nextCheckAt!) - clock, 240000);
  assert.equal(await readFile(path.join(f.localRoot, "main.tex"), "utf8"), source);
});
test("disable during exchange prevents a new automatic commit", async () => {
  const f = await fixture(); await writeFile(path.join(f.remoteRoot, "main.tex"), source.replace("Last idea.", "New desktop finding."));
  let disabled = false;
  const runner = async (host: string, command: string, input: Buffer) => {
    const result = await f.runner(host, command, input);
    if (!disabled) { disabled = true; await disableAutoSync(f.laptop, f.projectId); }
    return result;
  };
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner })).status, "staged");
  assert.equal(await readFile(path.join(f.localRoot, "main.tex"), "utf8"), source);
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner })).status, "disabled");
});

test('reconnect survives scheduled process restarts, bypasses backoff once and coalesces VPN flaps', async () => {
  const f = await fixture(); let clock = Date.now(), online = true, attempts = 0;
  const networkCheck = async () => ({ allowed: online, reason: online ? 'Campus route available' : 'VPN down' });
  const failing = async () => { attempts++; throw new Error('Temporary SSH failure'); };
  for (let i = 0; i < 4; i++) {
    await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
    if (i < 3) clock = Date.parse((await autoSyncStatus(f.laptop, f.projectId)).state!.nextCheckAt!);
  }
  const failed = (await autoSyncStatus(f.laptop, f.projectId)).state!;
  assert.equal(failed.failures, 4); assert.equal(attempts, 4);
  clock += 30000; online = false;
  const before = await readFile(await privateSyncPath(f.laptop, `auto/${f.projectId}/state.json`), 'utf8');
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck })).status, 'waiting-network');
  assert.equal(await readFile(await privateSyncPath(f.laptop, `auto/${f.projectId}/state.json`), 'utf8'), before);
  assert.equal(attempts, 4);
  online = true; clock += 1000;
  await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
  assert.equal(attempts, 4); // Reconnect remains pending through the cooldown.
  clock += 90000;
  assert.ok(clock < Date.parse(failed.nextCheckAt!));
  await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
  assert.equal(attempts, 5);
  clock += 30000;
  await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
  assert.equal(attempts, 5); // The wake was consumed, not a permanent bypass.
  online = false;
  await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
  online = true;
  await autoSyncCycle(f.laptop, f.projectId, { runner: failing, now: () => clock, networkCheck });
  assert.equal(attempts, 5);
  await writeFile(path.join(f.remoteRoot, 'new-note.tex'), '% New saved research note\n');
  clock += 90000;
  const result = await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner, now: () => clock, networkCheck });
  assert.equal(result.status, 'synced');
  assert.equal((await autoSyncStatus(f.laptop, f.projectId)).state?.failures, 0);
  assert.equal(await readFile(path.join(f.localRoot, 'new-note.tex'), 'utf8'), '% New saved research note\n');
});

test('manual check skips only timing; network gate, disabled config and interrupted operations stay guarded', async () => {
  const f = await fixture(); let clock = Date.now();
  await autoSyncCycle(f.laptop, f.projectId, { runner: async () => { throw new Error('Temporary failure'); }, now: () => clock });
  clock += 1000;
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner, now: () => clock, checkNow: true, networkCheck: async () => ({allowed:false,reason:'VPN down'}) })).status, 'waiting-network');
  assert.equal(f.calls(), 0);
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner, now: () => clock, checkNow: true, networkCheck: async () => ({allowed:true,reason:'Campus'}) })).status, 'aligned');
  await disableAutoSync(f.laptop, f.projectId);
  const calls = f.calls();
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner, checkNow: true })).status, 'disabled');
  assert.equal(f.calls(), calls);
});

test('ordinary writes during preview schedule a fresh bounded check, not a growing network-failure backoff', async () => {
  const f = await fixture(); let clock = Date.now();
  const runner = async () => { throw new Error('SSH exchange unavailable (1). Saved local files changed after this plan: data/research/current.md. Capture a fresh local snapshot and compare again; no live records changed.'); };
  const first = await autoSyncCycle(f.laptop, f.projectId, { runner, now: () => clock });
  assert.equal(first.status, 'unavailable'); assert.ok('failures' in first); assert.equal(first.failures, 0);
  assert.ok('nextCheckAt' in first); assert.equal(Date.parse(first.nextCheckAt!) - clock, 120000);
  assert.equal(await readFile(path.join(f.localRoot, 'main.tex'), 'utf8'), source);
  clock += 120000;
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner, now: () => clock })).status, 'aligned');
});
test("configuration needs an exact peer, saved drafts and bounded interval", async () => {
  const f = await fixture();
  await assert.rejects(configureAutoSync(f.laptop, f.projectId, { peerId: f.peer.id, mode: "safe", intervalSeconds: 1, savedDraftsConfirmed: true }), /120/);
  await assert.rejects(configureAutoSync(f.laptop, f.projectId, { peerId: f.peer.id, mode: "safe", savedDraftsConfirmed: false }), /Save drafts/);
  await assert.rejects(configureAutoSync(f.laptop, f.projectId, { peerId: "not-a-peer", mode: "safe", savedDraftsConfirmed: true }), /exact/);
});
test("remote code is held rather than imported or executed", async () => {
  const f = await fixture(); await writeFile(path.join(f.remoteRoot, "untrusted.py"), "raise RuntimeError('must never run')\n");
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner: f.runner })).status, "held");
  await assert.rejects(readFile(path.join(f.localRoot, "untrusted.py")), /ENOENT/);
});

test("file-heavy projects use an explicitly bounded SSH timeout without changing sync guards", async () => {
  const f = await fixture();
  for (const timeoutSeconds of [0, 121, 30.5, NaN]) await assert.rejects(configureAutoSync(f.laptop, f.projectId, { peerId: f.peer.id, mode: "safe", savedDraftsConfirmed: true, timeoutSeconds }), /10–120/);
  await configureAutoSync(f.laptop, f.projectId, { peerId: f.peer.id, mode: "safe", savedDraftsConfirmed: true, timeoutSeconds: 120 });
  const waits: number[] = [];
  const runner = async (host: string, command: string, input: Buffer, _max: number, timeoutMs: number) => { waits.push(timeoutMs); return f.runner(host, command, input); };
  assert.equal((await autoSyncCycle(f.laptop, f.projectId, { runner })).status, "aligned");
  assert.ok(waits.length > 0); assert.ok(waits.every(value => value === 120000));
  assert.equal((await autoSyncStatus(f.laptop, f.projectId)).config?.timeoutSeconds, 120);
  await followReadingSync(f.laptop,f.projectId);waits.length=0;
  await autoSyncCycle(f.laptop,f.projectId,{runner,checkNow:true});
  assert.ok(waits.length>0);assert.ok(waits.every(value=>value===120000),'Reading sync must honor the same configured budget');
});
test("partial commit stays held on later cycles; no automatic resume or duplicate save", async () => {
  const f = await fixture(); await writeFile(path.join(f.remoteRoot, "main.tex"), source.replace("Last idea.", "Desktop finding."));
  const runner = async (host: string, command: string, input: Buffer) => {
    if (JSON.parse(input.toString()).action === "commit-merge") throw new Error("Connection dropped after local collection");
    return f.runner(host, command, input);
  };
  const first = await autoSyncCycle(f.laptop, f.projectId, { runner }); assert.equal(first.status, "interrupted");
  const calls = f.calls(), text = await readFile(path.join(f.localRoot, "main.tex"), "utf8");
  const next = await autoSyncCycle(f.laptop, f.projectId, { runner, now: () => Date.now() + 240000, checkNow: true });
  assert.equal(next.status, "interrupted"); assert.equal(next.networkContacted, false); assert.equal(f.calls(), calls);
  assert.equal(await readFile(path.join(f.localRoot, "main.tex"), "utf8"), text);
});
import {readAutoSyncConfig} from './syncAuto.ts';

test('live configuration reads skip unrelated status/lock inspection and still validate the exact project',async()=>{
  const f=await fixture();
  const file=await privateSyncPath(f.laptop,`auto/${f.projectId}/state.json`,true);
  await writeFile(file,'not a status document');
  assert.equal((await readAutoSyncConfig(f.laptop,f.projectId))?.peerId,f.peer.id);
  assert.equal(f.calls(),0);
  await assert.rejects(readAutoSyncConfig(f.laptop,'../other'),/exact project/);
});
