export const heatmapMime = "application/vnd.paperfocus.heatmap+json";
export interface ExperimentHeatmap { title: string; xLabel: string; yLabel: string; x: number[]; y: number[]; values: number[][]; colorScale?: "linear" | "log" }
/** A bounded saved sample grid, never executable widget code or interpolation. */
export function experimentHeatmap(value: unknown): ExperimentHeatmap | undefined {
  const grid = value as ExperimentHeatmap;
  const axis = (values: unknown): values is number[] => Array.isArray(values) && values.length >= 1 && values.length <= 60 && values.every((n, i) => typeof n === "number" && Number.isFinite(n) && (!i || n > values[i - 1]));
  if (!grid || typeof grid.title !== "string" || grid.title.length > 300 || ![grid.xLabel, grid.yLabel].every(v => typeof v === "string" && v.length <= 100) || !axis(grid.x) || !axis(grid.y) || grid.colorScale !== undefined && !["linear", "log"].includes(grid.colorScale) || !Array.isArray(grid.values) || grid.values.length !== grid.y.length || grid.values.some(row => !Array.isArray(row) || row.length !== grid.x.length || row.some(n => typeof n !== "number" || !Number.isFinite(n) || grid.colorScale === "log" && n <= 0))) return undefined;
  return grid;
}
export function heatmapRange(grid: ExperimentHeatmap) {
  let min = Infinity, max = -Infinity, low = [0, 0], high = [0, 0];
  grid.values.forEach((row, j) => row.forEach((v, i) => { if (v < min) { min = v; low = [i, j]; } if (v > max) { max = v; high = [i, j]; } }));
  return { min, max, low, high };
}
export function heatmapFraction(value: number, min: number, max: number, scale: "linear" | "log" = "linear") {
  if (min === max) return 0.5;
  if (scale === "log") { value = Math.log(value); min = Math.log(min); max = Math.log(max); }
  if (min === max) return 0.5;
  // Half-sized operands avoid overflowing a finite, opposite-signed range.
  const span = max - min;
  return Math.max(0, Math.min(1, Number.isFinite(span) ? (value - min) / span : (value / 2 - min / 2) / (max / 2 - min / 2)));
}
export function heatmapSummary(grid: ExperimentHeatmap) {
  const { min, max, low, high } = heatmapRange(grid);
  const at = ([i, j]: number[]) => `${grid.xLabel}=${grid.x[i]}, ${grid.yLabel}=${grid.y[j]}`;
  return `Sample grid: ${grid.title}; ${grid.x.length} × ${grid.y.length} saved samples; no interpolation. Minimum ${min} at ${at(low)}; maximum ${max} at ${at(high)}. ${grid.xLabel} range ${grid.x[0]} to ${grid.x.at(-1)}; ${grid.yLabel} range ${grid.y[0]} to ${grid.y.at(-1)}; color ${grid.colorScale ?? "linear"}. Complete values remain in the cell; a selected sample is not the whole evidence.`;
}
