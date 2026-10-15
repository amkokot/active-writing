import { readHandoffTicket } from "./handoffs.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { ExperimentConflict, readExperiments } from "./experiments.ts";
import { cellText } from "../src/experiments.ts";
import { receiveStudyReply } from "../src/study.ts";

/** Explicit completion, not inference from an edited file or an idle assistant. */
export async function finishResearch(workspace: string, input: { projectId: string; entryId: string; notebookId: string; taskId: string; requestHash: string; summaryCellId: string; revision: string }) {
  if (!/^[a-f0-9]{64}$/.test(input.requestHash) || !/^[A-Za-z0-9_-]{1,64}$/.test(input.summaryCellId) || !/^[a-f0-9]{64}$/.test(input.revision)) throw new Error("Use the exact saved request hash, summary cell ID and notebook revision.");
  const ticket = await readHandoffTicket(workspace, input.projectId, input.taskId);
  if (ticket.notebookTarget?.entryId !== input.entryId || ticket.notebookTarget.notebookId !== input.notebookId || ticket.requestHash !== input.requestHash) throw new Error("This request belongs to a different notebook or prompt. Nothing was finished.");
  const conversations = await readNotebook(workspace, input.projectId), entry = conversations.entries.find(item => item.id === input.entryId);
  const turn = entry?.study?.turns.find(item => item.id === input.taskId);
  if (!entry?.study || (entry.experimentNotebookId ?? entry.id) !== input.notebookId || !turn || turn.ticket?.id !== ticket.id || turn.ticket.requestHash !== ticket.requestHash || turn.closed) throw new Error("Request is missing, closed or not saved yet. Reinspect; human decisions are preserved.");
  const store = await readExperiments(workspace, input.projectId, input.notebookId);
  if (store.revision !== input.revision) throw new ExperimentConflict("Notebook changed. Reinspect before finishing.");
  const cell = store.notebook.cells.find(item => item.id === input.summaryCellId);
  if (!cell || cell.cell_type !== "markdown" || cell.metadata.paperfocus?.deleted || cell.metadata.paperfocus?.filed || !cellText(cell).trim() || cellText(cell).length > 100_000) throw new Error("Choose a nonempty active Markdown summary cell under 100,000 characters.");
  const reply = cellText(cell);
  if (turn.notebookResult && turn.notebookResult.requestHash === input.requestHash && turn.notebookResult.notebookRevision === input.revision && turn.notebookResult.summaryCellId === cell.id && turn.reply === reply) return { finished: true, reused: true, taskId: ticket.id, summaryCellId: cell.id, notebookRevision: input.revision };
  if (turn.status !== "queued" || turn.reply.trim() || turn.notebookResult) throw new Error("This request already has findings. Preserve them and create a follow-up instead.");
  // The record captures a particular notebook revision. Later edits remain possible;
  // they never silently rewrite this completed request's summary.
  if ((await readExperiments(workspace, input.projectId, input.notebookId)).revision !== input.revision) throw new ExperimentConflict("Notebook changed while finishing. Reinspect.");
  const completedAt = new Date().toISOString();
  const study = receiveStudyReply(entry.study, ticket.id, reply);
  const updated = { ...entry, updatedAt: completedAt, study: { ...study, turns: study.turns.map(item => item.id === ticket.id ? { ...item, notebookResult: { requestHash: input.requestHash, notebookRevision: input.revision, summaryCellId: cell.id, completedAt } } : item) } };
  await writeNotebook(workspace, input.projectId, conversations.revision, conversations.entries.map(item => item.id === entry.id ? updated : item));
  return { finished: true, reused: false, taskId: ticket.id, summaryCellId: cell.id, notebookRevision: input.revision };
}
