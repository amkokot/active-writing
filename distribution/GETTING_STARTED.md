# A first session

Start with the welcome project. It is safe to edit. Its manuscript is split into
ordinary TeX files so you can see how a small project fits together.

## Write and navigate

Choose **Rendered text** in the Preview menu if TeX is not installed. The reading
preview is approximate; **Compile** makes the real LaTeX PDF when a compiler is
available. The source is editable in either view. Double Enter starts a paragraph;
a single Enter is an ordinary TeX line break in the source.

The scope selector offers **All sections**, **This section** and **Block window**.
The small expand icon beside it leaves focus. Drag the middle divider to resize
the panes. **Show in preview** follows the active source passage; double-click a
rendered passage or a mapped PDF location to return to source. Proofs view keeps
statements and proofs, including a referenced appendix proof brought forward for
editing at its original location. Exact typesetting still needs a full compile.

Click a passage to reveal its small tools. Try a comment, a saved highlight, a
rephrase request, or a question. Quick rephrase suggestions need no model; a local
model is optional. Suggestions are saved, not silently applied. Comments remain
in **Next ▾**, the priority queue, until explicitly resolved. You can reorder the
queue and choose this project or all projects.

Closing without saving discards a new comment or leaves an existing comment
unchanged. Replies stay inside their thread. The document title is editable at
the top of All sections, with its own comment button.

For Beamer projects, the Slides menu keeps the current deck easy to find.
Fast slide editing in the Compile menu uses one pass; Compile full paper settles
cross-references before sharing. A separate backup deck is an ordinary TeX file,
not something Aw removes from a presentation automatically.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **Ctrl+M** | Comment on highlighted source text or the active block. In a title/heading field, comment on its selection or whole command. |
| **Ctrl+Enter** | Save a comment or reply; save the command when editing a title or heading. |
| **Shift+Up / Left** | Previous comment from the reply field or focused comment panel. |
| **Shift+Down / Right** | Next comment from the reply field or focused comment panel. Unsent reply text is retained. |
| **Ctrl+K** | Search the manuscript's table of contents. |
| **Ctrl+A** | Select the source currently visible in the editor. |
| **Ctrl+Shift+A** | Select the active source block. |
| **Ctrl+scroll / pinch** | Zoom the source or preview pane under the pointer. Each pane keeps its own zoom. |

Other text fields keep their normal selection shortcuts. Shift+arrow in ordinary
source text selects text; it does not navigate comments. Click a comment button
to see its shortcut in the tooltip.

## Keep a question and its evidence together

Open **Notebook**. Conversations fold up; pin an experiment or summary you want
to keep visible. You can edit Markdown notes, reorder cells, hide/file older work,
or export/import a Jupyter notebook. Deleting a card is not the same as erasing
all historical evidence. Use a cell's **Links** to return to its manuscript passage.

The welcome notebook contains a geometric-series experiment. Its output starts
empty. Read the code before pressing Run; it uses only Python's standard library
and Aw's display helpers. The saved table and plot show partial sums, not a proof.
The source's appendix supplies the proof separately. No Python installation is
needed just to read or edit the notes.

For an external assistant, use **Copy to chat** or **Shared folder**. Copy the
prompt, then continue with the next queued task while you wait. A web-chat answer
can be pasted back with math/Markdown, or marked done without saving a reply.
A folder-aware agent can update the owning notebook through the guarded tools.
Answer arrival offers a return button; it does not move your current workspace.
Aw does not automate a signed-in web chat or use paid model APIs.

## Start your own work

Use the folder icon for **New / open project**, files, imports and repository
settings. Use the manuscript menu for a new independent TeX root or version
within that project. New work defaults to **Research notes**. **Overview** is a
short collaborator-facing explanation; **Publication draft** enables incremental
human review and locked wording. The agent's instructions must still authorize
the actual edits or experiments.

For Overleaf, keep a normal paper repository and use Aw's explicit Git workflow
or source ZIP. Overleaf's Git/GitHub availability depends on your Overleaf plan.
The walkthrough's `.tex` files require no Aw package or special compiler macro.
Notebook and app records live outside the paper checkout under `.paperfocus/`.

Optional setup: Python is needed to run cells; NumPy/SciPy/Matplotlib and related
libraries are listed in `scripts/research-requirements.txt`. PDF compilation needs
a TeX installation. Ollama and model weights are separate downloads. Nothing
automatically installs these or sends your manuscript elsewhere.

## Add capabilities later

Use only what you need; [MODULES.md](MODULES.md) is the setup map. Two-computer
tools are off in a new workspace. **Workspace folders → Optional tools** shows
them without pairing a machine or installing any watcher. A local-only workflow
requires no SSH account, remote server or maintenance model.

For a reading package, pin its short Overview and current Research notes from
the manuscript menu. Versions retain their own linked notebook; guarded notebook
transfer can copy or move selected entries between existing versions. Comments
and replies stay anchored, and the queue can return to the relevant passage or
notebook entry. No response automatically approves publication wording.

The notebook can display linked scatter plots, exact rows, uncertainty bands,
matrix grids, parameter frames, 2D/3D trajectories and saved animations. Ask an
agent to read `RESEARCH_VISUALS.md` when these would help explain results. Use
saved evidence during exploration instead of rerunning it for presentation.
