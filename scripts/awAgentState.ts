/** Small, explicit agent records. These are indexes, not evidence or permissions. */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { cellText, validateExperimentNotebook, newExperimentCell } from "../src/experiments.ts";
import type { ExperimentNotebook } from "../src/experiments.ts";
import { arrangeExperimentCell } from "../src/experimentActions.ts";

export const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export const samePath = (a: string, b: string) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
export async function agentJson(file: string, limit = 1_000_000) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error("Use a bounded regular agent JSON file, not a linked path.");
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) > limit) throw new Error("Agent JSON grew while reading; inspect it first.");
  return JSON.parse(text);
}
/** Never overwrite a source, notebook, binding or another worker's checkpoint. */
export async function createAgentJson(file: string, workspace: string, value: unknown) {
  const target = path.resolve(file), parent = path.dirname(target), root = await realpath(workspace);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !samePath(await realpath(parent), parent)) throw new Error("Create agent records in an existing, unlinked folder inside Aw home.");
  // Checking every ancestor excludes junctions which resolve back into the workspace.
  let current = parent;
  while (!samePath(current, root)) {
    if ((await lstat(current)).isSymbolicLink()) throw new Error("Agent record folders cannot be linked.");
    current = path.dirname(current);
  }
  await writeFile(target, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  return target;
}
export interface AgentIdentity { workspace: string; projectId: string; entryId: string; notebookId: string; revision: string }
export function agentManifest(identity: AgentIdentity, origin: string, notebook: ExperimentNotebook, inputStates = new Map<string, unknown>()) {
  return { version: 1, type: "aw-agent-manifest", origin, ...identity,
    note: "Observed saved state only; this does not mean complete outputs were read or verified.",
    cells: notebook.cells.map(cell => ({ id: cell.id, source: digest(cellText(cell)), outputs: digest(cell.outputs ?? []), metadata: digest(cell.metadata), inputs: digest(inputStates.get(cell.id) ?? null) })),
  };
}
export function manifestChanges(before: any, after: ReturnType<typeof agentManifest>) {
  if (before?.version !== 1 || before.type !== after.type || before.origin !== after.origin || !samePath(before.workspace ?? "", after.workspace) || ["projectId", "entryId", "notebookId"].some(key => before[key] !== after[key as keyof typeof after])
    || typeof before.revision !== "string" || !Array.isArray(before.cells) || before.cells.length > 200 || new Set(before.cells.map((cell: any) => cell.id)).size !== before.cells.length
    || before.cells.some((cell: any) => !cell || !/^[A-Za-z0-9_-]{1,64}$/.test(cell.id) || ["source", "outputs", "metadata", "inputs"].some(key => !/^[a-f0-9]{64}$/.test(cell[key])))) throw new Error("Manifest belongs to another scope or is invalid; no state is assumed read.");
  const old = new Map<string, any>(before.cells.map((cell: any) => [cell.id, cell]));
  const changed = after.cells.flatMap(cell => {
    const previous = old.get(cell.id);
    const fields = previous ? ["source", "outputs", "metadata", "inputs"].filter(key => cell[key as keyof typeof cell] !== previous[key]) : ["added"];
    return fields.length ? [{ id: cell.id, fields }] : [];
  });
  return { fromRevision: before.revision, revision: after.revision, changed,
    removed: before.cells.filter((cell: any) => !after.cells.some(item => item.id === cell.id)).map((cell: any) => cell.id),
    orderChanged: JSON.stringify(before.cells.map((cell: any) => cell.id)) !== JSON.stringify(after.cells.map(cell => cell.id)),
    note: "Changed hashes identify what to inspect; summaries are not complete evidence. Unchanged runs are not rerun.",
  };
}
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const arrangementKeys = new Set(["pinned", "highlighted", "suppressed", "filed", "deleted", "folder", "before", "after", "featuredOutput"]);
/** Prepare the whole edit before making one guarded save; outputs are not writable here. */
export async function prepareAgentBatch(notebook: ExperimentNotebook, value: any, base: string) {
  if (!value || value.version !== 1 || Object.keys(value).some(key => !["version", "changes"].includes(key)) || !Array.isArray(value.changes) || !value.changes.length || value.changes.length > 50) throw new Error("Use {version:1,changes:[...]} with 1–50 cell edits.");
  let next = structuredClone(notebook);
  const seen = new Set<string>();
  for (const change of value.changes) {
    if (!change || !id(change.cell) || seen.has(change.cell) || Object.keys(change).some(key => !["cell", "source", "file", "kind", "title", "after", "arrange", "inputs"].includes(key))) throw new Error("Use unique cell IDs and supported batch fields; outputs/execution records are preserved.");
    seen.add(change.cell);
    if (change.kind !== undefined && !["markdown", "code", "raw"].includes(change.kind)) throw new Error("Use markdown, code or raw.");
    if (change.source !== undefined && change.file !== undefined) throw new Error("Choose inline source or file, not both.");
    let source = change.source;
    if (change.file !== undefined) {
      if (typeof change.file !== "string") throw new Error("Use a source file path.");
      const file = path.resolve(base, change.file), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 400_000) throw new Error("Use a bounded regular cell source file.");
      source = await readFile(file, "utf8");
    }
    if (source !== undefined && (typeof source !== "string" || source.length > 100_000)) throw new Error("Cell source must be text under 100,000 characters.");
    if (change.title !== undefined && (typeof change.title !== "string" || change.title.length > 500)) throw new Error("Use a short text title.");
    let cell = next.cells.find(cell => cell.id === change.cell);
    if (cell && change.kind && cell.cell_type !== change.kind) throw new Error("Existing cell kinds are preserved; create a new ID to change kind.");
    if (!cell) {
      if (source === undefined) throw new Error("A new cell needs source text.");
      cell = { ...newExperimentCell(change.kind ?? "markdown"), id: change.cell };
      const anchor = change.after === undefined ? next.cells.length - 1 : next.cells.findIndex(cell => cell.id === change.after);
      if (change.after !== undefined && (!id(change.after) || anchor < 0)) throw new Error("The insertion anchor is missing.");
      next.cells.splice(anchor + 1, 0, cell);
    } else if (change.after !== undefined) throw new Error("Use arrange.after to move an existing cell.");
    if (source !== undefined) cell.source = source;
    if (change.title !== undefined) cell.metadata.paperfocus = { ...cell.metadata.paperfocus, title: change.title };
    if (change.inputs !== undefined) {
      if (cell.cell_type !== "code") throw new Error("Only code cells declare experiment inputs.");
      // Schema validation is shared with the run admission checks.
      cell.metadata.paperfocus = { ...cell.metadata.paperfocus, inputs: change.inputs };
    }
    if (change.arrange !== undefined) {
      const patch = change.arrange;
      if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some(key => !arrangementKeys.has(key))
        || ["pinned", "highlighted", "suppressed", "filed", "deleted"].some(key => patch[key] !== undefined && typeof patch[key] !== "boolean")
        || ["folder", "before", "after"].some(key => patch[key] !== undefined && typeof patch[key] !== "string")) throw new Error("Invalid cell arrangement.");
      next = arrangeExperimentCell(next, cell.id, patch);
    }
    if (source === undefined && change.title === undefined && change.arrange === undefined && change.inputs === undefined) throw new Error("Empty cell edit.");
  }
  validateExperimentNotebook(next);
  return next;
}
