/** Exact evidence read without transferring unrelated notebook outputs. */
import path from "node:path";
import { readNotebook } from "./notebookStore.ts";
import { readExperiments } from "./experiments.ts";
import { projectStorage } from "./projectStorage.ts";
import { checkExperimentInputs } from "./experimentInputs.ts";
import { experimentStaleness } from "../src/experiments.ts";
import { savedOutputLabel } from "../src/experimentActions.ts";

export async function readResearchCell(workspace: string, projectId: string, entryId: string, cellId: string, outputIndex?: string, expectedOwner?: string) {
  if (![entryId, cellId].every(id => /^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error("Choose exact conversation and cell IDs.");
  const conversations = await readNotebook(workspace, projectId), entry = conversations.entries.find(entry => entry.id === entryId);
  if (!entry) throw new Error("Conversation not found in this paper.");
  const notebookId = entry.experimentNotebookId ?? entry.id;
  if (expectedOwner && expectedOwner !== notebookId) throw new Error("Bound notebook ownership changed; confirm its intended owner.");
  const store = await readExperiments(workspace, projectId, notebookId), cell = store.notebook.cells.find(cell => cell.id === cellId);
  if (!cell) throw new Error("Cell not found.");
  let inputCheck;
  if (cell.metadata.paperfocus?.execution?.inputs?.length) {
    const roots = await projectStorage(workspace, projectId);
    inputCheck = await checkExperimentInputs({ paper: roots.paperRoot, data: roots.folder }, cell.metadata.paperfocus.execution.inputs);
  }
  const identity = { workspace: path.resolve(workspace), projectId, entryId, notebookId, path: store.path, revision: store.revision || "missing",
    inputCheck, staleReason: experimentStaleness(cell, store.notebook) ?? (inputCheck?.changed.length ? "declared input files changed since execution" : undefined) };
  if (outputIndex === undefined) return { ...identity, cell };
  if (!/^\d{1,2}$/.test(outputIndex)) throw new Error("Choose a zero-based output index from inspect.");
  const index = Number(outputIndex), output = cell.outputs?.[index];
  if (!output) throw new Error("Saved output not found. Reinspect the current run's indices.");
  return { ...identity, cellId, index, label: savedOutputLabel(output, index), output };
}
