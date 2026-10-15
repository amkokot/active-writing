import { experimentPlot, type ExperimentPlot } from "./experiments.ts";
export const sweepMime = "application/vnd.paperfocus.sweep+json";
export interface ExperimentSweep { title: string; parameter: string; frames: Array<{ value: number; plot: ExperimentPlot }>; initial?: number }
/** Data-only widgets. Bound display cost and reject inconsistent/misleading frames. */
export function experimentSweep(value: unknown): ExperimentSweep | undefined {
  const sweep = value as ExperimentSweep;
  if (!sweep || typeof sweep.title !== "string" || sweep.title.length > 300 || typeof sweep.parameter !== "string" || !sweep.parameter || sweep.parameter.length > 100 || !Array.isArray(sweep.frames) || sweep.frames.length < 2 || sweep.frames.length > 41 || sweep.initial !== undefined && (!Number.isInteger(sweep.initial) || sweep.initial < 0 || sweep.initial >= sweep.frames.length)) return undefined;
  let points = 0;
  const first = experimentPlot(sweep.frames[0]?.plot);
  if (!first) return undefined;
  for (const [index, frame] of sweep.frames.entries()) {
    const plot = experimentPlot(frame?.plot);
    if (!plot || typeof frame.value !== "number" || !Number.isFinite(frame.value) || index > 0 && frame.value <= sweep.frames[index - 1].value || plot.xLabel !== first.xLabel || plot.yLabel !== first.yLabel || (plot.xScale ?? "linear") !== (first.xScale ?? "linear") || (plot.yScale ?? "linear") !== (first.yScale ?? "linear") || plot.series.length !== first.series.length || plot.series.some((series, i) => series.name !== first.series[i].name)) return undefined;
    const count = plot.series.reduce((n, series) => n + series.points.length, 0);
    if (!count || (points += count) > 40_000) return undefined;
  }
  return sweep;
}
/** Use fixed axes across frames so movement doesn't disguise scale changes. */
export function sweepDomain(sweep: ExperimentSweep): ExperimentPlot {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const frame of sweep.frames) for (const series of frame.plot.series) for (const [x, y] of series.points) {
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  return { ...sweep.frames[0].plot, series: [{ name: "Saved range", points: [[xmin, ymin], [xmax, ymax]] }] };
}
export function sweepSummary(sweep: ExperimentSweep) {
  // Include both parameter extremes before interior frames so a bounded prompt
  // cannot accidentally hide the high-end negative control behind stable cases.
  const order = [...new Set([0, sweep.frames.length - 1, Math.floor(sweep.frames.length / 2), ...sweep.frames.map((_, i) => i)])];
  return `Parameter sweep: ${sweep.title}; ${sweep.parameter} from ${sweep.frames[0].value} to ${sweep.frames.at(-1)!.value}; ${sweep.frames.length} saved frames; axes ${sweep.frames[0].plot.xLabel}, ${sweep.frames[0].plot.yLabel}. Selected frame is a view, not the whole evidence. Summaries: extremes first, then interior. ` + order.map(i => {
    const frame = sweep.frames[i];
    return `${sweep.parameter}=${frame.value}: ${frame.plot.series.map(series => `${series.name} (${series.points.length} points, first=${JSON.stringify(series.points[0])}, last=${JSON.stringify(series.points.at(-1))})`).join("; ")}`;
  }).join("\n");
}
