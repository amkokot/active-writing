# Optional remote research

Use Aw on one computer unless you have a reason to add another. Remote chat
execution, persistent experiments and Aw file sync are different capabilities.
Installing the app does not configure any of them.

For a chosen research machine, install a clean Aw code copy and choose a separate
private data home. Authenticate your assistant yourself. `awRemoteBootstrap.py`
and `awRemoteSession.py` provide explicit user-local setup and persistent tmux
sessions; inspect their help first. Test disconnect survival with a small job
before relying on it. Existing research must not be restarted as a connection fix.

Pair a laptop reading copy only when wanted, using `awLinkReading.mjs` and
[DEVICE_SYNC.md](DEVICE_SYNC.md). Verify project IDs, both homes, pinned reading
documents and the proposed initial baseline. Sync needs explicit enrollment and
activation; showing its UI controls does not enable transfers. Keep readable
notes, notebooks, protocols and figures local, and bulk arrays/archives/checkpoints
on the research machine by role. Use `awStore.ts status/fetch` for explicit extra
files. Do not silently rerun an experiment because its raw data is remote.

For a review loop, read [REMOTE_REVIEW.md](REMOTE_REVIEW.md). Saved independent
comments and replies can combine; ordinary nonoverlapping source edits can merge.
Real overlapping wording, protected decisions and interrupted operations keep
their guards. Unsaved browser drafts are not evidence that a comment or edit has
reached the other machine. Preserve both versions instead of forcing a retry.

File transfer does not execute code, replay a task or make either computer globally
authoritative. Publication locks, approval and comment closure remain deliberate.
Use SSH keys and verified host keys; never publish a local editor port. If a VPN
or campus gate is configured, respect it and back off while unavailable. Remote
provider accounts, allocations, credentials and permissions are not bundled.
