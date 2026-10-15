import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createPaperProject } from "./projectFiles.ts";
import { getProject } from "./projects.ts";
import { initializeSyncDevice, readSyncSnapshot, syncStatus } from "./deviceSync.ts";
import { commitSyncClone, previewSyncClone } from "./syncClone.ts";
import { syncWorkingCheckpoint, createSyncInventory, exportSyncExchange } from "./syncExchange.ts";
import { previewSshPeer, commitSshPeer, sshPeerCommand, reconnectSshPeer, handleExchangeMessage, listSshPeers, type SshPeerOptions } from "./syncSsh.ts";
import { latexMiddleware } from "./latexPlugin.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { writeWorkbench } from "./workbenchStore.ts";
import { previewPairedSync, commitPairedSync, pairedSyncStatus, pendingPairedSyncs } from "./syncPaired.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { newExperimentNotebook } from "../src/experiments.ts";
import { writeExperiments, readExperiments } from "./experiments.ts";
import type { NotebookEntry } from "../src/types.ts";

const tex = "\\documentclass{article}\n\\begin{document}\nFirst idea.\n\nContext.\n\nLast idea.\n\\end{document}\n";
async function fixture() {
  const parent = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(parent, { recursive: true }); const laptop = await mkdtemp(path.join(parent, "ssh-exchange-")), project = await createPaperProject(laptop, "Synthetic SSH messaging"), projectId = project.id, root = (await getProject(laptop, projectId)).root;
  await initializeSyncDevice(laptop, "Laptop"); await writeFile(path.join(root, "main.tex"), tex);
  const stamp = "2026-10-14T00:00:00Z", entry: NotebookEntry = { id: "question", title: "Question", question: "Synthetic", notes: "Original", reply: "", proposal: "", status: "open", route: "codex", effort: 2, handoffs: [], appliedChanges: [], createdAt: stamp, updatedAt: stamp };
  await writeNotebook(laptop, projectId, 0, [entry]); await writeExperiments(laptop, projectId, "question", "", { ...newExperimentNotebook(), cells: [{ id: "proposed", cell_type: "code", source: "raise RuntimeError('This must never run during transfer')", metadata: {}, execution_count: null, outputs: [] }] });
  const baseline = await syncWorkingCheckpoint(laptop, projectId), snapshot = await readSyncSnapshot(baseline.path), desktop = path.join(laptop, "desktop"), copy = { destination: desktop, mainFile: "main.tex", label: "Desktop" }, plan = await previewSyncClone(snapshot, copy); await commitSyncClone(snapshot, copy, plan.planId);
  const device = (await syncStatus(desktop)).device!, options: SshPeerOptions = { host: "test-desktop", platform: "windows", tool: "C:/Installed Aw/scripts/awSync.ts", workspace: "C:/Research/Aw data", deviceId: device.id }, preview = await previewSshPeer(laptop, projectId, options); await commitSshPeer(laptop, projectId, options, preview.id);
  return { laptop, desktop, projectId, root, baseline, options, peerId: preview.id };
}

test("pair preview/commit stores only explicit immutable configuration and makes no network call", async () => {
  const f = await fixture(), peers = await listSshPeers(f.laptop, f.projectId); assert.equal(peers.length, 1); assert.equal(peers[0].host, "test-desktop");
  const preview = await previewSshPeer(f.laptop, f.projectId, f.options); assert.equal(preview.networkContacted, false); await assert.rejects(commitSshPeer(f.laptop, f.projectId, { ...f.options, host: "other" }, f.peerId), /changed/);
  await assert.rejects(previewSshPeer(f.laptop, f.projectId, { ...f.options, password: "not permitted" } as any), /Credentials/);
});
test("remote invocation uses fixed arguments and safe OS-specific path quoting", () => {
  const options: SshPeerOptions = { host: "desktop", platform: "windows", tool: "C:/Aw's copy/scripts/awSync.ts", workspace: "C:/Research's data", deviceId: "desktop-id" }, command = sshPeerCommand(options, "project");
  const script = Buffer.from(command.split(" ").at(-1)!, "base64").toString("utf16le"); assert.match(script, /'C:\/Aw''s copy\/scripts\/awSync.ts'/); assert.match(script, /exchange-stdio --workspace/); assert.match(script,/exit \$LASTEXITCODE/); assert.doesNotMatch(script, /Invoke-Expression|Start-Process/);
  const posix = sshPeerCommand({ ...options, platform: "posix", tool: "/opt/Aw's/scripts/awSync.ts", workspace: "/data/$(do-not-run)" }, "project"); assert.match(posix, /'"'"'/); assert.match(posix, /'\/data\/\$\(do-not-run\)'/);
  assert.throws(() => sshPeerCommand({ ...options, host: "-oProxyCommand=bad" }, "project"), /alias/); assert.throws(() => sshPeerCommand({ ...options, workspace: "C:/data\nmalicious" }, "project"), /paths/);
});
test("SSH harness exchanges both copies through stdio without services, imported execution or live writes", async () => {
  const f = await fixture(), remoteRoot = (await getProject(f.desktop, f.projectId)).root;
  await writeFile(path.join(f.root, "main.tex"), tex.replace("First idea.", "Human edit.")); await writeFile(path.join(remoteRoot, "main.tex"), tex.replace("Last idea.", "Desktop continuation."));
  const actions: string[] = [], result = await reconnectSshPeer(f.laptop, f.projectId, f.peerId, { runner: async (host, command, input, maximum, timeout) => {
    assert.equal(host, f.options.host); assert.match(command, /-EncodedCommand/); assert.ok(maximum < 30 * 1024 * 1024); assert.equal(timeout, 60000); const message = JSON.parse(input.toString()); actions.push(message.action); return Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop, f.projectId, message)));
  } });
  assert.deepEqual(actions, ["inventory", "export", "receive"]); assert.equal(result.connected, true); assert.equal(result.liveImport, false); assert.equal(result.merge.complete, true);
  assert.match(await readFile(path.join(f.root, "main.tex"), "utf8"), /Last idea/); assert.match(await readFile(path.join(remoteRoot, "main.tex"), "utf8"), /First idea/); assert.equal((await readExperiments(f.desktop, f.projectId, "question")).notebook.cells[0].execution_count, null);
});
test("offline/identity/budget failures never retry, run code, or rewrite current source", async () => {
  const f = await fixture(); let calls = 0; await assert.rejects(reconnectSshPeer(f.laptop, f.projectId, f.peerId, { runner: async () => { calls++; throw new Error("Synthetic offline host"); } }), /offline/); assert.equal(calls, 1); assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), tex);
  await assert.rejects(handleExchangeMessage(f.desktop, f.projectId, { version: 1, expectedDeviceId: "wrong", action: "inventory", maxBytes: 1024 }), /wrong remote device/);
  await assert.rejects(handleExchangeMessage(f.desktop, f.projectId, { version: 1, expectedDeviceId: f.options.deviceId, action: "run", maxBytes: 1024 }), /Invalid/);
  await assert.rejects(reconnectSshPeer(f.laptop, f.projectId, f.peerId, { maxBytes: 100000000 }), /bounded/);
});
test("actual offline remote CLI reads one bounded message and has no listener or notebook execution", async () => {
  const f = await fixture(), tool = path.resolve("scripts/awSync.ts"), message = { version: 1, expectedDeviceId: f.options.deviceId, action: "inventory", maxBytes: 1024 * 1024 };
  const output = await new Promise<string>((resolve,reject) => {
    const child = execFile(process.execPath, [tool, "exchange-stdio", "--workspace", f.desktop, "--project", f.projectId], { cwd: f.desktop, windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 }, (error,stdout) => error ? reject(error) : resolve(stdout)); child.stdin!.end(JSON.stringify(message));
  });
  assert.equal(JSON.parse(output).inventory.device.id, f.options.deviceId); assert.equal(JSON.parse(output).liveImport, false);
});
async function pairedFixture() {
  const f = await fixture(), remoteRoot = (await getProject(f.desktop,f.projectId)).root;
  await writeFile(path.join(f.root,"main.tex"),tex.replace("First idea.","Human offline edit.")); await writeFile(path.join(remoteRoot,"main.tex"),tex.replace("Last idea.","Desktop independent continuation."));
  const runner = async (_host: string,_command: string,input: Buffer) => Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString()))));
  const preview = await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner }); assert.equal(preview.paired,true); if (!("syncId" in preview)) throw new Error("Expected a complete paired preview"); return { ...f,remoteRoot,runner,preview };
}
test("one reviewed operation collects both saved copies, joins history and remembers agreement", async () => {
  const f = await pairedFixture(), result = await commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:f.runner }); assert.equal(result.completed,true); assert.equal(result.aligned,true); assert.equal(result.codeExecuted,false);
  const local = await readFile(path.join(f.root,"main.tex"),"utf8"), remote = await readFile(path.join(f.remoteRoot,"main.tex"),"utf8"); assert.equal(local,remote); assert.match(local,/Human offline edit/); assert.match(local,/Desktop independent continuation/);
  const status = await pairedSyncStatus(f.laptop,f.projectId,f.preview.syncId); assert.equal(status.completed,true); assert.equal((await readExperiments(f.desktop,f.projectId,"question")).notebook.cells[0].execution_count,null);
});
test("already aligned copies reuse heads on repeated sync without growing empty merge history", async () => {
  const f = await fixture(), runner = async (_host:string,_command:string,input:Buffer) => Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString()))));
  const first = await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner }); assert.equal("alreadyAligned" in first && first.alreadyAligned,true); assert.equal("syncId" in first,false);
  const second = await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner }); assert.equal(second.localHead,first.localHead); assert.equal(second.remoteHead,first.remoteHead);
  assert.equal((await readNotebook(f.laptop,f.projectId)).revision,1); assert.equal((await readNotebook(f.desktop,f.projectId)).revision,1);
});
test("independent new conversations on both copies converge to the same deterministic order", async () => {
  const f = await fixture(), stamp="2026-10-14T00:00:00Z";
  for (const [home,id] of [[f.laptop,"laptop-new"],[f.desktop,"desktop-new"]]) { const cat=await readNotebook(home,f.projectId); cat.entries.push({ ...structuredClone(cat.entries[0]),id,title:id,createdAt:stamp,updatedAt:stamp }); await writeNotebook(home,f.projectId,cat.revision,cat.entries); }
  const runner = async (_host:string,_command:string,input:Buffer) => Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString())))), preview=await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner }); assert.equal(preview.paired,true); if (!("syncId" in preview)) throw new Error("Expected independent additions to converge");
  await commitPairedSync(f.laptop,f.projectId,preview.syncId,{ runner }); assert.deepEqual((await readNotebook(f.laptop,f.projectId)).entries.map(entry=>entry.id),(await readNotebook(f.desktop,f.projectId)).entries.map(entry=>entry.id)); assert.equal((await readNotebook(f.laptop,f.projectId)).entries.length,3);
});
test("opening Aw and updating only queue housekeeping cannot block an offline desktop sync", async () => {
  const f=await fixture(), remoteRoot=(await getProject(f.desktop,f.projectId)).root; await writeWorkbench(f.laptop,f.projectId,0,{ ...emptyWorkbench(),queueLastActiveAt:"2026-10-14T06:00:00Z" });
  await writeFile(path.join(remoteRoot,"main.tex"),tex.replace("Last idea.","Desktop research"));
  const runner=async (_host:string,_command:string,input:Buffer)=>Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString())))), preview=await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner });
  assert.equal(preview.paired,true); if (!("syncId" in preview)) throw new Error("Empty local review initialization should not require human decision transfer");
  await commitPairedSync(f.laptop,f.projectId,preview.syncId,{ runner }); assert.equal(await readFile(path.join(f.root,"main.tex"),"utf8"),await readFile(path.join(remoteRoot,"main.tex"),"utf8"));
});
test("unknown review metadata is not mistaken for empty housekeeping or silently imported", async () => {
  const f=await fixture(); await writeWorkbench(f.laptop,f.projectId,0,emptyWorkbench()); const file=path.join(f.laptop,".paperfocus/project-data",f.projectId,"workbench.json"), value=JSON.parse(await readFile(file,"utf8")); value.extension={ preserve:"Unknown author-controlled data" }; await writeFile(file,JSON.stringify(value));
  const result=await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner:async (_host,_command,input)=>Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString())))) });
  assert.equal(result.paired,false); assert.ok(result.remoteMerge.held.some(item=>item.path==="data/workbench.json")); assert.deepEqual(JSON.parse(await readFile(file,"utf8")).extension,value.extension);
});
test("two-copy interruption after either collection resumes without duplicate saves", async () => {
  for (const phase of ["afterLocal","afterRemote"] as const) {
    const f = await pairedFixture(); await assert.rejects(commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:f.runner,[phase]:() => { throw new Error("Synthetic disconnect"); } }),/retained/);
    assert.equal((await pairedSyncStatus(f.laptop,f.projectId,f.preview.syncId)).completed,false); assert.equal((await pendingPairedSyncs(f.laptop,f.projectId))[0].id,f.preview.syncId); const local = await readNotebook(f.laptop,f.projectId), remote = await readNotebook(f.desktop,f.projectId);
    const resumed = await commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:f.runner }); assert.equal(resumed.completed,true); assert.deepEqual(await pendingPairedSyncs(f.laptop,f.projectId),[]); assert.equal((await readNotebook(f.laptop,f.projectId)).revision,local.revision); if (phase === "afterRemote") assert.equal((await readNotebook(f.desktop,f.projectId)).revision,remote.revision);
  }
});
test("changed remote work after preview is detected before the first local collection", async () => {
  const f = await pairedFixture(), local = await readFile(path.join(f.root,"main.tex")); await writeFile(path.join(f.remoteRoot,"main.tex"),"Later desktop work"); await assert.rejects(commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:f.runner }),/changed|local files/);
  assert.deepEqual(await readFile(path.join(f.root,"main.tex")),local); assert.equal(await readFile(path.join(f.remoteRoot,"main.tex"),"utf8"),"Later desktop work");
});
test("completed paired retries are offline and preserve later human work", async () => {
  const f = await pairedFixture(); await commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:f.runner }); await writeFile(path.join(f.root,"main.tex"),"Later human note"); const result = await commitPairedSync(f.laptop,f.projectId,f.preview.syncId,{ runner:async () => { throw new Error("Must not reconnect"); } }); assert.equal(result.alreadyComplete,true); assert.equal(await readFile(path.join(f.root,"main.tex"),"utf8"),"Later human note");
});
test("held source conflicts cannot enable the automatic two-copy commit", async () => {
  const f = await fixture(), remoteRoot = (await getProject(f.desktop,f.projectId)).root; await writeFile(path.join(f.root,"main.tex"),tex.replace("First idea.","Human replacement")); await writeFile(path.join(remoteRoot,"main.tex"),tex.replace("First idea.","Different desktop replacement"));
  const result = await previewPairedSync(f.laptop,f.projectId,f.peerId,{ runner:async (_host,_command,input) => Buffer.from(JSON.stringify(await handleExchangeMessage(f.desktop,f.projectId,JSON.parse(input.toString())))) }); assert.equal(result.paired,false); assert.equal("syncId" in result,false); assert.match(await readFile(path.join(f.root,"main.tex"),"utf8"),/Human replacement/);
});
test("HTTP exchange and merge require same-origin POST, exact review and saved drafts", async () => {
  const f = await fixture(), middleware = latexMiddleware(f.laptop), server = createServer((req,res) => { void middleware(req,res,() => { res.writeHead(404); res.end(); }); }); await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve)); const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (action: string, value: unknown, from=origin) => fetch(`${origin}/api/paperfocus/device-sync/${action}`, { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  try {
    for (const action of ["export", "receive", "merge", "pair", "reconnect", "acknowledge"]) { assert.equal((await fetch(`${origin}/api/paperfocus/device-sync/${action}`)).status,405); assert.equal((await post(action, {}, "https://foreign.example")).status,403); }
    const status = await (await fetch(`${origin}/api/paperfocus/device-sync?projectId=${f.projectId}`)).json(); assert.equal(status.exchangeSupported,true); assert.equal(status.peers[0].host,"test-desktop"); assert.equal(status.peers[0].workspace,undefined);
    const exported = await post("export",{ projectId: f.projectId }); assert.equal(exported.status,200); assert.equal(exported.headers.get("Content-Type"),"application/gzip"); assert.ok(exported.headers.get("X-Aw-Head"));
    const remoteRoot = (await getProject(f.desktop, f.projectId)).root; await writeFile(path.join(remoteRoot,"main.tex"),tex.replace("Last idea.","Desktop continuation.")); const remote = await syncWorkingCheckpoint(f.desktop,f.projectId), packet = await exportSyncExchange(f.desktop,f.projectId,remote.id,await createSyncInventory(f.laptop,f.projectId));
    const incoming = await post("receive",{ projectId:f.projectId,bytes:packet.bytes.toString("base64") }); assert.equal(incoming.status,200); assert.equal((await incoming.json()).liveImport,false);
    const compared = await post("compare",{ projectId:f.projectId,localId:f.baseline.id,remoteId:remote.id,refreshLocal:true }), comparison = await compared.json(); assert.equal(compared.status,200); assert.ok(comparison.merge.mergeId);
    const detail = await post("merge-file",{ projectId:f.projectId,planId:comparison.id,path:"source/main.tex" }); assert.equal(detail.status,200); assert.match((await detail.json()).after,/Desktop continuation/);
    assert.equal((await post("merge",{ projectId:f.projectId,planId:comparison.id,reviewId:comparison.merge.mergeId })).status,400);
    const collected = await post("merge",{ projectId:f.projectId,planId:comparison.id,reviewId:comparison.merge.mergeId,draftsSaved:true }); assert.equal(collected.status,200); assert.equal((await collected.json()).approvalGranted,false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
