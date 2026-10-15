const writers = new Map<string, () => Promise<void>>();
const key = (projectId: string, notebookId: string) => JSON.stringify([projectId, notebookId]);
/** Only mounted notebook editors register a writer; folded cards have no watcher. */
export function registerExperimentDraft(projectId: string, notebookId: string, flush: () => Promise<void>) {
  const identity = key(projectId, notebookId); writers.set(identity, flush);
  return () => { if (writers.get(identity) === flush) writers.delete(identity); };
}
export async function flushExperimentDraft(projectId: string, notebookId: string) { await writers.get(key(projectId, notebookId))?.(); }
export async function flushProjectExperimentDrafts(projectId: string) {
  for (const [identity, flush] of writers) if (JSON.parse(identity)[0] === projectId) await flush();
}
