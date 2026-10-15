import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppState, ProjectDocument, ProgressState } from "./types";
import { windowStateCache } from "./windowCache";
import { sendWindowMessage, subscribeWindowMessages } from "./windowMessages";

export function useWindowWorkspace(document: ProjectDocument | undefined, state: AppState, setState: Dispatch<SetStateAction<AppState>>) {
  const baseline = useRef<{ projectId: string; rootFile: string; revision: string; progress: AppState["progressByNode"] } | undefined>(undefined);
  useEffect(() => {
    let cache: ReturnType<typeof windowStateCache>;
    try { cache = windowStateCache(); cache.touch(); } catch { return; }
    const heartbeat = () => { try { cache.touch(); } catch { /* Optional browser recovery cache. */ } };
    const release = () => { try { cache.release(); } catch { /* A crashed window's lease also expires. */ } };
    const timer = window.setInterval(heartbeat, 20_000); window.addEventListener("pagehide", release); window.addEventListener("pageshow", heartbeat);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", release); window.removeEventListener("pageshow", heartbeat); release(); };
  }, []);
  useEffect(() => {
    if (!document) return;
    const previous = baseline.current;
    baseline.current = { projectId: document.project.id, rootFile: document.project.mainFile, revision: document.revision, progress: state.progressByNode };
    if (!previous || previous.projectId !== document.project.id || previous.rootFile !== document.project.mainFile || previous.revision !== document.revision) return;
    const changes = Object.fromEntries([...new Set([...Object.keys(previous.progress), ...Object.keys(state.progressByNode)])]
      .filter(id => previous.progress[id] !== state.progressByNode[id] && document.nodes.some(n => n.id === id)).map(id => [id, state.progressByNode[id] ?? null]));
    if (Object.keys(changes).length) sendWindowMessage({ kind: "progress", projectId: document.project.id, revision: document.revision, rootFile: document.project.mainFile, changes });
  }, [document?.project.id, document?.project.mainFile, document?.revision, state.progressByNode]);
  useEffect(() => subscribeWindowMessages(message => {
    if (message.kind !== "progress" || !document || message.projectId !== document.project.id || message.revision !== document.revision || message.rootFile !== document.project.mainFile) return;
    setState(current => {
      const progressByNode = { ...current.progressByNode }; let changed = false;
      for (const [id, value] of Object.entries(message.changes)) {
        if (!document.nodes.some(n => n.id === id) || progressByNode[id] === (value ?? undefined)) continue;
        if (value === null) delete progressByNode[id]; else progressByNode[id] = value as ProgressState; changed = true;
      }
      if (!changed) return current;
      baseline.current = { projectId: document.project.id, rootFile: document.project.mainFile, revision: document.revision, progress: progressByNode };
      return { ...current, progressByNode };
    });
  }), [document?.project.id, document?.project.mainFile, document?.revision, setState]);
}
