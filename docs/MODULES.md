# Use the parts you need

The editor, notebook, queue and offline agent tools are the core. They work on one
computer. Optional integrations ship as source in the same repository, but setup
does not activate them, download their runtimes, start background workers or
connect accounts. This is an opt-in setup model, not separately compiled plugins.

| Part | Extra requirement | How to start |
| --- | --- | --- |
| Editing, notes, comments, queue, rendered preview | Node and the locked npm dependencies | Normal setup |
| Real LaTeX PDFs and source/PDF navigation | A TeX installation | Install TeX, then Compile |
| Python notebook execution | Python; scientific libraries only as needed | Inspect a cell, then explicitly Run |
| Folder-aware assistant | Your own assistant, with folder access | Read AGENTS.md and use offline tools |
| Local helper / rephrasing | Your own configured local runtime and model | See DESKTOP_ASSISTANCE.md |
| Two-computer sync and remote storage | An explicitly chosen SSH host and paired project | See DEVICE_SYNC.md |
| Code-protected online reader | Your own hosting/account configuration | See ONLINE_SHARING.md |
| Autonomous maintenance | Separate enrollment, sandbox and local model | See MAINTENANCE.md |

## Keep the interface small

**Workspace folders → Optional tools → Two-computer tools** shows or hides the
pairing panel and sync notices. It is off in a fresh workspace. Existing enabled
pairs keep their controls visible when upgrading. No remote checks happen merely
because Aw opens; the notice reads saved local status only when enabled.

An assistant can make the same UI choice without a server:

```text
node APP_CODE/scripts/awModules.mjs status --workspace DATA_HOME
node APP_CODE/scripts/awModules.mjs sync-on --workspace DATA_HOME
node APP_CODE/scripts/awModules.mjs sync-off --workspace DATA_HOME
```

Hiding controls does not stop installed sync tasks or erase their settings. Use
the sync tools' explicit disable/uninstall workflow if you intend to stop them.
This separation prevents a display choice from unexpectedly cutting a working
connection. Choices live in private Aw home, not a manuscript repository.

## Start small, add later

For writing only, skip Python, models, SSH and hosting. For experiments on one
computer, add Python. A larger research computer can later own experiments while
a laptop holds a reading copy; that pairing is a separate operation, with its own
data scope and conflict handling. No specific institution, machine or subscription
is assumed. Updates to Aw code and synchronization of research are separate jobs.
