import type { AppState, RewriteSession, WorkbenchData, WorkbenchRecovery, WorkbenchStore, WorkbenchSync } from "./types.ts";

export function rewriteSourceMatches(session: RewriteSession, paragraph: string | undefined, read?: (id: string) => string | undefined) {
  if (session.selectionSpans) return session.selectionSpans.length >= 2 && session.selectionSpans.length <= 200 && !!read && session.selectionSpans.every(span => { const p = read(span.paragraphId); return p !== undefined && Number.isInteger(span.start) && Number.isInteger(span.end) && span.start >= 0 && span.end > span.start && span.end <= p.length && p.slice(span.start, span.end) === span.text; });
  return paragraph !== undefined && session.end <= paragraph.length && paragraph.slice(session.start, session.end) === session.sourceText;
}

export function emptyWorkbench(): WorkbenchData {
  return { attentionTasks: [], rewriteSessions: [], handoffDrafts: {}, recoveredDrafts: [] };
}
export function workbenchData(state: AppState): WorkbenchData {
  return { ...(state.queueLastActiveAt ? { queueLastActiveAt: state.queueLastActiveAt } : {}), attentionTasks: state.attentionTasks.filter((task) => !task.notebookId), rewriteSessions: state.rewriteSessions,
    handoffDrafts: state.handoffDrafts ?? {}, recoveredDrafts: state.recoveredWorkbenchDrafts ?? [] };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Change detection only, not authentication. Two independent checks plus length bound accidental collisions. */
function recordVersion(value: unknown) {
  // Polls in two tabs may finish at different times without changing any author content.
  const comparable = value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "updatedAt")) : value;
  const text = canonical(comparable); let a = 0x811c9dc5; let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x85ebca6b);
  }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
export function workbenchSync(data: WorkbenchData, revision: number): WorkbenchSync {
  return { revision, records: Object.fromEntries([
    ...data.attentionTasks.map((task) => [`task:${task.id}`, recordVersion(task)]),
    ...data.rewriteSessions.map((session) => [`rewrite:${session.id}`, recordVersion(session)]),
    ...Object.entries(data.handoffDrafts).map(([key, draft]) => [`handoff:${key}`, recordVersion(draft)]),
  ]) };
}

/** Three-way, per-record merge. Missing records are not deletions; conflicts never overwrite author work. */
export function reconcileWorkbench(local: WorkbenchData, remote: WorkbenchData, baseline?: WorkbenchSync): WorkbenchData {
  const recoveredDrafts = new Map<string, WorkbenchRecovery>();
  for (const draft of [...remote.recoveredDrafts, ...local.recoveredDrafts]) {
    const previous = recoveredDrafts.get(draft.id);
    recoveredDrafts.set(draft.id, { ...draft, dismissed: Boolean(previous?.dismissed || draft.dismissed) });
  }
  function merge<T>(kind: WorkbenchRecovery["kind"], locals: Array<[string, T]>, remotes: Array<[string, T]>) {
    const result = new Map(remotes);
    for (const [key, value] of locals) {
      const disk = result.get(key);
      const localVersion = recordVersion(value); const diskVersion = disk === undefined ? undefined : recordVersion(disk);
      const previous = baseline?.records[`${kind}:${key}`];
      if (disk === undefined || localVersion === diskVersion || diskVersion === previous) result.set(key, value);
      else if (localVersion !== previous) {
        // Keep the current editor stable while typing, and retain a complete conflicting disk copy.
        // Deterministic identity deduplicates repeated reloads; neither version is discarded.
        const id = `${kind}:${key}:${diskVersion}`;
        if (!recoveredDrafts.has(id)) recoveredDrafts.set(id, { id, kind, key, value: disk, createdAt: new Date().toISOString() } as WorkbenchRecovery);
        result.set(key, value);
      }
    }
    return [...result];
  }
  const attentionTasks = merge("task", local.attentionTasks.map((t) => [t.id, t]), remote.attentionTasks.map((t) => [t.id, t])).map(([, task]) => task);
  const rewriteSessions = merge("rewrite", local.rewriteSessions.map((s) => [s.id, s]), remote.rewriteSessions.map((s) => [s.id, s])).map(([, session]) => session);
  const handoffDrafts = Object.fromEntries(merge("handoff", Object.entries(local.handoffDrafts), Object.entries(remote.handoffDrafts)));
  // A background/older tab must not roll back the most recent human visit.
  const queueLastActiveAt = [local.queueLastActiveAt, remote.queueLastActiveAt].filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value)))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return { ...(queueLastActiveAt ? { queueLastActiveAt } : {}), attentionTasks, rewriteSessions, handoffDrafts, recoveredDrafts: [...recoveredDrafts.values()] };
}
export function receiveWorkbench(state: AppState, store: WorkbenchStore): AppState {
  const data = reconcileWorkbench(workbenchData(state), store, state.workbenchSync);
  // Notebook persistence owns its own task links. Neither hook replaces the other's records.
  return { ...state, queueLastActiveAt: data.queueLastActiveAt, attentionTasks: [...data.attentionTasks.map((task) => task.subscriptionJobId && ["queued", "working"].includes(task.status)
    ? { ...task, status: "failed" as const, error: "Direct chat connection was removed. Your request is kept." } : task),
    ...state.attentionTasks.filter((task) => task.notebookId)], rewriteSessions: data.rewriteSessions,
    handoffDrafts: data.handoffDrafts, recoveredWorkbenchDrafts: data.recoveredDrafts,
    workbenchSync: workbenchSync(store, store.revision) };
}
export function restoreWorkbenchDraft(state: AppState, id: string): AppState {
  const draft = state.recoveredWorkbenchDrafts?.find((item) => item.id === id && !item.dismissed);
  if (!draft || draft.kind === "handoff") return state;
  const now = new Date().toISOString();
  const recoveredWorkbenchDrafts = state.recoveredWorkbenchDrafts!.map((item) => item.id === id ? { ...item, dismissed: true } : item);
  if (draft.kind === "task") {
    // A restored copy is history, not a new request. Remove runnable job/ticket links; the complete original remains in recovery.
    const task = { ...draft.value, id: crypto.randomUUID(), title: `${draft.value.title} · recovered draft`, status: draft.value.review?.kind === "comment" || draft.value.writing?.kind === "paragraph" && !draft.value.writing.decision ? "queued" as const : "reviewed" as const,
      archivedStatus: draft.value.reply?.trim() || draft.value.replyDraft?.trim() ? "ready" as const : "failed" as const,
      ticket: undefined, sessionId: undefined, localJobId: undefined, subscriptionJobId: undefined,
      error: "Recovered draft. No request was sent again; the original record is kept in Saved work.", updatedAt: now };
    if (task.review?.kind === "comment") task.review = { ...task.review, resolvedAt: undefined };
    return { ...state, recoveredWorkbenchDrafts, attentionTasks: [...state.attentionTasks, task] };
  }
  return { ...state, recoveredWorkbenchDrafts, rewriteSessions: [...state.rewriteSessions,
    { ...draft.value, id: crypto.randomUUID(), status: "stale", updatedAt: now }] };
}
