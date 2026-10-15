import { createWindowStateCache, readWindowRequest } from "./windowWorkspace.ts";
import { workspaceWindowId } from "./windowMessages.ts";
import { initializeLargerRecovery, type RecoveryStorage } from "./largerBrowserRecovery.ts";
let cache: ReturnType<typeof createWindowStateCache> | undefined;
let shared: RecoveryStorage | undefined;
export const sharedRecoveryStorage = () => shared ?? localStorage;
export async function initializeWindowRecovery() {
  try { shared = await initializeLargerRecovery(localStorage); } catch { /* Blocked storage retains existing diagnostics. */ }
}
export function windowStateCache() {
  return cache ??= createWindowStateCache(sharedRecoveryStorage(), sessionStorage, workspaceWindowId);
}
export const initialWindowRequest = typeof window === "undefined" ? undefined : readWindowRequest(window.location.search);
