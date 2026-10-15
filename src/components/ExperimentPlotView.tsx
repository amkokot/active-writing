import { useMemo, useState } from "react";
import { plotTicks, type ExperimentPlot } from "../experiments";
import { nearestPlotPoint, plotViewCoordinates, plotWindow } from "../plotInspection";

const colors = ["light-dark(#167d8d, #79c5d0)", "light-dark(#bc723b, #e3a46b)", "light-dark(#9364a3, #c59cd7)", "light-dark(#518940, #9ac77c)", "light-dark(#5b79bd, #99b3ef)", "light-dark(#ac8342, #dbc27c)", "light-dark(#739e9b, #9dcac6)", "light-dark(#b65b49, #e7a091)"];
export function ExperimentPlotView({ plot, domain }: { plot: ExperimentPlot; domain?: ExperimentPlot }) {
  const [hidden, setHidden] = useState<number[]>([]), [selected, setSelected] = useState<{ series: number; point: number }>();
  const [bounds, setBounds] = useState<[number, number]>(), [from, setFrom] = useState(""), [to, setTo] = useState(""), [error, setError] = useState("");
  const visible = useMemo(() => plotWindow(plot, hidden, bounds), [plot, hidden, bounds]);
  const coordinates = useMemo(() => plotViewCoordinates(plot, hidden, bounds, domain), [plot, hidden, bounds, domain]);
  const data = selected && !hidden.includes(selected.series) ? plot.series[selected.series]?.points[selected.point] : undefined;
  const reset = () => { setBounds(undefined); setFrom(""); setTo(""); setError(""); setSelected(undefined); setHidden([]); };
  return <figure className="experiment-plot"><figcaption>{plot.title}</figcaption>
    {coordinates ? <svg role="img" aria-label={`${plot.title}; ${plot.xScale === "log" ? "logarithmic x axis; " : ""}${plot.yScale === "log" ? "logarithmic y axis; " : ""}click to inspect a point`} viewBox="0 0 580 280" onClick={event => {
      // getScreenCTM accounts for letterboxing and CSS zoom, unlike a bounding-box ratio.
      const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      setSelected(nearestPlotPoint(plot, hidden, bounds, point.x, point.y, domain));
    }}>
      {plotTicks(coordinates.ymin, coordinates.ymax, plot.yScale).map(tick => <g key={tick}><path d={`M60 ${coordinates.y(tick)} H520`} fill="none" stroke="currentColor" opacity="0.12" />{coordinates.y(tick) > 60 && coordinates.y(tick) < 219 && <text x="6" y={coordinates.y(tick) + 4}>{tick.toPrecision(3)}</text>}</g>)}
      {plotTicks(coordinates.xmin, coordinates.xmax, plot.xScale).map(tick => <g key={tick}><path d={`M${coordinates.x(tick)} 40 V235`} fill="none" stroke="currentColor" opacity="0.08" /><text x={coordinates.x(tick)} y="253" textAnchor="middle">{tick.toPrecision(3)}</text></g>)}
      <path d="M60 40 V235 H520" fill="none" stroke="currentColor" />
      <text x="60" y="253">{coordinates.xmin.toPrecision(3)}</text><text x="487" y="253">{coordinates.xmax.toPrecision(3)}</text>
      <text x="6" y="46">{coordinates.ymax.toPrecision(3)}</text><text x="6" y="237">{coordinates.ymin.toPrecision(3)}</text>
      <text x="230" y="277">{plot.xLabel}{plot.xScale === "log" ? " (log)" : ""}</text><text x="60" y="24">{plot.yLabel}{plot.yScale === "log" ? " (log)" : ""}</text>
      {visible.series.map((series, i) => <polyline key={i} points={series.points.map(p => `${coordinates.x(p[0])},${coordinates.y(p[1])}`).join(" ")} fill="none" stroke={colors[i]} strokeWidth="2" />)}
      {data && (!bounds || data[0] >= bounds[0] && data[0] <= bounds[1]) && <circle cx={coordinates.x(data[0])} cy={coordinates.y(data[1])} r="4" fill={colors[selected!.series]} stroke="currentColor" />}
    </svg> : <p>No points in this view. Reset the view or show a series.</p>}
    <div className="experiment-legend">{plot.series.map((series, i) => <button key={i} aria-label={`Show series ${series.name}`} aria-pressed={!hidden.includes(i)} style={{ color: colors[i], opacity: hidden.includes(i) ? 0.45 : 1 }} onClick={() => setHidden(old => old.includes(i) ? old.filter(index => index !== i) : [...old, i])}>{series.name}</button>)}</div>
    {data && <output className="experiment-point">{plot.series[selected!.series].name} · {plot.xLabel} = {String(data[0])}; {plot.yLabel} = {String(data[1])}{bounds && (data[0] < bounds[0] || data[0] > bounds[1]) ? " · outside zoom" : ""}</output>}
    <details className="experiment-plot-controls"><summary>Inspect / zoom{bounds ? " · zoomed" : ""}</summary><small>View only; saved data and Python are unchanged.</small>
      <label>Series<select aria-label="Inspect plot series" value={selected?.series ?? ""} onChange={event => setSelected(event.target.value === "" ? undefined : { series: Number(event.target.value), point: 0 })}><option value="">Choose a series</option>{plot.series.map((series, i) => <option key={i} value={i} disabled={hidden.includes(i) || !series.points.length}>{series.name}</option>)}</select></label>
      {selected && data && <label>Point {selected.point + 1} / {plot.series[selected.series].points.length}<input type="range" aria-label="Inspect plot point" min={0} max={plot.series[selected.series].points.length - 1} step={1} value={selected.point} onChange={event => setSelected({ ...selected, point: Number(event.target.value) })} /></label>}
      <div className="experiment-plot-range"><label>{plot.xLabel} from<input aria-label="Plot x minimum" type="number" value={from} onChange={event => setFrom(event.target.value)} /></label><label>to<input aria-label="Plot x maximum" type="number" value={to} onChange={event => setTo(event.target.value)} /></label><button onClick={() => {
        const a = Number(from), b = Number(to);
        if (!from.trim() || !to.trim() || !Number.isFinite(a) || !Number.isFinite(b) || a >= b || plot.xScale === "log" && a <= 0) { setError("Enter an increasing x range (positive for log axes)."); return; }
        setBounds([a, b]); setSelected(undefined); setError("");
      }}>Zoom</button><button onClick={reset}>Reset view</button></div>{error && <small role="alert">{error}</small>}
    </details>
  </figure>;
}
