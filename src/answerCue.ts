import { notebookReplyStatus } from "./notebook.ts";
import type { NotebookEntry } from "./types.ts";

export const answerCueDuration = 60_000;
export function answerCueKey(entry: NotebookEntry) {
  const turn = entry.study?.turns.find(turn => turn.id === entry.study?.activeTurnId) ?? entry.study?.turns.at(-1);
  return `${entry.id}:${turn?.id ?? "legacy"}`;
}
export function answerCueExpiry(entry: NotebookEntry, now: number) {
  const saved = Date.parse(entry.updatedAt);
  return notebookReplyStatus(entry) === "answer" && Number.isFinite(saved)
    ? Math.min(now, saved) + answerCueDuration : 0;
}
/** Remember the first arrival time, so editing notes or refreshing cannot rearm it. */
export function addAnswerCues(previous: Record<string, number>, entries: NotebookEntry[], now: number) {
  let next = previous;
  for (const entry of entries) {
    if (notebookReplyStatus(entry) !== "answer") continue;
    const key = answerCueKey(entry);
    if (Object.hasOwn(previous, key)) continue;
    if (next === previous) next = { ...previous };
    next[key] = answerCueExpiry(entry, now);
  }
  return next;
}
