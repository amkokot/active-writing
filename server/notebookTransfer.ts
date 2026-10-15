import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProject } from "./projects.ts";
import { readNotebook, validateNotebookEntries, writeNotebook } from "./notebookStore.ts";
import { experimentRuntime, readExperiments, writeExperiments } from "./experiments.ts";
import { projectStorage } from "./projectStorage.ts";

/** Catalogue-only transfer: passage links retain their actual source version. */
export async function transferNotebook(workspace: string, input: {
  projectId: string; mainFile: string; revision: string; notebookRevision: number;
  entryIds: string[]; targetFile: string; mode: "move" | "copy"; preview?: boolean;
}) {
  if (!["move", "copy"].includes(input.mode) || (input.preview !== undefined && typeof input.preview !== "boolean")) throw new Error("Choose move or copy and a boolean preview.");
  if (!Array.isArray(input.entryIds) || !input.entryIds.length || input.entryIds.length > 2000 || new Set(input.entryIds).size !== input.entryIds.length || input.entryIds.some(id => typeof id !== "string")) throw new Error("Choose distinct conversation IDs.");
  const document = await parseProject(workspace, input.projectId), notes = await readNotebook(workspace, input.projectId);
  const fence = async () => {
    const latest = await parseProject(workspace, input.projectId);
    if (latest.project.mainFile !== input.mainFile || latest.revision !== input.revision) throw new Error("The selected manuscript or source changed. Save and inspect before retrying.");
  };
  await fence();
  if (notes.revision !== input.notebookRevision) throw new Error("Notebook changed. Save and inspect before retrying.");
  if (!document.rootFiles.includes(input.targetFile)) throw new Error("Choose an existing independent manuscript root in this project.");
  const selected = input.entryIds.map(id => notes.entries.find(entry => entry.id === id));
  if (selected.some(entry => !entry || entry.recoveryKey)) throw new Error("A conversation is missing or is a recovery draft.");
  const entries = selected.map(entry => entry!);
  if (entries.some(entry => (entry.manuscriptFile ?? entry.source?.rootFile ?? input.mainFile) === input.targetFile)) throw new Error("Choose a different destination for every selected conversation.");
  if (entries.some(entry => entry.study?.turns.some(turn => turn.status === "queued" && !turn.closed) || entry.handoffs.some(h => !h.historyOnly && !h.queueHiddenAt && !(h.studyTurnId && entry.study?.turns.some(turn => turn.id === h.studyTurnId && (turn.closed || turn.status !== "queued")))))) throw new Error("Finish waiting requests before transferring their conversations.");
  const owners = new Set(entries.map(entry => entry.experimentNotebookId ?? entry.id));
  const idle = async () => {
    if ((await experimentRuntime()).activeJobs.some(job => job.projectId === input.projectId && owners.has(job.notebookId))) throw new Error("Wait for these experiment runs to finish before transferring.");
  };
  await idle();
  const snapshots = new Map<string, Awaited<ReturnType<typeof readExperiments>>>();
  let bytes = 0;
  if (input.mode === "copy") for (const owner of owners) {
    const snapshot = await readExperiments(workspace, input.projectId, owner);
    bytes += Buffer.byteLength(JSON.stringify(snapshot.notebook));
    if (bytes > 64_000_000) throw new Error("Copy fewer conversations at once (64 MB saved-notebook limit).");
    snapshots.set(owner, snapshot);
  }
  if (input.preview) return { preview: true, mode: input.mode, targetFile: input.targetFile, conversations: entries.map(entry => ({ id: entry.id, title: entry.title })), experimentOwners: owners.size, sourceWrites: false };
  const now = new Date().toISOString(), mapping: Record<string, string> = {};
  const newOwners = new Map([...owners].map(owner => [owner, randomUUID()]));
  const transferred = entries.map(entry => {
    const clone = structuredClone(entry); clone.manuscriptFile = input.targetFile; clone.updatedAt = now;
    if (input.mode === "move") { mapping[entry.id] = entry.id; return clone; }
    const owner = entry.experimentNotebookId ?? entry.id;
    clone.id = randomUUID(); mapping[entry.id] = clone.id;
    clone.experimentNotebookId = newOwners.get(owner)!;
    clone.continuedFrom = { entryId: entry.id, notebookId: owner, manuscriptFile: entry.manuscriptFile ?? entry.source?.rootFile ?? input.mainFile, revision: snapshots.get(owner)!.revision };
    clone.createdAt = now; clone.returnView = undefined;
    const turns = new Map((clone.study?.turns ?? []).map(turn => [turn.id, randomUUID()]));
    clone.handoffs = clone.handoffs.map(h => ({ ...h, id: randomUUID(), studyTurnId: h.studyTurnId && turns.get(h.studyTurnId), historyOnly: true }));
    if (clone.study) {
      clone.study.activeTurnId = clone.study.activeTurnId && turns.get(clone.study.activeTurnId);
      clone.study.turns = clone.study.turns.map(turn => ({ ...turn, id: turns.get(turn.id)!, previousTurnId: turn.previousTurnId && turns.get(turn.previousTurnId), closed: true, ticket: undefined, jobId: undefined, subscriptionJobId: undefined }));
    }
    return clone;
  });
  const replacement = new Map(transferred.map(entry => [entry.id, entry]));
  const updated = input.mode === "move" ? notes.entries.map(entry => replacement.get(entry.id) ?? entry) : notes.entries.concat(transferred);
  validateNotebookEntries(updated);
  const { folder } = await projectStorage(workspace, input.projectId);
  await mkdir(folder, { recursive: true });
  const journal = path.join(folder, `notebook-transfer-${randomUUID()}.json`);
  await writeFile(journal, JSON.stringify({ ...input, entryMapping: mapping, preparedOwners: [...newOwners], createdAt: now }, null, 2), { flag: "wx" });
  try {
    for (const [owner, snapshot] of snapshots) {
      const notebook = structuredClone(snapshot.notebook);
      notebook.metadata = { ...notebook.metadata, awVersionOrigin: { projectId: input.projectId, notebookId: owner, path: snapshot.path, revision: snapshot.revision, copiedAt: now } };
      await writeExperiments(workspace, input.projectId, newOwners.get(owner)!, "", notebook);
    }
    await idle(); await fence();
    for (const [owner, snapshot] of snapshots) if ((await readExperiments(workspace, input.projectId, owner)).revision !== snapshot.revision) throw new Error("Saved experiment evidence changed during preparation.");
    const notebook = await writeNotebook(workspace, input.projectId, input.notebookRevision, updated);
    return { notebook, entryMapping: mapping, targetFile: input.targetFile, mode: input.mode };
  } catch (error) {
    throw new Error(`${(error as Error).message} Preparation retained at ${journal}; inspect before retrying. Original evidence was not overwritten.`);
  }
}
