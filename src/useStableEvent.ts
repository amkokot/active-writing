import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable event identity, with the latest committed handler (never stale props).
 * For user events, not callbacks invoked during rendering. */
export function useStableEvent<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const committed = useRef(handler);
  useLayoutEffect(() => { committed.current = handler; });
  return useCallback((...args: Args) => committed.current(...args), []);
}
