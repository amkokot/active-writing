import type { ExperimentCell, ExperimentNotebook, ExperimentOutput } from "./experiments.ts";

export interface CellArrangement {
  pinned?: boolean; highlighted?: boolean; suppressed?: boolean; filed?: boolean; deleted?: boolean;
  folder?: string; before?: string; after?: string; featuredOutput?: number;
}
export const experimentCellDomId = (entryId: string, cellId: string) => `experiment-${entryId.length}-${entryId}-${cellId}`;
/** Shared human/agent semantics. Trash is reversible and never removes evidence. */
export function arrangeExperimentCell(notebook: ExperimentNotebook, id: string, patch: CellArrangement): ExperimentNotebook {
  if (!notebook.cells.some(cell => cell.id === id)) throw new Error("Cell not found.");
  if (patch.before !== undefined && patch.after !== undefined) throw new Error("Choose --before or --after, not both.");
  if (patch.folder !== undefined && (patch.folder.length > 200 || /[\r\n]/.test(patch.folder))) throw new Error("Use a one-line folder name under 200 characters.");
  if (patch.featuredOutput !== undefined && (!Number.isInteger(patch.featuredOutput) || patch.featuredOutput < 0 || patch.featuredOutput >= (notebook.cells.find(cell => cell.id === id)?.outputs?.length ?? 0))) throw new Error("Choose an existing saved output index (zero-based).");
  const { before, after, ...flags } = patch;
  const anchor = before ?? after;
  if (anchor !== undefined && (anchor === id || !notebook.cells.some(cell => cell.id === anchor))) throw new Error("Choose a different, existing cell as the move anchor.");
  const cells = notebook.cells.map(cell => cell.id === id ? { ...cell, metadata: { ...cell.metadata, paperfocus: { ...cell.metadata.paperfocus, ...flags, ...(flags.pinned === true ? { suppressed: false } : {}) } } } : cell);
  if (anchor !== undefined) {
    const index = cells.findIndex(cell => cell.id === id), [cell] = cells.splice(index, 1);
    cells.splice(cells.findIndex(cell => cell.id === anchor) + (after !== undefined ? 1 : 0), 0, cell);
  }
  return { ...notebook, cells };
}

export function featuredOutputIndex(cell: ExperimentCell) {
  const outputs = cell.outputs ?? [], saved = cell.metadata.paperfocus?.featuredOutput;
  if (saved !== undefined && outputs[saved]) return saved;
  const error = outputs.findIndex(output => output.output_type === "error");
  if (error >= 0) return error;
  const figure = outputs.findIndex(output => Object.keys(output.data ?? {}).some(key => /plot\+json|heatmap\+json|sweep\+json|image\/png/.test(key)));
  return Math.max(0, figure);
}
export function savedOutputLabel(output: ExperimentOutput, index: number) {
  const figures = Object.entries(output.data ?? {}).find(([key]) => /plot\+json|heatmap\+json|sweep\+json/.test(key));
  const title = figures?.[1] as { title?: unknown } | undefined;
  const kind = typeof title?.title === "string" ? title.title : output.output_type === "error" ? "Run error"
    : output.output_type === "stream" ? "Run log" : Array.isArray(output.data?.["application/json"]) ? `Table · ${output.data!["application/json"].length} rows`
    : output.data?.["image/png"] ? "Figure" : output.data?.["text/markdown"] ? "Explanation" : "Saved data";
  return `${index + 1}. ${kind.slice(0, 100)}`;
}

export function notebookShortcut(event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing?: boolean }) {
  if (event.key !== "Enter" || event.altKey || event.isComposing) return undefined;
  if (event.ctrlKey || event.metaKey) return "stay" as const;
  return event.shiftKey ? "advance" as const : undefined;
}
