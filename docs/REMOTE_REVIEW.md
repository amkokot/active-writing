# Reviewing across laptop and desktop

Leave comments in Aw as usual. They autosave with their original quotation, source
snapshot, manuscript root, author and thread ID. On an enabled paired project,
the laptop coordinator copies saved comments to the desktop and assistant replies
back to the laptop. No export/paste ritual, second queue or running desktop Aw
server is required. Receiving comments does not launch an agent or authorize edits.

The practical handoff is: save comments, remain connected through the approved
campus/VPN gate, then tell the remote agent which project/version and comments to
address. Enabled live reading pairs follow saved TeX/comments after a 300 ms
debounce, with a five-second fallback for missed/NFS events. Network latency and
other bounded transfers still apply; this is not an instant-delivery guarantee.
Small literal figure dependencies of the selected/pinned reading roots now join
the fast lane (2 MiB per figure, 8 MiB per inventory, at most 64 candidates).
Comments/text take priority, followed by figures, before notebook evidence and
root compiled PDFs. Larger or macro-resolved assets retain the slower lane.
The existing **Workspace folders → Two computers → Sync now** is the explicit
immediate route after saving drafts on both copies. No network gate is bypassed.
If offline, comments remain saved locally and transfer on reconnect.

## Agent loop

Before a revision, read the current manuscript rather than composing from the
comment's older quotation. `inspect`/`list` include `currentSourceRevision` for
each root. Recheck the source immediately before writing and use an exact-byte
or revision-guarded save; if it changed while you were drafting, reread it and
adapt the proposal instead of replacing the file with your earlier copy.
Receiving a comment or reply does not prove that every unfinished browser draft
has reached the desktop. Do not tell the human a source handoff is complete
without a saved-source sync acknowledgement. Reading sync moves saved files;
it does not arbitrate two writers editing the same words at once.

The editor now retains the original edited passages in its private browser
recovery, so an unrelated synced file change can be rebased after reopening.
Own-save continuations also resume automatically when their exact edited
originals are unchanged, including when a figure arrives during typing. Real
overlaps retain both texts and their original context; neither version is
chosen merely because sync itself is aligned. Disk recovery copies are separate
from synchronized manuscript source and do not count as a delivered revision.

Use the currently installed app-code path and confirmed desktop data home:

```text
node APP_CODE/scripts/awReview.ts list --workspace DATA_HOME --project PROJECT_ID
node APP_CODE/scripts/awReview.ts inspect --workspace DATA_HOME --project PROJECT_ID --comment COMMENT_ID
node APP_CODE/scripts/awReview.ts reply --workspace DATA_HOME --project PROJECT_ID --comment COMMENT_ID --revision REV --file REPLY.txt
```

`reply` previews; repeat with `--commit` for one guarded append. It deduplicates an
identical reply to the same parent, including an interrupted/repeated delivery.
Use the returned revision for the next reply; reinspect a conflict, never invent
a current revision. `list --manuscript ROOT.tex` narrows the root; `--all` includes
resolved history. `inspect` supplies the complete saved source snapshot and
whether the exact quoted range still exists. A changed quote is not permission
to apply an old offset to nearby text. Read the current source and policy.

Comments are not automatically execution requests. A user instruction to revise
provides scope; inspect the indicated open human comments and linked discussions,
then address them in bounded passes. Research notes allow the authorized source
edits; publication drafts retain their incremental proposal and wording-lock
workflow. Do not relabel a publication draft or overwrite locked text for sync.
Leave unrelated comments/files untouched. A comment's model-generated suggestion
is not authority to run code, upload data, install dependencies or spend money.

After a revision, append a short assistant reply identifying what changed, or
explaining the remaining concern. Keep substantive reasoning in the owning
notebook when appropriate and link it, rather than flooding comment threads.
Do not close the comment just because source changed or an answer arrived. The
remote review CLI has no resolve/approve/source-write command. The human uses
Aw's check mark when satisfied. Existing exported review files/web-client response
protocols remain available; do not submit the same response through both routes.

## What synchronizes and what remains held

- Independent new comments, immutable quotes/anchors and threaded assistant or
  human replies; independent body edits on different comments.
- An explicit human Resolve/Reopen action, recorded by the updated UI, can be
  copied exactly. Sync does not decide that a concern is resolved and does not
  approve wording, certify mathematics or complete a model job. A simultaneous
  new question on the same comment prevents a stale closure from winning.
- Queue placement/color/visit details stay local. Stable IDs prevent duplicates.
  Receiving a comment/reply does not force the user to navigate or change text.
- An editor's own-save `returnAnchor` is also local navigation. Moving the caret
  target after a source save is not a comment edit; original quotes and captures
  remain immutable. Incoming comments/replies keep this editor's existing return
  hint rather than replacing it with another device's hint.
- Identical historical resolved comments already present on both devices are
  retained during comment unions. This never imports a new unmarked resolution
  or changes either device's decision; differing legacy decisions remain held.
- Existing reply threads may retain different original captures of a passage
  revised between comments. Sync keeps these captures unchanged when both thread
  identities are already established; adding an unrelated comment does not
  reclassify that history as a new broken reply. New mismatched replies, altered
  original captures, missing parents, cycles and cross-manuscript links stay held.
- Independent comment/reply additions combine automatically in the fast lane.
  Competing comment text is kept as both versions with stable copy IDs, not a
  manual reconciliation task. Malformed/foreign anchors, unknown executable
  fields, cyclic/orphan reply threads and legacy decisions remain protected.
- Wording locks, publication approvals, model/request state, recoveries and other
  protected review records are not swept in with comments. Source/notebook
  conflicts keep their own guards. A protected difference can still hold a whole
  automatic pair; inspect it rather than forcing alignment or dropping records.

## Source revisions while the human keeps editing

For ordinary research notes, a saved common-text cache lets the fast reading lane
combine non-overlapping literal changes inside the same TeX/BibTeX/Markdown/text
file. No agent/model merge or whole-project comparison is required. Both source
saves retain exact-byte guards and before-images. A moving file is deferred; a
lost acknowledgement is followed on the next pass, never rolled back. Included
TeX files remain separate. This does not declare the mathematics correct.

Overlapping edits leave both source files unchanged and save a private comparison.
The sync notice offers **Compare revisions**, initially showing the differing
region with surrounding lines; **Show full file** reveals the complete copies.
Save unfinished editor drafts first. **Keep this saved version** / **Use this
saved version** queues a whole-file choice, not an immediate write. Sync rechecks
the exact versions on both devices; newer work invalidates that choice. Or copy
only the desired wording into the normal source editor. Original comparisons
remain saved after the copies agree; no comment is resolved or wording approved.

The cache/merge is bounded to 512 KiB, 12,000 lines and two million diff cells;
initial cache seeding is at most sixteen files / 1 MiB per pass. A missing checked
baseline is not guessed from timestamps. Large/ambiguous changes, deletions,
publication drafts and locked wording retain their protected workflows. If a file
contains a real overlap, this first implementation reviews that whole file; it
does not yet merge its other hunks independently while that overlap remains open.

Agents can inspect existing comparisons offline:

```text
node APP_CODE/scripts/awSync.ts source-reviews --workspace DATA_HOME --project PROJECT_ID
node APP_CODE/scripts/awSync.ts source-reviews --workspace DATA_HOME --project PROJECT_ID --review HASH --output NEW.json
```

These commands read saved evidence, not live SSH; they cannot choose a version or
edit source. Use the laptop coordinator's home for its comparisons. Do not force
desktop text over a newer human revision just to clear a notice. Continue with
other comments/passages and append a concise reply describing the attempt.

The local helper's bounded request/receipt artifacts can travel as inert,
append-only records after checking their project/conversation owner and schema.
This does not submit them to a model or execute suggested commands. Changed or
deleted receipts and arbitrary research JSON/configuration still require review.

Comments are part of Aw records, not `%` annotations automatically inserted into
TeX, not Overleaf comments and not arbitrary chat text. Ordinary TeX/Overleaf
compatibility is unchanged. Only saved disk content transfers; unsaved browser
drafts on another machine cannot be flushed remotely.

## Deployment and recovery

Both endpoints need the comment-aware sync code. Existing immutable peer records
are retained; opt-in pair configuration pins the new tool deliberately. An older
endpoint safely holds comments rather than pretending they synchronized.

Workbench saves use the same per-file cross-process lock and exact-byte fences
as sync/CLI writes. An older running local service must get one quiet restart
before concurrent review CLI/sync writes; never restart occupied research jobs.
Reload the browser after saving drafts to receive the new human-action markers.
Historical resolved comments remain readable; sync does not invent human markers
for legacy decisions. Keep interrupted journals and drafts; never replace live
workbench JSON, steal locks or clear browser storage to force agreement.

For an already running remote agent, ask it to reread the current project AGENTS
and use `awReview.ts list` before revisions. A new chat reads updated guidance;
sync itself cannot inject instructions into or wake an existing chat.
