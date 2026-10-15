import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState, NotebookStore } from "./types";
import { receiveNotebook, notebookSync } from "./notebookSync";
import { createJsonSnapshotter, snapshotRequest } from "./jsonSnapshot";
import { useSharedStorePoll } from "./useSharedStorePoll";
import { announceSaved } from "./windowMessages";

async function fetchNotebook(projectId: string): Promise<NotebookStore> {
  const response = await fetch(`/api/paperfocus/notebook?projectId=${encodeURIComponent(projectId)}`), result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Notebook unavailable."); return result;
}
export function useNotebookPersistence(projectId: string | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>, onHydrated?: (store: NotebookStore) => void) {
  const hydrationCallback = useRef(onHydrated); hydrationCallback.current = onHydrated;
  const latestState = useRef(state); latestState.current = state;
  const generation = useRef(0), revision = useRef(0), saved = useRef(""), conflicts = useRef(0);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const [phase, setPhase] = useState<{ projectId?: string; ready: boolean; saving: boolean; error?: string }>({ ready: false, saving: false });
  const [reload, setReload] = useState(0);
  const pollEtag = useRef<string | undefined>(undefined);
  const serialize = useMemo(() => createJsonSnapshotter(), []);
  const snapshot = useMemo(() => serialize(state.notebookEntries), [state.notebookEntries, serialize]);
  useEffect(() => {
    const run = ++generation.current; saved.current = ""; conflicts.current = 0;
    pollEtag.current = undefined;
    const active = () => generation.current === run && currentProject.current === projectId;
    setPhase({ projectId, ready: false, saving: false });
    if (!projectId) return;
    // Finish an older POST before reading the baseline. Its completion cannot
    // acknowledge this new hydration/project generation.
    void (async () => {
      await inFlight.current;
      if (!active()) return;
      const result = await fetchNotebook(projectId);
      if (!active()) return;
      revision.current = result.revision; saved.current = JSON.stringify(result.entries);
      setState(current => receiveNotebook(current, result));
      hydrationCallback.current?.(result);
      setPhase({ projectId, ready: true, saving: false });
    })().catch(error => { if (active()) setPhase({ projectId, ready: false, saving: false, error: String(error.message ?? error) }); });
    return () => { if (generation.current === run) generation.current++; };
  }, [projectId, reload, setState]);
  useEffect(() => {
    if (!projectId || phase.projectId !== projectId || !phase.ready || phase.saving || phase.error || snapshot === saved.current) return;
    const run = generation.current, active = () => generation.current === run && currentProject.current === projectId;
    const expectedRevision = revision.current;
    const expectedBaseline = saved.current;
    const timer = window.setTimeout(() => {
      if (inFlight.current || !active() || revision.current !== expectedRevision || saved.current !== expectedBaseline) return;
      setPhase({ projectId, ready: true, saving: true });
      const operation = (async () => {
        const response = await fetch("/api/paperfocus/notebook", { method: "POST", headers: { "Content-Type": "application/json" }, body: snapshotRequest({ projectId, revision: expectedRevision }, "entries", snapshot) });
        const result = await response.json();
        if (!active()) return;
        if (response.status === 409) {
          if (++conflicts.current > 3) throw new Error("Another window keeps editing this notebook. Your drafts are kept; retry when its saves finish.");
          const remote = await fetchNotebook(projectId);
          if (!active()) return;
          revision.current = remote.revision; saved.current = JSON.stringify(remote.entries);
          setState(current => receiveNotebook(current, remote));
        } else {
          if (!response.ok) throw new Error(result.error ?? "Could not save notebook.");
          revision.current = result.revision; saved.current = snapshot; conflicts.current = 0;
          pollEtag.current = undefined; announceSaved(projectId, "notebook");
          setState(current => ({ ...current, notebookRevision: result.revision, notebookSync: notebookSync(result.entries, result.revision) }));
        }
        setPhase({ projectId, ready: true, saving: false });
      })().catch(error => { if (active()) setPhase({ projectId, ready: true, saving: false, error: String(error.message ?? error) }); });
      inFlight.current = operation;
      void operation.finally(() => { if (inFlight.current === operation) inFlight.current = undefined; });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [projectId, snapshot, phase, setState]);
  const ready = phase.projectId === projectId && phase.ready;
  useSharedStorePoll(projectId, "notebook", ready, async () => {
    if (!projectId || inFlight.current || phase.saving || phase.error) return;
    const run = generation.current;
    const response = await fetch(`/api/paperfocus/notebook?projectId=${encodeURIComponent(projectId)}`, { headers: pollEtag.current ? { "If-None-Match": pollEtag.current } : {} });
    if (generation.current !== run || currentProject.current !== projectId || inFlight.current) return;
    if (response.status === 304) return;
    if (!response.ok) throw new Error("Notebook checking is temporarily unavailable.");
    const remote = await response.json() as NotebookStore;
    if (generation.current !== run || currentProject.current !== projectId || inFlight.current) return;
    pollEtag.current = response.headers.get("ETag") ?? undefined;
    const entries = JSON.stringify(remote.entries);
    if (remote.revision === revision.current && entries === saved.current) return;
    revision.current = remote.revision; saved.current = entries;
    setState(current => receiveNotebook(current, remote));
    setPhase({ projectId, ready: true, saving: false });
  });
  function accept(store: NotebookStore) {
    revision.current = store.revision; saved.current = JSON.stringify(store.entries); pollEtag.current = undefined;
    setState(current => receiveNotebook(current, store));
  }
  async function flush(): Promise<NotebookStore> {
    if (!projectId || !ready || phase.error) throw new Error("Wait for notebook saving, or recover its draft before making a version.");
    const run = generation.current;
    await inFlight.current;
    if (generation.current !== run || currentProject.current !== projectId) throw new Error("The project changed while saving notes.");
    setPhase({ projectId, ready: true, saving: true });
    const operation = (async () => {
      // Reserve the writer during this read/merge interval so an older debounce
      // cannot start a second POST. Reconcile even before React hydration commits.
      const remote = await fetchNotebook(projectId);
      if (generation.current !== run || currentProject.current !== projectId) throw new Error("The project changed while saving notes.");
      const entries = receiveNotebook(latestState.current, remote).notebookEntries, json = JSON.stringify(entries);
      revision.current = remote.revision; saved.current = JSON.stringify(remote.entries);
      if (json === saved.current) { accept(remote); return remote; }
      const expected = revision.current;
      const response = await fetch("/api/paperfocus/notebook", { method: "POST", headers: { "Content-Type": "application/json" }, body: snapshotRequest({ projectId, revision: expected }, "entries", json) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save the notebook.");
      if (generation.current !== run || currentProject.current !== projectId) throw new Error("The project changed while saving notes.");
      accept(result); announceSaved(projectId, "notebook"); return result as NotebookStore;
    })();
    const tracked = operation.then(() => undefined, () => undefined); inFlight.current = tracked;
    try { return await operation; }
    finally { if (inFlight.current === tracked) inFlight.current = undefined; if (generation.current === run) setPhase({ projectId, ready: true, saving: false }); }
  }
  return { flush, accept, ready, saving: phase.projectId === projectId && phase.saving, error: phase.projectId === projectId ? phase.error : undefined,
    pending: snapshot !== saved.current, recover: () => setReload(value => value + 1) };
}
