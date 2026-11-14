/** Keep native textarea input off the workspace render/save path. */
export function createCommentBuffer(initial: string, options: {
  commit: (value: string) => void;
  keep: (value: string, base: string) => void;
  conflict: () => void;
  schedule?: (callback: () => void, delay: number) => unknown;
  cancel?: (timer: unknown) => void;
}) {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? (timer => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let base = initial, value = initial, sent = initial, conflict = false, composing = false;
  let quiet: unknown, deadline: unknown;
  const emitted = new Set<string>();
  function stop() { if (quiet !== undefined) cancel(quiet); if (deadline !== undefined) cancel(deadline); quiet = deadline = undefined; }
  function flush() {
    stop();
    if (composing || conflict || value === sent) return;
    sent = value; emitted.add(value); options.commit(value);
  }
  function change(next: string) {
    value = next; options.keep(value, base);
    if (quiet !== undefined) cancel(quiet);
    quiet = schedule(flush, 450);
    // Long uninterrupted typing still reaches normal autosave/sync periodically.
    if (deadline === undefined) deadline = schedule(flush, 2500);
  }
  return {
    change, flush,
    composition(active: boolean) { composing = active; if (!active) change(value); },
    receive(next: string) {
      if (next === base) return undefined;
      if (next === value || emitted.has(next)) {
        base = next; emitted.delete(next);
        if (next === value) { sent = next; stop(); }
        options.keep(value, base);
        return undefined;
      }
      if (value === base && sent === base) { base = value = sent = next; return next; }
      conflict = true; stop(); options.keep(value, base); options.conflict();
      return undefined;
    },
    dispose() { composing = false; flush(); stop(); },
  };
}
