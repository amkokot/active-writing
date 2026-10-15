# Sharing work from Aw

The app and the work you write in it are separate. This public repository holds
the editor and a synthetic example; it is not a place to push private papers.

## Send a file

Use **Compile ▾ → Share manuscript & notebook** or **Notebook → Share…** for a
readable PDF. Use **Download source ZIP** for ordinary TeX, figures and bibliography
files. The ZIP preserves relative paths for Overleaf. Review the selected content
before sending it: authored notes, code and figures may contain private material.
Sharing does not run notebook code, approve wording or resolve comments.

## Put a reading copy online

Aw can prepare a **Private reader ZIP · for hosting**, with an Overview and selected
notes or notebook entries. The reader is a frozen, read-only snapshot. Updating
the live paper does not update the hosted copy.

The reusable Cloudflare Worker source and preparation tools are in
`deploy/cloudflare-reader/`. Configure your own account, Worker and D1 database.
Hosting is optional and requires its own sign-in; setup never publishes anything.
Inspect provider limits and pricing before deploying. No account IDs, reader
data, access codes, tokens or personal hosting configuration are supplied here.

The reader checks an unpredictable link and a short code on the server before
serving any research file. It uses signed sessions, persistent code-guess limits
and a checked file allowlist. A short shared code is a convenience barrier, not
strong protection against a determined recipient; links, codes and downloads
can be forwarded. Use stronger access controls for sensitive material.

GitHub Pages alone cannot protect private files with a server-checked code. A
client-side password box or obscure path does not make a public Pages deployment
private. Never upload private reader bytes to public static hosting, and never
expose the Aw editor or port 4173 as a reader.

## Keep the live manuscript and hosted snapshot distinct

Before publishing, confirm the intended project/root and source revision. Prepare
a new snapshot, inspect its readable text and figures, and compile its frozen TeX
with `scripts/awShareTypeset.ts` if a typeset PDF is wanted. Preserve previous
snapshots and newer local work. Check the actual hosted file hashes and verify
that PDFs, figures and downloads are blocked before code entry. Publishing a new
snapshot does not merge collaborator edits or synchronize Overleaf.

Keep an Overview short; put substantive results and important failures in the
research note, with links to notebook evidence where suitable. Do not publish the
entire private notebook just to share a concise explanation.

## Agent entry points

`node scripts/awShare.ts --help` prepares explicitly selected saved material in a
new folder without switching the project, uploading, pushing or executing cells.
`node scripts/shareReaderServer.mjs --help` describes the local Node reader.
Cloud deployment needs separate explicit authorization. Store access credentials
in host secrets, never Git, command-line arguments or public logs.
