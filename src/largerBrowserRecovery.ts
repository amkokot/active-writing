/** Shared recovery uses IndexedDB's larger quota. Immediate per-tab copies
 * remain synchronous; old Web Storage recoveries are never erased here. */
export type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">;
export type RecoveryRecord = { key: string; value: string | null };
export interface RecoveryStatus { backend: "web-storage" | "indexeddb"; saving: boolean; error?: string }
let status: RecoveryStatus = { backend: "web-storage", saving: false };
const listeners = new Set<() => void>();
export const largerRecoveryStatus = () => status;
export const subscribeLargerRecovery = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: RecoveryStatus) => { status = next; for (const listener of listeners) listener(); };
export const isRecoveryKey = (key: string) => /^(?:paperfocus\.prototype\.v1(?:\.|$)|paperfocus:experiments:|active-writing\.(?:raw\.v2|command|reading|pdf|window|resume)\.)/.test(key);

/** Failed transactions retain pending bytes, including newer edits. */
export function createLargerRecoveryStorage(legacy: RecoveryStorage, records: RecoveryRecord[], commit: (records: RecoveryRecord[]) => Promise<void>, onStatus: (status: RecoveryStatus) => void, broadcast: (records: RecoveryRecord[]) => void = () => {}) {
  const values = new Map(records.filter(r => isRecoveryKey(r.key)).map(r => [r.key, r.value]));
  const pending = new Map<string, string | null>();
  const inFlightKeys = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | undefined;
  const names = () => {
    const keys = new Set(values.keys());
    for (let i = 0; i < legacy.length; i++) { const key = legacy.key(i); if (key) keys.add(key); }
    return [...keys].filter(key => values.has(key) ? values.get(key) !== null : true);
  };
  const flush = async (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (running) { await running; if (pending.size) return flush(); return; }
    if (!pending.size) return;
    const batch = [...pending].map(([key, value]) => ({ key, value })); pending.clear();
    for (const r of batch) inFlightKeys.add(r.key);
    onStatus({ backend: "indexeddb", saving: true });
    const operation = (async () => {
      try { await commit(batch); try { broadcast(batch); } catch { /* A notification failure is not a failed commit. */ } onStatus({ backend: "indexeddb", saving: pending.size > 0 }); }
      catch (error) {
        for (const r of batch) if (!pending.has(r.key)) pending.set(r.key, r.value);
        onStatus({ backend: "indexeddb", saving: false, error: `Larger browser recovery could not be saved: ${error instanceof Error ? error.message : String(error)}. Disk saves are independent. Keep this window open until pending work saves to disk.` });
        throw error;
      }
    })();
    running = operation;
    try { await operation; } finally { running = undefined; inFlightKeys.clear(); }
    if (pending.size) return flush();
  };
  const queue = (key: string, value: string | null) => {
    if (!isRecoveryKey(key)) throw new Error("Unknown browser recovery key.");
    values.set(key, value); pending.set(key, value);
    if (!timer) timer = setTimeout(() => { timer = undefined; void flush().catch(() => undefined); }, 30);
  };
  return {
    storage: {
      get length() { return names().length; }, key: (index: number) => names()[index] ?? null,
      getItem(key: string) {
        const value = values.has(key) ? values.get(key)! : legacy.getItem(key);
        // A still-open older client may publish a newer legacy lease.
        if (/^active-writing\.window\..+\.alive$/.test(key) && value !== null) { const old = legacy.getItem(key); if (old !== null && Number(old) > Number(value)) return old; }
        return value;
      },
      setItem: (key: string, value: string) => queue(key, value),
      removeItem: (key: string) => queue(key, null), // Tombstones prevent stale fallback resurrection.
    } satisfies RecoveryStorage,
    flush,
    receive(batch: RecoveryRecord[]) { for (const r of batch) if (isRecoveryKey(r.key) && !pending.has(r.key) && !inFlightKeys.has(r.key)) values.set(r.key, r.value); },
  };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => { finished = true; reject(new Error("Larger browser storage did not open in time.")); }, 4000);
    const request = indexedDB.open("active-writing-recovery", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("records")) request.result.createObjectStore("records", { keyPath: "key" }); };
    request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else { finished = true; resolve(request.result); } };
    request.onerror = () => { clearTimeout(timer); finished = true; reject(request.error ?? new Error("Larger browser storage unavailable.")); };
  });
}
let active: ReturnType<typeof createLargerRecoveryStorage> | undefined;
export const flushLargerRecovery = () => active?.flush() ?? Promise.resolve();
export async function initializeLargerRecovery(legacy: RecoveryStorage): Promise<RecoveryStorage | undefined> {
  if (typeof indexedDB === "undefined" || typeof BroadcastChannel === "undefined") return undefined;
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase();
    const records = await new Promise<RecoveryRecord[]>((resolve, reject) => {
      const transaction = db!.transaction("records", "readonly"), request = transaction.objectStore("records").getAll();
      transaction.oncomplete = () => resolve(request.result); transaction.onabort = () => reject(transaction.error ?? new Error("Recovery read failed."));
    });
    const channel = new BroadcastChannel("active-writing-indexed-recovery-v1");
    const commit = (batch: RecoveryRecord[]) => new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction("records", "readwrite"), store = transaction.objectStore("records");
      for (const record of batch) store.put(record);
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error ?? new Error("Recovery transaction failed."));
    });
    active = createLargerRecoveryStorage(legacy, records, commit, publish, batch => channel.postMessage(batch));
    channel.onmessage = event => {
      if (Array.isArray(event.data) && event.data.every((r: unknown) => r && typeof r === "object" && "key" in r && typeof r.key === "string" && "value" in r && (r.value === null || typeof r.value === "string"))) active?.receive(event.data);
    };
    db.onversionchange = () => { db?.close(); publish({ backend: "indexeddb", saving: false, error: "Browser recovery storage changed in another window. Save work to disk and reload this window." }); };
    window.addEventListener("pagehide", () => { void flushLargerRecovery().catch(() => undefined); });
    publish({ backend: "indexeddb", saving: false });
    return active.storage;
  } catch { db?.close(); return undefined; }
}
