# Set up Aw for someone

For an existing installation, start with [UPDATING.md](UPDATING.md). Merge the new
guidance with existing instructions according to the user's requests; preserve
their preferences and existing module choices. Do not treat setup as a reason
to replace personal instructions, reset saved work or install every feature.

This is the entry point for Codex, Claude Code, or another assistant with terminal
and folder access. A browser-only chat cannot install software by itself. When
asked to set up Aw, carry out the agreed setup and verification; don't just hand
the user a list of commands. Respect your host's approval/security requirements.

## 1. Ask once, then do the work

Inspect the OS and existing installation first. If you haven't cloned the repo,
use https://github.com/amkokot/active-writing in a new, user-owned folder. Reuse a
confirmed clean checkout when appropriate. Never overwrite an existing Aw home,
manuscript repository, draft or experiment to make a fresh installation.

Ask one short question, using known preferences instead of asking again:

> I'll set up the editor, notebook and offline assistant tools. Which extras do
> you want: LaTeX PDF compilation, Python experiments, a local model, two-computer
> sync, or online sharing? None is needed for the basic app. Would you also like
> a desktop shortcut on Windows?

Recommend starting with the core, plus TeX if they want typeset PDFs. Explain
large runtime/model downloads before installing them. Record the agreed choices
in the final handoff; don't make the user maintain a configuration checklist.
Autonomous maintenance is an advanced option, not part of the usual question.
Do not treat an answer such as “just the editor” as permission to set up SSH,
models, hosting, cloud review, Python libraries or background services.

## 2. Install the core without an interactive terminal

Check for Node.js 24+. If missing, offer to install it from its official source,
following the host's normal permission rules. Don't weaken execution policy or
OS security to get an installer working. Then, in the verified repo:

```text
node scripts/portableSetup.mjs --plan
node scripts/portableSetup.mjs --install-core
```

The explicit `--install-core` action verifies the distribution, runs locked
`npm ci`, builds the app and seeds the synthetic welcome notebook only if safe.
It works without a TTY, so the assistant need not feed answers into a shell.
Append `--shortcut` only when requested on Windows. `--offline` restricts npm to
its cache; it will fail clearly if dependencies aren't cached. Never repair a
manifest failure by disabling verification; inspect changes or use a clean copy.
Plain `node scripts/portableSetup.mjs` remains the human's interactive installer.

## 3. Add only the agreed extras

| Choice | Assistant's next step |
| --- | --- |
| Core only | Skip every row below. Rendered text and notebook notes work now. |
| LaTeX PDFs | Reuse an installed TeX distribution; otherwise install an official distribution for the OS with permission. Compile the synthetic demo once. |
| Python experiments | Reuse or install Python, then add only libraries needed for the intended work. `scripts/research-requirements.txt` is optional, not a mandatory bulk install. Inspect the demo before a single authorized run. |
| Local model | Read DESKTOP_ASSISTANCE.md. Check hardware and agree on a bounded model/runtime download. Configure only a local endpoint; don't assume credentials or paid APIs. If impractical, leave the core working and explain. |
| Two-computer sync | Read DEVICE_SYNC.md and REMOTE_RESEARCH.md. Ask for the second machine, data scope and connection method. Pair/activate through guarded tools; never guess paths or bypass host-key/network checks. Show the tools with `node scripts/awModules.mjs sync-on --workspace DATA_HOME`. Showing controls alone does not pair or sync. |
| Online sharing | Read ONLINE_SHARING.md. Ask for hosting/account and exact material to share. Never publish sample/private work merely to test the installation. Keep this optional stage pending if account setup requires the person. |
| Maintenance, if explicitly requested | Read MAINTENANCE.md. Separate local-model configuration, sandbox checks and enrollment are required; never enable it by default. |

Existing integrations may belong to another project or computer. Preserve them;
do not stop jobs to simplify setup. Skipping an integration means not installing
or activating it, not deleting its source or disabling existing work. Optional
source stays bundled. Hide unwanted two-computer controls with `awModules.mjs
sync-off`; this does not stop existing jobs. No model, reviewer, institution,
compute allocation, service budget or transfer permission is inherited.

## 4. Verify and hand over

For a new installation, use the welcome project, not the person's research:

```text
node scripts/awModules.mjs status --workspace DATA_HOME
node scripts/awResearch.ts discover --offline --workspace DATA_HOME
node scripts/awResearch.ts inspect --offline --workspace DATA_HOME --project demo --entry welcome-series
```

The demo may be absent in an existing workspace; inspect its actual identities
instead. Never reset it. Launch on Windows using `Start Aw.cmd` or
`node scripts/desktopLauncher.mjs`; it manages the local service. Other systems
can run `node scripts/desktopServer.mjs` and open http://127.0.0.1:4173/.
Don't take over an occupied port or restart another owner's service. If a browser
is available, check the welcome manuscript and notebook once. Otherwise report
the successful build/offline checks and that a visual check wasn't performed.
Do not run the full regression suite as an installation ceremony.

Finish with the actual installation/data paths, how to launch, enabled extras,
anything deliberately skipped, and any concrete pending user action. The default
handoff should be “open the shortcut and write,” not “start a server each time.”
