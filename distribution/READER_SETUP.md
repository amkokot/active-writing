# Optional code-protected reader

This is separate from installing Aw. Do not deploy the editor, a private paper
directory, or an unreviewed notebook as a public static site.

## New project: reuse this setup

Prepare an inspected **Private reader ZIP** in Aw, or use
`node scripts/awShare.ts --help`. Keep the exported `aw/` folder outside this
public app repository. Inspect its contents before publishing.

Install Cloudflare's official Wrangler CLI in a separate tooling folder if wanted,
and sign in to your own account. Create a Worker and D1 database, applying
`reader/schema.sql` to that database. Choose a plan deliberately; Aw does not
upgrade it or guarantee that a provider's free limits will stay unchanged.

Run the offline preparation command with your confirmed identifiers:

```text
node deploy/cloudflare-reader/project.mjs --reader EXPORTED_aw --name aw-project-reader --account ACCOUNT_ID --subdomain YOUR_SUBDOMAIN.workers.dev --database D1_DATABASE_ID --output NEW_FOLDER
```

Inspect the returned plan and generated Wrangler configuration. It embeds only
the checked reader files and uses no public assets directory. The database name
in the generated configuration is a generic label; use your actual D1 name/ID.
Do not add generated artifacts or this configuration to the public Aw repository.

Generate a fresh random link token and session secret, plus a salted PBKDF2 code
hash. The reader expects `AW_SHARE_TOKEN`, `AW_SESSION_SECRET`, `AW_CODE_SALT`,
`AW_CODE_HASH`, and `AW_SHARE_ORIGIN`. Put these in the hosting provider's secrets.
The server implementation fixes the code hash at 100,000 SHA-256 PBKDF2 iterations;
the salt/hash are base64url bytes. A four-digit code is deliberately low-strength.

`secrets.mjs --help` and `check.mjs --help` document the hidden-input operator
helpers. They are not run by Aw setup. Keep code, tokens, credentials and generated
reader payloads out of Git, screenshots and shell history. Deployment is a
deliberate Wrangler operation using the inspected configuration, not a menu
action or automatic synchronization.

After deployment, verify before-code denial for every file, then unlock and check
the complete allowlist's hashes and downloads. Test the actual hosted origin,
not only a local build. Each project needs separate access secrets; shared D1
guessing budgets are project-namespaced. Preserve other projects on an update.

For a less technical starting point, use the PDF sharing option instead. See
[the sharing guide](../../docs/ONLINE_SHARING.md) for the security boundaries.
