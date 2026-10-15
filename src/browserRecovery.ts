/** Browser recovery supplements independent disk saves. Do not classify a cache
 * failure as a project-load failure or let its warning outlive a successful save. */
export function browserRecoveryFailure(error: unknown): string {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const reason = name === "QuotaExceededError" ? "browser storage is full"
    : name === "SecurityError" ? "browser storage access is blocked"
    : "browser storage could not be updated";
  const detail = error && typeof error === "object" && "recoveryStorage" in error ? error.recoveryStorage as { area?: string; characters?: number } : undefined;
  const location = detail && ["local", "session"].includes(detail.area ?? "") && typeof detail.characters === "number"
    ? ` (${detail.area === "local" ? "shared browser cache" : "this tab's cache"}; ${Math.ceil(detail.characters * 2 / 1024)} KB write)` : "";
  const stage = error && typeof error === "object" && "recoveryStage" in error && error.recoveryStage === "checkpoint" ? " Shared checkpoint could not be updated." : "";
  return `Browser recovery unavailable: ${reason}${location}.${stage} Disk saves are independent. Keep this window open until pending work saves to disk.`;
}

function compactBrowserRecovery() {
  // Storage access itself can be blocked; preserve the original warning then.
  if (typeof window === "undefined") return;
  for (const storage of [() => window.localStorage, () => window.sessionStorage]) {
    try { const cache = storage(); compactBrowserExperimentRecoveries(cache); packInactiveBrowserRecoveries(cache); } catch { /* No blind eviction. */ }
  }
}

export function saveBrowserRecovery(save: () => void, recoverQuota = compactBrowserRecovery): string | undefined {
  try { save(); return undefined; }
  catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError") {
      try { recoverQuota(); save(); return undefined; }
      catch (retryError) { return browserRecoveryFailure(retryError); }
    }
    return browserRecoveryFailure(error);
  }
}
import { compactBrowserExperimentRecoveries, packInactiveBrowserRecoveries } from "./windowWorkspace.ts";

