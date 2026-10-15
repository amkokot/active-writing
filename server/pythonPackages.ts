import { lstat } from "node:fs/promises";
import path from "node:path";

/** Explicit Aw-local overlay, not PYTHONPATH, .pth execution or an automatic install. */
export async function pythonPackageFolder(workspace: string): Promise<string | undefined> {
  const root = path.resolve(workspace), folder = path.join(root, ".paperfocus", "python-packages");
  for (const target of [root, path.join(root, ".paperfocus"), folder]) {
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Aw Python packages require regular directories, not linked paths.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && target === folder) return undefined;
      throw error;
    }
  }
  return folder;
}
