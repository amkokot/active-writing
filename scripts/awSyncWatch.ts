// Explicit opt-in, project-scoped saved-work sync. No service/browser required.
import path from "node:path";
import { setPriority, constants as osConstants } from 'node:os';
import { configureAutoSync, disableAutoSync, autoSyncCycle, autoSyncStatus, followReadingSync } from "../server/syncAuto.ts";

const args = process.argv.slice(2), command = args.shift(), flags: Record<string, string> = {};
if (!command || command === "--help") {
  console.log(`Aw saved-work synchronization (no model calls, execution or public listener)
node scripts/awSyncWatch.ts enable --workspace HOME --project ID --peer HASH --mode stage|safe --saved-drafts yes [--interval-seconds 180] [--timeout-seconds 30]
node scripts/awSyncWatch.ts status|disable|once|watch --workspace HOME --project ID
node scripts/awSyncWatch.ts follow --workspace HOME --project ID
node scripts/awSyncWatch.ts live --workspace HOME --project ID
follow upgrades an enabled safe pair to independent reading records.
For a new paired project, enroll both installed change journals with
scripts/awSyncJournalSetup.ts pair (preview, then exact --commit). See DEVICE_SYNC.md.
live keeps one private SSH stream: saved TeX/comments follow file events, with a
five-second fallback for missed/NFS events. Notebooks/figures use the slower lane.
It does not transfer experiment archives or claim whole-project history agreement.
once also accepts --check-now yes for one manual check without waiting for backoff.
disable also accepts --reason TEXT to show a saved manual-attention notice.

Enable is explicit permission for this pinned peer/project only. stage exchanges only;
safe collects only when BOTH complete guarded research proposals agree. Protected
wording, comments, request completion, deletion, code and overlaps stay held. No AI
merge, latest-wins policy, automatic partial-operation retry, or experiment replay.
Run watch on ONE coordinating machine. It backs off while offline; closing the
laptop doesn't stop desktop Codex/experiments. Start it at sign-in with your OS's
task manager. Disable stops new commits; never kill an in-progress guarded commit.
Only saved disk work syncs. Save drafts on both copies before enabling. Status is
local/read-only; once normally honors the saved interval/backoff. A manual check
still respects the network gate, locks, conflicts and interrupted operations.
See docs/DEVICE_SYNC.md.`);
} else {
  try {
    // Only the standalone worker yields CPU to the editor/research applications.
    // Never change the priority of an Aw service through autoSyncCycle().
    if(command==='once'||command==='watch'||command==='live')try{setPriority(0,osConstants.priority.PRIORITY_BELOW_NORMAL);}catch{/* OS scheduling support is optional, not a reason to lose a guarded sync. */}
    const permitted = command === "enable" ? ["workspace", "project", "peer", "mode", "saved-drafts", "interval-seconds", "timeout-seconds"] : command==='disable'?["workspace","project","reason"]:command==='once'?["workspace","project","check-now"]:["workspace", "project"];
    if (!["enable", "disable", "status", "once", "watch", "follow", "live"].includes(command)) throw new Error("Unknown command; use --help.");
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index].replace(/^--/, ""), value = args[index + 1];
      if (!args[index].startsWith("--") || !permitted.includes(key) || flags[key] || !value || value.startsWith("--")) throw new Error("Unknown/repeated/incomplete option: " + args[index]);
      flags[key] = value;
    }
    if (!flags.workspace || !flags.project) throw new Error("Specify the confirmed workspace and project.");
    const workspace = path.resolve(flags.workspace), projectId = flags.project;
    if (command === "enable") console.log(JSON.stringify(await configureAutoSync(workspace, projectId, { peerId: flags.peer, mode: flags.mode as "stage" | "safe", intervalSeconds: flags["interval-seconds"] ? Number(flags["interval-seconds"]) : undefined, timeoutSeconds: flags["timeout-seconds"] ? Number(flags["timeout-seconds"]) : undefined, savedDraftsConfirmed: flags["saved-drafts"] === "yes" }), null, 2));
    else if (command === "follow") console.log(JSON.stringify(await followReadingSync(workspace,projectId),null,2));
    else if(command==='live'){
      const controller=new AbortController();process.on('SIGINT',()=>controller.abort());process.on('SIGTERM',()=>controller.abort());
      await (await import('../server/syncLive.ts')).followLiveReading(workspace,projectId,controller.signal,value=>console.log(JSON.stringify(value)));
    }
    else if (command === "disable") console.log(JSON.stringify(await disableAutoSync(workspace, projectId,flags.reason), null, 2));
    else if (command === "status") console.log(JSON.stringify(await autoSyncStatus(workspace, projectId), null, 2));
    else if (command === "once") {
      if(flags['check-now']!==undefined && flags['check-now']!=='yes')throw new Error('Use --check-now yes for one explicit check.');
      console.log(JSON.stringify(await autoSyncCycle(workspace, projectId,{checkNow:flags['check-now']==='yes'}), null, 2));
    }
    else {
      let stopping = false, last = "";
      // Finish the current guarded operation before a graceful exit.
      process.on("SIGINT", () => { stopping = true; }); process.on("SIGTERM", () => { stopping = true; });
      while (!stopping) {
        const result = await autoSyncCycle(workspace, projectId);
        if (result.status === "disabled") break;
        const summary = JSON.stringify({ status: result.status, ...( "syncId" in result ? { syncId: result.syncId } : {}), ...( "detail" in result ? { detail: result.detail } : {}) });
        if (summary !== last) { console.log(JSON.stringify({ at: new Date().toISOString(), ...JSON.parse(summary) })); last = summary; }
        if (!stopping) await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
