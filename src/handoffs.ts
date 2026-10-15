import type { AppState, AttentionTask, HandoffTicket, RewriteCandidate } from "./types.ts";
import { receiveStudyReply } from "./study.ts";
import { fingerprint, sameProtectedLatex } from "./rewrite.ts";
import { receiveReviewReply } from "./review.ts";
import { receiveWritingReply } from "./writing.ts";

export async function exportHandoff(projectId: string, packet: string, route: AttentionTask["route"], options: { id?: string; label?: string; notebookTarget?: HandoffTicket["notebookTarget"] } = {}): Promise<HandoffTicket> {
  const response = await fetch("/api/paperfocus/handoff", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, id: options.id, content: packet, transport: route === "codex" ? "files" : "paste", label: options.label, notebookTarget: options.notebookTarget }) });
  const result = await response.json();
  if (!response.ok || !result.ticket) throw new Error(result.error ?? "Couldn't save the prompt file. Your draft is kept.");
  return result.ticket;
}

export async function fetchHandoffTicket(projectId: string, id: string): Promise<HandoffTicket> {
  const response = await fetch(`/api/paperfocus/handoff/ticket?${new URLSearchParams({ projectId, id })}`);
  const result = await response.json();
  if (!response.ok || !result.ticket) throw new Error(result.error ?? "Couldn't read the saved prompt. Nothing was copied.");
  return result.ticket;
}

/** Relocation changes file pointers only, not task progress or accepted findings. */
export function refreshHandoffTicket(state: AppState, taskId: string, ticket: HandoffTicket): AppState {
  const task = state.attentionTasks.find(item => item.id === taskId), old = task?.ticket;
  if (!old || old.id !== ticket.id || old.requestHash !== ticket.requestHash || old.transport !== ticket.transport || old.label !== ticket.label) return state;
  if (old.promptPath === ticket.promptPath && old.responsePath === ticket.responsePath && old.copyText === ticket.copyText) return state;
  const refreshed = { ...ticket, replyHash: old.replyHash };
  const directory = ticket.promptPath.slice(0, -"prompt.md".length);
  return { ...state,
    attentionTasks: state.attentionTasks.map(item => item.id !== taskId ? item : { ...item, ticket: refreshed, handoffPath: ticket.promptPath,
      ...(item.review?.kind === "request" ? { review: { ...item.review,
        ...(item.review.instructionsPath ? { instructionsPath: `${directory}REVIEW_INSTRUCTIONS.txt` } : {}),
        ...(item.review.webPath ? { webPath: `${directory}review-for-chat.txt` } : {}) } } : {}) }),
    notebookEntries: state.notebookEntries.map(entry => !entry.study?.turns.some(turn => turn.ticket?.id === ticket.id) ? entry : { ...entry,
      study: { ...entry.study, turns: entry.study.turns.map(turn => turn.ticket?.id === ticket.id && turn.ticket.requestHash === ticket.requestHash ? { ...turn, ticket: refreshed } : turn) } }),
  };
}

/** Bind by explicit task ID, never by title, open pane or guessed relevance. */
export function receiveHandoffReply(state: AppState, taskId: string, reply: string, replyHash?: string): AppState {
  const task = state.attentionTasks.find((item) => item.id === taskId);
  if (task?.writing?.kind === "paragraph") return state;
  if (task?.writing?.kind === "request") return receiveWritingReply(state, taskId, reply, replyHash);
  if (task?.review?.kind === "comment") return state;
  if (task?.review?.kind === "request") return receiveReviewReply(state, taskId, reply, replyHash);
  if (!task || task.status === "reviewed" || (replyHash && (task.status === "ready" || task.ticket?.replyHash === replyHash))) return state;
  const entry = state.notebookEntries.find((item) => item.id === task.notebookId);
  const turn = entry?.study?.turns.find((item) => item.id === task.studyTurnId);
  // A file must never replace a manual reply, an edited finding, or a closed request.
  if (replyHash && (turn?.closed || turn?.reply.trim() || task.reply?.trim())) return state;
  const now = new Date().toISOString();
  const ticket = task.ticket ? { ...task.ticket, ...(replyHash ? { replyHash } : {}) } : undefined;
  return { ...state,
    attentionTasks: state.attentionTasks.map((item) => item.id === taskId ? { ...item, ticket, reply, replyDraft: reply,
      authorEditedReply: item.authorEditedReply || (!replyHash && Boolean(item.reply?.trim()) && item.reply !== reply),
      error: undefined, status: reply.trim() ? "ready" : "queued", updatedAt: now } : item),
    notebookEntries: state.notebookEntries.map((item) => {
      if (item.id !== task.notebookId) return item;
      if (item.study && task.studyTurnId) {
        const study = receiveStudyReply(item.study, task.studyTurnId, reply);
        return { ...item, updatedAt: now, study: { ...study, turns: study.turns.map((saved) => saved.id === task.studyTurnId ? { ...saved, ticket } : saved) } };
      }
      return { ...item, reply, updatedAt: now };
    }),
    rewriteSessions: state.rewriteSessions.map((session) => {
      if (session.id !== task.sessionId || !reply.trim()) return session;
      // Optional machine-readable alternatives; ordinary prose stays in the reply pane.
      let candidates: unknown;
      try { candidates = JSON.parse(reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")).candidates; } catch { return session; }
      if (!Array.isArray(candidates) || candidates.length > 12) return session;
      const additions: RewriteCandidate[] = candidates.filter((text): text is string => typeof text === "string" && !!text.trim() && text.length <= 16000 && sameProtectedLatex(session.sourceText, text))
        .map((text) => ({ id: `handoff-${task.id}-${fingerprint(text)}`, text, source: task.ticket?.label ?? "External reply", dismissed: false, userEdited: false }))
        .filter((candidate) => !session.candidates.some((existing) => existing.id === candidate.id));
      return { ...session, candidates: [...session.candidates, ...additions], selectedCandidateId: session.selectedCandidateId ?? additions[0]?.id, updatedAt: now };
    }),
  };
}
