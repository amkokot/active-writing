// Server-independent clean distribution. Does not read paper or personal Codex stores.
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { portableEntries } from "../server/portableExport.ts";
import { zipEntries } from "../server/sourceZip.ts";

const arguments_ = process.argv.slice(2);
if (arguments_.includes("--help")) {
  console.log("Export a clean Aw app with agent guides and tools, no private workspace.\nnode scripts/exportAw.mjs [--output NEW.zip] [--plan]\nDefault: output/exports/active-writing-DATE-ID.zip. Never overwrites; no server or downloads.");
} else {
  let output, plan = false;
  for (let index = 0; index < arguments_.length; index++) {
    const flag = arguments_[index];
    if (flag === "--plan") plan = true;
    else if (flag === "--output" && arguments_[index + 1] && !arguments_[index + 1].startsWith("--")) output = arguments_[++index];
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { entries, manifest } = await portableEntries(root);
  if (plan) console.log(JSON.stringify({ ...manifest, bytes: manifest.files.reduce((n, file) => n + file.size, 0) }, null, 2));
  else {
    const destination = path.resolve(output ?? path.join(root, "output", "exports", `active-writing-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.zip`));
    if (!destination.toLowerCase().endsWith(".zip")) throw new Error("Choose a new .zip filename.");
    const archive = await zipEntries(entries);
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, "wx"); // Existing backups are never replaced.
    try { await handle.writeFile(archive); } finally { await handle.close(); }
    console.log(JSON.stringify({ file: destination, files: manifest.files.length, bytes: archive.length, privateWorkspaceIncluded: false }));
  }
}
