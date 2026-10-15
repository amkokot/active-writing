import { plotCoordinates, type ExperimentPlot } from "./experiments.ts";
/** Never mutate the saved series. Retain their indices/colors when hiding them. */
export function plotWindow(plot: ExperimentPlot, hidden: number[], bounds?: [number, number]): ExperimentPlot {
  return { ...plot, series: plot.series.map((series, index) => ({ ...series, points: hidden.includes(index) ? [] : bounds ? series.points.filter(([x]) => x >= bounds[0] && x <= bounds[1]) : series.points })) };
}
export function plotViewCoordinates(plot: ExperimentPlot, hidden: number[], bounds?: [number, number], domain?: ExperimentPlot) {
  const view = plotWindow(plot, hidden, bounds);
  if (!view.series.some(series => series.points.length)) return undefined;
  return plotCoordinates(!bounds && domain ? domain : view);
}
export function nearestPlotPoint(plot: ExperimentPlot, hidden: number[], bounds: [number, number] | undefined, x: number, y: number, domain?: ExperimentPlot) {
  if (x < 60 || x > 520 || y < 40 || y > 235) return undefined;
  const coordinates = plotViewCoordinates(plot, hidden, bounds, domain);
  if (!coordinates) return undefined;
  let best: { series: number; point: number } | undefined, distance = 24 ** 2;
  plot.series.forEach((series, index) => {
    if (hidden.includes(index)) return;
    series.points.forEach(([px, py], point) => {
      if (bounds && (px < bounds[0] || px > bounds[1])) return;
      const d = (coordinates.x(px) - x) ** 2 + (coordinates.y(py) - y) ** 2;
      if (d <= distance) { distance = d; best = { series: index, point }; }
    });
  });
  return best;
}
