# Active Writing

A local LaTeX editor with a research notebook beside it. Work through a section,
keep comments and questions in a queue, and save experiments close to the text
they explain. Ordinary `.tex` files stay usable in Overleaf and other editors.

This is an early, Windows-first release. Back up work you care about. The included
walkthrough is a disposable example, not a research project.

## Install

**Using Codex or Claude Code?** Point it at this repository and say:

> Set up Active Writing for me. Read AGENTS.md and docs/ASSISTANT_SETUP.md, ask
> which optional features I want, and install and verify only those choices.

The assistant can handle setup without an interactive terminal. Claude's
`CLAUDE.md` points to the same instructions. A chat without terminal/folder access
can guide setup but cannot carry out the installation.

Download this repository with **Code → Download ZIP**, extract it into a permanent
folder, and install [Node.js 24 or newer](https://nodejs.org/en/download) if needed. On Windows, double-click
**Set up Aw.cmd**. It checks the files, asks before installing the locked npm
dependencies, builds Aw and offers a desktop shortcut. Use **Start Aw.cmd** or the
shortcut afterward; it starts the local service for you.

On macOS/Linux, run `node scripts/portableSetup.mjs`, then
`node scripts/desktopServer.mjs` and open <http://127.0.0.1:4173/>.
Those platforms have not had the same desktop testing as Windows.
On Windows, avoid an excessively deep installation folder; some external TeX
tools still have path-length limits.

The editor and rendered-text preview work without Python, TeX or a model. For the
optional features, install your own Python interpreter, TeX distribution and/or
Ollama model. Aw does not buy credits, send questions to a cloud model, or download
model weights during setup. See [the walkthrough](docs/GETTING_STARTED.md).

## Choose what to add

One computer is enough. Editing, comments, the priority queue, notebook and offline
agent tools are included in the normal setup. Python experiments, a local helper,
two-computer sync, the online reader and automated maintenance are optional;
none is installed or activated as a background service by setup.

Two-computer controls are hidden in a fresh workspace. Show them from
**Workspace folders → Optional tools** if needed. The
[module guide](docs/MODULES.md) lists the requirements and entry points. Optional
code ships in this repository, so it is available later without rebuilding your
workflow; there are no separate plugin packages to manage.

## Try it

The welcome project covers focused editing, comments, references, an appendix
proof, the notebook, and a small Python experiment. Nothing runs on its own.
Use the folder button to create a separate project when you are ready.

For assistants, start with [AGENTS.md](AGENTS.md) and
[the agent guide](docs/AGENT_GUIDE.md). The guarded notebook tools work offline;
`node scripts/awResearch.ts --help` is the short entry point. Prompts can also be
copied to any chat and answers pasted back when useful.

Research notes can be written freely within your instructions. Publication drafts
use small proposals, human review and wording locks. The
[writing guide](docs/PRESENTATION_REVISION_NOTES.md) explains the intended style.
The current toolset also includes pinned Overview/Research notes documents,
version-linked notebooks, grouped comment replies, incremental writing proposals,
linked interactive plots, saved parameter frames and 2D/3D geometry. Authors can
keep ordinary source, use a focused window, or compile the real LaTeX PDF. A
research-directory project's Show / hide choice applies to its PDF and sharing
exports without removing its master source.

## Keep your work private

Your projects, notebooks, replies and builds are local. `.paperfocus/`, `papers/`,
build outputs and credentials are ignored by Git. Keep your own paper repositories
separate from this app repository. Do not force-add private files to this public
repo. Python cells have normal file/network access: run only code you trust.

For sharing, start with a PDF or source ZIP from Aw's menus. A protected online
reader is a separate optional deployment, not public GitHub Pages; see
[sharing](docs/ONLINE_SHARING.md). Never expose the editor's port to the internet.

## Updating and development

Save browser drafts and back up project data before updating. Keep a modified
welcome project somewhere else before replacing app files. Do not overwrite a
live data folder or restart experiments to update the UI.

`npm ci` installs dependencies; `npm run build` checks types and builds the app.
For a small change, use `npm run check -- --test server/FEATURE.test.ts --match
'regression'` with an actual test filename/name. `npm run check:full` is for a
release or broad investigation (some tests need Python and scientific libraries).
Developers can use `npm run dev`; everyday use should use
the built app. App code and research-data folders can be separate.

MIT licensed. Dependencies retain their own licenses. This repository contains
app code and synthetic examples, not accounts, personal assistant settings,
research records or a bundled subscription.
