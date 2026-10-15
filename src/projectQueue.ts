import type { AttentionTask, PaperProject } from "./types.ts";
import { attentionQueue } from "./attention.ts";

export type QueueScope = "project" | "all";
export interface QueueView {
  scope: QueueScope;
  order: string[];
  orderedAt?: string;
  colorsResetAt?: string;
  lastActiveAt?: string;
}
export interface ProjectQueueTask extends AttentionTask {
  projectId: string;
  projectName: string;
  taskId: string;
  location: string;
}
export interface ProjectQueueCatalogue { tasks: ProjectQueueTask[]; errors: Array<{ projectId: string; projectName: string; error: string }> }
export const queueViewKey = "active-writing.queue-view.v1";
export const defaultQueueView: QueueView = { scope: "project", order: [] };
export const projectQueueId = (projectId: string, taskId: string) => `${encodeURIComponent(projectId)}:${encodeURIComponent(taskId)}`;
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function loadQueueView(storage?: Pick<Storage, "getItem">): QueueView {
  try {
    const saved = JSON.parse(storage?.getItem(queueViewKey) ?? "null");
    return { scope: saved?.scope === "all" ? "all" : "project", order: Array.isArray(saved?.order) ? [...new Set<string>(saved.order.filter((id: unknown): id is string => typeof id === "string" && id.length <= 1000))].slice(0, 20_000) : [],
      ...(date(saved?.orderedAt) ? { orderedAt: saved.orderedAt } : {}), ...(date(saved?.colorsResetAt) ? { colorsResetAt: saved.colorsResetAt } : {}), ...(date(saved?.lastActiveAt) ? { lastActiveAt: saved.lastActiveAt } : {}) };
  } catch { return { ...defaultQueueView, order: [] }; }
}

/** View identity is namespaced; never save these IDs or display positions into a paper. */
export function projectQueueTask(project: Pick<PaperProject, "id" | "name">, task: AttentionTask, location = task.sourceSnapshot?.nodeTitle ?? task.title): ProjectQueueTask {
  return { ...task, id: projectQueueId(project.id, task.id), taskId: task.id, projectId: project.id, projectName: project.name, location };
}

export function scopedProjectQueue(project: Pick<PaperProject, "id" | "name"> | undefined, local: AttentionTask[], other: ProjectQueueTask[], view: QueueView, location: (task: AttentionTask) => string = t => t.title): ProjectQueueTask[] {
  if (!project) return [];
  const here = local.map(task => projectQueueTask(project, task, location(task)));
  if (view.scope === "project") return here;
  const combined = [...here, ...other.filter(task => task.projectId !== project.id)];
  const baseline = attentionQueue(combined);
  const positions = new Map(view.order.map((id, index) => [id, index]));
  const ranked = view.order.length ? [...baseline].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity)) : baseline;
  const rank = new Map(ranked.map((task, i) => [task.id, i]));
  return combined.map(task => ({ ...task,
    ...(view.order.length && task.status !== "reviewed" ? { queuePosition: rank.get(task.id), queueOrderedAt: view.orderedAt && (!task.queueOrderedAt || view.orderedAt > task.queueOrderedAt) ? view.orderedAt : task.queueOrderedAt } : {}),
    ...(view.colorsResetAt && (!task.queueColorResetAt || view.colorsResetAt > task.queueColorResetAt) ? { queueColorResetAt: view.colorsResetAt } : {}) }));
}

/** Advance without resolving, restarting or repeatedly opening the active item. */
export function nextQueueTask<T extends AttentionTask>(queue: T[], activeId?: string): T | undefined {
  const index = queue.findIndex(task => task.id === activeId);
  if (index < 0) return queue[0];
  return queue.length > 1 ? queue[(index + 1) % queue.length] : undefined;
}
export function moveProjectQueue(view: QueueView, tasks: ProjectQueueTask[], id: string, targetId: string, after = false, now = new Date().toISOString()): QueueView {
  const queue = attentionQueue(tasks), moved = queue.find(task => task.id === id);
  if (!moved || id === targetId || !queue.some(task => task.id === targetId)) return view;
  const remaining = queue.filter(task => task.id !== id);
  remaining.splice(remaining.findIndex(task => task.id === targetId) + Number(after), 0, moved);
  return { ...touchQueueView(view, now), order: remaining.map(task => task.id), orderedAt: now };
}
export function touchQueueView(view: QueueView, now = new Date().toISOString()): QueueView {
  const inactive = date(view.lastActiveAt) && Date.parse(now) - Date.parse(view.lastActiveAt) >= 30 * 86400_000;
  return { ...view, lastActiveAt: now, ...(inactive ? { colorsResetAt: now } : {}) };
}
