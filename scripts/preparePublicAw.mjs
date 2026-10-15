// Prepare a NEW source repository, never a private workspace or its Git history.
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { portableEntries } from "../server/portableExport.ts";

export async function preparePublicAw(root, output) {
  const { entries, manifest } = await portableEntries(root);
  // These broad checks supplement the allowlist; they cannot certify arbitrary
  // authored prose as non-private. Inspect the full staged tree before publishing.
  for (const entry of entries) {
    const text = entry.data.toString("utf8");
    const credentialUrls = text.match(/https:\/\/[^\s/"']*:[^\s/"']*@[^\s"'<>)}]+/g) ?? [];
    const syntheticUrl = (url) => /\.test\.(?:ts|mjs)$/.test(entry.name) && /^(?:https:\/\/user:(?:secret|pass)@example\.(?:test|org|com)|https:\/\/secret:token@github\.com\/owner\/paper|https:\/\/name:secret@github\.com\/a\/b)$/.test(url);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/.test(text)
      || credentialUrls.some(url => !syntheticUrl(url))
      || /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|example\b|test\b)[^\s/\\]+/i.test(text)) throw new Error(`Review potentially private content in ${entry.name}. Nothing published.`);
  }
  const destination = path.resolve(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination); // An existing copy is never overwritten or cleaned.
  for (const entry of entries) {
    const target = path.join(destination, entry.name); await mkdir(path.dirname(target), { recursive: true });
    const file = await open(target, "wx"); try { await file.writeFile(entry.data); } finally { await file.close(); }
  }
  return { folder: destination, files: entries.length, bytes: manifest.files.reduce((n, f) => n + f.size, 0), privateWorkspaceIncluded: false, published: false };
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output") console.log("node scripts/preparePublicAw.mjs --output NEW_FOLDER\nCreates an allowlisted clean repository tree. No Git, upload, credentials, downloads or private data stores.");
  else preparePublicAw(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), args[1]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
