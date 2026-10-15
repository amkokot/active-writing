# Two-computer workflow

Status: **offline-first research reconciliation, private incremental exchanges
and optional reviewed SSH synchronization**, October 2026. Each machine keeps its
own data home and works without a connection. Ordinary research-source, conversation
and experiment changes can collect through guarded, recoverable batches. Publication
wording, locks, review/policy/task decisions, deletions and ambiguous code/output
changes retain their own workflows. This is not a distributed database, automatic
background sync, remote Python worker or backup restore. No real second host has
been configured or tested yet; the SSH contract has been exercised with local doubles.

## What works now

- Each Aw installation can have a distinct saved device ID and a human name.
  **Workspace folders → Two computers** is collapsed until opened. Reading its
  status does not create an identity or contact another computer.
- `scripts/awSync.ts` works without the Aw service, npm downloads or model calls.
- First-copy import creates a new data home, preserving project/conversation/cell
  IDs, source includes, policy, locks and saved evidence. It never imports over an
  existing home and never resumes requests or runs. App code stays separate.
- An explicit selected-project capture saves source/assets, notebook catalogue,
  experiment notebooks, immutable run files, assistance/review state, project
  purpose/version metadata and saved research/reference/handoff files.
- Snapshots have SHA-256 file/manifest checksums, explicit ancestry and deletion
  history. Comparing two descendants requires their exact shared baseline,
  distinct device IDs and the same project ID. Dates do not select a winner.
- The merge preview combines independent catalogue fields, new conversations
  and notebook cells. Conservative conflicts preserve base/local/remote variants.
  Code cells are execution units: concurrent code/output changes are not spliced.
  Run files are immutable; divergent copies or removals require review.
- A saved preview and optional short assistant brief can be inspected without
  executing notebook code, approving wording, resolving comments or finishing jobs.
- Staging stores identical file content once, verifies it on reuse, and marks a
  snapshot ready only after all its files are saved. Repeat an interrupted stage
  with the same packet; completed files are reused, not added again.
- Comparing staged branches follows their actual saved parent manifests and
  checks ancestry/deletion history. Missing or unfinished parents block comparison.
  The nearest shared baseline is used; ambiguous histories need an explicit choice.
- Preparing a detached review copy checks the installation identity and saved
  local source/notebook state before and after preparation. New local edits require
  a fresh branch/plan. The review copy never replaces a live store.
  Routine queue activity and its assistance-store revision counter are ignored
  for this detached check; authored concerns and protected wording remain checked.
- Agents have a server-independent fast path: capture-and-stage a checkpoint,
  inspect a small change index, read one exact file/conflict, and prepare literal
  text combinations or targeted reconciliation proposals. No model call is built in.
- `collect` previews one existing experiment notebook. Exact-review commit uses
  the guarded notebook store, preserves IDs/outputs/provenance, copies matching
  new immutable run files, and saves a full selected-project checkpoint first.
  It never runs code, changes source or finishes a queued request.
- `collect --entries` adds 1–8 distinct new conversations with their new notebooks
  and saved runs. Existing conversations remain unchanged. Evidence is prepared
  first and the byte/revision-guarded catalogue is saved last, with resumable journals.
- `merge` collects a reviewed batch of ordinary research source, safe existing
  conversation fields, new conversations, notebooks and their saved runs. It keeps
  complete before-checkpoints, byte/revision fences, leases and resumable journals.
- Checkpoints remember their working parent and reuse unchanged authored work.
  Complete batches join the two histories; partial batches keep only their local
  parent, so held changes are not accidentally acknowledged or lost next time.
- `.aw-sync` exchanges compress checked history and send each content hash once.
  A receiving inventory skips already saved manifests/data. Receive stages only.
- Explicit SSH pairing pins a host alias, installed tool path, data home and device
  identity. `sync` previews both sides; only convergent, unheld proposals enable an
  exact-review two-copy commit. No public listener or notebook code execution occurs.
- Interrupted two-copy operations can be reopened after refresh in **Two computers
  → Interrupted syncs**, or inspected/resumed with their exact offline tool IDs.

## Offline commands

Use the confirmed Aw home and registry project ID, not the selected browser tab.

```text
node scripts/awSync.ts --help
node scripts/awSync.ts status --workspace AW_HOME
node scripts/awSync.ts init --workspace AW_HOME --label Laptop
node scripts/awSync.ts snapshot --workspace AW_HOME --project PROJECT_ID
```

`init` creates only `.paperfocus/device-sync/device.json` outside paper checkouts.
It preserves an existing identity; a different requested name is refused for now.
Do not copy this file to another installation. Set up the second installation
independently as Desktop. The friends' app distribution includes the sync tool
and this guide but excludes all live identities, packets and private records.

Default snapshots are new immutable files under
`.paperfocus/device-sync/snapshots/HASH.json`. `--output NEW.json` instead writes
an explicit new file and never replaces an existing one. Preserve the initial
shared snapshot when preparing the second copy. Use the guarded first-copy command
below rather than copying device identities or replacing a registry manually.

## Everyday reconnect workflow

Keep app code installed separately on each machine; keep two independent local
research-data homes, not one actively written cloud/network folder. Save open
drafts before transferring. The app flushes this window's source/notebook drafts
before capture and collection; it cannot flush another machine's browser drafts.
Neither computer is a permanent winner. Dates do not decide authored conflicts.

**Workspace folders → Two computers** stays collapsed until needed. With a saved
SSH connection, **Sync now** exchanges checkpoints and previews both proposed
results. **Sync safe changes on both copies** becomes available only when both
proposals have no held changes and agree on the complete authored result. Confirm
other open drafts are saved, then collect. The actual source/notebook saves are
guarded, backed up and sequential. This is a recoverable workflow, not a distributed
transaction; a disconnect never triggers an automatic rollback or job rerun.

Without SSH, **Download exchange** and **Receive exchange** use a private `.aw-sync`
file through a trusted channel. Receive only stages it. **Compare changes** makes a
current local checkpoint and shows the safe changes/held list. **Inspect** reads
complete small current/proposed text; large/binary material needs the exact offline
file tools, not a truncated preview. **Collect safe changes here** updates only this
copy. Exchange its resulting head back and collect there; **Mark matching copies
aligned** requires actual agreement and joined local history. There is no background
network traffic while working offline. Large exchanges use the CLI (browser receive
limit 16 MB). Private files are not email-ready collaborator exports or app updates.

### Guarded research batch

```text
node scripts/awSync.ts merge --workspace AW_HOME --project ID --plan PLAN_HASH
node scripts/awSync.ts merge-details --workspace AW_HOME --project ID --plan PLAN_HASH --output NEW-DETAILS.json
node scripts/awSync.ts merge-file --workspace AW_HOME --project ID --plan PLAN_HASH --path source/main.tex --output NEW-PROPOSAL.tex
node scripts/awSync.ts merge --workspace AW_HOME --project ID --plan PLAN_HASH --review RETURNED_MERGE_HASH --commit
node scripts/awSync.ts merge-status --workspace AW_HOME --project ID --merge RETURNED_MERGE_HASH
```

Ordinary UTF-8 `.tex`, `.bib`, `.md`, `.txt`, and supported figure files may transfer;
code/configuration files are held. Separate literal line edits combine mechanically.
Existing conversation title/question/notes/reply/proposal, compact context and filing/
pin/order fields can merge; ownership, anchors, pending/completed requests, integrated
status, applied-change history and unknown metadata are not silently replaced.
Display chronology takes a deterministic timestamp, never a winner for content.
Independent new entries use the checked plan's deterministic order; competing
reorders remain held. Existing cell deletion/type changes and filed/trash resurrection,
ambiguous outputs and unmatched run provenance stay held. New cards/evidence are units.

The batch caps are 300 changed files/48 MB, eight new conversations, sixteen changed
owners, with the original notebook/run and snapshot limits still enforced. The
original project is captured once for the journal; individual writes use exact-byte
fences/native stores, and full state is checked before/after the batch and before
publishing cards. It does not recapture the whole project for every file. Interrupted
files accept only that journal's exact before/after bytes. No removals, task completion,
comment resolution, purpose changes, code execution or wording approval occur.
All publication-source changes are conservatively held, even one-sided changes;
use their writing workflow. Known or uncertain wording locks also hold source.

For a held ordinary source overlap, make the existing `reconcile` proposal, then
pass `merge --proposal PROPOSAL_HASH`. For an ordinary conversation-field overlap,
`merge-details` returns its exact conflict ID/base/local/remote. A separate decisions
file has `{ "version": 1, "projectId": "ID", "planId": "HASH", "decisions": [
{ "conflictId": "EXACT_ID", "choice": "text", "text": "Complete field text" } ] }`.
Use `merge --decisions NEW.json` for preview and repeat those same options on commit.
`local`/`remote` choices omit `text`. Protected fields cannot be targeted. Original
variants survive; this is not permission to rewrite unrelated exposition.

### Incremental private files and shared history

```text
node scripts/awSync.ts checkpoint --workspace AW_HOME --project ID
node scripts/awSync.ts inventory --workspace AW_HOME --project ID --output NEW-INVENTORY.json
node scripts/awSync.ts export --workspace AW_HOME --project ID --head HEAD_HASH --output NEW.aw-sync --inventory OTHER-INVENTORY.json
node scripts/awSync.ts receive --workspace AW_HOME --project ID --file PRIVATE.aw-sync
node scripts/awSync.ts exchange-status --workspace AW_HOME --project ID
node scripts/awSync.ts acknowledge --workspace AW_HOME --project ID --head AGREED_OTHER_HEAD
```

After the first remembered checkpoint, omit `--parent`: the tool follows its current
working/shared head. Old staged histories with no remembered head need one deliberate
`--parent EXACT_LOCAL_HEAD`; a completed first-copy home uses its checked baseline.
Never reset a history merely to avoid a conflict. An unchanged checkpoint reuses its
existing ID. With a previously received peer, `export --peer OTHER_DEVICE_ID` uses its
checked inventory rather than a separately carried inventory file. Output files are
new and never overwrite. Exchanges cap at 64 MB compressed/192 MB expanded, 128 MB
unique data and 50,000 references. Whole graph history remains bounded to 256 ancestors.
Hashes are verified before staging; missing omitted data/parents fail rather than
inventing readiness. Receiving an interrupted exchange can repeat identically.

Receive records a **received head**, not acceptance. Complete collection saves a
two-parent head; partial collection saves a local-only descendant and retains the
held variants. Acknowledge is non-mutating for source/notebooks and requires both
authored states to match and the offered head to contain the local branch. Only known
host-local catalogue/workbench counters, queue activity and validated JSON formatting
are excluded from this agreement comparison. Unknown metadata, policy, locks, outputs,
source bytes and immutable run bytes remain significant. A validated review record
containing only the known empty collections is equivalent to an uninitialized one
for agreement; it is not imported or removed. Unknown fields, comments, requests,
recoveries and locks are never treated as empty. Subsequent offline work then
branches from the agreed checkpoint, avoiding repeated already-resolved conflicts.
When already-aligned copies share the required ancestry, another sync acknowledges
that fact without saving source/notebooks or adding empty merge heads. A counter-only
native save still creates a fresh byte fence when needed; it is never incorrectly
reused as an older raw catalogue revision. Capability reporting separates explicit
SSH/research collection from unavailable automatic sync, protected-state import and
remote compute; status checks themselves never connect.

### Optional SSH and one reviewed two-copy operation

First install Node 24+/Aw on the desktop and make its guarded separate copy. Configure
an SSH alias, key/login and trusted host key outside Aw. Aw stores no passwords/keys
and never accepts a new host key or changes SSH settings. The remote data home and
installed `scripts/awSync.ts` path are explicit; Windows and POSIX invocation quoting
are separate. Desktop Aw/Codex/Python may keep working independently of the laptop.
This protocol never starts/stops them or configures a cluster worker.

```text
node scripts/awSync.ts pair --workspace LAPTOP_DATA --project ID --host DESKTOP_ALIAS --platform windows --tool "C:/Installed Aw/scripts/awSync.ts" --remote-workspace "C:/Research/Aw data" --device DESKTOP_DEVICE_ID
# Repeat with --review RETURNED_PAIR_HASH --commit after checking the paths/identity.
node scripts/awSync.ts sync --workspace LAPTOP_DATA --project ID --peer PAIR_HASH
# Save drafts on both copies; inspect both proposals.
node scripts/awSync.ts sync --workspace LAPTOP_DATA --project ID --review RETURNED_SYNC_HASH --commit
node scripts/awSync.ts sync-status --workspace LAPTOP_DATA --project ID --sync RETURNED_SYNC_HASH
```

Pairing makes no connection. `reconnect --peer HASH` exchanges/stages only and returns
a local preview. `sync --peer HASH` also previews the remote side. Each SSH message is
noninteractive, uses strict known-host checking and defaults to 16 MB/60 seconds;
explicit preview options allow at most 64 MB/120 seconds per message. No automatic
retry, upload outside the paired project, dependency installation, listener or job
submission occurs. The remote CLI reads one bounded stdio message and exits; its
ordinary notebook/source guards work without an Aw service.

Exact-sync commit first rechecks the remote original review, collects locally with a
full checkpoint, stages the collected head remotely, checks the new remote candidate
against the **originally reviewed authored result**, then collects remotely. It returns
the canonical remote head and acknowledges matching copies locally. A completed retry
needs no network and cannot overwrite later work. A disconnect after either collection
can resume without allocating a second save. Newer local/desktop work stops alignment
and remains saved; inspect the journals and make a fresh preview, never force a retry.
The started marker survives browser closure and exposes **Interrupted syncs → Resume**.
Original packets, backups and all partial preparation files remain recoverable.
Keep one coordinating sync operation per project across the two machines, even
when several app windows are open. Simultaneous initiation preserves both copies,
but can leave competing shared heads needing an explicit `compare --base` and
no-op guarded merge before agreement; never reset history to avoid that review.

If proposals disagree or protected/ambiguous concerns remain, the paired commit is not
offered. The app can collect selected safe changes here, with the remaining concerns
visible. An assistant can inspect exact conflicts and propose scoped ordinary text;
it does not receive permission to approve publication words, complete requests,
unlock text, remove history, execute cells or choose a side merely to make counts zero.
No real desktop/SSH host has been exercised in this development environment yet.

### Updating the app, not the data

Use the clean **Export Aw** distribution for code/tools/guides. Install a new code
copy separately, verify/setup it with permission for dependencies when needed, build,
then point the launcher/agent command path at the existing data home. This avoids
overwriting research with an app update and keeps the old code copy recoverable.
Update a data home's generated `AGENTS.md` pointer only when the code path changes;
never rewrite historical scientific runtime paths. Before mixing offline collection
with an older running service, arrange one quiet restart after saves/runs settle:
the updated source writer now shares file-byte fences/leases. Do not deploy/restart
over another owner's active work. Automatic app-code updates are not implemented.

## First copy to a new computer

Install the app code separately using [PORTABLE_AW.md](PORTABLE_AW.md). On the
source machine, save editor drafts and choose a quiet checkpoint with no waiting
model/agent requests or active runs. Explicitly capture the selected project.
For a genuinely new pairing, use an initial checkpoint without a parent; keep
this shared packet. Do not reset an existing transfer history this way.

Move that private packet by an authorized trusted channel. On the receiving
machine, choose a **new, absent** data-home directory whose parent already exists:

```text
node scripts/awSync.ts clone --file COMMON.json --destination NEW_DATA_HOME --main-file main.tex --label Desktop
node scripts/awSync.ts clone --file COMMON.json --destination NEW_DATA_HOME --main-file main.tex --label Desktop --plan RETURNED_PLAN_HASH --commit
```

The first call validates and previews without creating folders. Select the exact
independent TeX root from its `roots`; included sections are not separate roots.
Optional `--engine pdflatex|xelatex|lualatex` selects the compiler. The second call
checks the same packet, destination, root and device name against the plan hash.
It writes source under `NEW_DATA_HOME/paper/` and Aw records outside that checkout
under `.paperfocus/project-data/PROJECT_ID/`. It creates a fresh registry/catalogue
with local paths, not a copy of the source machine's global registry. Source files
and notebook/review bytes are unchanged; publication policies and wording locks
stay in force. A distinct local device ID prevents the two copies being confused.
The new home's `AGENTS.md` points to the receiving installation's guides/tools,
with the exact data-home/project scope. It lives outside the paper checkout.

The original packet is saved and staged as the receiving copy's shared baseline.
If it had parents, `missingHistory` lists the earlier packets still needed: stage
all of them before comparison. A completion receipt does not invent ancestry,
verify mathematics or approve text. Historical execution paths remain historical;
configure the recipient's Python/TeX/models independently. No code, compiler,
dependency install, remote contact, request completion or task replay occurs.

Completed files survive interruption. Repeat the exact command/plan to resume;
changed partial files, unexpected additions or another clone journal stop it
without overwriting. A `.part` or crashed `.aw-lock` needs explicit inspection,
not automatic removal. If creation stopped before a journal was written, inspect
that folder and choose a new destination rather than clearing it automatically.
Registry registration comes after source/data copying; readiness comes after
verification. The normal launcher refuses an unfinished first copy. Repeating a
completed clone reports completion without recopying over subsequent local edits.

This first step supports one project in a new home, not adding another project
to an occupied home, full backup recovery, Git-history restoration or live merged
imports. Browser-only drafts, excluded caches/recoveries, credentials, dependencies
and Git history are outside the packet. Original files on the source machine are
never changed. Snapshot checksums detect damage, not sender authenticity.

### Keep app code and research data separate

Use the existing code installation to open the new data home:

```text
node scripts/desktopLauncher.mjs --workspace NEW_DATA_HOME
```

On Windows, `scripts/installDesktopShortcut.ps1 -WorkspacePath NEW_DATA_HOME`
can explicitly install a shortcut targeting that home. The usual shortcut is
unchanged unless that installer is run. The launcher uses the app code's current
built assets and data-home-specific logs/locks; it refuses an outdated/missing
build rather than starting development mode against the wrong folder. Another
home's service on port 4173 is never stopped or reused. One service per machine,
several windows, remains the rule. Use local disks, not a simultaneously written
cloud/network store.

Agents can run the tools by their absolute **app-code** path with an explicit
`--workspace DATA_HOME`; bindings retain the owning data home's IDs. They do not
need the launcher or server for ordinary offline record work. Updating the code
installation need not change the data home. This separation is groundwork for
app updates, not an automatic code updater or research synchronization service.
Workspace notes, saved assistant requests and copied notebook instructions now
report the installed tool paths rather than assuming `scripts/` exists in the
data home. If the code installation is moved later, deliberately update the
generated local `AGENTS.md` pointer; do not rewrite old scientific provenance.
The offline harness accepts a completed receiving home without a `package.json`;
its copy receipt/device identity and registry are checked before guarded access.
An unfinished or mismatched home is refused, not repaired automatically.

## Compare later work

```text
node scripts/awSync.ts snapshot --workspace LAPTOP_AW --project PROJECT_ID --parent COMMON.json --output LAPTOP.json
node scripts/awSync.ts snapshot --workspace DESKTOP_AW --project PROJECT_ID --parent COMMON.json --output DESKTOP.json
node scripts/awSync.ts preview --base COMMON.json --local LAPTOP.json --remote DESKTOP.json --output NEW-PLAN.json --brief NEW-BRIEF.md
```

The direct `preview` command compares three complete packets but only checks
their claimed ancestry. For checked parent history and recoverable staging, use
the following on the receiving installation. Stage **every parent** back to the
initial shared copy, not just the three files in this simple example.

```text
node scripts/awSync.ts stage --workspace LAPTOP_AW --project PROJECT_ID --file COMMON.json
node scripts/awSync.ts stage --workspace LAPTOP_AW --project PROJECT_ID --file LAPTOP.json
node scripts/awSync.ts stage --workspace LAPTOP_AW --project PROJECT_ID --file DESKTOP.json
node scripts/awSync.ts staged --workspace LAPTOP_AW --project PROJECT_ID
node scripts/awSync.ts compare --workspace LAPTOP_AW --project PROJECT_ID --local LAPTOP_HASH --remote DESKTOP_HASH --brief NEW-BRIEF.md
node scripts/awSync.ts plan --workspace LAPTOP_AW --project PROJECT_ID --plan RETURNED_PLAN_HASH --output NEW-PLAN.json
node scripts/awSync.ts prepare --workspace LAPTOP_AW --project PROJECT_ID --plan RETURNED_PLAN_HASH
```

Use the returned IDs and paths. A plan can be reopened without rewriting it;
the exact staged inputs are checked again. `compare --base HASH` handles an
explicit shared baseline when several exist. Dates never decide a merge.

The returned review folder contains `candidates/`, `review.json` and a completion
marker. Conflicting files are omitted from candidates; their exact variants and
proposed deletions are retained in `review.json`. A review folder may therefore
be **incomplete**. It is not a registered project, ready-to-run notebook or import
packet. Do not copy its JSON over live stores, run imported cells or compile it
as though it were a complete manuscript. Assistant reconciliation stays a proposal;
a protected whole-project migration remains outside this workflow. The separate
guarded collectors above/below replay checked staged inputs, not arbitrary files
from this review folder.
The marker certifies preparation
at the recorded local state, not that the live project will never change afterward.

In Aw, open **Workspace folders → Two computers → Inspect snapshots**. Inspect a
small packet, select local/other staged copies, then **Compare copies** and
**Prepare review copy**. This local panel contacts no other computer. Initial
capture still uses the offline tool; large packets use `stage` rather than the
browser's 7 MB picker limit. Newly built controls need a frontend reload and the
updated backend needs a safe service restart after drafts/runs settle; never
restart an occupied service just to inspect snapshots.

Saving a new comment, initializing review metadata on a fresh paper, or changing
the notebook can invalidate an older local snapshot even without a TeX edit.
The refusal lists changed saved-file paths, not their private contents. Capture
a fresh branch from your last local snapshot, stage it, then refresh the snapshot
list and compare again. This preserves the newly saved work rather than treating
an older candidate as authoritative.

Ordinary queue activity does not invalidate a detached copy. Only the workbench's
activity timestamp and revision counter are excluded from this preparation
fingerprint; comments, tasks, drafts, recovered work and locks remain checked.
Source and notebook revision changes still block it. A future live collector must
use current store revisions and retain current local housekeeping fields; this
exception is not permission to overwrite a live assistance store.

The preview never changes manuscripts, notebook stores, project selection or
review state. Conflicting files are absent from the automatic candidate list;
their exact variants remain in the conflict list/original snapshots. Source
files remain indivisible in the original preview. A separate `reconcile` step can
propose combinations of non-overlapping line edits without changing the saved plan.
Overlapping wording still needs a targeted proposal, not a whole-paper rewrite.
Assistance/review state and manuscript policy are also conservative whole-record
conflicts. One-sided changes are shown as candidates, **not human approval**.
Local catalogue revision counters are omitted from merged candidates: a future
collector must allocate actual local revisions through guarded stores.

## Collect a reviewed experiment notebook

Use this only when the human authorizes collecting the selected research copy.
An ordinary research question or detached proposal is not data-transfer authority.
Save browser drafts first, keep one coordinating notebook writer, and use an
updated service if it is running. Do not restart another owner's service/run.
The command requires no service, listener, renderer, model or Python execution.

```text
node scripts/awSync.ts collect --workspace AW_HOME --project ID --plan PLAN_HASH --path data/experiments/OWNER/notebook.ipynb
node scripts/awSync.ts collect --workspace AW_HOME --project ID --plan PLAN_HASH --path data/experiments/OWNER/notebook.ipynb --review RETURNED_COLLECTION_ID --commit
node scripts/awSync.ts collect-status --workspace AW_HOME --project ID --collection RETURNED_COLLECTION_ID
```

Preview reports the exact before/after revisions, changed cell IDs, added run
files and unrelated held conflicts; it writes nothing. Read the relevant complete
candidate/evidence before an authorized commit, not just a plot title or this
index. The review ID binds exact plan/target/candidate/local state and manuscript
selection. It is not evidence of human approval or mathematical verification.

Commit saves an immutable `before.json` selected-project checkpoint and journal
under `.paperfocus/device-sync/collections/PROJECT_ID/COLLECTION_ID/`, then
acquires the target notebook's Python-run lease. A busy run is never stopped,
queued or bypassed. Matching new run records are copied without replacement;
the existing revision-guarded experiment store assigns the actual saved revision.
Cell IDs, unknown metadata, full outputs and historical runtime paths survive.
The run records remain historical executions, not newly executed local results.
A completion receipt is written only after the copied evidence is confirmed.

The `--path` mode supports **one already-owned experiment notebook**. It does
not add/reassign conversations, import new owners, delete cells or run files,
change cell kinds, resurrect filed/trashed cells, edit manuscripts, update project
policy/locks/comments, or resolve/finish tasks. A conflicting notebook/code-output
unit, inconsistent run identity or unsettled run stays held. Unrelated conflicts
can remain while this independent notebook is collected. The result explicitly
does not mean the whole project was synchronized or a shared head acknowledged.

Journaled copies survive interruption. `collect-status` distinguishes a completed
copy from an unconfirmed partial copy, which may already have live notebook/run
writes. Repeat the identical review/plan/path to resume: exact copied runs are
reused, and an already-saved notebook is not saved twice. New notebook or unrelated
authored edits, damaged backups/receipts or changed root/compiler selection stop
the retry without overwriting. Inspect retained work; never force revisions or
replace JSON manually. A crash before the journal is published can leave an orphan
backup, and `.part`/`.aw-lock` recovery remains explicit. There is no automatic
rollback through later work. The checkpoint is not a full private-workspace backup.

Repeating a completed commit reports its original receipt and does not overwrite
later local research; its recorded revision is not necessarily the current one.
After a successful collection, capture/stage a fresh local descendant from the
previous local head and compare again before collecting another notebook. Do not
reset history or treat an old plan as valid after a live save. Editing existing
conversations, manuscript collection and peer acknowledgement remain next steps.

### Add selected new conversations

Use the same command with `--entries` instead of `--path`:

```text
node scripts/awSync.ts collect --workspace AW_HOME --project ID --plan PLAN_HASH --entries ENTRY_ID,ENTRY_ID
node scripts/awSync.ts collect --workspace AW_HOME --project ID --plan PLAN_HASH --entries ENTRY_ID,ENTRY_ID --review RETURNED_COLLECTION_ID --commit
node scripts/awSync.ts collect-status --workspace AW_HOME --project ID --collection RETURNED_COLLECTION_ID
```

Select 1–8 conversation IDs present on the sending branch but absent from both
the shared baseline and the receiving catalogue. Each must have a distinct new
experiment owner and an available local manuscript root. Existing/shared owners,
ID collisions, recovery drafts, owner folders containing excluded/hidden work,
linked paths and unsupported/conflicting evidence are held rather than adopted
or silently remapped. The preview lists exact titles, owner IDs, file hashes and
the receiving catalogue's next revision. Projected file/payload limits are checked
before copying. One history validation is reused for all selected notebooks.

Finished/failed answers can remain **unreviewed**: transfer preserves their status
and does not require a manual close. Active queued requests must finish or already
be set aside on the sending copy; transfer never closes or restarts them. Historical
task IDs/tickets retain ownership, and collisions with existing history are refused.
Unlinked legacy handoffs must be explicitly historical. Do not strip provenance
or change IDs to force an import. A version-copy notebook whose original run
records are under another owner needs that evidence's own collection workflow;
this first new-owner mode does not guess historical run locations.

Commit takes an immutable checkpoint and journal, claims the new owner folders,
holds their Python-run leases, and saves complete notebooks/runs through existing
guards. Only after confirming every selected owner does it append the conversations
to the receiving catalogue. Existing entries and unknown catalogue metadata are
preserved; the local counter advances once, never adopting the sending host's
counter. A content-hash guard catches even same-counter external edits. Original
source links may be stale if manuscript edits have not been collected; they are
kept, not guessed or reassigned. Source, comments, locks, publication approval and
existing queue items are not changed; new ready answers may remain in the review queue.

The catalogue is the final publication step, not an atomic filesystem transaction.
An interruption can leave complete but not-yet-listed owners; after catalogue
saving it can leave a listed bundle with an unconfirmed receipt. `collect-status`
and the identical review commit handle both, without another catalogue increment
or duplicate entries. Changed partial files, root selection or human notes stop
retries. An owner folder created before its claim marker is saved is an orphan
requiring explicit inspection, not automatic deletion/adoption. Preserve all
prepared files and finish/inspect a partial bundle before planning another transfer.
All owned leases are released where possible, even if another lease changed;
foreign/crashed locks are never stolen. Completed retries never replace later work.

Unrelated plan conflicts may stay held while these independent new branches are
added. This is neither a whole-project merge nor acknowledgement of an agreed
shared head. Stage a fresh local descendant and all missing ancestor packets before
the next comparison, including when transferring back in the other direction.

## Agent fast path for transfers

Many merges are routine. Independent conversations/cells already combine in the
preview, and separate edits within an ordinary text file can now combine in a
literal proposal. Start mechanically; use an assistant's judgment only for the
actual overlap. This is reconciliation, not an invitation to polish everything.

1. Confirm both Aw homes, the shared project ID and saved common history. Save
   browser drafts before capture; do not infer identity from the active tab or
   matching paper/device names. Read the current owning-root policy when notebook
   or manuscript work is involved. Device-local paths/credentials are not shared
   scientific provenance and must not be pasted into source.
2. Use `checkpoint` to capture **and stage** saved local work in one command.
   Its initial `--parent` is the exact staged local predecessor; later calls can
   use the remembered head automatically. Do not reset history on each transfer. Keep the
   returned snapshot file private. If staging fails, the error returns its saved
   packet path: retry `stage` with that packet, not another capture.
3. Move only explicitly authorized private packets through the chosen trusted
   channel using the incremental exchange or explicitly paired SSH tools above.
   Raw packets still need every missing parent staged. The first-copy command creates a new home only. Never
   copy a global registry or device identity over another installation.
4. Compare the exact heads, then use `changes` once. It reports changed paths,
   exact conflict IDs and ordinary-text eligibility without copying all content
   into the prompt. A hash index is not an assertion that evidence was read.
   Normal console output caps the index at 200 changed paths/100 conflicts and
   reports truncation. Filter by `--path` or save the complete index with `--output`.
5. If there are no conflicts, prepare the ordinary plan directly—no agent
   deliberation is needed. Otherwise `reconcile` first proposes clean, literal
   line combinations. Read only remaining overlaps using `conflict` or `file`.
   For a difficult sentence, propose the smallest substantive adjustment and
   explain it briefly; preserve unrelated paragraphs and scientific uncertainty.
6. Prepare the proposal by its returned ID. It replays the exact inputs and
   checks current local saved work. If stale, capture a fresh descendant and
   compare again; do not edit the old plan, force a revision or erase a draft.
   Leave one short handoff: what combines, what still needs attention, and the
   returned proposal/review paths. Do not launch Aw, compile, rerun experiments
   or start/restart a service merely to reconcile files.

```text
node scripts/awSync.ts checkpoint --workspace AW_HOME --project ID --parent LOCAL_PREDECESSOR_HASH
node scripts/awSync.ts compare --workspace AW_HOME --project ID --local RETURNED_HASH --remote REMOTE_HASH
node scripts/awSync.ts changes --workspace AW_HOME --project ID --plan PLAN_HASH
node scripts/awSync.ts conflict --workspace AW_HOME --project ID --plan PLAN_HASH --conflict CONFLICT_HASH
node scripts/awSync.ts file --workspace AW_HOME --project ID --plan PLAN_HASH --path source/main.tex --side local --output NEW-LOCAL.tex
node scripts/awSync.ts reconcile --workspace AW_HOME --project ID --plan PLAN_HASH
node scripts/awSync.ts prepare --workspace AW_HOME --project ID --plan PLAN_HASH --proposal RETURNED_PROPOSAL_HASH
```

For a fresh assistant, `changes --brief NEW.md` generates a short scoped handoff
with these commands and exact conflicts. An existing chat usually only needs the
plan ID, current question and a small changed excerpt; skip a redundant brief.
`conflict` returns the complete exact field/ordinary-text variants, never a
guessed nearby paragraph. Very large or binary whole-file variants are identified
instead of decoded; use `file --side base|local|remote --output NEW_FILE` for exact
bytes. Details larger than 24 KB require an explicit output file, not a silently
truncated console excerpt. Outputs are new files and never overwrite existing ones.

### Targeted decisions

For one source overlap, the quickest route is to export a new draft with `file`,
edit that **detached draft** using ordinary file tools, then pass it directly:

```text
node scripts/awSync.ts reconcile --workspace AW_HOME --project ID --plan PLAN_HASH --conflict CONFLICT_HASH --text-file NEW-CANDIDATE.tex --note "Combined the overlapping sentence"
```

The command reads the explicitly named draft with size/UTF-8 checks and stores
its exact content in the immutable recipe; it does not depend on that draft's
path later or treat its creation as permission to change the live source. This
avoids escaping/embedding a long manuscript in a JSON packet. Use `--file` instead
when proposing several related choices; the two forms cannot be mixed.

Optional `reconcile --file DECISIONS.json` accepts this format. Conflict IDs are
returned by `changes` and tied to exact path/field/reason/base/local/remote values.
Dates or conflict-list positions are not identities.

```json
{
  "version": 1,
  "projectId": "RETURNED_PROJECT_ID",
  "planId": "RETURNED_PLAN_HASH",
  "decisions": [
    {
      "conflictId": "RETURNED_CONFLICT_HASH",
      "choice": "text",
      "text": "Complete proposed text for this one ordinary file.\n",
      "note": "Combined the overlapping sentence; kept unrelated paragraphs unchanged."
    }
  ]
}
```

`choice` can also be `local` or `remote`, without `text`. That records an explicit
proposal to keep one side; the other remains in its original snapshot. It does
not assert that the chosen claim is correct. Do not choose a side just to make
the conflict count zero. Missing/duplicate/foreign IDs and approval-bearing fields
are rejected. A supplied sentence merge still uses a complete candidate file,
so untouched context can be checked and hashed; it is not a live-file replacement.

This first text path handles UTF-8 `.tex`, `.bib`, `.md` and `.txt` ordinary source
or research records. It preserves line endings, Unicode, BOM and trailing newline
bytes; it does not expand TeX, reinterpret notation, normalize spacing or invent
proofs. Conflicting insertions/boundaries stay conflicts. It tries at most 64 files
per proposal, with a 512 KB/file, 12,000-line and two-million alignment-cell budget
per branch; oversized/complex cases remain for focused inspection. Decision files
are capped at 4 MB and 200 entries. No local or cloud model is invoked automatically.

Review/policy records, code/output units, immutable runs, binary assets, deletion
versus edit and structured notebook conflicts remain outside this plain-text
decision path. They are retained for their specific protected workflow, not
silently discarded. Known locked-wording files cannot be targets; uncertain lock
locations hold source proposals rather than guessing. Publication changes retain
their incremental human-review rules. Transfer proposals cannot grant approval,
unlock wording, resolve comments, finish saved tasks or execute notebook cells.

Recipes are immutable under `reconciliations/PROJECT_ID/HASH.json`; detached
candidates and remaining conflicts are under `reconciled/PROJECT_ID/HASH/`.
Original snapshots and plans survive revisions/retries. `remaining: 0` means a
complete **proposal**, not an applied sync, trusted experiment, reviewed manuscript
or permission to copy it over a live store. The separate guarded `merge` collector
above uses current revision/ownership guards, backups and policy; protected state
remains held even if a detached proposal shows a one-sided candidate.

For a repeatable developer check, `node scripts/syncAgentTrial.mjs` creates a new
pair of isolated synthetic data homes and exercises the actual offline CLI:
checkpoint, first-copy preview/commit, independent edits, stage, compare, index,
exact conflict read, reconciliation and preparation. It
asserts that both source changes and notebook notes appear in the candidate, then
previews/commits an existing experiment notebook and checks its receipt/backup.
It then sends a new laptop conversation back to the isolated desktop copy, collects
its new owner, and reads it through the offline harness. Existing conversations and
both manuscripts remain unchanged; only the selected new conversation is appended.
It retains the returned private
trial folder for inspection. This is not a real desktop/SSH/disconnection test and
does not execute experiments, open Aw, change the main workspace selection or
touch an existing project.

Independent insertions use deterministic ID-based ordering where both branches
added records; competing reorders require review. Missing baseline files become
explicit deletion history. A previously deleted path cannot quietly reappear.
The prototype retains ancestry up to 256 ancestors and fails rather than silently
dropping history; safe history compaction is a future step.

Private staging lives under `.paperfocus/device-sync/`: `staged/` has compact
manifests, `blobs/` has content-addressed bytes, `receipts/` marks completed stages,
`plans/` retains input identities and summaries, and `prepared/` holds detached
reviews. `collections/` retains notebook collection journals/checkpoints/receipts.
`merges/` retains research-batch journals and resulting heads; `exchange/` retains
working/common/received heads and peer inventories. `peers/` contains explicit SSH
path/identity configuration, not credentials. `paired/` and `paired-remote/` retain
two-copy plans, started markers and recovery/completion receipts.
`clone.json`/`clone-ready.json` guard initial home creation. The tool
replays blobs only after verifying hashes/size; comparison
checks the manifest graph and hydrates the exact baseline and branch contents.
Older unused history blobs are not reread on every graph traversal. Receipts are
completion records, not sender authentication or proof verification.

Immutable artifacts are published without replacement under local cross-process
locks. A crash can leave a `.part` or `.aw-lock`; preserve it and inspect before
manual recovery. This was tested on local Windows/NTFS storage, not an active
network share. No automatic pruning is implemented, so private staging can grow.

## Capture and privacy boundaries

Save browser drafts first. Capture reads source and research twice and rejects
observable changes; it never stops writers/runs or steals their locks. This is
a stable-read check, not a global transaction or filesystem backup. If capture
fails while work is progressing, retry at a quieter checkpoint. Existing saved
run files are captured; in-flight jobs, process variables and browser-only drafts
are not transferred or replayed.

Limits: 5,000 files, 24 MB per file, 96 MB decoded payload, 140 MB input packet.
Source collection also retains the source ZIP's stricter 20 MB file limit.
Linked paths, checksum mismatches, case-only filename ambiguity and newer sync
formats fail safely. Known record formats are checked before structured merging.
No model is called and no proof is verified.

Packets contain **private project material**, including authored notes/code and
historical runtime paths in provenance or handoffs. Do not send them as the clean
friends' app ZIP. SHA-256 checks detect damage, not sender authenticity; private-file
transfer needs a trusted channel, and SSH uses separately established host/login
trust plus explicit project/device pairing. Credentials must not be kept in ordinary
project/research files. Only transfer trusted material; importing never runs it.

Build caches, Git history, previous-store copies, source-draft recovery, external
backups, old paper-local metadata, dependencies/models and browser state are not
captured. Older paper-local Aw storage stops capture rather than being silently
ignored or migrated. Snapshots are **not complete private backups**. Follow
[REMOTE_RESEARCH.md](REMOTE_RESEARCH.md) for migration/backup preservation.

## Next stages

1. Extend first-copy creation to guarded registration of additional projects in
   existing homes. Keep current stores, identity and source structure intact.
2. Extend bounded literal text proposals to finer notebook/text conflicts and a
   compact human review view. Preserve publication locks and unresolved concerns.
3. Add dedicated reviewed deletion/restoration and protected-policy/decision transfer
   workflows, without treating source import as publication approval.
4. Add safe history compaction and optional background exchange notifications;
   keep collection deliberate and neither machine a permanent authority for notes.
5. Exercise disconnection, interrupted collection, retries, removals/restoration,
   schema upgrades and concurrent editing on the actual second computer.

Aw code updates remain separate from project data synchronization. An SSH compute
worker or automatic app updater is not enabled by this reconciliation protocol.
