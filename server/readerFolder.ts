import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

/** Only explicitly catalogued reader artifacts are separate from paper source.
 * An ordinary aw/ folder, unlisted files and any TeX source remain visible.
 */
export async function readerSnapshotPaths(root: string) {
  const result = new Set<string>();
  try {
    const folder = await lstat(path.join(root, "aw")), info = await lstat(path.join(root, "aw/reader.json"));
    if (!folder.isDirectory() || folder.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.size > 40_000) return result;
    const manifest = JSON.parse(await readFile(path.join(root, "aw/reader.json"), "utf8"));
    if (manifest.format !== "active-writing-reader" || manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 96 || !manifest.files.every((file: any) => typeof file?.name === "string" && /^(?:(?:index|reading)\.html|(?:overview|research-note)\.pdf|(?:README|LICENSE-KaTeX)\.txt|(?:manuscript|notebook)\.md|notes\/note-\d+\.html|notebooks\/conversation-\d+\.ipynb|figures\/[\w-]+\.png|assets\/[a-f0-9]{24}\.(?:png|jpeg|webp|gif|woff2?|ttf))$/.test(file.name) && /^[a-f0-9]{64}$/.test(file.sha256))) return result;
    result.add("aw/reader.json");
    for (const file of manifest.files) result.add(`aw/${file.name}`);
  } catch { /* not an Aw reader snapshot: never hide ordinary project files */ }
  return result;
}
