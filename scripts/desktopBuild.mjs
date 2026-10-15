import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Only app inputs, never manuscripts, notes, models or dependency trees.
export async function desktopInputs(root) {
  const records = [];
  async function visit(relative) {
    const filename = path.join(root, relative);
    let info;
    try { info = await stat(filename); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    if (info.isDirectory()) {
      const entries = await readdir(filename, { withFileTypes: true });
      await Promise.all(entries.filter(e => !e.isSymbolicLink()).map(e => visit(path.posix.join(relative, e.name))));
    } else if (info.isFile()) records.push({ file: relative, size: info.size, mtimeMs: info.mtimeMs });
  }
  await Promise.all(["src", "public", "index.html", "package.json", "package-lock.json", "vite.config.ts"].map(visit));
  return records.sort((a, b) => a.file.localeCompare(b.file));
}
export async function writeDesktopBuildStamp(root, output = path.join(root, "dist"), inputs) {
  const current = await desktopInputs(root);
  if (inputs && JSON.stringify(inputs) !== JSON.stringify(current)) throw new Error("App files changed during the build. Build again to enable fast startup.");
  await writeFile(path.join(output, ".aw-build.json"), JSON.stringify({ version: 1, inputs: current }));
}
export async function desktopBuildReady(root) {
  try {
    const output = path.join(root, "dist");
    const stamp = JSON.parse(await readFile(path.join(output, ".aw-build.json"), "utf8"));
    if (stamp.version !== 1 || !Array.isArray(stamp.inputs) || !(await stat(path.join(output, "index.html"))).isFile()) return false;
    return JSON.stringify(stamp.inputs) === JSON.stringify(await desktopInputs(root));
  } catch { return false; }
}
