# Two-computer workflow

## Slow VPN and travel connections

SSH handshakes allow up to 30 seconds (bounded by the overall exchange budget),
and the campus/VPN gateway probe allows five seconds. Earlier eight-second SSH
and 1.2-second probe limits caused all projects to report unavailable on a working
in-flight VPN connection. Eligibility still requires campus Wi-Fi or the VPN;
these limits do not open an alternate route or bypass authentication.
Reading sync now honors the project's configured `timeoutSeconds` (10–120),
as full-history sync already did. Previously it silently used 30 seconds.
The native scheduling, network backoff, byte/revision and conflict guards remain.
Long-lived followers need a guarded refresh to load a changed transport module;
new scheduled checks use it immediately. Do not reset project history or restart
desktop research to repair a slow laptop link.

## Scheduling recovery after laptop restart

The automatic scheduler's global slots (`auto/coordinator`,
`auto/reading-coordinator`) and per-project `auto/ID/cycle` have a native
process-lifetime lease: a private named mutex on Windows and `flock` on Linux.
This is distinct from manuscript/notebook/store locks. A crashed owner releases
the kernel lease. Under that exclusive lease only, a well-formed scheduling
marker with a confirmed missing process can be archived byte-for-byte before
trying the scheduling slot again. On Windows, a reused PID can also be recovered
when a bounded OS start-time query proves the current process started more than
one second after the marker was written. This check runs only under the exclusive
kernel scheduling lease. Live original owners, unknown/access-denied start times,
invalid markers and changed bytes remain held. Earlier blanket manual-recovery
instructions still apply to every other record/data lock; they are superseded
only for these exact scheduling paths. Recovery does not resume a partial merge,
choose a source version, acknowledge history, close a comment or bypass the
existing pending-operation, per-record and byte/revision checks.

This addresses an observed laptop reboot that left an overnight fast coordinator
marker and two per-project scheduling markers behind. Merely restarting a follower
could not clear them; all fast projects waited indefinitely on the shared marker.
The recovered original markers remain in the private auto folder. Status now also
reports the fast reading coordinator. Busy live followers wait two seconds rather
than probing the scheduling locks twice per second. No editor/research restart
or public listener is part of normal scheduling recovery.

The reading-text path preserves form-feed whitespace exactly, rather than
silently classifying the entire TeX file as busy. Invalid UTF-8, NUL and other
unsupported control bytes still fail validation. This changes no manuscript
bytes. Two-machine installs need the same validator acceptance on both ends;
apply a scoped checked code patch, not a copy of research/state or a forced merge.
## Windows SSH lifetime

Fast figure inventories are selected-document dependency subsets, not complete
directory listings. A previously synchronized figure absent from one fast subset
is deferred to the ordinary reading pass, never classified as a deletion or
binary conflict merely because the two devices have different documents open.
Full reading inventories and genuine two-sided figure changes retain their
existing conflict guards. No source, baseline or review decision is overwritten
to clear this notice.

Aw's reading, full-history and bulk SSH transports contain each connection in a
private Windows Job Object. The installed `scripts/OwnedProcessHost.cs` is compiled
once per worker using Windows' bundled .NET compiler, without downloading a runtime
or requiring administrator rights. It assigns SSH before allowing it to run.
Normal exit, timeout, cancellation and loss of the owning Aw worker close the
whole local connection tree, including ProxyJump helpers. Other SSH/Codex
connections and remote research jobs are outside that job. If containment cannot
start, sync waits with an error; it does not silently launch an uncontained SSH.
The university route gate, pinned identity, save/merge guards and reconnect backoff
remain in force. This is a connection-lifetime boundary, not a research sandbox.
Live loops read only their bounded configuration between cycles. A reading
inventory shares one policy observation across its files instead of repeatedly
loading the same workbench; packet fetches and imports still check current policy
and exact bytes. The file-event path and five-second fallback remain unchanged.
The pooled followers queue fast passes in memory before acquiring cross-process
leases; idle projects do not repeatedly race for the same filesystem lock.

Typing remains local. A source save waits for a pause; sync follows saved files,
not individual key events. Browser recovery is immediate and self-contained,
packing immutable state fields separately so an edit does not recompress unchanged
notebook/comment history. Readers retain support for earlier raw and LZW copies.

## Bring a desktop idea to the laptop when it is ready to read

Do not pair every scratch idea or research phase. Keep exploration on the desktop
until the user asks to read/audit a substantial note. Then prepare one frozen,
complete inline reading baseline with no missing parents or pending requests and
a `link-plan.json` describing its SHA-256, byte count, snapshot/project/device IDs,
desktop home, installed tool, selected root, expected cells and pins. Use the
existing desktop handoff format; explicitly set `rawArraysIncluded: false`.
Keep raw arrays and historical execution archives out of that reading packet.
Preparing a packet does not upload it or enable laptop sync.

The laptop agent fetches only those two files through the already approved SSH
alias and campus/VPN gate, then batches setup with:

```text
node scripts/awLinkReading.mjs --workspace CONTROL_HOME --packet BASELINE.json --link-plan LINK-PLAN.json --destination NEW_HOME --host APPROVED_ALIAS
```

Inspect its identities/coverage, then repeat with `--review HASH --commit`. This
uses the existing guarded clone, peer, network gate, desktop-first policy, both
installed journals, reading/comment coordinator, windowless Windows worker and
project desktop shortcut.
No human walkthrough of each subcommand is needed. The control home is the
existing laptop Aw installation with its installed journal configuration; the
destination is a NEW independent child data home under that control workspace.
The completed copy is automatically listed in Aw's usual folder/project chooser;
opening that entry starts/reuses its separate local reading view. It never imports over an occupied
home, substitutes device IDs, runs notebook code or claims full-history agreement.
Interrupted steps retain their receipts; inspect and retry the same inputs,
never clear files/locks to force a retry. A deliberately paused or changed peer
stays paused rather than being silently re-enabled. The first setup still needs
the desktop reachable and the one-time journal installations present.

Use `node scripts/readingWorkspaceLauncher.mjs --workspace NEW_HOME` to open the
reading copy. It starts/reuses its separate loopback view without replacing the
main Aw service. Windows setup installs a windowless one-click shortcut;
`scripts/installReadingShortcut.ps1 -WorkspacePath NEW_HOME -Name NAME` can also
install one explicitly. Retain that home for
later versions: routine saved source, comments/replies, existing notebooks and
figures flow through reading sync; do not make another first copy for each audit.
New notebook owners, policy/version decisions and new archive evidence still
need their existing guarded collection workflow.

Reading views use the same project chooser as the main app: a completed clone
finds the ancestor catalogue that explicitly registers its exact home and project.
It can then open sibling reading copies and ordinary projects from that chooser.
No project records, comments or active manuscript selection are copied to build
the menu. Standalone/unregistered homes do not inherit a catalogue merely because
they are nearby. Listing never starts a service; an explicit project click starts
or reuses the matching local view after the current draft-navigation guard.

Status: **offline-first research reconciliation, private incremental exchanges
and optional reviewed SSH synchronization**, October 2026. Each machine keeps its
own data home and works without a connection. Ordinary research-source, conversation
and experiment changes can collect through guarded, recoverable batches. Publication
wording, locks, review/policy/task decisions, deletions and ambiguous code/output
changes retain their own workflows. This is not a distributed database, remote
Python worker or backup restore. As of 21 October, first-copy import and a bounded
SSH exchange have also been exercised on a real Linux desktop. The opt-in CLI
coordinator below adds saved-work automatic synchronization; the app's ordinary
Two computers button remains an explicitly reviewed operation.

## What works now

Recovery note: a completed newer same-peer join may explicitly supersede an old
interrupted pair using `supersedePairedSync`. The replacement receipt must be
verified complete and its checked ancestry must contain both old branches. The
original plan, journals and incomplete status remain intact; this is not a forged
completion, deleted lock, rollback or automatic conflict decision. Only then may
the automatic reading coordinator stop treating that old pair as pending.

Full-capture performance: compiled-PDF retention skips historical-manifest
enumeration when no compiled PDF exists. Merge fencing no longer repeats a full
capture for an absent hook or an empty owner-lease step; real hook/lease changes,
native write guards and final verification retain their checks. Full history
reconciliation is still a deeper operation than reading sync. The persistent
local change journal below avoids repeated discovery scans while its checked
index and continuous watcher are healthy. Final acceptance still verifies live
files, rather than trusting a cache as merge authority. Routine TeX/comments use
the separate live reading lane.

Saved comments now have a guarded comment-only merge inside the existing pair:
new threads/replies, independent body edits and explicit updated-UI human
Resolve/Reopen markers can collect. No status is inferred from source changes or
assistant replies. Competing edits, identity/anchor changes, deletions, legacy
unmarked resolutions, other review/request records and wording approvals remain
held. New saved comments can prompt the next connected scheduled check, without
waiting for the longer source interval. See [REMOTE_REVIEW.md](REMOTE_REVIEW.md).

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

## Paired working copies, including large evidence

### Local-light storage and network gating

For a configured desktop pair, `awStore.ts` keeps bulk data there while preserving
the laptop's complete readable/editable notes. `offload` previews only eligible
archives, arrays and model checkpoints regardless of individual size, plus raw
research `*.results.json` files of at least 1 MB. Thousands of small arrays/weights
are still bulk evidence, not required reading. It never
offloads TeX/BibTeX, Markdown explanations, notebooks, run records, figures/PDFs,
reviews or policy. Current enrollment requires a streaming-sync project. A preview
does not remove files; exact-plan commit verifies their immutable desktop copies
through the pinned SSH identity, checks current local bytes, then saves local-only
availability references before evicting anything. Shared/legacy inline cache
dependencies are retained. New eligible desktop evidence can stay remote during
a guarded sync instead of being downloaded automatically. Notebook IDs, source
bytes and agreement semantics do not depend on physical residency.

The automatic desktop-first policy uses file roles: `.npy`, `.npz`, `.pt`, `.pth`,
`.ckpt`, `.pkl`, `.parquet`, `.h5`, `.hdf5`, `.zip`, `.tar` and `.gz` stay backed by
verified desktop copies. Text, source, comments, notebooks, compact JSON summaries,
CSV tables, code/protocols and figures remain eligible for local transfer. Transfer
does not execute a protocol or accept a protected merge. Unknown formats remain
local rather than being silently hidden. Explicit Fetch/local pins take priority;
the policy does not evict existing files automatically or replace conflicting local
edits. Desktop verification uses bounded batches with exact path/hash/size checks,
not a raised transfer cap. Both paired tool installations need this policy update.

```text
node scripts/awStore.ts status --workspace LAPTOP_HOME --project ID
node scripts/awStore.ts enroll --workspace HOME --project ID
node scripts/awStore.ts offload --workspace LAPTOP_HOME --project ID --peer PEER_HASH
node scripts/awStore.ts offload --workspace LAPTOP_HOME --project ID --plan RETURNED_HASH --commit
node scripts/awStore.ts fetch --workspace LAPTOP_HOME --project ID --path data/research/EXACT_FILE.npz
node scripts/awStore.ts network --workspace LAPTOP_HOME --check
```

For an existing paired project, `enroll` on each confirmed home enables streaming
checkpoints without recopying the project, resetting ancestry or rewriting source.
Install compatible tools on both hosts and pin their exact paths deliberately.
The next guarded sync handles the representation change; it grants no new wording,
review, execution or conflict-resolution authority. Existing inline history bytes
remain until a dedicated safe archival workflow can remove their local dependency.

Fetch restores verified bytes to their original path and keeps them local. A
different existing file is never replaced. **Workspace folders → Two computers →
Files on desktop** lists these files, has a search/Fetch action, and copies the
remote project folder for starting a remote chat. Reading the list does not connect.
Cold references are not local backups: retain the desktop's immutable store and
normal backups. A full new clone/exact export needs actual bytes; fetch missing
artifacts first instead of pretending a thin copy contains them. Do not copy cold
metadata by hand, reset history or delete cache folders to free disk space.

An interrupted eviction can retain a quarantine file and its exact source-path
record under `cold/quarantine/`. `awStore status` reports these recovery files.
Inspect before retrying; do not discard them, roll back through later edits or
claim the entire offload completed. A failed proof or changed source is preserved.

`awStore network --file POLICY.json` saves an explicit local-only gate. Its schema
is `{version:1,profiles:["APPROVED_WIFI"],vpnDescriptions:["APPROVED_ADAPTER"],host:
"DESKTOP_HOST",port:22}`. It uses active interfaces with assigned IPv4 addresses,
approved connection/adapter names and a bounded TCP check of the chosen SSH entry
point (the gateway for a jump-host connection, not a blocked direct desktop port).
This does not certify SSH authentication or the downstream desktop's health. Unsupported
or unreadable OS status waits safely; status checks do not enable networking. The
Windows observation is briefly cached and invalidated on interface changes so
fifteen project workers do not each launch repeated network queries. No retries,
SSH, project hashing or failure/backoff counter changes happen off-network. Ordinary
manual sync/fetch also respects the gate. This is a resource/access preference,
not a replacement for trusted SSH keys or university access policy.

`awPair.ts` is the short setup path for an existing registered project. It creates
a complete independent desktop Aw home: source, selected manuscript, purpose,
overview links, notebook conversations, experiments and saved evidence. It keeps
the laptop copy. For a new project, use `new --name NAME` instead of `prepare
--project ID`; it creates ordinary research notes before preparing the pair.

```text
node scripts/awPair.ts prepare --workspace LAPTOP_HOME --project ID --host SSH_ALIAS --remote-code /INSTALLED/AW_CODE --remote-parent /RESEARCH/PROJECTS --auto yes
node scripts/awPair.ts commit --workspace LAPTOP_HOME --project ID --plan RETURNED_HASH --saved-drafts yes
node scripts/awPair.ts status --workspace LAPTOP_HOME --project ID --plan RETURNED_HASH
```

Install the current app code/Node separately on the selected trusted host first.
Preparation stages local saved work and checks that host; it does not replace a
desktop folder. Commit binds the exact project, packet, paths and automatic-sync
choice. Save browser drafts first. Pending requests, missing history, changed
copies, linked paths and occupied destinations stop it rather than being forced.
Repeat the same interrupted plan: complete content hashes are reused; partial
files/journals remain for inspection. A crashed lock needs explicit recovery.
It never executes experiments, resumes chats or installs dependencies. `--auto yes`
enables the existing guarded saved-work coordinator and its windowless Windows task;
on other coordinating systems, use the documented watch command/scheduler.

The receipt returns the exact desktop workspace, laptop viewing query and optional
desktop launcher command. Continue viewing/editing the same project in the laptop
Aw app, offline if needed; saved desktop results appear there after synchronization.
The desktop needs no editor server for agent/notebook work. The browser's **Two
computers → Set up a desktop copy → Copy setup instructions** gives a folder-aware
assistant the correct scope and tool. It does not launch an agent or connect by itself.

Version 2 stores bulk files as SHA-256 references, not base64 inside snapshots.
Files stream over verified SSH with 256 KB buffers; no whole-project ZIP, public
listener or paid service is involved. The first copy has an explicit 128 GB budget;
later automatic exchanges allow at most 1 GB of missing bulk content per direction.
Limits are 50,000 files, 8 GB/file and 128 GB/project, with the old bounded inline
budgets retained for catalogue/review/policy stores and editable text. Unchanged
notebooks are references with verified schema/canonical hashes; only changed ones
are loaded for cell-level merging. A valid legacy pretty-printed notebook may be
read up to 24 MB without rewriting it; new saves use compact JSON when necessary
to remain within the existing logical notebook and 5 MB saved-file budgets.
Oversized logical notebooks or
ambiguous/protected changes still require their own workflow, not a higher RAM limit.

Only missing content hashes cross the network. An edited binary transfers as a file,
not a binary delta; completed files are reused after interruption, but an incomplete
file restarts. A saved fingerprint cache avoids repeatedly reading unchanged bulk
files; inode/size/mtime/ctime changes invalidate it. Incoming bytes and live file
replacements are hash-checked; changed destinations preserve both variants. Source
and notebook saves retain revision/wording/ownership/provenance guards. Run history
is immutable, and notebook collection loads only changed run evidence, not its entire
archive. No synchronization executes or extracts ZIPs, NumPy arrays or notebook code.

Keep one coordinating worker per project. Automatic workers also share one
laptop-wide slot, so several projects cannot start heavy checks together. A busy
worker defers; it never stops another project or steals its lock. Windowless Windows
tasks start while signed in, connected and on AC power; a started guarded operation
can finish if power is unplugged. Routine checks scan metadata; they do not
re-upload evidence. Research source edits, schema-safe notebook edits and safe data
assets can collect when both proposals agree. Deletes, competing edits, executable
code/configuration, publication words, reviews, policies and task decisions stay held.
Read-only cached blobs are internal evidence, not user-editable source files or a
backup. Do not delete caches/ancestors to silence a warning. Full detached review
copies and standalone `.aw-sync` downloads do not bundle external blobs; use the SSH
pair or exact `file --output NEW_FILE` for those bytes. Legacy version-1 projects
keep their existing protocol until explicitly enrolled on both copies.

### Legacy commands

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

Ordinary UTF-8 `.tex`, `.bib`, `.md`, `.txt`, and supported figure files may transfer.
One-sided research protocols, summaries and logs under `data/research/` transfer as
exact inert text; they are never executed, loaded as Aw state or treated as requests.
Competing code/configuration edits, paper-repository code and protected Aw records
stay held. Separate literal prose line edits combine mechanically.
Generated research PDF extracts/logs retain their exact UTF-8 control glyphs;
this exception does not relax manuscript-source or binary/NUL checks. Private
helper requests/caches may be retained as opaque desktop-backed archives only
after exact path/hash and catalogue ownership checks. They never become incoming
model requests, accepted answers, completed tasks or executable notebook cells.
Existing conversation title/question/notes/reply/proposal, compact context and filing/
pin/order fields can merge; ownership, anchors, pending/completed requests, integrated
status, applied-change history and unknown metadata are not silently replaced.
Display chronology takes a deterministic timestamp, never a winner for content.
Independent new entries use the checked plan's deterministic order; competing
reorders remain held. Existing cell deletion/type changes and filed/trash resurrection,
ambiguous outputs and unmatched run provenance stay held. New cards/evidence are units.

Ordinary batches cap at 300 changed files/48 MB inline data, eight new conversations, sixteen changed
owners, with the original notebook/run and snapshot limits still enforced. The
original project is captured once for the journal; individual writes use exact-byte
fences/native stores, and full state is checked before/after the batch and before
publishing cards. It does not recapture the whole project for every file. Interrupted
files accept only that journal's exact before/after bytes. No removals, task completion,
comment resolution, purpose changes, code execution or wording approval occur.
All publication-source changes are conservatively held, even one-sided changes;
use their writing workflow. Known or uncertain wording locks also hold source.

A desktop-first bulk batch distinguishes verified nonresident references from files
actually copied: at most 20,000 changes, 5,000 resident files, 256 MiB resident data
and the same 48 MiB inline cap. Reference ownership is checked per path/hash; short
destination leases and one guarded index save avoid thousands of index rewrites.
Metadata journals/receipts remain bounded to 8 MiB. This does not raise the 1 GiB
SSH transfer budget, import unverified references or join a partly held history.
Small verified proof batches retain valid progress after a disconnect; bad or
unverified batches do not become availability claims. Local pins always win.
Review collection derives its native save counter from the immutable local
before-image. Earlier counter-only UI housekeeping cannot block a comment
transfer; exact byte fences still reject newer authored work. Partial retries
expect the same native result and never increment the counter a second time.
Checked source PDF assets remain in sync even when one host selects that PDF's
TeX file as its main document. This uses ready, project-owned history and hashes
the actual current bytes; it does not treat history as proof of file content.
Ordinary source ZIP downloads still omit the selected document's compiled PDF.

Aw reads compact saved sync status without SSH while the editor is visible. A
dismissible **Sync needs attention** notice opens **Workspace folders → Two
computers** for holds, interrupted operations, abandoned locks or structural failures.
Ordinary offline waiting is quiet. Dismissal does not resolve a conflict; the folder
button keeps a small marker, and **Copy sync help** supplies a scoped assistant brief.

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
The first-copy/SSH path has also been exercised on a real Linux desktop. Local
doubles cover two-sided guarded saves, conflicts and interrupted collection.

### Opt-in automatic saved-work sync

#### Follow reading files while experiments run

For an already enabled, verified safe pair, `awSyncWatch.ts follow --workspace HOME
--project ID` chooses independent reading records. Then `awSyncWatch.ts live
--workspace HOME --project ID` keeps one private SSH stdio connection open.
Saved TeX/BibTeX/Markdown/text and comments follow file notifications after a
300 ms debounce, with a five-second poll for missed/NFS notifications. The aim
is seconds after a saved edit, not a scheduled multi-minute batch. Network and
filesystem latency still apply; unsaved browser drafts do not transfer.
It follows TeX/BibTeX/Markdown/text and figure/PDF files in the paper checkout,
saved comments, and existing notebooks whose conversation ownership agrees on
both devices. It does not scan the research archive or require unrelated reports
to stop changing. A moving or leased record waits for a later pass; settled
records keep making progress. A pass copies at most 32 records / 32 MiB, with a
16 MiB packet cap. Only changed records cross the connection.

This is a **reading scope**, not full-project agreement. Its per-record baselines,
before-images and receipts stay in private `device-sync/reading/` storage. The
ordinary snapshot/exchange ledger is not reset or falsely acknowledged. Raw
experiments, unregistered research-folder files, new conversation catalogues and
version/policy changes retain the full guarded workflow. Existing notebooks bring
their exact settled run evidence, never Python execution. New notebook ownership,
cell removal/type changes, competing source/notebook edits, protected wording and deletions stay
held. One-sided saves use native store/file revision fences; an atomic remote save
whose acknowledgement is lost can be recognized by matching saved content on the
next pass, without replaying a two-copy merge or restarting a job.

Comment records are the exception to whole-record conflict holds: independent
threads and replies added on both machines combine automatically in the fast lane.
If both copies contain different text for the same comment, preserve both with a
deterministic copy ID and an `(other version)` title, rather than ask which one
wins. Retries do not keep multiplying copies. Original quotes/source snapshots,
explicit human decisions and before-images remain; syncing never infers closure.
Each device keeps its own queue ordering, and non-comment requests/wording locks
are not replaced. Both stores save with native revision/byte guards; after an
interrupted one-side save the next pass combines the remaining work, not rollback.
Malformed/foreign anchors, unknown executable fields and storage limits still
stop a write. This is inert comment preservation, not a manuscript text merge.

Ordinary research-source files now use bounded literal three-way comparison in
the fast lane: independent edits within one file can combine automatically. The
coordinator keeps checked common text privately, seeded at most 16 files / 1 MiB
per pass (individual merge cap 512 KiB / 12,000 lines / two million diff cells).
Publication/locked text, deletions and unknown bases are not silently merged.
Overlapping edits retain both originals and offer **Compare revisions** in the
sync notice. A human whole-file choice queues for sync only while both captured
versions still match; changing either copy requires a fresh comparison. A real
overlap currently holds that file, not unrelated files/comments. No model runs,
comment resolution or source conflict markers are involved. See REMOTE_REVIEW.md
for the human loop and the read-only `awSync.ts source-reviews` agent command.

The campus/VPN gate and below-normal CPU priority still apply. Keep one
coordinating laptop; do not copy its per-peer baseline onto another coordinator.
There is one fast text/comment slot alongside the single bulk slot: an unrelated
archive scan must not make a comment wait minutes. Per-project cycles and native
file/store locks remain exclusive; conflicts are never overridden for speed.
Existing notebooks and figures use a bounded slower pass every three minutes,
not every keystroke. New notebook/catalogue ownership retains the full workflow.
Reinstalling the existing Windows task after `follow` selects this resident
windowless worker. The repeating task trigger is crash recovery, not its transfer
interval; IgnoreNew prevents duplicate task instances. This bounded reader may
run on battery, never wakes the laptop, and checks the configured campus/VPN gate
before contact or scans. It closes the channel while offline and reconnects with
bounded backoff; a changed network interface prompts a new route check. Source
directory watches are shallow and limited to reading-file directories, never the
whole experiment tree. No public listener, model call or SSH trust change is used.
A dropped route stops further SSH calls in that pass.
`status` reports `scope: reading` and
lists records still changing or needing review. This mode needs the reading
protocol on both installations; unsupported peers do not receive a fallback
unguarded copy. Full two-copy interrupted operations still require inspection.
Fast and slower status records are separate so a successful TeX check cannot
erase a slower notebook conflict notice. Run only one live worker for a project.
The visible app checks comments every two seconds with conditional reads;
notebook histories remain on the slower twelve-second UI cadence. Source display
already checks changed files every three seconds and preserves overlapping drafts.
An open browser needs the updated assets (save drafts, then reload); changing
sync's CLI does not itself replace JavaScript already loaded in a browser tab.

Pilot measurement, 24 October: a synthetic project over the configured desktop
SSH route transferred three saved TeX edits in 146–162 ms and a saved comment in
153 ms on the warm connection. A remote save produced an event and copied back
in 1.02 seconds including the separate diagnostic SSH startup. These are observed
trials, not a latency guarantee or evidence of whole-project synchronization.
The first live example project reader reported four fast records aligned and eight reading
records aligned, without pausing its research. Other projects retain their saved
sync mode until deliberately upgraded. The multi-project installer
`scripts/installSyncPool.ps1 -WorkspacePath HOME -ExistingLiveProject PROJECT_ID`
shares the other enabled reading pairs in one below-normal-priority Node process.
Startup connections are staggered; fast passes share one slot. Existing scheduled
workers handle slower notebook/figure passes. Network observations are coalesced
so reconnecting does not launch discovery separately for each project. Interrupted
pairs stay held for explicit inspection, not silently bypassed by this pool.

##### Local change journal on each computer

`node scripts/awSyncJournal.ts start --config ABSOLUTE_CONFIG.json` watches saved
files locally, including while the VPN is disconnected or Aw is closed. The
configuration is `{ "version": 1, "projects": [{ "workspace": "ABSOLUTE_HOME",
"projectId": "EXACT_ID" }] }` (at most 32 scopes). Use the laptop installer
`scripts/installSyncJournal.ps1 -WorkspacePath CODE -ConfigPath CONFIG` for a
hidden, below-normal-priority, single-instance task. The desktop uses a user
service with restart backoff. Neither starts research, opens SSH, downloads
anything, wakes the laptop, or hashes all projects at startup.

Each computer has its own private `.paperfocus/device-sync/change-journal/ID/`
index and filesystem-event segments. A requested bulk snapshot establishes one
baseline; subsequent discovery reads changed/new paths and the small protected
catalogues. A private local barrier drains pending events before a capture.
Watcher restart, stale/erroring owner, event gaps, damaged index, structural
directory changes or changed ownership/binding cause a recovery inventory.
An audit is due after an hour, only when another full snapshot is requested;
there is no timer scanning every project. Strong write/acceptance fences bypass
the index deliberately. This is not a guarantee that every full-sync phase reads
only changed files, nor permission to resolve conflicts automatically.

`changeJournalStatus` reports watcher health and the last capture's mode, reason,
checked-path count and time. Active event segments rotate; older segments are
archived locally rather than deleted, and previous epochs/history are retained.
The index is a disposable discovery aid, not a backup or sync acknowledgement.
`node scripts/awSyncJournal.ts stop --config CONFIG` flushes and stops only this
watcher; the next requested snapshot safely falls back to full discovery.

For every **new paired project**, after the initial clone and pinned peer exist,
activate enrollment from the laptop (the configured daemons are already installed):

```text
node scripts/awSyncJournalSetup.ts pair --workspace LAPTOP_HOME --project ID --peer PEER_HASH
node scripts/awSyncJournalSetup.ts pair --workspace LAPTOP_HOME --project ID --peer PEER_HASH --commit REVIEW_HASH
```

The first command previews both exact devices/configurations. The second enrolls
both through guarded configuration saves; existing watchers adopt it within five
seconds without restarts. This is idempotent: no duplicate watcher per project.
If interrupted, preview again and commit the fresh review; a completed enrollment
on one side is harmless and preserved. Campus/VPN gating still applies to setup.
It does not clone a project, enable transfers, resolve conflicts or start jobs.
Enable the ordinary reading coordinator separately as part of the authorized
pairing workflow. Do not create another daemon or invent desktop paths per project.
On a fresh machine install its daemon once first; missing installations fail with
an explicit instruction instead of claiming activation.

#### Whole-project reconciliation

With explicit host/data-transfer permission and a verified pinned peer, one
coordinating computer can run `scripts/awSyncWatch.ts`. No Aw service or browser
is needed. This does not start or supervise desktop Codex or experiments.

```text
node scripts/awSyncWatch.ts enable --workspace LAPTOP_HOME --project ID --peer PEER_HASH --mode safe --saved-drafts yes --interval-seconds 180
node scripts/awSyncWatch.ts once --workspace LAPTOP_HOME --project ID
node scripts/awSyncWatch.ts status --workspace LAPTOP_HOME --project ID
node scripts/awSyncWatch.ts disable --workspace LAPTOP_HOME --project ID
```

`safe` previews both saved copies and commits the exact prepared pair only when
both complete proposals agree. `stage` only exchanges/prepares work. Neither mode
uses AI to resolve conflicts, picks the latest file, imports protected decisions,
executes transferred code or resumes an interrupted collection. A held conflict
keeps both versions; inspect the normal merge tools. Interrupted collections need
explicit status/recovery, not background retries. Offline checks back off to at
most one attempt per 30 minutes; successful checks return to the configured pace.
Scheduled invocations still check the shared cached campus/VPN route during that
backoff, without scanning project files or starting SSH while off-network. After
an observed disconnection, the next connected invocation can make one early
catch-up attempt. At least two minutes must separate attempts, so a flapping VPN
cannot create a scan/transfer loop. The pending reconnect survives process exits
and the cooldown. Conflicts and interrupted collections are never auto-resolved
or resumed. This is scheduled polling (normally up to three minutes), not a
permanent socket or a guarantee to notice an outage shorter than the polling gap.
For an explicit manual verification, `once --check-now yes` bypasses only the
interval/backoff; all network, ownership and merge protections still apply.
If ordinary saved files change during a preview, that stale plan remains unused
and a fresh check is scheduled after two minutes rather than escalating network
failure backoff. Repeated edits can still prevent a complete collection; sync
does not freeze an agent's files or force a stale snapshot onto either copy.
For file-heavy projects on slower remote storage, `enable --timeout-seconds 120`
allows up to two minutes per SSH message (default 30 seconds, range 10–120).
This changes only the bounded transport wait, not transfer size, merge guards,
experiment time limits or retry policy. Older settings retain the 30-second default.

Save drafts on both copies before enabling. Only saved disk work is synchronized;
it cannot flush another browser's draft. Existing source/notebook revision fences,
locks, immutable checkpoints and retained variants remain in force. Readers must
use updated cross-process-aware Aw writers before mixed offline/background saves.
Never point both machines at the same live NFS/cloud-synced data home. Keep one
coordinator, not opposing background sync jobs. Stop on storage/history limits;
do not discard checkpoints to keep a worker running.

On Windows, `scripts/installSyncTask.ps1 -WorkspacePath LAPTOP_HOME -ProjectId ID`
adds a limited, signed-in-user task every three minutes, with a windowless
Windows Script Host entry point (rather than launching a console and hiding it),
no password/elevation, no wake request and no competing task instance. It runs
the standalone worker at below-normal CPU priority, leaving the Aw service and
research processes unchanged. Existing cached hashes and peer inventories avoid
recopying unchanged content; no polling loop downloads desktop-backed arrays.
The scheduled task runs
with network and AC power; a cycle already underway may finish after unplugging
instead of being terminated mid-save. The desktop's research continues without it. `-Remove`
unregisters that exact task without deleting research/history. To pause cleanly,
disable the configuration first; an already started guarded commit can finish.
Never kill it to try to undo a sync. Alternatively `awSyncWatch.ts watch` runs a
foreground coordinator with graceful Ctrl+C. Local status contains the last result,
next check and an interrupted sync ID when applicable. The CLI is the initial
control surface; the app does not yet expose an automatic-sync toggle/banner.
The latest launch output replaces `launcher.log` beside that project's automatic
sync settings. The launcher waits and forwards the exit code, so overlapping
cycles remain excluded. If Windows Script Host is disabled by local policy,
installation/execution must be corrected explicitly; there is no visible-console
fallback. Do not automatically clear abandoned locks: verify their owner and
preserve the lock during explicit recovery.

If scheduled tasks repeatedly report `busy`, check the owner in both the global
`auto/coordinator.aw-lock` and the project's `cycle.aw-lock`; a successful task
exit does not prove an exchange occurred. An absent owner requires explicit,
byte-checked recovery that preserves the original lock, not an automatic unlock.

Bulk capture validates research paths before hashing/copying evidence and names
any linked path it refuses. Keep experiment inputs as ordinary files in the
synced tree, with provenance links in notes/receipts rather than filesystem
symlinks. A link introduced by an experiment can otherwise block comments and
source too. Do not delete it or silently follow it: inspect the full inventory.
An authorized path-preserving repair can retain original links outside capture
and substitute verified byte-identical ordinary copies of in-project files;
never import an external target, rerun research or infer a new shared baseline.

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


## Reading document pins

Paired readers with the optional `documentPins` inventory capability exchange a
small separate record for ordinary Overview and Research notes pins and the
pinned overview target. Only these selected roots receive the corresponding
notes/overview purpose tag. The selected main file, publication purpose/pins,
wording locks, review decisions and unrelated version metadata are preserved.
Both sides must advertise the capability; older peers keep syncing source and
comments. The digest is saved separately from legacy file baselines so an older
running app service can continue ordinary sync safely.

Existing differing choices for one role are held, with neither computer treated
as authoritative. Independent role edits combine from the saved common version;
first pairing fills blank roles but does not replace a nonempty competing choice.
An explicit later unpin follows once a common baseline exists. Missing/new source
defers metadata while other files continue, then the next pass retries the pin.
Full registry bytes are fenced before saving and other projects are retained.
This is ordinary reading navigation, never permission to relabel publication
text, approve wording or switch a user away from the document they are editing.
