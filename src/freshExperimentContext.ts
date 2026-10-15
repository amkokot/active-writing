import { experimentContext, validateExperimentNotebook, type ExperimentStore } from "./experiments.ts";
import type { NotebookEntry } from "./types.ts";
import { flushExperimentDraft } from "./experimentDrafts.ts";
import type { EvidenceSnapshot } from "./experimentEvidence.ts";
/** Fetch at submission, even if the experiment catalogue is folded/unmounted.
 * Expanded evidence is transient: the durable entry keeps its compact summary. */
export async function freshExperimentStore(entry: NotebookEntry, projectId: string, request: typeof fetch = fetch) {
  const notebookId = entry.experimentNotebookId ?? entry.id;
  await flushExperimentDraft(projectId, notebookId);
  const response = await request(`/api/paperfocus/experiments?${new URLSearchParams({ projectId, notebookId })}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Couldn't read saved experiments. Your question is kept; retry before sending it.");
  const store = await response.json() as ExperimentStore;
  validateExperimentNotebook(store.notebook);
  return store;
}
export async function freshExperimentContext(entry: NotebookEntry, projectId: string, scope: "compact" | "expanded", request: typeof fetch = fetch) {
  const notebookId = entry.experimentNotebookId ?? entry.id;
  const store = await freshExperimentStore(entry, projectId, request);
  return { context: store.notebook.cells.length ? experimentContext(store.notebook, notebookId, scope, store.path) : "", compact: store.notebook.cells.length ? experimentContext(store.notebook, notebookId, "compact", store.path) : "", revision: store.revision };
}
/** Snapshot preparation never sends material to a model or executes code. */
export async function saveFreshExperimentEvidence(entry: NotebookEntry, projectId: string, request: typeof fetch = fetch): Promise<EvidenceSnapshot> {
  const notebookId = entry.experimentNotebookId ?? entry.id;
  const store = await freshExperimentStore(entry, projectId, request);
  const response = await request("/api/paperfocus/experiments/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, entryId: entry.id, notebookId, revision: store.revision }), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Restart the Aw service to save evidence files. Your question is kept.");
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.error || "Couldn't save complete evidence. Your question is kept.");
  }
  const snapshot = await response.json() as EvidenceSnapshot;
  if (snapshot.projectId !== projectId || snapshot.entryId !== entry.id || snapshot.notebookId !== notebookId || snapshot.revision !== store.revision || !/^[a-f0-9]{64}$/.test(snapshot.id) || !snapshot.files?.notebook || !snapshot.files?.text) throw new Error("Evidence response belongs to another notebook; nothing was shared.");
  return snapshot;
}
