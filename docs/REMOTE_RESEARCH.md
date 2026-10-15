# Research sessions and remote compute

For local-first two-machine preparation, see [DEVICE_SYNC.md](DEVICE_SYNC.md).
Device identities, private snapshots, resumable deduplicated staging, checked
parent history, guarded first-copy creation and detached three-way review copies
now work offline. App code can launch a separately located research-data home.
Review
preparation refuses a plan after new local source/notebook edits. These are
receiving-side tools, not an SSH compute worker. Guarded research batches now merge
ordinary source, safe existing conversation fields, new branches and notebook evidence
in separate homes. Private incremental files and explicit SSH pairing/stdio exchange
work; a reviewed two-copy operation collects both only when their complete proposals
agree. Protected/publication changes retain their own workflows. These paths need no
Aw service and never run imported cells. The one-host safety rules below still apply
within each active data home; do not write one shared store from two computers.

Status: 6 October 2026. Local notebooks, guarded writes, direct assistant handoffs,
saved displays and independent windows work today. Remote desktop access is
external to Aw. SSH execution adapters, cluster submission, durable scheduler
polling and guarded remote-result collection are not implemented yet. Nothing
here connects an account, opens a network listener or submits a job.

## Start the first real sessions

1. Open Aw through its desktop shortcut. Use one service with several browser
   tabs/windows, not multiple servers pointed at the same Aw home. Under
   Advanced → Second screen & windows, open the companion view you need; a
   Passage link can also open a separate manuscript tab.
2. Choose the paper with the folder icon. Check its root file. Start a separate
   notebook conversation for each genuinely independent question. Use names that
   identify the target, not just “experiment”. Keep only a few useful displays pinned.
3. In Experiments → Jupyter & shared files, optionally Check research setup.
   This reads saved files and probes the installed interpreter's version/package
   metadata. It never executes notebook source, enables Python or installs anything.
   Browser drafts and backup completeness are outside that check.
4. Copy instructions for an assistant into the existing folder-aware chat. Start
   with the intended result, assumptions, next uncertainty and compute budget.
   The assistant should inspect current evidence, save separate reasoning and
   numerical controls, and finish the exact saved request when appropriate.
5. Use Next to work elsewhere while waiting. Returns are invitations, not forced
   navigation. Apply publication manuscript text only after reviewing it. Agents
   may resolve simple comments after verifying a complete saved fix during an
   authorized revision pass; assessment questions stay open. A proof, numerical observation and edited prose
   should remain distinct records.

Local Python defaults to two simultaneous runs in different notebook owners,
always one per notebook; inspect the actual host capacity before running.
The default is a fresh process and 30 seconds. Longer 2/5-minute budgets and
notebook-owned shared sessions are deliberate choices. Separate conversations
sharing the same experiment owner also share its session. Server restart loses
variables, not saved outputs; reopening never replays code. Heavy experiments
must not be disguised as dozens of short local runs.

At a stopping point, leave one short note: target/assumptions, useful finding,
open gap, exact cell/run IDs, waiting tasks and next action. Confirm saves have
settled. If a conflict is visible, keep/export the draft rather than restarting
to make the warning disappear.

## Backups and moving machines

The manuscript repository is not the complete research record. Back up its
source and assets, Aw home's `.paperfocus/projects.json`, and the owning
`.paperfocus/project-data/PROJECT_ID/` folders. These hold conversations,
experiments, run history, replies and the project catalogue. Pause writers/runs
for a consistent copy, then verify a restore separately. Never overwrite a live
store with a backup. Browser recovery copies are not a backup.

Notebook Export keeps all cells, including filed/trash records. Evidence
snapshots are useful fixed records, but omit filed/trash cells and historical
run-record files; they are not a complete project backup. Large generated builds
can normally be regenerated, but only exclude them deliberately after deciding
what needs preservation. There is no automatic backup/pruning in this pass.

Do not use a cloud-synced `.ipynb` or JSON folder as an active multi-host database.
Aw guards revisions and merges independent edits within a service; independent
services have separate process locks and can still race. One live host owns
saves. A second machine should view that host or work in a separate copy and
reconcile deliberately. Relocation also needs registry path remapping and
runtime checks; copying Windows paths does not make them valid on Linux.

For the first independent copy, `awSync.ts clone` previews then commits one
explicit checkpoint into a new, absent data home. It preserves record IDs and
relative source structure, creates a distinct device identity, and refuses
pending requests. Use the code installation's launcher with `--workspace` to
open that home. See [the first-copy procedure](DEVICE_SYNC.md#first-copy-to-a-new-computer).
This does not move the laptop's work, install runtimes or configure SSH. Keep
both copies independent and prepare later merges deliberately; the live collector
for a whole project is not implemented. A reviewed existing experiment notebook
can now be collected through `awSync.ts collect`, with a backup/journal and
current revision/run guards; source, catalogue and queued requests stay untouched.
`collect --entries` can also add selected new research conversations and their new
owners, with evidence prepared first and the receiving catalogue appended last.
Neither mode edits source, completes requests or replaces existing conversations.
Never share an actively written data home between hosts.

For ordinary research-source and existing conversation-field reconciliation, use
the newer guarded `merge` or reviewed paired `sync` flow in DEVICE_SYNC.md. The
private SSH exchange is not a compute worker: ongoing desktop agents/experiments
remain independent, and no notebook code is submitted, restarted or replayed.

## Desktop access first

The simplest first step is to remotely access the desktop that owns Aw and the
research files. Keep Aw listening on `127.0.0.1`; browser windows on that desktop
use the existing app. This keeps the assistant, Python and project paths on one
machine, with no new distributed storage protocol.

An alternative is an authenticated SSH tunnel to an already configured host.
Keep the same client and server port, because Aw checks the browser Host/Origin
against its listener. For example, with an existing authorized SSH login:

```text
ssh -N -L 127.0.0.1:4173:127.0.0.1:4173 USER@DESKTOP
```

Then the client browser uses `http://127.0.0.1:4173/`. The client port must be
free; do not start a competing local Aw service there. Run `awResearch.ts` on
the Aw host, with that host's workspace path. Notebook/folder paths returned by
Aw belong to the host, not the client; Open folder opens Explorer on the host.
This tunnel pattern is a future deployment option, not an end-to-end tested
connection here. SSH setup, keys, host verification and institutional access
policy need the user's chosen environment. Do not bind Aw to `0.0.0.0`, open a
public port or bypass host/certificate warnings. Aw has no remote multi-user
authentication; same-origin checks are not authentication.

OpenSSH documents loopback-bound local forwarding in its [SSH manual](https://man.openbsd.org/ssh.1).

## Direction for remote desktops and a cluster

Keep three separable responsibilities:

- Browser: editing, notebook display, queue and independent views.
- One Aw host: authoritative source/notes, revision guards, request identity,
  job catalogue and result collection. Agents save through that host's harness.
- Compute workers: execute an explicitly approved, frozen experiment in a
  private per-job working directory; return artifacts, never rewrite the live
  manuscript or notebook directly.

The current preflight reports `execution.targets: ["local"]`,
the actual `maxConcurrentRuns` (default 2, host-configurable from 1 to 4),
`maxConcurrentRunsPerNotebook: 1`, available slots, and `remoteEnabled: false`. An
older running service retains its old capability until a safe restart. Local
concurrency is not remote execution or a CPU/memory sandbox. Keep capability reporting
explicit as adapters are added. Do not expose unavailable targets in the normal
UI. Later, Python settings can offer On this computer / Desktop / Cluster;
ordinary notebook controls, summaries and queue behavior should stay unchanged.

The next backend boundary should be an execution adapter with prepare, submit,
status, cancel and collect operations. Preserve the existing local runner as the
default. Implement remote desktop SSH first; add the actual cluster scheduler
only after confirming its type and policy. Do not assume the cluster uses Slurm.

Use a durable, versioned job contract with stable project/conversation/notebook/
cell IDs, exact source and input hashes, parameter/seed specification, environment
or dependency-lock identity, resource limits and a unique submission token.
Transfers should use relative bundle paths; local/remote path maps stay in
private host configuration. Keep credentials in existing SSH tooling, not prompts,
notebook metadata, project repositories or exported bundles.

The lifecycle needs separate states for prepared, submitted/queued, running,
collecting, succeeded, failed, cancelled and unknown. A successful submit is not
a completed computation; loss of connectivity is unknown, not failure. Persist
the scheduler job ID before retries, reconcile status after reconnection, and
never silently resubmit a possibly accepted job. A live Aw browser should not be
required for an accepted remote job to keep running.

For Slurm, `sbatch` returns after acceptance and does not transfer the input
files. Its official [submission documentation](https://slurm.schedmd.com/sbatch.html)
therefore supports a separate staging/collection step, rather than treating a
successful `sbatch` exit as a research result. Account, partition, walltime,
CPUs/GPUs, memory and permitted queue concurrency must be explicit and bounded.

On collection, validate ownership, source/input hashes, manifest/artifact hashes,
status and size limits. Preserve the immutable result even if the originating
cell changed. Attach it only where the current source still matches, or retain
it as older evidence for explicit reconciliation. A removed/filed cell must not
be silently resurrected. Store environment versions, host/adapter, scheduler ID,
timing, parameters, stdout/stderr and output hashes with the run. Execution origin
is provenance, not mathematical verification.

Keep bulk arrays/checkpoints on the worker or artifact store. Return a small
table, selected plots, controls and a Markdown interpretation first; fetch large
artifacts explicitly when needed. Transfer new immutable artifacts only, avoid
continuous whole-notebook syncing, and back off polling queued/unchanged jobs.
Existing saved plots, sweeps and heatmaps can display the compact results without
live kernels or remote widget callbacks. Notebook text-only summaries still
matter for assistants.

Remote results should use the same optional Return invitation and explicit human
completion as local work. Completed computation, an assistant answer, reviewed
evidence and a resolved queue item are different events.

## Next implementation gate

Before enabling a real worker, choose its OS/SSH alias, environment, permitted
data transfer, scratch/output locations and resource budget. For the cluster,
also identify its scheduler, account/partition policy and cancellation semantics.
Then test one tiny authorized deterministic run end to end: stage, submit,
disconnect/reconnect, collect, stale-source handling, duplicate prevention and
cancel. Only then try a meaningful research experiment. This pass deliberately
does not configure those machines or consume remote resources.
