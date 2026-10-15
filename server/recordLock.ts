import { open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export class RecordLocked extends Error {}

/** Cross-process lock for one validated store target. Never steal a stale lock. */
export async function acquireRecordLock(target: string, waitMs = 2000): Promise<() => Promise<void>> {
  const lock = `${target}.aw-lock`, token = randomUUID(), until = Date.now() + waitMs;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      try { await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })); }
      finally { await handle.close(); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= until) throw new RecordLocked(`Aw record is locked by another writer: ${lock}. No changes made. Wait; if a writer crashed, inspect its lock before explicit recovery. Locks are never automatically stolen.`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  return async () => {
    const owner = JSON.parse(await readFile(lock, "utf8"));
    if (owner.token !== token) throw new Error(`Aw record lock ownership changed: ${lock}. Preserved for inspection.`);
    await unlink(lock);
  };
}
export async function withRecordLock<T>(target: string, action: () => Promise<T>, waitMs = 2000): Promise<T> {
  const release = await acquireRecordLock(target, waitMs);
  try { return await action(); } finally { await release(); }
}
