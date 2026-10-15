/** Join overlapping starts and back off after failure. Probing never launches
 * anything and can detect a runtime started manually during the cooldown. */
export function createRuntimeStarter({ probe, start, now = Date.now, cooldownMs = 30_000 }: {
  probe: () => Promise<unknown>; start: () => Promise<void>; now?: () => number; cooldownMs?: number;
}) {
  let flight: Promise<void> | undefined;
  let failure: Error | undefined;
  let retryAt = 0;
  return function ensure(): Promise<void> {
    if (flight) return flight;
    flight = (async () => {
      try { await probe(); failure = undefined; return; } catch { /* Offline. */ }
      if (failure && now() < retryAt) throw failure;
      try { await start(); failure = undefined; }
      catch (error) {
        failure = new Error(`${error instanceof Error ? error.message : String(error)} Automatic startup is paused for 30 seconds; retry after that.`);
        retryAt = now() + cooldownMs;
        throw failure;
      }
    })().finally(() => { flight = undefined; });
    return flight;
  };
}
