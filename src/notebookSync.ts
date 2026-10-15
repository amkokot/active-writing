import type { AppState, AttentionTask, NotebookEntry, NotebookStore } from "./types.ts";
import { retireRemoteRequests, studyActions } from "./study.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([key, item]) => key !== "updatedAt" && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function version(value: unknown) {
  const text = canonical(value); let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 0x01000193); b = Math.imul(b ^ text.charCodeAt(text.length - i - 1), 0x85ebca6b); }
  return `${text.length}-${a >>> 0}-${b >>> 0}`;
}
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const keyed = (v: unknown[]): v is Array<Record<string, unknown> & { id: string }> => v.every(item => object(item) && typeof item.id === "string");
export function notebookSync(entries: NotebookEntry[], revision: number): NonNullable<AppState["notebookSync"]> {
  const fields: Record<string, string> = {};
  const visit = (value: unknown, path: string) => {
    fields[path] = version(value);
    if (Array.isArray(value) && keyed(value)) for (const item of value) visit(item, `${path}/${encodeURIComponent(item.id)}`);
    else if (object(value)) for (const [key, item] of Object.entries(value)) visit(item, `${path}/${key}`);
  };
  for (const entry of entries) visit(entry, encodeURIComponent(entry.id));
  return { revision, fields };
}

/** Independent field/turn changes merge. A contested field keeps a complete disk draft. */
export function reconcileNotebook(local: NotebookEntry[], remote: NotebookEntry[], baseline?: AppState["notebookSync"]): NotebookEntry[] {
  const result = new Map(remote.map(entry => [entry.id, entry]));
  for (const entry of local) {
    const disk = result.get(entry.id);
    if (!disk) { result.set(entry.id, entry); continue; }
    let conflict = false;
    const merge = (left: unknown, right: unknown, path: string): unknown => {
      const lv = version(left), rv = version(right), base = baseline?.fields[path];
      if (lv === rv || rv === base) return left;
      if (lv === base) return right;
      if (object(left) && object(right) && !path.endsWith("/source") && !path.endsWith("/returnAnchor")) {
        return Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map(key => [key,
          key === "updatedAt" ? [String(left[key] ?? ""), String(right[key] ?? "")].sort().at(-1) : merge(left[key], right[key], `${path}/${key}`)]));
      }
      if (Array.isArray(left) && Array.isArray(right) && keyed(left) && keyed(right)) {
        const items = new Map(right.map(item => [item.id, item]));
        for (const item of left) items.set(item.id, items.has(item.id) ? merge(item, items.get(item.id), `${path}/${encodeURIComponent(item.id)}`) as typeof item : item);
        return [...items.values()];
      }
      if (left === undefined && base === undefined) return right;
      if (right === undefined && base === undefined) return left;
      conflict = true; return left;
    };
    result.set(entry.id, merge(entry, disk, encodeURIComponent(entry.id)) as NotebookEntry);
    if (conflict) {
      const recoveryKey = `${entry.id}:${version(disk)}`, id = `recovery-${version(recoveryKey)}`;
      if (![...result.values(), ...local].some(item => item.recoveryKey === recoveryKey)) result.set(id, {
        ...disk, id, recoveryKey, title: `${disk.title} · recovered disk draft`, experimentNotebookId: disk.experimentNotebookId ?? disk.id,
        study: disk.study ? { ...disk.study, turns: disk.study.turns.map(turn => ({ ...turn, closed: true })) } : undefined,
      });
    }
  }
  return [...result.values()];
}
export function receiveNotebook(current: AppState, store: NotebookStore): AppState {
  const baseline = current.notebookSync ?? (current.notebookRevision === store.revision ? notebookSync(store.entries, store.revision) : undefined);
  const entries = retireRemoteRequests(reconcileNotebook(current.notebookEntries, store.entries, baseline));
  return { ...current, notebookEntries: entries, notebookRevision: store.revision, notebookSync: notebookSync(store.entries, store.revision), attentionTasks: notebookAttentionTasks(entries, current.attentionTasks, current.activeNodeId) };
}

/** Read-only task projection, shared by the live project and the cross-project catalogue. */
export function notebookAttentionTasks(entries: NotebookEntry[], existing: AttentionTask[], activeNodeId = "document"): AttentionTask[] {
  const tasks = existing.map(task => task.subscriptionJobId && ["queued", "working"].includes(task.status)
    ? { ...task, status: "failed" as const, error: "Direct subscription integration was removed. Saved request retained." } : task);
  for (const entry of entries.filter(item => !item.recoveryKey)) {
    for (const handoff of entry.handoffs.filter(item => !item.studyTurnId && !item.historyOnly)) {
      if (!tasks.some(task => task.id === handoff.id)) tasks.push({ id: handoff.id, notebookId: entry.id, title: `${entry.route} · ${entry.title}`,
        queuePosition: handoff.queuePosition, queueOrderedAt: handoff.queueOrderedAt, deferredAt: handoff.deferredAt, queueColorResetAt: handoff.queueColorResetAt, queueHiddenAt: handoff.queueHiddenAt,
        nodeId: entry.source?.nodeId ?? activeNodeId, paragraphId: entry.source?.paragraphId, route: entry.route, packet: handoff.packet,
        status: entry.status === "integrated" ? "reviewed" : entry.reply.trim() && handoff.id === entry.handoffs.at(-1)?.id ? "ready" : "queued", createdAt: handoff.createdAt, updatedAt: entry.updatedAt });
    }
    for (const turn of entry.study?.turns ?? []) {
      const index = tasks.findIndex(task => task.id === turn.id);
      const task = { ...tasks[index], id: turn.id, notebookId: entry.id, studyTurnId: turn.id,
        queuePosition: turn.queuePosition ?? tasks[index]?.queuePosition, queueOrderedAt: turn.queueOrderedAt ?? tasks[index]?.queueOrderedAt, deferredAt: turn.deferredAt ?? tasks[index]?.deferredAt, queueColorResetAt: turn.queueColorResetAt ?? tasks[index]?.queueColorResetAt, queueHiddenAt: turn.queueHiddenAt,
        title: `${turn.ticket?.label ?? (turn.route === "local" ? "Local" : "External assistant")} · ${studyActions[turn.action]}`,
        nodeId: entry.source?.nodeId ?? activeNodeId, paragraphId: entry.source?.paragraphId, route: turn.route,
        packet: turn.route === "local" ? undefined : turn.packet, ticket: turn.ticket, handoffPath: turn.ticket?.promptPath,
        reply: turn.reply, replyDraft: turn.reply, localJobId: turn.jobId, subscriptionJobId: turn.subscriptionJobId, previousTaskId: turn.previousTurnId,
        error: turn.error ?? (turn.status === "queued" ? tasks[index]?.error : undefined), completedExternally: turn.completedExternally,
        archivedStatus: turn.closed ? turn.status : undefined,
        status: turn.closed ? "reviewed" as const : turn.status === "queued" && turn.jobId ? "working" as const : turn.status,
        createdAt: turn.createdAt, updatedAt: entry.updatedAt };
      if (index >= 0) tasks[index] = task; else tasks.push(task);
    }
  }
  return tasks;
}
