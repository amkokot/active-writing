import type { AppState, AttentionTask, ProjectDocument } from "./types.ts";

const priority: Record<AttentionTask["status"], number> = { ready: 0, failed: 1, working: 2, queued: 3, reviewed: 4 };

const queueMonth = 30 * 24 * 60 * 60 * 1000;
const queueWeek = 7 * 24 * 60 * 60 * 1000;

/** Fast initial rise, followed by progressively smaller weekly color shifts. */
export function queueAgeWarmth(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const elapsed = Math.min(elapsedMs, queueMonth);
  // Make the first minutes readable, not just a tiny weekly-scale tint shift.
  const firstMinutes = 120_000;
  if (elapsed <= firstMinutes) return .6 * Math.log1p(elapsed / 1000) / Math.log1p(firstMinutes / 1000);
  if (elapsed <= queueWeek) return .6 + .15 * Math.log(elapsed / firstMinutes) / Math.log(queueWeek / firstMinutes);
  return .75 + .25 * Math.log(elapsed / queueWeek) / Math.log(queueMonth / queueWeek);
}

// A blue/slate baseline, then gold → amber → copper → rust. No purple/pink path.
const queueHueStops = [[0, 250], [.45, 235], [.6, 175], [.75, 105], [1, 40]];
export const queueNeighborHueGap = 1.5;
export const queueColorPageSize = 32;

/** A short queue gets a clearer gradient; a full page keeps the gentle floor. */
export function queueNeighborGap(count:number) {
  if(!Number.isFinite(count) || count<2)return 0;
  const size=Math.min(queueColorPageSize,Math.max(2,Math.floor(count)));
  const sparse=(queueColorPageSize-size)/(queueColorPageSize-2);
  return queueNeighborHueGap+6.5*sparse**3;
}

export function queueHue(warmth: number) {
  const value = Number.isFinite(warmth) ? Math.max(0, Math.min(1, warmth)) : 0;
  for (let i = 1; i < queueHueStops.length; i++) {
    const [high, end] = queueHueStops[i], [low, start] = queueHueStops[i - 1];
    if (value <= high) return start + (end - start) * (value - low) / (high - low);
  }
  return 40;
}

function warmthFromHue(hue: number) {
  for (let i = 1; i < queueHueStops.length; i++) {
    const [high, end] = queueHueStops[i], [low, start] = queueHueStops[i - 1];
    if (hue >= end) return low + (high - low) * (start - hue) / (start - end);
  }
  return 1;
}

/** Keep intermediate hues soft, but visible enough to distinguish short waits. */
export function queueColorVariables(warmth: number) {
  const hue = queueHue(warmth);
  const chroma = hue >= 220 ? .09 : hue >= 160 ? .045 + .045 * (hue - 160) / 60 : hue > 105 ? .045 + .075 * (160 - hue) / 55 : .12;
  return { "--queue-hue": hue, "--queue-chroma": chroma };
}

/** Display-only urgency. Queue order is authoritative, including a manual demotion.
 * Lower rows stay cooler even when older; no timestamps or task states are changed. */
export function queueWarmth(queue: AttentionTask[], now = Date.now()): number[] {
  if (!queue.length) return [];
  // Each visible page keeps a gradient inside the same non-pink palette.
  // The spacing adapts to that page's item count, never to a task's status.
  if (queue.length > queueColorPageSize) {
    const pages = [];
    for (let start = 0; start < queue.length; start += queueColorPageSize) pages.push(...queueWarmth(queue.slice(start, start + queueColorPageSize), now));
    return pages;
  }
  const preferred = queue.map(task => {
    const born = Date.parse(task.deferredAt ?? task.createdAt);
    const reset = task.queueColorResetAt ? Date.parse(task.queueColorResetAt) : 0;
    const since = Math.max(Number.isFinite(born) ? born : now, Number.isFinite(reset) ? reset : 0);
    const age = queueAgeWarmth(now - since);
    return age <= .75 ? .45 + .3 * age / .75 : age;
  });
  const step = queueNeighborGap(queue.length);
  let previous = 0;
  return preferred.map((warmth, index) => {
    const ceiling = 250 - (queue.length - 1 - index) * step;
    const hue = Math.min(ceiling, Math.max(queueHue(warmth), previous + (index ? step : 0)));
    previous = hue;
    return warmthFromHue(hue);
  });
}

export function queueWaitLabel(task: AttentionTask, now = Date.now()) {
  const elapsed = Math.max(0, now - Date.parse(task.deferredAt!));
  if (!Number.isFinite(elapsed)) return taskStatusLabel(task);
  const minutes = Math.floor(elapsed / 60_000);
  const duration = minutes < 1 ? "<1 min" : minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} d`;
  return `${task.ticket?.transport === "paste" ? "Check chat" : "Check response"} · ${duration}`;
}

export function waitingQueueAge(task: AttentionTask, now = Date.now()) {
  if (!task.deferredAt || !task.ticket || task.localJobId || !["queued", "working"].includes(task.status)) return 0;
  const since = Math.max(Date.parse(task.deferredAt), task.queueOrderedAt ? Date.parse(task.queueOrderedAt) : 0);
  return Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 600_000)) : 0;
}

export function attentionQueue<T extends AttentionTask>(tasks: T[], now = Date.now()) {
  const ordered = tasks.filter((task) => task.status !== "reviewed" && !task.queueHiddenAt).sort((a, b) => (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER) || priority[a.status] - priority[b.status]
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const positions = new Map(ordered.map((task, i) => [task.id, i]));
  return ordered.sort((a, b) => positions.get(a.id)! - waitingQueueAge(a, now) - (positions.get(b.id)! - waitingQueueAge(b, now)) || positions.get(a.id)! - positions.get(b.id)!);
}

/** Remember leaving a waiting question, without claiming the other app is running. */
export function rememberDeferredTasks(state: AppState, now = new Date().toISOString(), openPromptNotebookId?: string): AppState {
  let changed = false;
  const tasks = state.attentionTasks.map(task => {
    const entry = task.notebookId && state.notebookEntries.find(entry => entry.id === task.notebookId);
    const sameTurn = !task.studyTurnId || Boolean(entry && task.studyTurnId === (entry.study?.activeTurnId ?? entry.study?.turns.at(-1)?.id));
    const here = task.notebookId ? sameTurn && (state.destination === "notebook" && state.activeNotebookId === task.notebookId || openPromptNotebookId === task.notebookId)
      : state.destination === "manuscript" && state.activeNodeId === task.nodeId && (!task.paragraphId || state.activeParagraphId === task.paragraphId);
    if (here || task.deferredAt || !task.ticket || task.localJobId || !["queued", "working"].includes(task.status) || task.review?.kind === "comment") return task;
    changed = true; return { ...task, deferredAt: now };
  });
  return changed ? saveQueueMetadata(state, tasks, now) : state;
}

function saveQueueMetadata(state: AppState, tasks: AttentionTask[], now: string): AppState {
  const metadata = new Map(tasks.filter(task => task.notebookId).map(task => [task.id, { queuePosition: task.queuePosition, queueOrderedAt: task.queueOrderedAt, deferredAt: task.deferredAt, queueColorResetAt: task.queueColorResetAt, queueHiddenAt: task.queueHiddenAt }]));
  return { ...state, attentionTasks: tasks, notebookEntries: state.notebookEntries.map(entry => {
    const relevant = tasks.some(task => task.notebookId === entry.id && task !== state.attentionTasks.find(old => old.id === task.id));
    if (!relevant) return entry;
    return { ...entry, updatedAt: now, handoffs: entry.handoffs.map(handoff => metadata.has(handoff.id) ? { ...handoff, ...metadata.get(handoff.id) } : handoff),
      study: entry.study && { ...entry.study, turns: entry.study.turns.map(turn => metadata.has(turn.id) ? { ...turn, ...metadata.get(turn.id) } : turn) } };
  }) };
}

/** Reset color aging only. Keep ordering, actual waiting times, requests and comments. */
export function resetQueueColors(state: AppState, now = new Date().toISOString()): AppState {
  if (!state.attentionTasks.some(task => task.status !== "reviewed")) return state;
  return saveQueueMetadata(state, state.attentionTasks.map(task => task.status === "reviewed" ? task : { ...task, queueColorResetAt: now }), now);
}

/** Called only on opening/returning to the project or actual human input.
 * A legacy project gets one calm baseline. Background jobs do not call this. */
export function touchQueueActivity(state: AppState, now = new Date().toISOString()): AppState {
  const time = Date.parse(now), last = Date.parse(state.queueLastActiveAt ?? "");
  if (!Number.isFinite(time)) return state;
  if (Number.isFinite(last) && time - last < 60_000) return state;
  const reset = !Number.isFinite(last) || time - last >= queueMonth;
  const next = reset ? resetQueueColors(state, now) : state;
  return { ...next, queueLastActiveAt: now };
}

/** Reorder only live tasks, without changing status, timestamps, notes or source. */
export function moveAttentionTask(state: AppState, id: string, targetId: string, after = false): AppState {
  const queue = attentionQueue(state.attentionTasks);
  const moved = queue.find(task => task.id === id);
  if (!moved || id === targetId || !queue.some(task => task.id === targetId)) return state;
  const remaining = queue.filter(task => task.id !== id);
  remaining.splice(remaining.findIndex(task => task.id === targetId) + Number(after), 0, moved);
  if (remaining.every((task, i) => task.id === queue[i].id)) return state;
  const positions = new Map(remaining.map((task, i) => [task.id, i]));
  const now = new Date().toISOString();
  return saveQueueMetadata(state, state.attentionTasks.map(task => positions.has(task.id) ? { ...task, queuePosition: positions.get(task.id), queueOrderedAt: now } : task), now);
}

/** Live manuscript location, with a safe saved-title fallback for notebook/removed targets. */
export function attentionTaskLocation(task: AttentionTask, document?: Pick<ProjectDocument, "nodes" | "paragraphs">) {
  if (!document || task.notebookId && !task.paragraphId) return task.title;
  const node = document.nodes.find(node => node.id === task.nodeId);
  if (!node) return task.sourceSnapshot?.nodeTitle ?? task.title;
  const path = [], seen = new Set<string>();
  for (let current: typeof node | undefined = node; current && !seen.has(current.id); current = document.nodes.find(n => n.id === current!.parentId)) {
    seen.add(current.id);
    if (["section", "subsection"].includes(current.kind)) path.unshift(`${current.number ? `${current.number} ` : ""}${current.title}`);
  }
  const block = document.paragraphs.filter(p => p.nodeId === node.id).findIndex(p => p.id === task.paragraphId) + 1;
  const item = ["section", "subsection"].includes(node.kind) ? (block ? `Block ${block}` : "Section") : node.title;
  return path.length ? `${path.join(" / ")} — ${item}` : item;
}

export function attentionHistory(tasks: AttentionTask[]) {
  return tasks.filter((task) => task.status === "reviewed" || task.queueHiddenAt).sort((a, b) => (b.queueHiddenAt ?? b.updatedAt).localeCompare(a.queueHiddenAt ?? a.updatedAt) || a.id.localeCompare(b.id));
}

/** Explicit human queue clearing preserves all records and does not pretend any work was reviewed. */
export function setAsideCurrentQueue(tasks: AttentionTask[], now = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Use a valid queue-clearing time.");
  const ids = new Set(attentionQueue(tasks).map(task => task.id));
  return tasks.map(task => ids.has(task.id) ? { ...task, queueHiddenAt: now } : task);
}

export function readyResponseArrivals(previous: AttentionTask[], current: AttentionTask[]) {
  return current.filter((task) => task.status === "ready" && !task.queueHiddenAt && (task.localJobId || task.ticket?.transport === "files" && task.ticket.replyHash)
    && previous.some((saved) => saved.id === task.id && ["queued", "working"].includes(saved.status))).map((task) => task.id);
}

/** One-step return goes to the work immediately before this reply, not an old review. */
export function replyReturnBookmark(state: AppState, task: AttentionTask): NonNullable<AppState["handoffResume"]> {
  const study = state.notebookEntries.find((entry) => entry.id === state.activeNotebookId)?.study;
  const studyTurnId = study?.activeTurnId ?? study?.turns.at(-1)?.id;
  const alreadyHere = task.notebookId
    ? state.destination === "notebook" && state.activeNotebookId === task.notebookId && studyTurnId === task.studyTurnId
    : state.destination === "manuscript" && Boolean(task.paragraphId) && state.activeParagraphId === task.paragraphId && state.activeNodeId === task.nodeId;
  if (alreadyHere && state.handoffResume) return state.handoffResume;
  return { destination: state.destination, activeNotebookId: state.activeNotebookId, activeNodeId: state.activeNodeId,
    activeParagraphId: state.activeParagraphId, focusedNodeId: state.focusedNodeId, lens: state.lens,
    previewMode: state.previewMode, hiddenNodeIds: state.hiddenNodeIds, turbo: state.turbo, blockWindow: state.blockWindow, studyTurnId };
}

/** A prepared manual handoff is not evidence that a web client is running. */
export function waitingPasteHandoffs(tasks: AttentionTask[], hidden: string[] = []) {
  return attentionQueue(tasks).filter((task) => task.ticket?.transport === "paste" && !task.localJobId
    && ["queued", "working"].includes(task.status) && !hidden.includes(task.id));
}

export function attentionTurnNumber(tasks: AttentionTask[], previousId?: string) {
  let turn = 1;
  const seen = new Set<string>();
  for (let id = previousId; id && !seen.has(id);) {
    seen.add(id); const previous = tasks.find((task) => task.id === id);
    if (!previous) break;
    turn++; id = previous.previousTaskId;
  }
  return turn;
}

export function queueAttentionTask(state: AppState, task: AttentionTask): AppState {
  if (state.attentionTasks.some((item) => item.id === task.id)) return state;
  const previous = state.attentionTasks.find((item) => item.id === task.previousTaskId);
  // An explicitly linked continuation consumes the ready notice, not its findings.
  const next = previous?.status === "ready" ? archiveAttentionTask(state, previous.id) : state;
  return { ...next, attentionTasks: [...next.attentionTasks, task] };
}

export function taskStatusLabel(task: AttentionTask) {
  if (task.queueHiddenAt) return "set aside · not reviewed";
  if (task.writing?.kind === "paragraph") return task.writing.decision === "accepted" ? "wording reviewed" : task.writing.decision === "dropped" ? "wording set aside" : task.writing.placement ? "draft in paper · review required" : "proposed wording · review required";
  if (task.reminder) return task.status === "reviewed" ? "in history" : task.reminder.kind === "passage" ? "saved passage" : "unfinished section";
  if (task.review?.kind === "comment") return task.status === "reviewed" ? "resolved" : task.review.author === "human" ? "your comment · unresolved" : "assistant comment · unresolved";
  if (task.review?.kind === "request" && task.status === "ready") return "review imported · comments stay open";
  if (task.status === "reviewed" && task.completedExternally) return "finished elsewhere · no reply imported";
  if (task.status === "ready") return "reply ready";
  if (task.status === "failed") return "needs attention";
  if (task.status === "reviewed") return "in history";
  if (task.localJobId) return task.status === "working" ? "running locally" : "queued locally";
  return task.ticket?.transport === "files" ? task.ticket.notebookTarget ? "awaiting notebook update" : "awaiting response file" : task.ticket?.transport === "paste" ? "awaiting pasted reply" : "handoff prepared";
}

export function canFinishWithoutImport(task: AttentionTask) {
  return task.ticket?.transport === "paste" && !task.localJobId && !task.subscriptionJobId
    && ["queued", "working"].includes(task.status) && !task.reply?.trim() && !task.replyDraft?.trim();
}

/** Explicit user closure, not a manufactured response or a claim about external completion. */
export function finishWithoutImport(state: AppState, id: string): AppState {
  const task = state.attentionTasks.find((item) => item.id === id);
  if (!task || !canFinishWithoutImport(task)) return state;
  const next = archiveAttentionTask(state, id);
  return { ...next, attentionTasks: next.attentionTasks.map((item) => item.id === id ? { ...item, completedExternally: true } : item),
    notebookEntries: next.notebookEntries.map((entry) => entry.id === task.notebookId && entry.study ? { ...entry,
      study: { ...entry.study, turns: entry.study.turns.map((turn) => turn.id === task.studyTurnId ? { ...turn, completedExternally: true } : turn) } } : entry) };
}

/** Preserve packets, findings and author edits. Stopping a local job never schedules it again. */
export function archiveAttentionTask(state: AppState, id: string, stoppedLocal = false): AppState {
  const task = state.attentionTasks.find((item) => item.id === id);
  if (!task || task.status === "reviewed" || task.review?.kind === "comment" || task.writing?.kind === "paragraph") return state;
  const now = new Date().toISOString();
  return { ...state, attentionTasks: state.attentionTasks.map((item) => item.id === id ? { ...item,
    archivedStatus: stoppedLocal ? "failed" : task.status as Exclude<AttentionTask["status"], "reviewed">,
    status: "reviewed", updatedAt: now,
    ...(stoppedLocal ? { error: "Local request stopped. Reopen to inspect the saved work; rerun explicitly if needed." } : {}) } : item),
    progressByNode: task.reminder?.kind === "section" ? { ...state.progressByNode, [task.nodeId]: "done" } : state.progressByNode,
    notebookEntries: state.notebookEntries.map((entry) => {
      if (entry.id !== task.notebookId || !entry.study || !task.studyTurnId) return entry;
      return { ...entry, updatedAt: now, study: { ...entry.study, turns: entry.study.turns.map((turn) => turn.id === task.studyTurnId
        ? { ...turn, closed: true, ...(stoppedLocal ? { status: "failed" as const, error: "Request stopped. Existing explanations remain saved." } : {}) } : turn) } };
    }) };
}

/** Integration consumes ready findings durably, not still-running related work. */
export function archiveReadyNotebookTasks(state: AppState, notebookId: string): AppState {
  return state.attentionTasks.filter((task) => task.notebookId === notebookId && task.status === "ready")
    .reduce((next, task) => archiveAttentionTask(next, task.id), state);
}

export function reopenAttentionTask(state: AppState, id: string): AppState {
  const task = state.attentionTasks.find((item) => item.id === id);
  if (task?.queueHiddenAt) {
    const next = saveQueueMetadata(state, state.attentionTasks.map(item => {
      if (item.id !== id) return item;
      const restored = { ...item }; delete restored.queueHiddenAt; return restored;
    }), new Date().toISOString());
    return task.status === "reviewed" && task.review?.kind !== "comment" ? reopenAttentionTask(next, id) : next;
  }
  if (!task || task.status !== "reviewed" || task.review?.kind === "comment") return state;
  if (task.writing?.kind === "paragraph") {
    if (task.writing.decision === "dropped" && task.writing.placement) return state;
    return { ...state, attentionTasks: state.attentionTasks.map(t => t.id === id && t.writing?.kind === "paragraph" ? { ...t, status: "queued", writing: { ...t.writing, decision: undefined, curatedText: undefined, decidedAt: undefined } } : t) };
  }
  const now = new Date().toISOString();
  // Removed subscription adapters and stopped jobs are never resurrected by a queue action.
  const status = task.subscriptionJobId ? "failed" : task.archivedStatus ?? (task.reply?.trim() ? "ready" : task.error ? "failed" : "queued");
  return { ...state, attentionTasks: state.attentionTasks.map((item) => item.id === id ? { ...item, status, archivedStatus: undefined, completedExternally: undefined, updatedAt: now, ...(task.reminder ? { queueColorResetAt: now } : {}) } : item),
    progressByNode: task.reminder?.kind === "section" ? { ...state.progressByNode, [task.nodeId]: "progress" } : state.progressByNode,
    notebookEntries: state.notebookEntries.map((entry) => {
      if (entry.id !== task.notebookId || !entry.study || !task.studyTurnId) return entry;
      return { ...entry, updatedAt: now, study: { ...entry.study, turns: entry.study.turns.map((turn) => turn.id === task.studyTurnId ? { ...turn, closed: false, completedExternally: undefined } : turn) } };
    }) };
}
