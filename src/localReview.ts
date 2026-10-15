import type { StudyGuidance } from "./types.ts";
import type { NotebookEntry } from "./types.ts";
import { fingerprint } from "./rewrite.ts";

export const reviewToolNames = ["search_paper", "read_passage", "read_experiments", "lookup_citation"] as const;
export type ReviewToolName = typeof reviewToolNames[number];
export interface ReviewTrace { name: ReviewToolName; requestedBy: "model" | "fallback"; arguments: string; result: string }
export interface LocalSecondLook {
  status: "ready" | "failed";
  model: string;
  sourceRevision: string;
  draftFingerprint: string;
  summary: string;
  observations: Array<{ observation: string; sourceId: string; quote: string; nextCheck: string }>;
  tools: ReviewTrace[];
  durationMs: number;
  rawReply?: string;
  error?: string;
}
export function canUseSecondLook(effort: number, guidance?: StudyGuidance, statementOnly = false) {
  return effort > 0 && guidance !== "hint" && !statementOnly;
}
export function secondLookContext(entry: NotebookEntry) {
  if (entry.study?.benchmark?.phase === "attempt" || entry.study?.guidance === "hint") return "";
  const turns = entry.study?.turns ?? [];
  const active = turns.find(item => item.id === entry.study?.activeTurnId) ?? turns.at(-1);
  const turn = active?.reply.trim() ? active : [...turns].reverse().find(item => item.reply.trim());
  const review = turn?.secondLook;
  if (review?.status !== "ready" || !review.observations.length || review.draftFingerprint !== fingerprint(turn!.reply)) return "";
  return `Second look at saved paper version ${review.sourceRevision.slice(0, 12)} (unchecked suggestions, not independent verification):\n` +
    review.observations.map(item => `${item.observation}\nQuoted ${item.sourceId}: ${item.quote}\nNext check: ${item.nextCheck}`).join("\n\n").slice(0, 1800);
}
export function validateSecondLook(value: unknown): asserts value is LocalSecondLook {
  const result = value as LocalSecondLook;
  const text = (item: unknown, max: number) => typeof item === "string" && item.length <= max;
  if (!result || !["ready", "failed"].includes(result.status) || !text(result.model, 151) || !text(result.sourceRevision, 100)
    || !text(result.draftFingerprint, 100) || !text(result.summary, 800) || !Number.isFinite(result.durationMs) || result.durationMs < 0
    || !Array.isArray(result.observations) || result.observations.length > 3 || !Array.isArray(result.tools) || result.tools.length > 2
    || (result.rawReply !== undefined && !text(result.rawReply, 10000)) || (result.error !== undefined && !text(result.error, 1000))) throw new Error("Invalid saved second look.");
  for (const item of result.observations) if (!item || !text(item.observation, 600) || !text(item.nextCheck, 600) || !text(item.quote, 300) || !text(item.sourceId, 150)) throw new Error("Invalid saved review observation.");
  for (const tool of result.tools) if (!tool || !reviewToolNames.includes(tool.name) || !["model", "fallback"].includes(tool.requestedBy) || !text(tool.arguments, 1000) || !text(tool.result, 6000)) throw new Error("Invalid saved review tool record.");
}
