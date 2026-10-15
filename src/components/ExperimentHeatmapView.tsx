import { useId, useMemo, useState } from "react";
import { heatmapFraction, heatmapRange, type ExperimentHeatmap } from "../experimentHeatmap";

export function ExperimentHeatmapView({ grid }: { grid: ExperimentHeatmap }) {
  const [selected, setSelected] = useState<[number, number]>([0, 0]);
  const i = Math.min(selected[0], grid.x.length - 1), j = Math.min(selected[1], grid.y.length - 1);
  const range = useMemo(() => heatmapRange(grid), [grid]), labelId = useId();
  const short = (v: number) => String(Number(v.toPrecision(6)));
  const left = 48, width = 408;
  const color = (v: number) => `hsl(${210 - heatmapFraction(v, range.min, range.max, grid.colorScale) * 175} 55% 48%)`;
  // Reuse saved tiles when only the inspection cursor moves.
  const tiles = useMemo(() => grid.values.flatMap((row, y) => row.map((v, x) => <rect key={`${x}:${y}`} x={left + width * x / grid.x.length} y={12 + 188 * (grid.y.length - 1 - y) / grid.y.length} width={width / grid.x.length} height={188 / grid.y.length} fill={color(v)} onClick={() => setSelected([x, y])}><title>{grid.xLabel}={grid.x[x]}, {grid.yLabel}={grid.y[y]}: {String(v)}</title></rect>)), [grid, range]);
  const move = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (direction) { event.preventDefault(); setSelected([Math.max(0, Math.min(grid.x.length - 1, i + direction[0])), Math.max(0, Math.min(grid.y.length - 1, j + direction[1]))]); }
  };
  return <figure className="experiment-heatmap">
    <figcaption id={labelId}>{grid.title}</figcaption>
    <svg viewBox="0 0 480 240" role="group" tabIndex={0} aria-labelledby={labelId} aria-describedby={`${labelId}-help`} onKeyDown={move}>
      {tiles}
      <rect x={left + width * i / grid.x.length} y={12 + 188 * (grid.y.length - 1 - j) / grid.y.length} width={width / grid.x.length} height={188 / grid.y.length} fill="none" stroke="black" strokeWidth={3} pointerEvents="none" />
      <rect x={left + width * i / grid.x.length + 1} y={12 + 188 * (grid.y.length - 1 - j) / grid.y.length + 1} width={Math.max(0, width / grid.x.length - 2)} height={Math.max(0, 188 / grid.y.length - 2)} fill="none" stroke="white" strokeWidth={1} pointerEvents="none" />
      <text x={left} y={214}>{short(grid.x[0])}</text><text x={left + width} y={214} textAnchor="end">{short(grid.x.at(-1)!)}</text>
      <text x={left - 4} y={20} textAnchor="end">{short(grid.y.at(-1)!)}</text><text x={left - 4} y={199} textAnchor="end">{short(grid.y[0])}</text>
      <text x={252} y={233} textAnchor="middle">{grid.xLabel} · increasing →</text><text transform="translate(13,106) rotate(-90)" textAnchor="middle">{grid.yLabel} · increasing →</text>
    </svg>
    <output aria-live="polite">{grid.xLabel} = {String(grid.x[i])} · {grid.yLabel} = {String(grid.y[j])} · value = {String(grid.values[j][i])}</output>
    <small><span className="heatmap-key" style={{ background: color(range.min) }} /> <span title={String(range.min)}>{short(range.min)}</span> → <span className="heatmap-key" style={{ background: color(range.max) }} /> <span title={String(range.max)}>{short(range.max)}</span> · {grid.colorScale ?? "linear"} color</small>
    <small id={`${labelId}-help`}>{grid.x.length} × {grid.y.length} saved samples · equal-size tiles, not numeric spacing · no interpolation or rerun · click / arrow keys</small>
    <details><summary>Select exact sample</summary><label>{grid.xLabel}<select aria-label={`${grid.xLabel} grid sample`} value={i} onChange={event => setSelected([Number(event.target.value), j])}>{grid.x.map((v, n) => <option value={n} key={n}>{String(v)}</option>)}</select></label><label>{grid.yLabel}<select aria-label={`${grid.yLabel} grid sample`} value={j} onChange={event => setSelected([i, Number(event.target.value)])}>{grid.y.map((v, n) => <option value={n} key={n}>{String(v)}</option>)}</select></label><button onClick={() => setSelected(range.low as [number, number])}>Minimum</button><button onClick={() => setSelected(range.high as [number, number])}>Maximum</button></details>
  </figure>;
}
