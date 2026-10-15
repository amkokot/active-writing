import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState, WorkbenchData, WorkbenchStore } from "./types";
import { receiveWorkbench, workbenchData, workbenchSync } from "./workbench";
import { createJsonSnapshotter, snapshotRequest } from "./jsonSnapshot";
import { useSharedStorePoll } from "./useSharedStorePoll";
import { announceSaved } from "./windowMessages";

async function fetchWorkbench(projectId: string): Promise<WorkbenchStore> {
  const response = await fetch(`/api/paperfocus/workbench?projectId=${encodeURIComponent(projectId)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Saved work is unavailable.");
  return result;
}
export function useWorkbenchPersistence(projectId: string | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>) {
  const generation = useRef(0);
  const revision = useRef(0);
  const saved = useRef("");
  const conflicts = useRef(0);
  const currentProject = useRef(projectId); currentProject.current = projectId;
  const [phase, setPhase] = useState<{ projectId?: string; ready: boolean; saving: boolean; error?: string }>({ ready: false, saving: false });
  const [reload, setReload] = useState(0);
  const pollEtag = useRef<string | undefined>(undefined);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const serialize = useMemo(() => createJsonSnapshotter(), []);
  const snapshot = useMemo(() => serialize(workbenchData(state)), [state.queueLastActiveAt, state.attentionTasks, state.rewriteSessions, state.handoffDrafts, state.recoveredWorkbenchDrafts, serialize]);
  useEffect(() => {
    const run = ++generation.current;
    saved.current = ""; conflicts.current = 0;
    pollEtag.current = undefined;
    setPhase({ projectId, ready: false, saving: false });
    if (!projectId) return;
    let cancelled = false;
    void (async () => { await inFlight.current; if (cancelled || currentProject.current !== projectId) return; return fetchWorkbench(projectId); })().then((result) => {
      if (!result || cancelled || currentProject.current !== projectId) return;
      revision.current = result.revision; saved.current = JSON.stringify(workbenchDataFromStore(result));
      setState((current) => receiveWorkbench(current, result));
      setPhase({ projectId, ready: true, saving: false });
    }).catch((error) => {
      if (!cancelled && generation.current === run && currentProject.current === projectId)
        setPhase({ projectId, ready: false, saving: false, error: String(error.message ?? error) });
    });
    return () => { cancelled = true; };
  }, [projectId, reload, setState]);

  useEffect(() => {
    if (!projectId || phase.projectId !== projectId || !phase.ready || phase.saving || phase.error || snapshot === saved.current) return;
    const run = generation.current;
    const expectedRevision = revision.current;
    const expectedBaseline = saved.current;
    const active = () => generation.current === run && currentProject.current === projectId;
    const timer = window.setTimeout(() => {
      if (inFlight.current || !active() || revision.current !== expectedRevision || saved.current !== expectedBaseline) return;
      setPhase({ projectId, ready: true, saving: true });
      const operation = (async () => {
        const response = await fetch("/api/paperfocus/workbench", { method: "POST", headers: { "Content-Type": "application/json" },
          body: snapshotRequest({ projectId, revision: expectedRevision }, "data", snapshot) });
        const result = await response.json();
        if (!active()) return;
        if (response.status === 409) {
          if (++conflicts.current > 3) throw new Error("Another window keeps editing this paper. Your drafts are kept; retry when its saves finish.");
          const remote = await fetchWorkbench(projectId);
          if (!active()) return;
          revision.current = remote.revision; saved.current = JSON.stringify(workbenchDataFromStore(remote));
          setState((current) => receiveWorkbench(current, remote));
          setPhase({ projectId, ready: true, saving: false });
          return;
        }
        if (!response.ok) throw new Error(result.error ?? "Could not save work to this paper.");
        revision.current = result.revision; saved.current = snapshot; conflicts.current = 0;
        pollEtag.current = undefined; announceSaved(projectId, "workbench");
        setState((current) => ({ ...current, workbenchSync: workbenchSync(result, result.revision) }));
        setPhase({ projectId, ready: true, saving: false });
      })().catch((error) => {
        if (active()) setPhase({ projectId, ready: true, saving: false, error: String(error.message ?? error) });
      });
      inFlight.current = operation;
      void operation.finally(() => { if (inFlight.current === operation) inFlight.current = undefined; });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [projectId, snapshot, phase, setState]);
  const ready = phase.projectId === projectId && phase.ready;
  useSharedStorePoll(projectId, "workbench", ready, async () => {
    if (!projectId || inFlight.current || phase.saving || phase.error) return;
    const run = generation.current;
    const response = await fetch(`/api/paperfocus/workbench?projectId=${encodeURIComponent(projectId)}`, { headers: pollEtag.current ? { "If-None-Match": pollEtag.current } : {} });
    if (generation.current !== run || currentProject.current !== projectId || inFlight.current) return;
    if (response.status === 304) return;
    if (!response.ok) throw new Error("Saved work checking is temporarily unavailable.");
    const remote = await response.json() as WorkbenchStore;
    if (generation.current !== run || currentProject.current !== projectId || inFlight.current) return;
    pollEtag.current = response.headers.get("ETag") ?? undefined;
    const data = JSON.stringify(workbenchDataFromStore(remote));
    if (remote.revision === revision.current && data === saved.current) return;
    revision.current = remote.revision; saved.current = data;
    setState(current => receiveWorkbench(current, remote));
    // The merged bytes can equal our pending draft. Still reschedule against
    // the new disk baseline instead of dropping a now-stale debounce timer.
    setPhase({ projectId, ready: true, saving: false });
  });
  function accept(store: WorkbenchStore) {
    revision.current = store.revision; saved.current = JSON.stringify(workbenchDataFromStore(store)); pollEtag.current = undefined;
    setState(current => receiveWorkbench(current, store));
  }
  return { accept, ready, saving: phase.projectId === projectId && phase.saving, error: phase.projectId === projectId ? phase.error : undefined,
    pending: snapshot !== saved.current, recover: () => setReload((value) => value + 1) };
}
function workbenchDataFromStore(store: WorkbenchStore): WorkbenchData {
  return { ...(store.queueLastActiveAt ? { queueLastActiveAt: store.queueLastActiveAt } : {}), attentionTasks: store.attentionTasks, rewriteSessions: store.rewriteSessions, handoffDrafts: store.handoffDrafts, recoveredDrafts: store.recoveredDrafts };
}
