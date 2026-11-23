# Changes

## 0.2.0 preview 5

- Comments can open beside both source and preview. Turn off **Keep preview
  beside comments** in Advanced settings to use the previous layout.
- Opening a comment no longer performs source checks for actions that aren't
  available until it is saved. Focusing the comment field preserves scroll.
- Typing in long, heavily commented manuscripts does less work: source checks
  index only relevant excerpt text, and block controls coalesce layout measures.
  Exact-quote, duplicate-source and conflict safeguards remain in place.
- Large PDFs paint one page at a time while yielding to scrolling. Nearby text
  stays selectable; cached pages retain their image without unnecessary text
  layers. Selected text and source/PDF navigation remain available.
- Ctrl+Enter compiles from the editor, including saving title and heading edits.
  In comments and replies it saves instead; notebook shortcuts keep their role.
- Jump to commented text remains available after edits, returning near the old
  block when an exact match is gone. Approximate jumps never authorize edits.
- Paired-machine sync reuses verified immutable local blobs rather than asking
  for them again. Corrupt cache entries and genuine conflicts still stop safely.

## 0.2.0 preview 4

- Updated instructions for Codex and Claude: merge guidance with the user's
  existing instructions and preferences, preserve saved work, and enable only
  the optional features they request. Added a separate update guide.
- Comments now require an explicit save. Closing without saving discards a new
  comment or leaves the saved version unchanged. Replies stay in their thread
  without moving your place in the queue.
- Ctrl+M comments on a highlighted range or the active block. Ctrl+Enter saves
  comments and replies; Shift+arrow moves between comments while replying.
- Document titles can be edited and commented on in the standard source view,
  including titles declared in an included preamble file.
- Personal notes and slide decks have separate document menus. Fast slide
  editing uses a one-pass full-deck compile; settled compilation remains available.
- Notebook folders and designated current writeups make larger collections
  easier to browse. An optional paired-machine inbox transfers selected files
  with receipts when two-computer tools have been configured.
- Improved large-PDF scrolling and retained the existing compilation cache and
  source/PDF navigation. Source edits remain ordinary, shareable LaTeX.
- The basic editor and notebook remain independent of optional model, Python,
  two-computer sync, online sharing and maintenance setup.
- Missing notebook run provenance is reported as a held import regardless of
  folder names; reading sync still never runs transferred code.

## 0.2.0 preview 3

- Fresh workspaces open in rendered text, so basic setup does not attempt TeX
  compilation. Saved PDF/reading choices still take precedence when reopening.

- A fresh basic-install trial worked without Python, TeX, models, GitHub CLI or
  SSH on the application's PATH. No optional service was installed or started.
- Updated the locked Vite build tool to the compatible 6.4.6 patch after the
  trial's dependency audit reported advisories in the previous build-tool version.

## 0.2.0 preview 2

- Added an assistant-led setup guide, a Claude entry point and an explicit
  non-interactive core installer. Assistants ask which extras are wanted, then
  install and verify the agreed setup; unused integrations remain inactive.
- Setup plans are read-only; unattended installation requires `--install-core`.
  Shortcut creation and cache-only installation have separate explicit flags.

## 0.2.0 preview

- Updated notebook tools, interactive displays, linked research records and
  version copies that preserve their saved run evidence.
- Pinned Overview/Research notes documents, grouped comment replies and a clearer
  path from queued work to its manuscript passage or notebook entry.
- Current source editing, compilation caching and source/PDF navigation fixes.
  Research-directory PDFs now follow Show / hide without changing source files.
- Incremental publication proposals, wording locks, detailed exposition guidance
  and an optional cache of explicit human writing preferences.
- Portable agent guidance and complete offline helper scripts. No inherited
  external-review permission, private infrastructure or research data.
- Optional two-computer controls, off in new workspaces; setup installs no sync
  tasks, local models, hosted reader or autonomous maintenance worker.
- Current change-journal, reading/comment sync, guarded merge and slow-link
  transport fixes for users who explicitly configure two machines.

This remains a Windows-first preview. Python, TeX, local models, SSH and hosting
are separate choices; source code for their integrations ships with the app.
