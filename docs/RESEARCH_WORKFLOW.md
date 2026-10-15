# Research workflow for Active Writing

This is the working guide for a human researcher and Codex, or another folder-aware assistant, using Active Writing (Aw). Aw holds the current question, manuscript context, conversations, Python experiments and replies. The assistant does the requested reasoning and computing; the human controls direction, learning, acceptance and manuscript changes.

Use the existing conversation and notebook as the working record. Do not make the human maintain a second task system, repeatedly approve relevance, or press Save for ordinary notes. Keep the interface quiet: one current question, folded conversations, and a small number of pinned results. Record assumptions and evidence as part of the work, not as compulsory forms.

During exploration, keep prose-editing/rendering checks minimal unless explicitly asked for more or working on publication manuscripts. Check changed passages for obvious readability/markup failures and fix locally; skip routine whole-note polishing, full compilation, page-by-page aesthetic inspection and UI editing trials. A note does not need publication finish before the next research step. This conserves agent time without weakening mathematical checks, experimental provenance, complete-output inspection or guarded storage. App-code verification has its own requirements in `AGENTS.md`.

Treat a clear indication that the human wants to read this version as a reading-ready request, even without explicit editing/QA wording. Prepare coherent exposition and do focused readability/rendering checks for that version. A requested digest or walkthrough can therefore warrant more presentation care than scratch notes, without becoming a publication manuscript or a validated result. Do not default to exhaustive full-PDF aesthetic trials unless the request warrants them.

For reader-facing drafting and revisions, see [Writing overviews and research notes in Aw](PRESENTATION_REVISION_NOTES.md): introduce the process before its formulas, state precise scoped results, explain their significance and check the view the human actually uses. The reading preview supports literal project-local PNG/JPEG/GIF/WebP `\includegraphics` references and captions; PDF figures have an open link. Use explicit project-relative paths. Custom graphics macros, `\graphicspath`, SVG/EPS and exact float layout still need the compiled PDF. Do not rerun experiments merely to revise their presentation.

Implementation reference: checked against this workspace on 9 October 2026. This document is an operating convention, not a new execution engine. In particular, Aw does not start Codex, create worker agents, monitor an arbitrary web chat, verify proofs, or automatically ingest every file in a research folder.

New agents can start with [AGENT_GUIDE.md](AGENT_GUIDE.md), a shorter map of project setup, manuscript/notes roots, included sections, reversible structural edits and two-way evidence links. Return here for the complete research and execution protocol.

Report substantive experiments in the detailed **shared Aw research note**:
protocols, complete relevant comparisons, readable tables/plots and important
failures. Keep raw data, code and execution provenance in its owning notebook and
link them. When sharing is authorized, check the exported/deployed source revision,
matching full PDF and new results; saving or compiling the live manuscript does
not update an older hosted snapshot. See the [publication version check](ONLINE_SHARING.md#keep-the-live-manuscript-and-hosted-snapshot-distinct).

## Quick start

**Agents work in Aw without opening its UI.** Keep project/conversation ownership, notebook evidence, manuscript links and saved-task completion connected through the scoped tools. Authorized TeX notes remain normal source files in the confirmed paper folder; link them into the owning research record when available. Routine exploration needs only brief markup checks, not a browser visit. Reserve opening Aw and inspecting its renderer for material prepared for the human's review, explicit display/UI work or publication presentation checks. Use explicit `--offline` for saved records, guarded cell updates, authorized fresh Python and saved-task completion, without a server or HTTP. Shared sessions and unsupported operations retain their service protocols. See [the no-UI path](AGENT_GUIDE.md#default-work-in-aw-without-opening-its-ui) for identity lookup and unavailable-service handling; report what was not completed rather than repeatedly polling or launching services.

Use **Overview** for a short collaborator-facing explanation rather than a research notebook dump or publication manuscript. Keep it to a few paragraphs/about a page, clarify scientific status, and link to the designated main manuscript for detail. Research notes can remain expansive. This purpose does not grant source-write permission or clear existing locks/reviews. The [agent guide](AGENT_GUIDE.md#manuscript-versions) covers its local main-manuscript link and guarded agent commands.

Before a new saved request, inspect its owning root and current writing policy, not an old assumption from chat history. Notes are the default and may contain full explanations. Keep exploration presentation checks minimal; clear intent to read calls for focused readability/rendering checks, not publication approval. See [Manuscript versions](AGENT_GUIDE.md#manuscript-versions) for guarded notebook move/copy between roots and the corresponding agent command.

The following is human setup for an interactive Aw session, not an agent checklist for every research request.

1. Open the Active Writing desktop shortcut. The local address is `http://127.0.0.1:4173/`. Development work can use `npm run dev`; ordinary research agents should not start it by default. Keep the app bound to loopback.
2. Identify the intended project under **Paper & files** (the folder button). **Switch manuscript** in the top bar chooses a parent LaTeX root within it, such as the paper or informative notes. Included section files are part of their parent manuscript, not separate manuscripts. For an unfamiliar benchmark, use an isolated paper folder, not the author's working manuscript.
3. In the manuscript, select a passage and use **Ask**, or open a standalone **Question** in the Notebook. Give the question a descriptive title. Questions and working notes save automatically.
4. Write the target and assumptions, the unresolved step, and whether the human wants a hint, outline or walkthrough. Record background only when it matters.
5. Open the conversation's experiments and **Jupyter & shared files** to find its `.ipynb` path. **Copy instructions for an assistant** supplies brief, scoped commands with the app origin, workspace, paper and conversation. No account connection is involved.
6. For deeper work, prepare a **Shared-folder assistant** request. Pass its short instruction to the existing Codex conversation. For a different assistant with no history, choose a fuller briefing rather than assuming shared context.
7. Continue a related or unrelated question while waiting. The folder-aware assistant writes notes, code and displays directly into the owning notebook, then explicitly finishes the saved request. Aw offers **Return to task**, without moving the human automatically. Web clients can still use optional paste or finish without saving a reply.

Before the first real session, open **Experiments → Jupyter & shared files → Check research setup**, or use the scoped `preflight` command below. It checks saved records and starts only a fixed, short Python version/package diagnostic, never cell code. Missing scientific libraries affect only experiments that need them. A setup check is not a compilation, backup check, execution permission or mathematical verification. The result stays tucked away; it is not a compulsory step for each question. An already running service needs one safe restart to enable new server features—wait for runs to finish and drafts to save first.

For several instances, open tabs/windows of the same Aw service. Give each independent research question its own conversation; shared-session variables belong to the notebook owner, not the tab. Python defaults to **two concurrent local runs in different notebooks**, shared across this service. Every notebook remains sequential, including fresh/shared-session mixtures and conversations deliberately sharing an owner. Keep one coordinator writing any given notebook, even when other assistants reason in parallel. See [remote research and session preparation](REMOTE_RESEARCH.md) for backups, a first-session checklist and the planned desktop/cluster split.

The host can set `AW_PYTHON_CONCURRENCY` to an integer from 1 to 4 before starting Aw (default 2). For example, `$env:AW_PYTHON_CONCURRENCY='1'` before `npm run dev` retains the older one-slot policy. This is a host setting, not a per-tab permission or CPU/memory sandbox; parallel scientific libraries may themselves use several threads. Change it only at a safe restart after runs and drafts settle. An older running service still has its old limit until restarted. `inspect` reports actual runtime capacity, available slots and active run IDs/owners/start times/budgets; `preflight` reports a point-in-time capacity summary. `runtime.busy` means at least one slot is occupied, **not necessarily that capacity is full**. Busy rejections identify the active run(s) and do not queue or automatically rerun code. Never stop another notebook's run to obtain a slot without permission. Reservations remain occupied through validation and saving results, including cancellation cleanup.

An answer, a plot, a successful compilation and a section's Done checkbox mean different things. None is a mathematical verification badge.

Explicitly clearing a queue can set its current items aside without asserting review or correctness. Queue-only `queueHiddenAt` metadata keeps their comments, drafts, prompts and findings unchanged; comments remain unresolved and wording remains unapproved. Task history labels them **set aside · not reviewed** and **Return to queue** restores them without rerunning anything. This is not automatic retirement after a reply or edit, and it does not stop compute. Notebook requests retain the flag in their owning turn/handoff; closed turns are archived, never mathematically validated. Assistance records remain in their own store. A newly created request still enters the queue normally.

The toolbar's **Next** button advances through queued work without opening a menu or finishing anything. Its adjacent arrow opens the queue, with a compact **This project / All projects** toggle. All projects includes the registered papers and names each paper beside its items. Opening an item saves pending work before switching to its owning paper and passage/conversation. The combined view can be reordered with the same handles; its browser preference does not rewrite any paper's individual queue order. Scope and combined order are remembered. Resolve/check remains an explicit human action.

For a manuscript passage with saved conversations, the main bar shows **Notebook**; several conversations get a small chooser, including filed work. Each linked conversation has its own **Passage** link beside its title, even when collapsed or pinned. Click to return to that entry's manuscript location and saved view; right-click or Ctrl/Cmd-click to open saved source in a separate tab. New unsaved blocks or uncertain locations cannot supply a new-tab link; edits to existing blocks open their saved version in the other tab. Multi-block questions link from each captured block. Uncertain source locations are not guessed. Queue Next/Return prefers the manuscript for linked questions; standalone or uncertain questions open the notebook instead. Reply explicitly opens the conversation, restoring filed work and bringing its heading into view. Replies arriving in the background do not move the current view or resolve human comments.

Each Aw tab keeps its own project, manuscript/notebook view, reading position and pending drafts. Refresh resumes that tab; a new session resumes the last-used project and last closed view when available. **Advanced → Second screen & windows** opens a deliberately separate view, without borrowing a live window's unfinished edits. Saved source, conversations, experiments and queue items are shared. Source edits from another Aw window appear automatically; edits made in other editors are checked every few seconds while visible and on return. Unchanged passages can merge safely. Overlapping edits show both versions and keep the local draft until the human reviews it. Incoming source marks a compiled PDF outdated; it does not recompile automatically unless automatic compilation was explicitly enabled. Browser recovery supplements disk saves, not backups: clearing browser storage removes pending recovery copies, and an abrupt browser/device crash may lose the final unsaved instant. Python permission and execution settings reset; no code reruns on reopening.

## Identify the workspace before writing

Browser recovery is separate from disk persistence. Experiment caches retain a full merge baseline only while edits are pending; clean notebooks use an empty recovery marker instead of duplicating their saved cells and outputs. Opening an experiment notebook also compacts its older browser copies only when the cached notebook exactly equals its baseline. Dirty, malformed and unrecognized recoveries are preserved. A recovery warning distinguishes full storage from blocked access, offers **Retry browser recovery**, and clears after a successful cache write; it is not a project-load error. Do not clear all browser storage to repair this warning, since that could erase pending recovery drafts.

Distinguish the installed app-code folder, Aw research-data home, the paper
repository and the paper's Aw data folder. The code installation contains
`package.json`, `server/`, `src/` and agent tools/guides; it may be separate from
the data home. A completed first-copy home has a checked receipt/registry, not a
fake app package. Run tools by their code path with the confirmed data home in
`--workspace`; inspect reports `codeRoot` separately. The repository holds ordinary
source and deliberately shared research files. Notes, experiments, replies and
compilation files live outside that checkout under the data home's
`.paperfocus/project-data/PROJECT_ID/`. Paper-relative paths refer to the manuscript,
not the app or Aw data folder. Read [DEVICE_SYNC.md](DEVICE_SYNC.md) before any
authorized cross-device collection; ordinary research saves are not sync permission.

Use the user's named paper or the saved request's project identity. If it is unclear which paper should receive work, ask one question before writing. Do not choose whichever benchmark happened to be active last time.

These optional service identity diagnostics are read-only. A scoped CLI inspection already checks identity; do not run these as an additional startup checklist or for ordinary file-only notes:

```powershell
$awBase = 'http://127.0.0.1:4173'
Invoke-RestMethod "$awBase/api/paperfocus/health"
$awProjects = Invoke-RestMethod "$awBase/api/paperfocus/projects"
$awProjects.projects | Select-Object id, name, folder, mainFile
```

The health endpoint identifies the app and its workspace folder. Once the intended project ID is known, `GET /api/paperfocus/document?projectId=...` supplies the current parsed source and revision, and `GET /api/paperfocus/notebook?projectId=...` supplies saved conversations. Do not dump unrelated projects or private notes into an assistant prompt.

The experiment owner is `entry.experimentNotebookId ?? entry.id`, not the title or whichever card is expanded. Existing entries can deliberately share an experiment notebook. Preserve that ownership when returning or branching work.

Manuscript versions are separate from research phases: **Switch manuscript → New version** copies ordinary TeX roots/includes and continues independent notebook owners by default; Advanced can start the notebook fresh. `entry.manuscriptFile` scopes a conversation's catalogue, and `continuedFrom` records its previous owner. Copied saved displays are historical evidence, never new executions; inspect their `awVersionOrigin` metadata for the original notebook/revision/run records. The scoped `awVersions.ts inspect/create` commands supply chronology and guarded preview/commit without UI traversal. Use newly returned entry IDs/bindings for future work, not old pending tickets. See the complete constraints and recovery procedure under **Manuscript versions** in [AGENT_GUIDE.md](AGENT_GUIDE.md). A phase inherits its conversation's manuscript scope; it does not create a TeX version.

### Fast agent loop

Use `node scripts/awResearch.ts` from the Aw code folder. Add `--offline` for supported saved-record operations; omit it only when deliberately using the already running service. Neither path starts a server, contacts a model or installs anything. Scoped commands require `--workspace PATH --project PAPER_ID --entry CONVERSATION_ID`; discover can list identities with less scope. Supply `--url http://127.0.0.1:PORT` when live access or future evidence links need a different origin. Copy scope from **Copy instructions for an assistant**, not from a different trial.

- `inspect`: fresh disk evidence, exact notebook revision and path, owner, `paperRoot`, `awDataRoot`, cell catalogue, run IDs, stale-output flags and bounded findings. This works even when the human has closed the conversation. The saved conversation's older `experimentContext` is not a substitute for this fresh read.
- `preflight`: point-in-time saved-file, owner, interpreter/package and execution-capacity check. Uses the same explicit workspace/project/entry options, without `--revision` or `--allow-python`. It does not run cell code, install libraries, test backups, enable remote execution or flush browser drafts. Python diagnostics are deduplicated/cached for 15 seconds; file checks are fresh.
- `cell --cell ID`: full source and all saved MIME outputs for a particular cell. Inspect this before drawing conclusions from a shortened context or citing exact values. Plot summaries include endpoints, not the full curve or image pixels.
- `output --cell ID --output INDEX`: one complete saved MIME output, plus its exact notebook revision and stale-state warning. `inspect` lists zero-based indices and display labels. Use this for a specific numerical control or plot rather than repeatedly reading thousands of unrelated points. It never reruns code or changes which display the human sees.
- `put --cell ID --file SOURCE_FILE --revision REVISION`: change just a cell's source, preserving outputs, metadata and all other cells. For a new cell add `--kind code|markdown|raw`, optionally `--title TITLE --after ANCHOR_ID`. Use `missing` for a genuinely absent notebook's revision. Changed code retains old results, which are marked stale; saving does not run it.
- `organize --cell ID --revision REVISION`: arrange a saved cell using any of `--pin true|false`, `--highlight true|false`, `--suppress true|false`, `--filed true|false`, `--trash true|false`, `--folder TITLE`, `--output INDEX` (zero-based saved output index), and `--before ID` or `--after ID`. These are the human's Organize cell / Saved display actions, with the same reversible filing and trash semantics. Pinning also unsuppresses a display. No output or code is deleted; every mutation checks the revision.
- `finish --task TASK_ID --request-hash HASH --summary-cell CELL_ID --revision REVISION`: complete a **direct notebook research request** using a saved, active Markdown summary cell. `inspect` lists the conversation's direct requests and exact hashes. The saved request must belong to this conversation/owner and still be waiting; a stale revision, closed task, different request or existing manual answer is rejected. The conversation retains that summary version and links its source cell/revision; later cell edits do not rewrite the completed reply. Finishing offers Return, not automatic navigation or resolution. No intermediate response file is written. With no saved request, simply save the cells; there is nothing to finish.
- `run --cell ID --revision REVISION --allow-python`: start only the explicitly authorized, trusted cell. On the live service it returns a job ID immediately. With `--offline` it waits for fresh Python and notebook collection, returning the new revision, status and run path. Python has normal file/network access; the flag is not permission by itself and is not a sandbox.
- `job --job RUN_ID`: read completion without rerunning; inspect the cell and run record afterward. Reinspect after every save or conflict. Never automatically retry a protected stale write.
- `inspect --expanded`: up to 24 active-cell excerpts / 18,000 characters; use `cell` for complete evidence. Ordinary inspect remains compact.
- `evidence --revision REVISION`: save a complete fixed snapshot of active cells as `.ipynb` plus a Markdown text companion. Returns exact paths, download links and SHA-256 hashes. It checks conversation ownership and the current revision, never executes code, and never sends files to a model. Retrying an unchanged revision reuses the same files.
- `session`: inspect this notebook's live Python state without creating a process. `restart`: clear only this notebook's variables (not its saved outputs); stop a running cell first. `run ... --session` deliberately shares variables across cells. It never automatically replays setup code.

For example, append a short proof-gap note after the experiment rather than placing the entire derivation in stdout. Keep a few pinned displays; use highlights only to prioritize bounded prompt excerpts. Numerical plots can use `display_plot(..., y_scale="log")` (or `x_scale="log"`), preserving original values. Log axes require strictly positive values; zero or negative data must be handled deliberately, not silently omitted. `display_data({"text/markdown": text})` renders explanatory Markdown/math safely, without executing HTML or scripts. Pair figures with a small table and a short numerical summary for text-only assistants. Keep proof, evidence and editorial proposals distinct.

### Efficient agent commands

Use offline `--help` rather than inspecting app internals or downloading a launcher. `discover --workspace AW_HOME [--project ID]` lists only project/conversation identities. `bind` with the confirmed scoped options and `--file NEW.json` creates a small explicit binding, then commands can use `--scope NEW.json`. It checks workspace, project, conversation and owner; conflicting overrides or an ownership change stop the command. Keep these records in an existing Aw research folder outside the source checkout; old bindings/checkpoints are not overwritten. A new phase needs a new binding. Binding does not grant execution, manuscript editing or delegation authority.

For related changes use a version-1 edit packet:

```json
{"version":1,"changes":[
  {"cell":"proof-gap","kind":"markdown","source":"## Remaining step\nThe bound still needs justification.","title":"Current gap","arrange":{"pinned":true}},
  {"cell":"control","kind":"code","file":"control.py","inputs":[{"root":"data","path":"research/study/control.py"}],"after":"proof-gap"}
]}
```

`batch --revision REV --file EDITS.json` validates and previews; repeat with `--commit` for one guarded save. There are 1–50 uniquely named changes, with optional inline `source` **or** a `file` relative to the packet. Existing kind, IDs, outputs, execution records and unknown metadata are preserved. New cells need source; `after` inserts a new cell, and `arrange.after`/`arrange.before` moves an existing one. `arrange` uses the existing pinned/highlighted/suppressed/filed/deleted/folder/featuredOutput controls; pinning unsuppresses. No change executes, overwrites notebook ownership, modifies source files or resolves comments. Invalid batches and stale revisions save nothing. Use each successful returned revision rather than inspecting after every save; inspect and reconcile conflicts, never force a retry. Batches currently use one ordinary guarded notebook save, not a new append-only storage engine.

`manifest --file NEW.json` saves a small hash index of sources, outputs, metadata and checked input state. `inspect --since NEW.json` returns added/changed cells, removed IDs and order changes, without repeating unchanged excerpts. The ordinary inspect remains available. This observed-state index is **not complete evidence**, a read receipt or proof verification. Read full changed cells/outputs before drawing conclusions; `evidence` still supplies immutable complete snapshots. Inspector headings and exact cell links help maintain one current-state note pointing to full derivations, experiments and open gaps. A short manuscript synthesis must not be described as containing every saved proof.

`job --job ID --wait-seconds 30` checks inside one bounded command instead of requiring repeated model/tool turns. Allowed waits are 1–60 seconds. It neither queues code nor reruns it; a still-working result is normal and preserves the exact job ID. Continue independent reasoning while a job runs when useful.

### Declared experiment inputs

Reusable code/data can be declared with `put --inputs INPUTS.json`, a JSON array such as `[{"root":"data","path":"research/study/study.py"}]`, or with a batch `inputs` field. `paper` means the confirmed repository root; `data` means this paper's returned Aw data folder. Only code cells declare inputs. Use forward-slash relative paths, no traversal, junctions or symlinks. Limits are 32 files, 20 MB per file and 50 MB per capture/check. Inspector checks share a bounded per-command hash cache; an exhausted check reports uncertainty, not a clean result. Large datasets can be represented by a deliberately prepared digest/manifest file, but a manifest does not magically validate the underlying dataset.

With `health.features.experimentInputs`, the service captures declared file hashes before an authorized fresh/shared run and checks them afterward. The exact captured inputs and changed-file names are retained in the run record and cell execution metadata. The CLI refuses to run a declared-input cell on an older service rather than silently dropping provenance. `inputs --cell ID`, `cell`, `output` and `inspect` compare captured hashes to the current files without execution. Untracked old/imported outputs remain untracked; declaring inputs now does not retroactively verify them. Inspector checks do not mutate notebooks or automatically rerun code. The normal browser polling does not continuously rehash external files.

This is explicit **declared-input** tracking, not complete Python import discovery, immutable execution, a filesystem sandbox or mathematical validation. Hashes sampled before/after cannot detect every intermediate mutation; the cell may read undeclared files or cached shared-session modules. Keep one coordinated script writer, use fresh cells by default, and restart/replay an explicitly chosen shared session when imported code changes. Existing saved evidence remains available rather than being deleted or relabeled as a fresh run.

Bindings, batches, manifests, delta inspection and waiting work with the current older service. New exact-cell/output transfer (`researchCells`) and run-time input capture require one **later safe restart**, after active jobs and drafts settle. Never restart another owner's service for this upgrade. The CLI capability-checks and falls back to the old guarded evidence reads; it does not restart, install or contact a model.

### Human notebook controls

The same `.ipynb` is editable by the human: add Python or Markdown notes, edit source, explicitly Run, import/export, pin, prioritize, suppress, reorder, file in a topic folder, trash and restore. **Jump to cell** reaches active, filed and trashed records. **Organize cell → + Note below / + Python below** inserts beside the relevant evidence. In a source editor, **Shift+Enter** runs a trusted code cell or saves/previews a note and advances; **Ctrl+Enter** stays. Plain Enter remains a newline. The last cell advances to a blank note. Python permission, run limits, busy-state checks and revision guards still apply; shortcuts do not bypass them.

Assistants need not traverse menus: the scoped CLI covers reading, writing, organizing, running, evidence snapshots and completion. Browser controls have stable cell IDs and named regions if visual inspection is useful. Human controls are not a mandatory approval checklist. Incoming results never scroll the current editor or force a notebook open.

For cells with several outputs, **Saved display** shows one figure, table, explanation or log, or all outputs on request. Its chosen output also appears when the experiment is pinned. This is a display choice, not an evidence filter: `cell` and evidence snapshots still include every saved output; prompt excerpts remain bounded and are independent of the displayed result. Errors stay visible beside the selected result. Output indices refer to the current saved run; recheck after changing code that changes output order. A two-parameter heatmap plus an exact table and a parameter sweep often explains a conditioning issue better than dozens of disconnected charts.

### Establish a working folder for each project

Keep each paper or research project in its own folder inside Aw home. New projects and remote imports establish separate folders under `papers/`. Use the toolbar's **folder icon → New / open project** to start a blank paper, import files/a folder, clone a repository, or register an existing workspace-relative folder. Aw still needs a LaTeX root with `\documentclass`. Do not move existing imported papers just to match the new layout; older checkouts keep their registered paths.

Each project's separate Aw data folder stores its conversations, experiments and replies. The registry ID keeps that link stable across title, branch or root-file changes; `project.json` catalogues the categories. Source, shared data and figures belong in the repository only when intentionally shared. Separate questions can share a project without separate checkouts. A remote clone is not a worker sandbox. Give authorized parallel workers separate output locations and coordinate shared edits.

Use the **folder icon** for project selection and source files. The **home icon** offers **Paper repository**, **Aw files · this paper**, and **Aw home**, with Open, Copy path and Copy link. **Copy workspace note for a chat** includes these exact paths and the research guide. Choose the repository for manuscript work; give a folder-aware assistant access to the separate Aw files when it needs experiments or replies. Choose Aw home for app development. Copying a note does not change another client's workspace or grant it filesystem access automatically.

Start Codex in the app folder to use its `AGENTS.md`. In a separately opened paper repository, explicitly point the assistant to this guide and the intended request; do not assume this parent folder's instructions were loaded. Project instruction discovery depends on the working directory and project root, as described in the [official Codex instructions guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Keep a compact research record

The coordinator, normally the main Codex assistant, maintains the following in the conversation's notes. The human can edit it, but is not responsible for filling out each field after every action. Omit fields that add no value to a small question.

```text
Target: The exact claim or question and its assumptions.
Current approach: The useful idea, and the step that is still missing.
Learning preference: Hint, outline or walkthrough; relevant background.
Evidence: Specific notebook cells, run IDs or primary-source locations.
Open gap: What remains unproved, contradicted or unclear.
Next: One useful check or derivation, with a short reason.
```

When assumptions change, retain the old formulation and give the new one a short version label in notes. Mark which conclusions and runs used the old assumptions. A notebook edit does not automatically create a versioned theorem or dependency graph; those are lightweight written conventions here.

Keep a short dependency outline when the proof needs it: the target relies on Lemmas A and B; A relies on a stated estimate. An unsupported lemma remains a gap even if its downstream calculations work. Use separate conversations only for genuinely independent questions, not every line of algebra.

## Work from a question to a paper

### Understand the bottleneck

Use **Catch me up** for the smallest prerequisite path needed now. Ask for a toy example and the bridge back to the current approach, not a generic reading course. **Explain this step** should expand one confusing inference and identify the hypotheses used. **Check assumptions** should distinguish a sufficient condition from a necessary one and suggest a boundary case.

Explanation depth, response budget and help level are separate. Derivation depth with Small hint still means a hint, not a revealed solution. If the next step is already established, build on it rather than asking for another explanation of the same fact.

### Develop a few distinct approaches

Ask for two or three approaches when the problem is genuinely open-ended. For each, state what it would prove, its missing ingredient, and its cheapest decisive check. Prefer qualitatively different methods over reworded copies. Keep an abandoned approach as a short note with the reason; it can become useful after an assumption changes.

The assistant may recommend the next branch, but should not silently change the target to an easier theorem. If a counterexample defeats the target, say so and offer a revised statement for the human to choose.

### Use computation to choose the next mathematical question

Design a small experiment around an actual uncertainty: an invariant, scaling law, sharp constant, counterexample, conditioning problem, or finite-dimensional toy case. Before running it, state what would support the idea and what would falsify it. Include a baseline, a negative or boundary control, and the numerical tolerance.

Start with a small deterministic run. For randomized simulations, fix and record a seed and include repeated trials or variability when that is needed. Increase problem size only if the result changes the next decision. A failed control is useful information, not something to hide by choosing a better-looking plot.

Record the distinction between optimization error, discretization error, sampling noise and floating-point error where relevant. A nearly converged numerical solver is not an exact mathematical oracle. A finite counterexample needs its hypotheses and computation checked before it disproves a universal statement.

### Return to the proof

Translate observations into an explicit candidate lemma or question. Give the mathematical derivation separately from the simulation. State which assumptions justify each nontrivial inference and which dependency remains open. Do not insert an unproved step behind phrases such as “clearly” or “standard.”

Use an independent check when worthwhile: another derivation, symbolic calculation, exact small instance, or a worker checking a particular inference. Repeating the same reasoning with the same model is not independent confirmation. A local model's second look is an unchecked suggestion, not a proof checker.

### Write and review

For publication prose, use the [incremental writing workflow](WRITING_WORKFLOW.md): one human idea, one to three connected paragraphs, a guided queue review for every change, and locked approved wording that subsequent agents may read but not rewrite. **Tools → Write a small step** can draw context from the current section, theme or bounded paper. The scoped `awWriting.ts` client submits proposals rather than editing source or deciding approval. This does not replace the research notebook or the separately authorized informative-notes manuscript.

**Switch manuscript → Writing purpose** makes the distinction explicit. Research notes can be a full first-pass explanation or digest of any useful length, within practical storage/model limits; they do not require publication-style paragraph approval. New informative-notes roots are marked automatically; new versions inherit purpose. Unmarked roots default to research notes; choosing the Paper scaffold or Publication draft explicitly enables publication guardrails. **Writing → Ask for a full research note** transfers the instruction into a saved conversation without sending it. `awResearch.ts inspect` reports the owning root's policy; `awVersions.ts inspect/purpose` exposes guarded metadata choices. Source writing still requires explicit human scope. Agents must not relabel publication work to bypass review, and switching purpose never clears existing comments, pending review or locks. A note later used for publication needs incremental human curation, not automatic approval of its old text.

For longer-form explanations, derivations, literature reviews, or evolving research summaries, create or reuse an informative-notes manuscript within the project when source writing is authorized. Reuse an appropriate existing notes root rather than creating one per session; keep it separate from the publication manuscript unless the human requests otherwise. Maintain it as the readable research synthesis throughout the work, not only when a final paper is ready. Keep experimental code, outputs, execution records and short result summaries in the owning notebook, and link the exposition to exact cells or saved outputs. Clearly separate established results, numerical evidence, conjectures and unresolved gaps.

The top-bar manuscript menu can create a separate notes root or **Sections & files** can create/include a child section or move a current section to a new file. **All sections / This section** edits the assembled manuscript or a focused subtree, preserving each originating source file. A guarded **Undo section/file change** reverses the latest operation only while the source is unchanged, with parent/child recovery copies retained. Details, API fences and limitations are in the [agent guide](AGENT_GUIDE.md#manuscripts-and-included-section-files).

Use **View → Copy passage link** and an experiment cell's **Links → Copy evidence link / Copy LaTeX reference** to connect exposition to exact cells or saved outputs. Captured-passage conversations supply a reciprocal return link; standalone research needs an explicitly chosen manuscript origin. Evidence links inspect saved data without reruns, preserve filed/trash flags and warn on changed revisions. They are live local references, not immutable citations or mathematical verification. See the [link contract](AGENT_GUIDE.md#two-way-evidence-links); use evidence snapshots when a fixed version matters.

Keep the exact assistant answer and short research/result summaries in the Notebook; longer-form exposition belongs in the notes manuscript described above. Propose publication-manuscript text separately, tied to the current passage and its original included `.tex` file. Preserve notation, quantifiers, hypotheses, citations and the difference between observation and theorem. A research request alone does not authorize edits to the publication manuscript; respect the user's scope for saved notes and source writing.

When source editing is requested, preserve unrelated work and follow its purpose: small incremental publication changes, or a full explanatory note when requested. Use focused compilation for iteration and a full document build for final appearance and reference checks. Quick reading and editing typography are intentional alternative views; the actual compiled PDF is the appearance check. Compile success does not validate the mathematics.

The document API's `paragraphs[].text` is the editable span, often only the body of a theorem or proof. Match its `nodeId` to `nodes[]` and inspect `sourceOpening` / `sourceClosing` before writing. A `paragraphEdits` replacement must not repeat wrappers that already live outside that span. To change or remove a wrapper, use the separate revision-guarded `environmentChange` action with the node ID and current main file, not a body rewrite. After editing, inspect both the source structure and the claim; successful compilation can still conceal an accidentally nested proof.

Use **Tools → Review mode** for human or assistant comments, or select text and choose **Comment** or **Later**. Comments are not resolved automatically by edits, incoming replies, Turbo progress or research completion. During an authorized revision pass, an agent may explicitly resolve a straightforward issue after verifying its complete saved fix. Substantive, ambiguous and partially addressed issues remain open for human assessment; add anchored comments/replies to explain the attempt or remaining question. Preserve history and use revision-guarded saves. Publication wording approval stays separate, and dedicated comment-only review briefs remain read-only. See [comment handling](AGENT_GUIDE.md#handle-comments-during-a-revision-pass).

The comment panel's prominent **Jump to commented text** button shows its verified location in the source pane. Uncertain locations retain the saved quote instead of guessing. Resolving a parent also resolves its existing descendant replies, preserving the full thread history; reopening affects only the selected comment. **Priority queue → Resolve all comments…** offers an explicit confirmation for queued comments and their replies in this project, across all queue pages; this includes set-aside replies but leaves unrelated set-aside comments, other projects and non-comment tasks untouched. Resolved comments remain in History and can be reopened. This bulk interface action is not automatic acceptance of a revision pass or publication wording.

## Divide labor without making the human manage agents

Delegate only when the user or applicable instructions permit it and there is a useful independent task. One assistant can perform the same roles sequentially; a multi-agent system is optional. Aw is the shared record, not the worker scheduler.

The coordinator owns the current target, collects results, checks contradictions and writes one synthesis. Useful worker assignments include checking a single proof step, finding a counterexample, implementing one simulation, inspecting a primary theorem's assumptions, or reviewing a proposed paragraph. Choose only the roles needed now. Local models are most appropriate for bounded explanations, wording and cheap checks; stronger folder-aware assistants can handle the deeper reasoning and coding.

As a conservative starting budget, use at most two workers, one bounded question each, with one follow-up if it would settle the issue. This is a workflow recommendation, not an Aw setting or a guarantee of account limits. Do not create user-visible chats or message another chat without the required user authorization. Do not buy credits or add paid API calls.

For every delegated task, give this short contract:

```text
Question: One precise result or uncertainty.
Inputs: The exact permitted statement, notes, cells and sources.
Output: A derivation, counterexample, code cell or review; name its destination.
Checks: The control, assumption or consistency check to perform.
Budget: A bounded scope; stop and report an unresolved obstacle.
Writes: Worker-owned output only. Do not change the manuscript or shared state.
```

Use separate worker output files or separate assigned cell IDs. Keep one writer for shared conversation state and for merging worker results into an experiment notebook. A coordinator should read the latest revision before each write. Different workers must not replace an entire `.ipynb` file based on the same old snapshot.

Do not require the human to classify every result. The coordinator records the origin, assumption version, useful conclusion and open issue automatically in a note. Surface only a meaningful choice, contradiction, safety concern or change of target. While waiting, offer related work when it advances the same branch and unrelated work when the branch is occupied. Keep that suggestion panel minimizable.

## Store notes and simulations where Aw can display them

Actual storage has this shape:

```text
APP_ROOT/
  AGENTS.md
  docs/RESEARCH_WORKFLOW.md
  .paperfocus/projects.json                  paper registry
  papers/PAPER_ROOT/                         new projects and Git checkouts
    main.tex and included files              ordinary manuscript source
    figures/, data/, references.bib           intentionally shared files
    .git/                                    this project's Git connection
  .paperfocus/project-data/PROJECT_ID/        OUTSIDE the manuscript checkout
      project.json                           project identity and record catalogue
      migration.json                         legacy relocation record, when needed
      notebook.json                          conversations and retained replies
      notebook.previous.json                 one previous conversation store
      workbench.json                         comments and other editing work
      experiments/CONVERSATION_OWNER/
        notebook.ipynb                       notes, code and saved outputs
        notebook.previous.ipynb              one previous notebook copy
        runs/RUN_ID.json                     source and outputs of app runs
        evidence/SNAPSHOT_ID/                immutable notebook, text and manifest
      handoffs/REQUEST_ID/
        prompt.md and request.json           captured question and ticket
        response.json                        legacy/review reply (not direct notebook work)
      references/                            attached cited PDFs and page mappings
      source-drafts/                         retained recovery drafts
      build/full/ and build/focus/            compiler outputs and cached PDFs
      research/                              optional working files for assistants
  .paperfocus/backups/PROJECT_ID/             original source backups
  .paperfocus/local-model/                    shared local-model job/cache records
```

`PAPER_ROOT` is schematic: existing papers may use another registered folder, including the old `.paperfocus/projects/` location. Use paths returned by Aw rather than assembling them from titles. `project.json` paths are relative to the Aw data folder, not the paper repository. Python cells run in their experiment folder; use the explicit `paperRoot` path to read manuscript data rather than assuming `../..` points at the checkout.

Use Markdown cells for hypotheses, observations, failed attempts, prerequisite explanations and short synthesis notes. Use code cells for self-contained calculations with their saved outputs. Conversations retain the reasoning exchange; the experiment notebook holds the concrete evidence. A simulation should have its interpretation beside it, not only in an assistant's final message.

For large datasets, scripts or worker artifacts, an optional `awDataRoot/research/SESSION/` folder can hold `brief.md`, `workers/`, `artifacts/` and `checkpoint.md`. This is an ordinary-file convention, not an automatically ingested store. Add a concise conversation note with the exact path, hash, settings and finding. Promote important results into displayed notebook cells. Export selected reproducible scripts or figures into the manuscript repository only when sharing is intended.

Aw records are outside the manuscript repository, not merely Git-ignored files inside it. GitHub/Overleaf sync transfers normal project files, not notes, model context, comments or compiler caches. Notes need no special Overleaf macros. Do not assume Git backs up Aw data; export a research record deliberately when needed. Previous-file copies are recovery help, not full archives. This workspace is under OneDrive, whose existing sync policy is separate from Aw.

On first access after an upgrade, recognized old paper-local `.paperfocus` records move to the external store without changing source or revisions. Unknown files and Git-tracked originals are retained. Different destination copies or linked assets stop migration without overwriting them. `migration.json` records what moved and what remained. Already-sent shared-folder requests with old return paths need their **Copy prompt** instructions passed again; Aw refreshes the paths without changing the original captured request. Migrated build artifacts remain available, but stale old dependency paths require recompilation before source/PDF navigation or cache reuse.

### Organize cells without losing evidence

Conversations have a small drag handle and a **…** menu with Move up/down, a folder label and File away. Their chosen order persists; selecting or pinning a conversation does not reorder the list. New questions appear at the top. Filed conversations stay in a folded **Filed away → folder** area, where they can be read or restored. Filing never resolves a comment or waiting request, changes experiment ownership, or deletes notes/replies. These folders are catalogue labels, not filesystem directories. Conversation fields `cataloguePosition`, `filed` and `folder` must survive agent updates and concurrent-store merges.

Experiment cells also have drag handles and Move up/down in **Organize cell**, including when the source is collapsed. Moving changes the saved Jupyter cell order, not the code or outputs, and never runs a cell. Keep explicit shared-session execution order distinct from display order. **Organize cell → Folder / topic** assigns a category; the Filed away tab can filter by it. Unfile restores the cell in its retained position.

Cell display preferences live in `metadata.paperfocus`:

- `title` and `folder` give readable names and categories. `folder` is a label, not a directory move.
- `pinned` keeps a result displayed. Pinning does not affect execution, relevance or verification.
- `highlighted` prioritizes a cell for bounded question context.
- `suppressed` collapses its display. Suppressed active cells can still inform prompts; this is not a privacy switch.
- `filed` and `deleted` exclude cells from ordinary active context. The UI retains filed and trashed cells for recovery. Do not physically erase them as routine cleanup.
- `imagesCleared` records explicit removal of embedded PNG outputs, not failed execution or removal of code/text. New app runs clear that flag when adopting new outputs.

For bulky image outputs, **Organize cell → Saved images** shows the PNG count and approximate decoded size for that cell. Remove saved images removes only its embedded `image/png` data from the current `.ipynb`; source, execution identity, plain text, alternative formats and notes remain. Undo is available while that conversation stays open and refuses to overwrite changed run outputs. Filing/suppressing never removes images. Cleanup does not purge run JSON, previous notebook copies, attachments or immutable evidence snapshots, so it is not a whole-project disk cleanup. Export or preserve needed evidence before deliberately cleaning those files separately; never automatically prune an agent's or human's retained evidence.

Avoid a wall of pinned material. Normally pin only the current diagnostic plot or experiment and a short synthesis. The rest stays saved and folded. Do not automatically pin every new worker result or prioritize all cells, which would defeat selection.

### Roll over a full notebook without breaking its history

#### Version work without repeating file-management chores

Use a **phase version** for a substantial change of research direction, a clearly superseded investigation, or notebook storage pressure—not every assistant turn. A phase title such as `Weighted switching — sparse regime v2` makes its purpose clear. Keep earlier successful and failed arguments available; explicitly mark what is established, conjectural, contradicted or still open in the new handoff. Versioning saves context and repeated computation; it does not certify a proof.

For a fixed checkpoint without changing the active conversation, use the existing `evidence --revision REVISION`: its immutable snapshot contains complete **active** cells, not filed/trashed history. For an actual rollover, the new folder-aware `phase` command preserves the **entire** original notebook, including filed/trashed cells, and the original owning conversation record. Do not generate ad hoc archival scripts or rerun experiments to recreate existing evidence.

First inspect the intended owner. `inspect.storage` reports compact JSON characters, disk bytes, both limits and a conservative 80% `phaseSuggested` hint; `inspect.phase` reports any predecessor. A hint is not automatic permission to organize files. Write a short handoff (at most 20,000 characters / 80,000 bytes) containing the current question, useful results, assumptions, exact old cell/output IDs, remaining gaps and next steps. Do not copy all historical code/outputs into it.

```powershell
# Use the confirmed scope and exact revision returned by inspect.
node scripts/awResearch.ts phase --url 'http://127.0.0.1:4173' --workspace 'AW_HOME' --project PROJECT_ID --entry OLD_CONVERSATION_ID --revision REVISION --title 'Next research phase v2' --file 'HANDOFF.md' --folder 'Earlier research'
# After reviewing the read-only plan, with archival organization authorized,
# save browser drafts and repeat exactly the same command plus --commit.
```

The plan returns the old/new identities, paper root, archive folder, fixed backup path and links. The committed operation:

1. Preserves the original notebook bytes and conversation record under the returned `awDataRoot/research/phases/OPERATION_ID/`, alongside a SHA-256 manifest. For a missing notebook, the manifest labels its synthetic empty backup explicitly.
2. Prepares a fresh notebook with pinned `phase-handoff` and `phase-history` cells. No historical code runs or output copies are needed. Notebook metadata records predecessor ownership/revision and backup path.
3. Uses the existing revision-guarded conversation store to file the old entry and add the new one in a single catalogue save. It preserves other entries, the old title/status/replies/source/owner, old notebook bytes, stable cell IDs and run folders. It does not switch manuscripts, navigate the browser, resolve comments or alter source.

Continue using the **returned new entry ID**, not the old owner. An existing live service can handle the command through its current guarded APIs; no service restart is needed for the CLI. Copied assistant instructions now describe this versioning workflow too.

The operation identity is derived from the confirmed scope, old revision, phase title, archive folder and handoff content. After interruption, retry **identical arguments**, including the original revision and same handoff. Identical backup/prepared files are reused; mismatching backups or edited partial notebooks are never overwritten. A completed retry returns the existing phase without replacing its later progress or re-filing an archive the human has restored. Keep the handoff file while recovery might be needed. Reusing a different title/handoff creates a different operation, not a recovery attempt.

There is no multi-file transaction: interruption or a concurrent catalogue edit can leave verified backups and a prepared notebook without a registered new conversation. The original stays active until the guarded catalogue save succeeds. Inspect the returned plan/manifest and prepared notebook before recovery; do not delete them or force a newer revision to bypass a conflict. If the old conversation or notebook changed, reconcile explicitly. Save browser drafts first and keep one coordinated writer; the command cannot see unsaved drafts or lock out a new edit/run that begins after its last check. It refuses an already running owner, shared owners and pending queued/working research. Never cancel another run to enable rollover.

Restore the old conversation through its normal catalogue control to undo filing; retain the new phase and its work unless the human requests a separate organization change. Restoration does not merge notebooks or shrink the old one. For manuscripts, reuse the appropriate notes root, or create a separately named root only with source-writing permission. Phase versioning is not Git, automatic TeX versioning or a substitute for source-change recovery.

Filing/suppressing cells changes catalogue visibility, not notebook bytes. The current validator caps compact JSON at 4,000,000 characters; the disk reader separately refuses files larger than 5,000,000 bytes. A pretty-printed notebook can approach the latter before its compact form reaches the former. Do not merely add filing metadata to an almost-full file and assume that creates room, raise the service limit as routine cleanup, or remove retained output automatically.

Plan rollover **before** the read limit is exceeded. `phase` uses the ordinary validated reader and cannot bypass an already unreadable notebook. Such a file needs explicitly scoped manual recovery with preserved bytes, not repeated failing agent inspections.

When the human authorizes archival organization, a new research phase can use a fresh conversation with its own notebook owner. First preserve a fixed copy of the old `.ipynb` and conversation record, with file hashes and original identities. Leave the old notebook, cell IDs, outputs and run folders unchanged; file its conversation under a descriptive folder and keep its original title, status, replies and ownership. Add the new conversation through the revision-guarded notebook store and save a compact checkpoint, archive link and provenance note in its fresh `.ipynb`. Do not repoint the old conversation to the empty notebook. A filed conversation uses a lazy disclosure: its experiment workspace is not mounted in ordinary active HTML until opened. Deep links can still inspect old evidence. Restore reverses the filing; it does not merge the two notebooks or remove the original size limit.

A focused TeX notes manuscript can accompany this phase when source writing is requested. Preserve the previous parent roots and included files, and link the new exposition to the new evidence cells. Capture an explicit manuscript passage for the new conversation when a reciprocal Passage link is useful; do not fabricate a prior origin. If copying previously executed external code/results into the new notebook, retain full outputs, source/output hashes, timestamps and original budgets, label them imported external evidence and use no invented Aw run IDs. Archival organization never executes Python or resolves human comments. These are existing store/catalogue operations, not automatic archival ingestion or a new storage tier.

### Make evidence useful to later questions

Ordinary experiment context includes at most six active cells, with highlighted cells first, sharing a 6,000-character excerpt budget. In question Options, external handoffs can choose Expanded: up to 24 cells / 18,000 characters. Local study requests still reduce compact evidence to about 1,800 characters; Tiny uses smaller context. The exact full code and outputs remain on disk. Image pixels are not automatically understood through these text excerpts.

Put the measured values, controls, settings, interpretation and open question in a short textual result or adjacent note. Do not rely on a plot alone to tell an assistant what happened. Keep the most useful synthesis cell early or highlighted; identify omitted cells by exact path and ID when a deeper request needs them. Treat a newly saved plot as new evidence requiring interpretation, not as a reason to rerun every experiment.

Questions and Keep thinking flush the mounted experiment editor's draft, then read current disk evidence immediately before submission. This also works with a folded or closed catalogue; there is no global polling of closed conversations. Save conflicts/read failures retain the question and stop submission rather than silently using old context. Expanded excerpts belong to the immutable request, not the conversation's compact cached summary. For folder-aware work, an explicitly permitted exact path supplies full evidence without copying it all into chat.

Output whose `lastRunSource` differs from current code is stale. Shared-session output is also marked stale when earlier executed cells change, are rerun, filed/trashed or removed. The history is conservative, not a variable dependency graph: all prior cells may have influenced later cells, including repeated self-mutating runs. Imported or externally supplied outputs are not independently verified just because they display correctly. Preserve these distinctions in any synthesis.

## Run experiments safely and reproducibly

Aw executes Python code cells one at a time **per notebook**, with a default 30-second timeout; independent notebooks can overlap within the host's bounded concurrency limit above. **Python settings & safety → Run limit** allows an explicit 2- or 5-minute budget for future runs; it resets to 30 seconds when the notebook is reopened. Changing the choice never extends an already running cell. Folder-aware assistants can use `run --timeout-seconds 120` or `300`, only within the human's compute permission. The selected budget and start time are retained with each run. Stop remains available; no code runs merely because a setting changes. Fresh-cell mode is the default: each cell imports its dependencies and defines its inputs. **Execution → Shared session** optionally preserves variables/functions between explicit runs in this notebook, including conversations deliberately sharing that notebook owner. This is a lightweight Python session, not a complete Jupyter kernel.

Shared sessions are limited to three open notebooks and 100 runs each. Variables are cleared on explicit restart, a failed/stopped run, a protocol/output failure, server shutdown or 15 minutes idle. Browser reload does not clear server variables, but execution permission resets and the UI defaults to fresh cells. Saved outputs survive; variables do not survive server restart. Nothing automatically reruns to recreate them. Restart and explicitly replay setup cells in order before claiming reproducibility; run records include session ID, sequence and preceding cell/run IDs. A failed run discards partially mutated state, not its recorded failure. Switching back to fresh cells leaves an existing session idle until restart or expiry. These limits bound normal use, not memory allocation or hostile code.

Use a smaller experiment or authorized external execution for work that cannot fit the five-minute/output budget; do not quietly raise limits or start a large parameter sweep. Numerical-library threads, concurrent runs and output sizes remain bounded as before. These are normal-use limits, not child-process containment or a hard memory quota.

An already-running older Aw service needs a one-time restart to use newly added budgets. The app and agent client check support before asking for a longer run, rather than silently running it with the old limit. Do not interrupt the user's live workspace to deploy an update while they are editing or running experiments.

Execution permission must be explicit. The human can review **Python settings & safety** and run a trusted cell. If the user's current request explicitly authorizes Codex to run experiments, Codex may use that authority for the stated, bounded code; it must not infer permission for arbitrary imported code or unrelated computation. Importing, opening, pinning and external notebook edits never execute code automatically.

The runner's isolated Python startup and limits are not a security sandbox. Code has normal user-level filesystem and network capabilities. Do not run untrusted code, credential access, downloads or destructive operations merely because they are inside a notebook. Missing dependencies should be reported, not installed without permission.

### Explicitly authorized project-local scientific packages

Aw's shared scientific overlay is `AW_HOME/.paperfocus/python-packages/`, outside manuscript checkouts. The human-authorized installation includes NumPy/Pandas, SciPy, Matplotlib, SymPy/mpmath, NetworkX, scikit-learn, statsmodels, CVXPY and its CPU solvers, POT for optimal transport, nbformat and psutil. Fresh offline and updated live runners explicitly add this validated directory before imports; `-I` remains enabled, and `.pth` startup files are not executed. There is no automatic installation or upgrade. `scripts/research-requirements.txt` lists the requested tools; `.paperfocus/python-packages.installed.txt` records this installation's exact distribution versions. Run provenance records the actual interpreter and loaded scientific distribution versions. Package versions are not a complete environment snapshot or a claim of numerical correctness.

An older running service must be restarted once at a safe time to use the overlay; offline runs need no restart. Use the same `AW_PYTHON_CONCURRENCY=1..4` across processes (default two). Updated live and offline runners share per-owner and per-host active-run locks. Reported live capacity lists only that service's in-memory jobs; an unseen CLI run can still occupy a slot. A rejected run is never queued. Crash locks require explicit inspection/recovery, not automatic expiry. Shared-session variables remain service-only and are not accessible to offline Python. Normal imported code has user-level access: this overlay is not a security sandbox.

When the human authorizes adding a scientific dependency, a project-local package folder can avoid altering Codex's bundled Python or another project's environment. Use the returned `awDataRoot` plus `python-packages/`, record the package/version and installation scope, and verify its import and the needed numerical operation in a fresh owning-notebook cell. Prefer a compatible binary wheel; do not silently upgrade existing NumPy or install unrelated dependencies. If an installer moves files from a protected temporary folder on Windows, inspect permissions before a repair; restore normal inherited permissions only within the newly installed package folder, not elsewhere in the workspace.

Additional per-project packages are **not automatically importable**, and `PYTHONPATH` does not enable them with `-I`. For the ordinary Aw fresh-cell working directory (the returned `experiments/NOTEBOOK_ID/` folder), an explicitly trusted setup is:

```python
import sys
from pathlib import Path
packages = Path.cwd().parents[1] / "python-packages"
if not packages.is_dir():
    raise RuntimeError("Project-local scientific packages have not been installed")
sys.path.insert(0, str(packages))
import scipy
```

Include this setup only for separately authorized per-project packages, not the shared overlay. A deliberate shared session can execute it once and record replay order. Outside the normal runner directory, use the exact returned `awDataRoot`, not this relative expression. The stock `preflight` probe inspects the configured interpreter without this cell bootstrap, so it can report a separately installed per-project package unavailable: the saved project-scoped import/solver check is separate evidence. Do not upgrade packages during occupied runs/sessions; save results and explicitly restart sessions after an authorized installation.

Record seed, parameters, tolerances, algorithm version and runtime/library versions when relevant. An app run retains its executed source and outputs in `runs/RUN_ID.json`. Keep that run ID with the interpretation. Never make up a run count, timestamp or `lastRunSource` to make a candidate cell appear tested. If results came from external execution, label that origin explicitly.

### Display useful outputs

The in-app runner supplies `display_table(rows)`, `display_plot(title, series, x_label, y_label)` and `display_data(mime_dictionary)`. Text, JSON tables, the app's numeric plot format and PNG figures render in the notebook. Numeric plots offer series toggles, click/keyboard point inspection and x-range zoom under **Inspect / zoom**. These controls change the view only: no rerun, source edit or saved-data mutation. Zoom fits retained samples, not an interpolation beyond them. Matplotlib figures are saved as PNGs if code imports pyplot; PNGs remain static. HTML, JavaScript and arbitrary widgets are not executed; unsupported rich output stays saved and should have a plain-text fallback.

These display helpers are app-specific. Ordinary Jupyter does not define them: supply deliberate equivalents there or use standard Jupyter displays. Aw can import and export nbformat-4 Python notebooks, but it is not a complete Jupyter frontend.

### Saved parameter views and complete evidence

`display_sweep(title, parameter, frames, x_label, y_label, x_scale="linear", y_scale="linear", initial=0)` adds a small parameter slider above a saved numeric plot. Each frame is `{"value": number, "series": [{"name": text, "points": [[x,y], ...]}]}`. Use 2–41 strictly increasing parameter values, matching series names and axes, at most 8 series / 2,000 points per series and 40,000 total points. Log axes require positive data. Compute the frames once during an explicit run; moving the slider selects saved data without Python calls. Axes remain fixed across frames; explicit zoom fits the selected frame's retained samples. Point inspection returns exact values. Selecting another frame resets point/zoom state so it cannot mislabel previous values. There are no arbitrary callbacks, embedded JavaScript or automatic reruns. A text fallback summarizes every frame for ordinary Jupyter and text-only assistants; `cell` returns the full numerical evidence, not just the displayed frame.

For example, after forming `frames` during a bounded simulation:

```python
display_sweep("Step-size controls", "alpha", frames,
              x_label="step", y_label="error", y_scale="log")
```

External question **Options → Complete experiment evidence → Save evidence files** flushes the owning editor's pending draft, reads current disk evidence, and saves a fixed `.ipynb` copy plus a complete textual Markdown companion in the paper's experiment folder. Download either file or **Copy file paths** for a folder-aware assistant. All active code, notes, outputs, stable IDs and metadata are retained, including suppressed displays; filed/trashed cells are omitted. The notebook retains PNG/rich outputs; the text companion includes all textual and numeric data without excerpt clipping, identifies rich outputs, and does not execute them. Older run-record files are not bundled. Metadata identifies the paper, conversation, owner, source revision and stale/failed evidence status; a manifest records file hashes. Oversized evidence fails visibly rather than being shortened. Unchanged retries reuse the snapshot; altered saved files are refused, not overwritten. This is derived data, not mathematical verification or a notebook edit.

Check before sharing, especially during a statement-only attempt, then attach manually in your other client. Nothing uploads automatically. These files are not bound to an earlier prompt and do not update after later edits; prepare another copy if experiments change. Snapshot links can be prepared again after reopening the conversation. Compact/expanded prompts and local-model contexts remain bounded. Folder-aware assistants can use scoped `inspect` and complete `cell` reads for current evidence, or `evidence --revision REVISION` for a fixed copy. The ordinary Export button still exports the whole notebook, including filed/trash records, for backup. Snapshots stay on disk; Aw does not automatically prune them.

`display_heatmap(title, x, y, values, x_label="x", y_label="y", color_scale="linear")` displays a saved two-parameter sample grid. Supply 1–60 finite, strictly increasing numbers per axis and a finite `len(y)`-by-`len(x)` matrix; log color requires strictly positive values. Click a tile, use arrow keys, or open **Select exact sample** to inspect an exact value or the minimum/maximum. Tiles have equal display size even for nonuniform numeric samples: this is a sample catalogue, not a continuous interpolated surface. Colors use the saved range. No selection runs Python or edits evidence. Full numeric data and a text fallback remain in the cell; compact context summarizes the range and both extrema. Large tables are folded under **Saved table** to keep figures accessible. HTML, arbitrary callbacks and executable widgets stay disabled.

This small example checks an affine contraction's residual relation. It uses only standard Python and the supplied display helpers. It is a workflow example, not a new theorem or universal numerical proof.

<!-- aw-example: affine-control -->
```python
import math
import platform

rows, curves = [], []
for a in (0.2, 0.8, 0.98):
    b, x = 1.0, 0.0
    fixed = b / (1.0 - a)
    points = []
    for k in range(26):
        error = abs(x - fixed)
        residual = abs(a * x + b - x)
        assert math.isclose(residual, (1.0 - a) * error,
                            rel_tol=1e-9, abs_tol=1e-12)
        points.append([k, error])
        x = a * x + b
    rows.append({"a": a, "initial_error": points[0][1],
                 "error_at_25": points[-1][1],
                 "error_per_unit_residual": 1.0 / (1.0 - a)})
    curves.append({"name": f"a={a}", "points": points})

assert (1.0 * 3.0 + 1.0) != 3.0  # a=1, b=1 has no fixed point
display_table(rows)
display_plot("Affine control: error over iterations", curves,
             x_label="iteration", y_label="absolute error")
print(f"Python {platform.python_version()}; deterministic inputs; controls passed.")
print("The residual/error relation needs its algebraic argument; examples are not proof.")
```

An adjacent note should derive `T(x)-x = (a-1)(x-x_*)`, identify `a != 1`, explain why a small residual can be misleading when `a` is near one, and propose the next genuinely unresolved question. The notebook records the calculation and reasoning together.

## Write into Aw without fighting the human

### Server-independent saved records

### Server-independent records and Python

`node scripts/awResearch.ts inspect --offline --workspace AW_HOME --project ID --entry CONVERSATION_ID` checks the saved project, owner and root policy directly. Use the same explicit flag on discover/bind/cell/output/inputs/manifest/put/batch/organize/finish and authorized run/job commands. Normal revision, cell-source and task-ticket options remain unchanged. A binding stores identity, not transport, so add `--offline` with `--scope` too. There is no network probe, listener or automatic fallback. Reads/saves never execute code. The workspace must have a valid Active Writing package identity and registered project; malformed/missing registries do not silently select the demo. Returned paths still identify external project-data records. Existing storage migration/validation rules apply.

The shortest experiment loop, after confirming ownership and the human's compute permission:

```powershell
# Save trusted source into the existing owning notebook; use its returned revision.
node scripts/awResearch.ts put --offline --scope SCOPE.json --cell control --kind code --file control.py --revision REV
# Run in fresh Python, wait for collection, and use the new returned revision.
node scripts/awResearch.ts run --offline --scope SCOPE.json --cell control --revision SAVED_REV --allow-python
node scripts/awResearch.ts cell --offline --scope SCOPE.json --cell control
```

Keep source/bindings in the returned Aw data research folder, not the paper checkout. Existing cells omit `--kind` or retain their kind. Runs default to 30 seconds; choose `--timeout-seconds 120|300` deliberately within permission. No variables survive between offline runs. Declared inputs are hashed before/after as with live runs. Source, outputs, errors, timestamps, budget, transport and actual runtime are saved in immutable `runs/RUN_ID.json`; ordinary outputs attach to the existing cell, preserving concurrent source/catalogue edits. A changed source is marked stale; a removed cell is never resurrected. `notebookUpdated:false` means read the returned run record, not assume a visible notebook cell. A save conflict preserves the run record when possible and reports failure; reconcile, do not rerun merely to import results. A failed CLI run prints its JSON record and exits nonzero. The CLI must remain running until collection completes; forced termination can leave a lock/child process requiring inspection.

`job --offline --job ID` reads saved completion only, even from a later process; it never reruns code. `--wait-seconds` and `--session` are rejected offline. To continue other work during a longer run, use the terminal tool's background session and poll that same process, or deliberately use the live service; never start the cell again. Read complete outputs before scientific conclusions, then save a short linked summary and use ordinary `finish` for a real saved ticket.

These are the same Aw notebooks and conversations, not a separate offline cache. Updated live windows see disk changes through normal polling/reopening; no manual import is needed for successful offline saves. `finish` validates the real saved ticket and Markdown summary, preserves closed/already-answered human decisions, and offers Return when the app next observes completion. Completion during a closed session remains available in the saved conversation/queue; it does not guarantee a transient notification replay or force navigation.

Offline inspect advertises fresh-run support and the optional shared package folder, but does not spawn Python, check its interpreter or promise an available slot. Locks check actual capacity when running. Session/restart/preflight, evidence snapshots and phase rollover are refused rather than emulated. Live model work, compilation and guarded manuscript/version operations are not part of this offline adapter. No new execution provenance is created from imported or previously saved outputs. Each new run also writes an immutable collection receipt beside its execution record; a later process can distinguish a failed notebook save from a successful computation.

Notebook and experiment-store writers now share cross-process `.aw-lock` files, bounded waits, atomic replacement and revision checks. Before concurrent offline and online writes, an older service must be safely restarted once to adopt these locks; do not interrupt someone else's runs or drafts. Offline-only work needs no server. Locks are never expired/stolen automatically: after a writer crash, inspect the recorded PID/time and recover only that exact lock with explicit authority. Arbitrary external JSON writers and distributed/network filesystems do not share this coordination. Keep one coordinated notebook writer; preserve unsaved browser drafts and reconcile conflicts instead of retrying with a newer revision. Multi-store completion retains its existing revision checks, not a filesystem-wide transaction.

Prefer the running app's revision-guarded stores. These loopback endpoints are local app operations, not paid model APIs:

- `GET /api/paperfocus/notebook?projectId=...` returns `{version, revision, entries}`. `POST /api/paperfocus/notebook` takes `{projectId, revision, entries}`. Preserve every unmodified entry and its unknown fields; update only the intended conversation. Use the returned revision on the next write.
- `GET /api/paperfocus/experiments?projectId=...&notebookId=...` returns `{notebook, revision, path, runtime}`. `POST /api/paperfocus/experiments` takes `{projectId, notebookId, revision, notebook}`. Its revision is a hash of file bytes, not the numeric conversation-store revision. An absent experiment file has revision `""`.
- After execution is authorized, `POST /api/paperfocus/experiments/run` takes `{projectId, notebookId, cellId, revision, acknowledgeLocalExecution:true}`. Save first and use that exact revision. Poll `GET /api/paperfocus/experiments/job?projectId=...&notebookId=...&id=...`; cancellation uses `POST /api/paperfocus/experiments/cancel` with `{projectId, notebookId, id}`.

For script-driven experiment POST requests, include `Origin: http://127.0.0.1:4173` and `Content-Type: application/json`, matching the actual loopback host. This satisfies the app's same-origin check; it is not an authentication token or permission to execute. Check HTTP status before treating a save or run as successful.

`GET /api/paperfocus/workspace-folders?projectId=...` returns Aw home, the paper repository, its external `data` folder (paths and file URLs), and the guide path. Opening a folder is an explicit same-origin `POST /api/paperfocus/workspace-folders/open` with `{projectId, target:"paper"}`, `{projectId, target:"data"}` or `{target:"home"}`. Only these known folders are accepted, not arbitrary paths. File Explorer opening is Windows-only; copying paths works independently.

If writing through filesystem helpers from the app root, use `readNotebook` / `writeNotebook` in `server/notebookStore.ts`, or `readExperiments` / `writeExperiments` in `server/experiments.ts`. They apply validation and guarded persistence. A `409` or revision conflict means reread and reconcile the intended fields, not retry with an invented revision or overwrite the current file. A concurrent direct-file writer can still race a store writer; the safest rule is one coordinated writer per store.

Direct `.ipynb` editing is supported when necessary. Preserve existing cell IDs, metadata, catalogue flags and outputs; create unique IDs for new cells. Validate with `validateExperimentNotebook` in `src/experiments.ts`, stage a UTF-8 file beside its destination, recheck the original bytes, then atomically replace it. Do not use junctions or symlinks, and do not delete the old file as a replacement fallback. Same-field conflicts require reconciliation; an atomic rename alone does not merge competing edits.

A minimal valid experiment notebook is below. In normal use, append its cells to the latest notebook rather than replacing existing work. This example has no executed result.

<!-- aw-example: minimal-notebook -->
```json
{
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {"language_info": {"name": "python"}},
  "cells": [
    {
      "id": "control-note",
      "cell_type": "markdown",
      "metadata": {"paperfocus": {"title": "Control interpretation", "folder": "controls"}},
      "source": "Target and assumptions go here. This cell is a working note, not a verification badge."
    },
    {
      "id": "control-code",
      "cell_type": "code",
      "metadata": {"paperfocus": {"title": "Small control", "folder": "controls"}},
      "source": "print('Candidate cell; execute only with explicit permission.')",
      "execution_count": null,
      "outputs": []
    }
  ]
}
```

Current limits include 200 cells, about 4 MB of validated notebook JSON, 100,000 characters per cell, and 30 saved outputs per cell. The Python runner separately bounds its rich displays and output size. Compact plot data supports at most eight series and 2,000 finite points per series. Keep summaries small; save large raw data separately and state exactly how to reproduce the displayed result.

## Complete notebook work; keep legacy handoffs compatible

Use the app to prepare the request, so it captures the conversation, task and source identity. Read its `prompt.md` and `request.json`; do not invent a new task ID or recompute a hash from a subsequently edited prompt. Follow the narrower request permissions. Project context and earlier conversation are useful, but access to the same folder is not permission to read every file or modify the manuscript.

For new folder-aware research requests with `ticket.notebookTarget`, **write the notebook directly and use `finish`**, as above. Save a concise Markdown summary cell alongside the derivation and experiments; there is no response-file requirement. Finishing copies only that summary into the owning conversation and records the exact cell/revision. If the human already answered or closed the request, preserve that decision and leave new evidence in cells for a follow-up. Aw does not infer completion from file edits alone.

The protocol below is **only for older requests without a notebook target, or review/rephrase tasks whose saved instructions require a response file**. Return UTF-8 JSON to the ticket's `responsePath` in this shape. Copy `taskId` from `request.ticket.id` and `requestHash` from `request.ticket.requestHash`:

<!-- aw-example: response-envelope -->
```json
{
  "version": 1,
  "taskId": "COPY_THE_TICKET_ID",
  "requestHash": "COPY_THE_TICKET_REQUEST_HASH",
  "complete": true,
  "reply": "A task-specific Markdown answer, or the requested structured answer encoded as a JSON string."
}
```

Write to a temporary file in that same request folder, validate the complete JSON, then rename it to `response.json` once the answer is final. Do not publish a half-written envelope. If a finalized response already exists, preserve it and use a new app request for a revised answer. The app checks task identity and hash, retains the exact reply, and offers Return when it detects completion. A model's final chat message alone is not the response-file signal.

For the collapsible research answer, the inner reply can be the following object serialized with `JSON.stringify`. Do not place an object directly in the envelope's `reply` field. Escape LaTeX backslashes correctly when serializing JSON.

Serialize twice: `inner = JSON.stringify(answer)` and then `JSON.stringify({version: 1, taskId, requestHash, complete: true, reply: inner})`. Do not hand-escape a nested JSON string. Check `parseStudyAnswer(inner)` before publishing a structured answer. Wrap mathematical expressions in `$...$` or `\[...\]`; bare TeX commands in prose are intentionally not guessed into mathematics. An unrecognized reply remains readable as text rather than being silently repaired. The harness trial retained an initially malformed inner answer in its finalized response file, then tested a correctly serialized manual correction; the app saved the corrected outline without altering source or overwriting the original file.

<!-- aw-example: study-answer -->
```json
{
  "idea": "The useful mechanism and the target it addresses.",
  "background": "Only the prerequisites needed for this question.",
  "argument": "The derivation, or the exact step still requiring justification.",
  "checks": "Assumptions used, controls or counterexamples, and the next useful check.",
  "references": []
}
```

Empty fields are appropriate for hints. Add references only when useful; each object needs `title`, `why`, `locator`, `citationKey` and `url`, with empty strings for unknown metadata. A supplied bibliography record is not proof that its theorem was read. Cite inspected primary sources precisely and label uninspected suggestions as reading leads.

For review tasks, follow their generated `REVIEW_INSTRUCTIONS.txt` and comments schema instead of the research-answer schema. Preserve exact source anchors. Assistant comments stay unresolved. Do not mix a review response with a notebook experiment response just because they concern the same paragraph.

For **Any web chat**, the user copies the prompt, works elsewhere, and uses the client's Copy button to paste a reply into the matching Aw task. Ordinary Markdown, fenced code, tables and math are retained. Pasting is optional: the human may finish without importing an already satisfactory answer. Aw cannot detect that external client's completion, and should not claim it can. Use the same small-context continuation or fuller-briefing choice for any provider.

## Recover a known theorem without confusing learning and retrieval

Choose a precise theorem statement from a versioned paper, including assumptions and notation. Keep the published proof and comparison notes out of the initial attempt. In statement-only mode, do not browse for the theorem, identify the paper or open a proof-bearing project file. A worker's input restrictions must match the coordinator's. The mode is a prompt boundary, not a guarantee against prior model knowledge.

Use **Small hint** or **Proof outline** to protect the human's opportunity to reason. Save the attempt before comparing it with the reference. Aw's benchmark transition retains a checkpoint of the first pre-comparison attempt. Only then inspect the published proof, record its exact theorem/page/version, and classify genuine gaps, missing assumptions and alternate valid proofs. Do not treat a different proof as wrong merely because it differs from the paper.

Keep “recovered with hints,” “reconstructed independently,” “borrowed from the reference,” and “still incomplete” distinct in notes. Any novelty claim needs a separate literature check; recovering a known result is a workflow sanity check, not evidence of new research.

## Checkpoint and resume

At a natural stopping point, leave a short note with the target version, useful deduction, open gap, exact experiment cells and run IDs, pending request paths, and next action. State whether a run finished or merely started. Never restart an experiment just because the browser or server restarted; inspect saved outputs and run records first.

On resume, verify the project and source revision, read the current conversation, inspect newly changed cells, and reconcile any conflicts. Keep the published-proof boundary if the attempt is still blind. Reuse existing external chat history where appropriate, sending only the changed context and current question. A new assistant needs a briefing; a continuing assistant usually does not need the whole paper again.

## Judge whether the harness helped

For a trial, measure both research quality and human friction. The assistant records this; it is not another routine form for the human.

- Did a result change the next proof step or research question? Were assumptions, failed checks and actual gaps preserved?
- Did the human learn the missing idea without receiving more of the solution than requested?
- Were simulation settings and controls reproducible? Did stale or imported output stay distinguishable from a fresh run?
- Could the human work elsewhere while waiting and return with one action, without losing notes or being pulled away?
- Did the returned answer and experiment appear in the correct conversation? Did the important evidence reach the next prompt?
- Did the writing pass preserve the mathematical claim and compile in the ordinary full manuscript? Were comments left for human resolution?

Use one or two small trials before a larger study. Do not rerun expensive models to test storage, and do not describe a self-piloted trial as an independent usability study. A useful report gives the concrete finding, artifact path and next repair, rather than a blanket “everything works.”

## Implementation references

When this guide disagrees with the code, check the current implementation and update the guide rather than inventing a missing feature:

- `src/types.ts`, `src/notebook.ts`, `src/study.ts`: conversation fields, captured source, help levels, benchmark checkpoints and structured answers.
- `src/experiments.ts`, `src/experimentContext.ts`, `src/experimentActions.ts`: notebook validation, catalogue flags, merge rules, display selection, cell arrangement and bounded context.
- `server/notebookStore.ts`, `server/experiments.ts`, `server/experiment_runner.py`: guarded persistence, trusted execution and run records.
- `server/handoffs.ts`, `server/researchFinish.ts`, `src/handoffs.ts`: request identity, direct-notebook completion, legacy final-response detection and imports.
- `scripts/awResearch.ts`, `src/researchInstructions.ts`: scoped agent commands and copied brief instructions.
- `server/latexPlugin.ts`: current local endpoint routes and request bodies.
- `src/components/ResearchNotebook.tsx`, `src/components/ExperimentWorkspace.tsx`: displayed ownership, polling, safety controls and rendering.
- `src/review.ts`, `server/reviewExport.ts`: comment anchors and manual resolution rules.

`problem-lab/` remains a separate exploration prototype with its own data store. Linking to it does not synchronize approaches, experiments or comments. Export/import deliberately if a specific task needs to bridge the two.

Validate schema examples with `npm run test:workflow`. For app changes, use the relevant existing tests, type checking and build. Documentation checks are not a substitute for a human click-through or an actual research trial.

The isolated agent-harness trial is `.paperfocus/trials/agent-harness-20261006`. Its two-dimensional quadratic study runs one bounded NumPy cell, preserving a run record, a log-scale plot, a table, rendered mathematical commentary and a separate analytic proof checkpoint. The out-of-range step grows while two stable steps contract; a small gradient in the slow direction still has distance one. A stale cell write is rejected without losing results. This is a self-piloted harness check, not a new theorem, independent usability study or formal verification. New helper/plot/instruction checks run in `npm run test:workflow`; use the full regression suite and build for implementation changes.
