// One local file save with exact-byte fencing. This is not a distributed lock;
// editors that do not participate can still race the final filesystem rename.
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { syncHash } from "./syncProtocol.ts";
import { readSyncBytes } from "./deviceSync.ts";
import { withRecordLock } from "./recordLock.ts";
import { replaceFile } from "./atomicFile.ts";

export async function guardedTarget(root: string, name: string, createParents = false) {
  if (!name || name.length > 500 || /[\\:\x00-\x1f\x7f]/.test(name) || path.posix.isAbsolute(name)
    || name.split("/").some(part => !part || [".", ".."].includes(part) || /[<>"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Use an ordinary relative file path.");
  let target = await realpath(root);
  for (const [index, part] of name.split("/").entries()) {
    target = path.join(target, part); const last = index === name.split("/").length - 1;
    let stat; try { stat = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (!stat && !last && createParents) { await mkdir(target).catch(error => { if (error.code !== "EEXIST") throw error; }); stat = await lstat(target); }
    if (stat && (stat.isSymbolicLink() || (last ? !stat.isFile() : !stat.isDirectory()))) throw new Error("A save path is linked or not an ordinary file/folder; preserved.");
    if (!stat && !last && !createParents) return target + path.sep + name.split("/").slice(index + 1).join(path.sep);
  }
  return target;
}
export async function guardedFileHash(root: string, name: string, maximum = 24 * 1024 * 1024) {
  const target = await guardedTarget(root, name);
  try { return syncHash(await readSyncBytes(target, maximum)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
export async function saveGuardedFile(root: string, name: string, expectedHash: string, bytes: Buffer, maximum = 24 * 1024 * 1024) {
  if (expectedHash !== "" && !/^[a-f0-9]{64}$/.test(expectedHash) || bytes.length > maximum) throw new Error("Invalid file fence or oversized save.");
  const target = await guardedTarget(root, name, true);
  // Validate the lock too; never follow a link disguised as a stale lock.
  await guardedTarget(root, `${name}.aw-lock`);
  return withRecordLock(target, async () => {
    const check = async () => { if (await guardedFileHash(root, name, maximum) !== expectedHash) throw new Error("File changed outside this save. Current bytes and prepared draft are preserved."); };
    await check(); const temporary = path.join(path.dirname(target), `.aw-save-${randomUUID()}.tmp`), handle = await open(temporary, "wx");
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await guardedTarget(root, name); await check(); await replaceFile(temporary, target);
    if (await guardedFileHash(root, name, maximum) !== syncHash(bytes)) throw new Error("File changed while the save was confirmed; inspect the backup and current file.");
    return syncHash(bytes);
  });
}
