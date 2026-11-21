# Update Aw without replacing your setup

This guide is for Codex, Claude Code and other folder-aware assistants. An Aw
release supplies tools and default guidance. It does not replace the user's
instructions or authorize every optional integration.

## Merge guidance, rather than replacing it

Start with the user's current request, their existing instructions and the
installation's enabled modules. Read the incoming AGENTS.md, CLAUDE.md and the
workflow documents relevant to that request. Carry forward useful new guidance
while preserving the person's choices, terminology, writing preferences, project
policies and deliberate exceptions. The user's explicit directions take priority
over Aw's defaults, within the assistant host's instruction and security rules.

When an instruction file already exists, compare the current file with its last
release version and the incoming version when those are available. Preserve both
sets of additions; reconcile wording by intent. Do not append a second,
contradictory checklist or replace the whole file with the new template. If no
baseline exists, preserve the current file and integrate only clearly compatible
changes. Ask a narrow question only when a real conflict affects the requested
work. A user's narrower request remains narrower after an update.

Prefer short references to the installed guides over copying whole guides into
every project. Put project-specific instructions with that project. Keep personal
or machine-specific settings outside the release files where practical; follow
the user's existing arrangement instead of imposing a new one. Do not edit global
Codex/Claude settings or unrelated projects just because this release is present.

For writing, merge the principles with the user's reader, examples and feedback.
Research notes may be expansive; an Overview stays short; publication text keeps
its review and wording locks. Do not turn exploration into repeated prose audits,
or treat a stylistic suggestion as a mandatory rule for every document.

## Keep the app and saved work separate

1. Confirm the current app-code location, data home, enabled modules and launch
   method. Save open drafts before a restart. Preserve an application rollback
   copy or commit, plus a separate backup of the user's saved work.
2. Obtain the chosen release in a new app-code folder or a clean, versioned
   checkout. Inspect local changes before updating an existing checkout. Never
   use a hard reset, a clean command or extraction over a live workspace to make
   an update pass.
3. Verify the unmodified release with
   `node scripts/portableSetup.mjs --verify`. Then install/build its core when
   authorized. Manifest verification checks the release bytes: do not disable it
   or regenerate hashes merely to conceal an unexpected modification. Preserve
   customized instructions separately before verification, then merge their
   intent into the user's maintained instructions as described above.
4. Keep manuscript repositories, `.paperfocus` records, notebooks, comments,
   drafts, credentials, paired-device identities and sync history intact. Do not
   seed a demo over existing work. A clean app ZIP is not a workspace backup.
5. Reuse existing optional integrations only within their configured scope. A
   laptop update does not authorize deploying to another computer. Leave unused
   modules inactive; do not install TeX, Python libraries, models, SSH services or
   hosting as an update ceremony. See MODULES.md for the choices.
6. Check the changed workflows proportionately on a synthetic project. Do not
   start research, execute notebook cells, upload files or replay saved tasks as
   an installation test. Restart only the intended local service at a safe point.

Conclude with the installed version and paths, what guidance was merged, choices
preserved, checks actually run and any remaining activation step. Be explicit if
you prepared an update but did not switch the running app to it.
