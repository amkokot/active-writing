import { rename } from "node:fs/promises";

// Windows sync/indexing services can briefly hold the destination open.
// Retry the atomic replacement; never delete the original as a fallback.
export async function replaceFile(temporary: string, target: string, move = rename, pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { await move(temporary, target); return; }
    catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await pause(40 * 2 ** attempt);
    }
  }
}
