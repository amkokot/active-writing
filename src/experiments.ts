export interface ExperimentOutput {
  output_type: string; name?: string; text?: string | string[];
  data?: Record<string, unknown>; metadata?: Record<string, unknown>;
  ename?: string; evalue?: string; traceback?: string[];
}
export { compactExperimentContext } from "./experimentContext.ts";
import { experimentRunBudget } from "./experimentLimits.ts";
import { validateExperimentInputs, validateCapturedInputs } from "./experimentInputs.ts";
import type { ExperimentInput, CapturedExperimentInput } from "./experimentInputs.ts";
import { experimentSweep, sweepMime, sweepSummary } from "./experimentSweep.ts";
import { experimentHeatmap, heatmapMime, heatmapSummary } from "./experimentHeatmap.ts";
export interface ExperimentExecution {
  mode: "fresh" | "session"; sessionId?: string; sequence?: number;
  timeoutMs?: number;
  transport?: "offline" | "service";
  runtime?: { executable: string; python: string; packageFolder?: string | null; packages: Record<string, string> };
  priorRuns?: Array<{ cellId: string; runId: string }>;
  inputs?: CapturedExperimentInput[];
  inputsChanged?: string[];
}
export interface ExperimentSession { active: boolean; sessionId?: string; runs: number; busy: boolean; idleMs: number; maxRuns: number }
export interface ExperimentCell {
  id: string; cell_type: "markdown" | "code" | "raw"; source: string | string[];
  metadata: Record<string, unknown> & { paperfocus?: {
    title?: string; pinned?: boolean; highlighted?: boolean; suppressed?: boolean; filed?: boolean; deleted?: boolean; folder?: string; imagesCleared?: boolean; featuredOutput?: number;
    lastRunSource?: string; lastRunAt?: string; durationMs?: number; runId?: string; execution?: ExperimentExecution;
    inputs?: ExperimentInput[];
  } };
  outputs?: ExperimentOutput[]; execution_count?: number | null;
}
export interface ExperimentNotebook { nbformat: 4; nbformat_minor: number; metadata: Record<string, unknown>; cells: ExperimentCell[] }
export interface ExperimentStore { notebook: ExperimentNotebook; revision: string; path: string }
export interface ExperimentJob { id: string; cellId: string; status: "working" | "ready" | "failed" | "cancelled"; error?: string; durationMs?: number; execution?: ExperimentExecution; startedAt?: string }
export interface ExperimentPlot { title: string; xLabel: string; yLabel: string; xScale?: "linear" | "log"; yScale?: "linear" | "log"; series: Array<{ name: string; points: number[][] }> }
export const cellText = (cell: Pick<ExperimentCell, "source">) => Array.isArray(cell.source) ? cell.source.join("") : cell.source;
export const mimeText = (value: unknown) => typeof value === "string" ? value : Array.isArray(value) && value.every((part) => typeof part === "string") ? value.join("") : undefined;
export const outputText = (output: ExperimentOutput) => mimeText(output.text) ?? mimeText(output.data?.["text/plain"]) ?? (output.ename ? `${output.ename}: ${output.evalue ?? ""}\n${output.traceback?.join("\n") ?? ""}` : "");
export const newExperimentNotebook = (): ExperimentNotebook => ({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" } }, cells: [] });
export const newExperimentCell = (kind: ExperimentCell["cell_type"]): ExperimentCell => ({ id: crypto.randomUUID(), cell_type: kind, source: kind === "code" ? "# Python cell. Run only trusted code.\nprint('Experiment ready')" : "", metadata: { paperfocus: { title: kind === "code" ? "New experiment" : "Research note" } }, ...(kind === "code" ? { outputs: [], execution_count: null } : {}) });
export function validateExperimentNotebook(value: unknown): asserts value is ExperimentNotebook {
  const nb = value as ExperimentNotebook;
  if (!nb || nb.nbformat !== 4 || !Number.isInteger(nb.nbformat_minor) || !nb.metadata || typeof nb.metadata !== "object" || Array.isArray(nb.metadata) || !Array.isArray(nb.cells) || nb.cells.length > 200 || JSON.stringify(nb).length > 4_000_000) throw new Error("Use an nbformat-4 notebook with at most 200 cells / 4 MB.");
  const ids = new Set<string>();
  for (const cell of nb.cells) {
    if (!cell || !/^[A-Za-z0-9_-]{1,64}$/.test(cell.id) || ids.has(cell.id) || !["code", "markdown", "raw"].includes(cell.cell_type) || !(typeof cell.source === "string" || Array.isArray(cell.source) && cell.source.every((part) => typeof part === "string")) || cellText(cell).length > 100_000 || !cell.metadata || typeof cell.metadata !== "object" || Array.isArray(cell.metadata)) throw new Error("Invalid experiment cell or duplicate cell ID.");
    ids.add(cell.id);
    const flags = cell.metadata.paperfocus;
    if (flags?.inputs !== undefined) validateExperimentInputs(flags.inputs);
    if (flags?.featuredOutput !== undefined && (!Number.isInteger(flags.featuredOutput) || flags.featuredOutput < 0 || flags.featuredOutput >= 30)) throw new Error("Invalid featured experiment output.");
    if (flags !== undefined && (!flags || typeof flags !== "object" || Array.isArray(flags))) throw new Error("Invalid experiment catalogue metadata.");
    if (flags && (["pinned", "highlighted", "suppressed", "filed", "deleted", "imagesCleared"].some((key) => flags[key as keyof typeof flags] !== undefined && typeof flags[key as keyof typeof flags] !== "boolean") || ["title", "folder", "lastRunSource", "lastRunAt", "runId"].some((key) => flags[key as keyof typeof flags] !== undefined && typeof flags[key as keyof typeof flags] !== "string"))) throw new Error("Invalid experiment catalogue metadata.");
    if (flags?.execution !== undefined) {
      const execution = flags.execution;
      if (execution?.inputs !== undefined) validateCapturedInputs(execution.inputs);
      if (execution?.inputsChanged !== undefined && (!Array.isArray(execution.inputsChanged) || execution.inputsChanged.length > 32 || execution.inputsChanged.some(item => typeof item !== "string" || item.length > 550))) throw new Error("Invalid changed-input record.");
      if (execution?.timeoutMs !== undefined) experimentRunBudget(execution.timeoutMs);
      if (execution?.transport !== undefined && !["offline", "service"].includes(execution.transport)) throw new Error("Invalid execution transport.");
      if (execution?.runtime !== undefined) {
        const runtime = execution.runtime;
        if (!runtime || typeof runtime.executable !== "string" || typeof runtime.python !== "string" || runtime.packageFolder != null && typeof runtime.packageFolder !== "string" || !runtime.packages || typeof runtime.packages !== "object" || Array.isArray(runtime.packages) || Object.values(runtime.packages).some(v => typeof v !== "string") || JSON.stringify(runtime).length > 10_000) throw new Error("Invalid Python runtime record.");
      }
      if (!execution || !["fresh", "session"].includes(execution.mode) || execution.mode === "session" && (!/^[A-Za-z0-9_-]{1,64}$/.test(execution.sessionId ?? "") || !Number.isInteger(execution.sequence) || execution.sequence! < 1 || execution.sequence! > 100 || !Array.isArray(execution.priorRuns)) || execution.priorRuns !== undefined && (!Array.isArray(execution.priorRuns) || execution.priorRuns.length > 100 || execution.priorRuns.some(run => !run || !/^[A-Za-z0-9_-]{1,64}$/.test(run.cellId) || !/^[A-Za-z0-9_-]{1,64}$/.test(run.runId)))) throw new Error("Invalid Python execution history.");
    }
    if (cell.cell_type === "code" && (!Array.isArray(cell.outputs) || cell.outputs.length > 30 || !(cell.execution_count === null || Number.isInteger(cell.execution_count) && cell.execution_count! >= 0))) throw new Error("Invalid code-cell outputs/count.");
    for (const output of cell.outputs ?? []) {
      if (!output || !["stream", "display_data", "execute_result", "error"].includes(output.output_type) || output.text !== undefined && !(typeof output.text === "string" || Array.isArray(output.text) && output.text.every((part) => typeof part === "string")) || output.data !== undefined && (!output.data || typeof output.data !== "object" || Array.isArray(output.data)) || output.traceback !== undefined && (!Array.isArray(output.traceback) || output.traceback.some((line) => typeof line !== "string"))) throw new Error("Invalid experiment output.");
      const value = output.data?.["image/png"], png = mimeText(value);
      if (value !== undefined && (!png || png.length > 1_500_000 || !/^[A-Za-z0-9+/=\r\n]+$/.test(png))) throw new Error("Invalid or oversized PNG output.");
    }
  }
}
/** Assign stable IDs for older Jupyter imports without executing or discarding outputs. */
export function importExperimentNotebook(value: unknown): ExperimentNotebook {
  const nb = structuredClone(value) as ExperimentNotebook;
  if (Array.isArray(nb?.cells)) nb.cells = nb.cells.map((cell) => ({ ...cell, id: cell.id || crypto.randomUUID() }));
  validateExperimentNotebook(nb);
  const metadata = nb.metadata as { language_info?: { name?: string }; kernelspec?: { language?: string } };
  const language = metadata.language_info?.name || metadata.kernelspec?.language;
  if (language && language.toLowerCase() !== "python") throw new Error("This prototype executes Python only. Convert a non-Python notebook deliberately before importing its code.");
  return nb;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if ((base === undefined || base && typeof base === "object" && !Array.isArray(base)) && local && remote && [local, remote].every((v) => typeof v === "object" && !Array.isArray(v))) {
    const a = (base ?? {}) as Record<string, unknown>, b = local as Record<string, unknown>, c = remote as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])].map((key) => [key, mergeValue(a[key], b[key], c[key])]));
  }
  throw new Error("The same experiment field changed in another editor. Both versions are retained; export your draft before reloading disk.");
}
/** Merge independent cell/metadata/output edits, never guess between competing source edits. */
export function mergeExperimentNotebooks(base: ExperimentNotebook, local: ExperimentNotebook, remote: ExperimentNotebook): ExperimentNotebook {
  const maps = [base, local, remote].map((nb) => new Map(nb.cells.map((cell) => [cell.id, cell])));
  const order = (nb: ExperimentNotebook) => nb.cells.filter((cell) => maps[0].has(cell.id)).map((cell) => cell.id);
  const chosen = mergeValue(order(base), order(local), order(remote)) as string[];
  const preferred = same(chosen, order(local)) && !same(order(local), order(base)) ? local : remote;
  const other = preferred === local ? remote : local;
  const ids = preferred.cells.map((cell) => cell.id);
  // Preserve where an external editor inserted a new cell; append-only reconciliation
  // would otherwise move every agent-added explanation to the end of the notebook.
  for (const [index, cell] of other.cells.entries()) if (!ids.includes(cell.id)) {
    const before = [...other.cells.slice(0, index)].reverse().find((candidate) => ids.includes(candidate.id));
    const after = other.cells.slice(index + 1).find((candidate) => ids.includes(candidate.id));
    const position = before ? ids.indexOf(before.id) + 1 : after ? ids.indexOf(after.id) : ids.length;
    ids.splice(position, 0, cell.id);
  }
  const cells = ids.map((id) => mergeValue(maps[0].get(id), maps[1].get(id), maps[2].get(id))).filter((cell): cell is ExperimentCell => Boolean(cell));
  const result = { ...remote, metadata: mergeValue(base.metadata, local.metadata, remote.metadata) as ExperimentNotebook["metadata"], cells };
  validateExperimentNotebook(result); return result;
}
/** Session history is conservative: this is not a variable dependency graph. */
export function experimentStaleness(cell: ExperimentCell, nb: ExperimentNotebook) {
  if (cell.metadata.paperfocus?.lastRunSource !== undefined && cell.metadata.paperfocus.lastRunSource !== cellText(cell)) return "code changed since this output";
  const execution = cell.metadata.paperfocus?.execution, inputs = cell.metadata.paperfocus?.inputs;
  if (execution?.inputsChanged?.length) return "declared input files changed during execution; inspect the saved run";
  if (inputs?.length && !execution?.inputs) return "declared inputs were not captured for this saved output";
  if (execution?.inputs && JSON.stringify(execution.inputs.map(({ root, path }) => ({ root, path }))) !== JSON.stringify(inputs ?? [])) return "declared experiment inputs changed since this output";
  const prior = new Map((cell.metadata.paperfocus?.execution?.priorRuns ?? []).map(run => [run.cellId, run.runId]));
  prior.delete(cell.id);
  for (const [id, runId] of prior) {
    const upstream = nb.cells.find(candidate => candidate.id === id);
    if (!upstream || upstream.metadata.paperfocus?.deleted || upstream.metadata.paperfocus?.filed || upstream.metadata.paperfocus?.runId !== runId || upstream.metadata.paperfocus?.lastRunSource !== cellText(upstream)) return "earlier session cells changed or are missing; restart and rerun in order";
  }
  return undefined;
}
export function experimentContext(nb: ExperimentNotebook, notebookId: string, scope: "compact" | "expanded" = "compact", sourcePath?: string) {
  const active = nb.cells.filter((cell) => !cell.metadata.paperfocus?.deleted && !cell.metadata.paperfocus?.filed);
  const cells = [...active.filter((cell) => cell.metadata.paperfocus?.highlighted), ...active.filter((cell) => !cell.metadata.paperfocus?.highlighted)].slice(0, scope === "expanded" ? 24 : 6);
  const header = `Experiment file: ${sourcePath ?? `experiments/${notebookId}/notebook.ipynb (relative to this paper's Aw files, outside its repository)`}\n${active.length} active cells; ${nb.cells.length - active.length} filed/trashed cells omitted. Numerical findings are not proof.\nBounded excerpts of ${cells.length} cells; inspect the notebook for complete code, outputs and omitted cells.`;
  // Divide the budget across cells; a large first output must not displace later checks.
  const budget = Math.floor(((scope === "expanded" ? 18000 : 6000) - header.length - 2 * cells.length) / Math.max(1, cells.length));
  return [header, ...cells.map((cell) => {
    const metadata = cell.metadata.paperfocus;
    const stale = experimentStaleness(cell, nb);
    const findings = (cell.outputs ?? []).map((output) => {
      const text = mimeText(output.data?.["text/markdown"]) ?? outputText(output);
      const grid = experimentHeatmap(output.data?.[heatmapMime]);
      if (grid) return heatmapSummary(grid);
      const sweep = experimentSweep(output.data?.[sweepMime]);
      if (sweep) return sweepSummary(sweep);
      if (output.data?.["application/json"] !== undefined) return `${text}\n${JSON.stringify(output.data["application/json"]).slice(0, 800)}`;
      const plot = experimentPlot(output.data?.["application/vnd.paperfocus.plot+json"]);
      // Plain fallbacks used to hide plot numbers from agents entirely.
      return plot ? `Plot: ${plot.title}; axes ${plot.xLabel} (${plot.xScale ?? "linear"}), ${plot.yLabel} (${plot.yScale ?? "linear"}); ${plot.series.map((s) => `${s.name} (${s.points.length} points, first=${JSON.stringify(s.points[0])}, last=${JSON.stringify(s.points.at(-1))})`).join("; ")}` : text;
    }).join("\n");
    const failed = (cell.outputs ?? []).some((output) => output.output_type === "error");
    const label = `## Cell ${metadata?.highlighted ? "Highlighted · " : ""}${(metadata?.title || cell.id).slice(0, 100)} [${cell.id}]: ${cell.cell_type}${metadata?.folder ? ` · ${metadata.folder.slice(0, 60)}` : ""}\nState: ${cell.cell_type !== "code" ? "research note; not mathematical verification" : stale ? `output from earlier code; do not treat as current (${stale})` : failed ? "failed run; not successful evidence" : metadata?.lastRunAt ? "saved run" : "unrun / imported output; not independently verified"}${stale && failed ? "; failed run" : ""}${metadata?.runId ? `; run=${metadata.runId.slice(0, 64)}` : ""}${metadata?.execution?.mode === "session" ? `; shared session ${metadata.execution.sessionId}, step ${metadata.execution.sequence}; execution history matters` : ""}${metadata?.imagesCleared ? "; PNG images removed from this notebook; inspect the original saved run if needed" : ""}`;
    const available = Math.max(0, budget - label.length - 60);
    const evidence = cell.cell_type === "code" ? findings || "No saved findings." : cellText(cell);
    const evidenceBudget = Math.min(scope === "expanded" ? 3600 : 900, Math.floor(available * 0.7));
    const sourceBudget = Math.min(scope === "expanded" ? 1600 : 500, Math.max(0, available - evidenceBudget));
    return `${label}\nFindings excerpt:\n${evidence.slice(0, evidenceBudget)}${evidence.length > evidenceBudget ? "\n[Findings shortened.]" : ""}${cell.cell_type === "code" && sourceBudget ? `\nSource excerpt:\n${cellText(cell).slice(0, sourceBudget)}` : ""}`.slice(0, budget);
  })].join("\n\n");
}

export function experimentPlot(value: unknown): ExperimentPlot | undefined {
  const plot = value as ExperimentPlot;
  if (!plot || ![plot.title, plot.xLabel, plot.yLabel].every((v) => typeof v === "string") || !Array.isArray(plot.series) || !plot.series.length || plot.series.length > 8 || plot.series.some((s) => !s || typeof s.name !== "string" || !Array.isArray(s.points) || s.points.length > 2000 || s.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => typeof n !== "number" || !Number.isFinite(n))))) return undefined;
  if ([plot.xScale, plot.yScale].some((scale) => scale !== undefined && scale !== "linear" && scale !== "log") || plot.series.some((series) => series.points.some(([x, y]) => plot.xScale === "log" && x <= 0 || plot.yScale === "log" && y <= 0))) return undefined;
  return plot;
}

/** Transform display coordinates only; retain original numeric data. */
export function plotCoordinates(plot: ExperimentPlot) {
  const points = plot.series.flatMap((series) => series.points);
  if (!points.length) return undefined;
  const tx = (n: number) => plot.xScale === "log" ? Math.log10(n) : n;
  const ty = (n: number) => plot.yScale === "log" ? Math.log10(n) : n;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
  const fraction = (n: number, min: number, max: number, transform: (n: number) => number) => {
    const a = transform(min), b = transform(max), v = transform(n), span = b - a;
    return Number.isFinite(span) ? (v - a) / (span || 1) : (v / 2 - a / 2) / (b / 2 - a / 2);
  };
  return { xmin, xmax, ymin, ymax,
    x: (n: number) => 60 + 460 * fraction(n, xmin, xmax, tx),
    y: (n: number) => 235 - 195 * fraction(n, ymin, ymax, ty),
  };
}

export function plotTicks(min: number, max: number, scale?: "linear" | "log") {
  if (min >= max) return [];
  if (scale !== "log") return [0.25, 0.5, 0.75].map(fraction => min * (1 - fraction) + max * fraction);
  const first = Math.ceil(Math.log10(min)), last = Math.floor(Math.log10(max));
  const stride = Math.max(1, Math.ceil((last - first + 1) / 6));
  const ticks: number[] = [];
  for (let exponent = first; exponent <= last; exponent += stride) {
    const value = 10 ** exponent;
    if (value > min && value < max && Number.isFinite(value)) ticks.push(value);
  }
  return ticks;
}
