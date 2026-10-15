# Exporting Active Writing

## Give a friend a clean copy

Open **Workspace folders** (the house icon in the top bar), then **Export Aw**.
Download the ZIP and send that one file. A clean copy includes app source, agent
instructions, workflow guides, offline notebook/writing/version tools, test tools,
the Python runner and an optional scientific-library requirements list.

It never copies live projects, your existing example, notebooks, trials, recovery
drafts, development README, personal Codex settings/chats/credentials, dependencies
or model weights. The example and short README are generated fresh. No upload,
publication, service restart, code execution or dependency download occurs.
Only explicitly selected app directories/files are read; links and changing app
files stop export. Limits: 2,500 files, 8 MB per file, 48 MB uncompressed total.
The hash manifest lists the exact contents without the sender's workspace path.
This is not a guarantee that modified app source contains no secrets: never put
credentials or unpublished research into distributable source/guides/fixtures.

The same export works without an Aw service:

```text
node scripts/exportAw.mjs
node scripts/exportAw.mjs --output NEW.zip
node scripts/exportAw.mjs --plan
```

Default exports go to `output/exports/` with a unique name. Existing ZIPs are
never replaced. CLI plans show contents and hashes without making an archive.
Use Node.js 24+; no npx or dependency download is involved in the export command.

## Receiving the ZIP

Extract it into a new permanent folder, not over an existing Aw workspace. Read
the included README. Install Node.js 24+ separately. On Windows, double-click
**Set up Aw.cmd**; elsewhere run `node scripts/portableSetup.mjs`. Setup verifies
every manifest file before asking permission to download dependencies (`npm ci`)
and build the app. It can create the existing Windows desktop shortcut; no
system-wide installation, model download or Python install is done. A different
existing shortcut is preserved, not overwritten. `--verify` checks only files.

After setup, the Windows shortcut starts/reuses the matching local service and
opens the app automatically. The loopback port stays 4173; another app/Aw copy
occupying it is not stopped. Use the folder menu to create/import projects.
Windows is the tested desktop target. Other platforms can run the loopback web
app but require platform-appropriate runtime/LaTeX/model setup.

Node dependencies are downloaded on first setup; this is a small source bundle,
not a fully offline installer. Python, TeX and local models are optional and
installed/configured separately. No paid model API or account is bundled.
Recipients sign into their own assistant. Aw-specific agent tools/guides travel
with the package; personal Codex skills/plugins do not. Copy only intentionally
shareable custom skills under their applicable licenses, not an entire `.codex`
folder. Checksums detect damage/changes, not an untrusted sender or malicious
code. Review the source before executing setup. Third-party dependency licenses
still apply; this package makes no licensing grant on the author's behalf.

## Move your own saved work — separate from the friends' copy

The clean app export deliberately is **not a complete workspace backup**.
To migrate research, save all browser drafts and pause writers/runs, then copy
the manuscript repositories (including local changes/assets and Git history if
needed), `.paperfocus/projects.json`, all owning `.paperfocus/project-data/ID/`
folders and `.paperfocus/backups/`. Preserve any legacy/unmigrated records and
pending artifacts too; inspect your actual storage rather than guessing paths.
Never overwrite a live store. The source ZIP and collaborator PDF/ZIP are not
restore formats and do not contain the complete private record.

Restore into a separate destination, remap registry paths where necessary and
validate identities, saved cells/outputs, comments/review locks, notebook links
and runtime availability before switching. Browser-only state and active Python
variables are not transferred by copying disk files. Sign in separately; do not
bundle credentials. Reinstall compatible runtimes/libraries/models deliberately.
Do not let two machines write a cloud-synced Aw store concurrently; one host
should remain authoritative. See [REMOTE_RESEARCH.md](REMOTE_RESEARCH.md).

There is not yet an automatic private-backup export/import or path-remapping
wizard. A friends' distribution can be regenerated at any time with the command
above; it does not modify or remove the original installation or private work.

For a selected project's **first independent copy**, the offline `awSync.ts clone`
tool now creates a new data home with the same project/notebook/cell IDs and
relative source tree. It requires preview then exact-plan commit; it never copies
over an occupied home or restores a full backup. The clean app package and this
private project packet remain separate. Launch installed code with
`node scripts/desktopLauncher.mjs --workspace DATA_HOME`, or explicitly run the
Windows shortcut installer with `-WorkspacePath DATA_HOME`. Updates to the app
code need not touch that data home. Read [DEVICE_SYNC.md](DEVICE_SYNC.md) for
pending-work, recovery, provenance and transfer-history boundaries.
