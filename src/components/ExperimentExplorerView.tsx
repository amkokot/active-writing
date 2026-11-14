import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { axisValue, columnDomain, explorerCsv, explorerSubset, histogram, numericColumn, selectRectangle } from "../experimentExplorer";
import type { AxisScale, ExplorerColumn, ExplorerVisual } from "../experimentExplorer";
import { saveVisual, useVisualSurface } from "./visualSurface";

const short = (n: number) => Number(n.toPrecision(4)).toString();
const accent = "#4388b7";
function context(canvas: HTMLCanvasElement, width: number, height: number) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.height = `${height}px`;
  const c = canvas.getContext("2d")!; c.scale(ratio, ratio); c.font = "11px system-ui";
  const style = getComputedStyle(canvas), ink = style.color;
  c.fillStyle = style.getPropertyValue("--paper").trim() || "white"; c.fillRect(0, 0, width, height);
  return { c, ink };
}
function rowColor(column: ExplorerColumn | undefined, index: number, range: number[]) {
  const v = column?.values[index];
  if (v === undefined || v === null) return v === null ? "#92959c" : accent;
  if (typeof v === "number") return `hsl(${245 - 225 * Math.max(0, Math.min(1, (v - range[0]) / (range[1] - range[0])))} 65% 49%)`;
  let hash = 0; for (const ch of v) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${(Math.abs(hash) * 137.508) % 360} 58% 49%)`;
}
type Selection = ReadonlySet<number> | null;
type Select = (rows: number[], add?: boolean) => void;

function Scatter({ visual, x, y, color, xScale, yScale, selection, select }: {
  visual: ExplorerVisual; x: ExplorerColumn; y: ExplorerColumn; color?: ExplorerColumn; xScale: AxisScale; yScale: AxisScale; selection: Selection; select: Select;
}) {
  const { ref, width, visible, theme } = useVisualSurface(), canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState("select"), [view, setView] = useState<number[] | null>(null), [hover, setHover] = useState("");
  const [drag, setDrag] = useState<{ from: number[]; to: number[] } | null>(null);
  const projected = useRef<{ x: number; y: number; row: number }[]>([]);
  const xd = useMemo(() => columnDomain(x, xScale), [x, xScale]), yd = useMemo(() => columnDomain(y, yScale), [y, yScale]);
  const full = useMemo(() => [xd[0] - .04 * (xd[1] - xd[0]), xd[1] + .04 * (xd[1] - xd[0]), yd[0] - .04 * (yd[1] - yd[0]), yd[1] + .04 * (yd[1] - yd[0])], [xd, yd]);
  useEffect(() => { setView(null); setDrag(null); setHover(""); }, [x, y, xScale, yScale]);
  const domain = view ?? full, w = width, h = 330, left = 62, right = w - 18, top = 16, bottom = h - 49;
  const invert = (p: number[]) => [domain[0] + (p[0] - left) / (right - left) * (domain[1] - domain[0]), domain[3] - (p[1] - top) / (bottom - top) * (domain[3] - domain[2])];
  const position = (event: ReactPointerEvent<HTMLCanvasElement>) => { const r = event.currentTarget.getBoundingClientRect(); return [Math.max(left, Math.min(right, event.clientX - r.left)), Math.max(top, Math.min(bottom, event.clientY - r.top))]; };
  const nearest = (p: number[]) => { let found = -1, distance = 81; for (const dot of projected.current) { const d = (dot.x - p[0]) ** 2 + (dot.y - p[1]) ** 2; if (d < distance) { found = dot.row; distance = d; } } return found; };
  const colorRange = useMemo(() => color ? columnDomain(color) : [0, 1], [color]);
  const valid = useMemo(() => x.values.flatMap((v, i) => axisValue(v, xScale) !== undefined && axisValue(y.values[i], yScale) !== undefined ? [i] : []), [x, y, xScale, yScale]);
  useEffect(() => {
    if (!canvas.current || !visible) return;
    const { c, ink } = context(canvas.current, w, h), mapX = (v: number) => left + (v - domain[0]) / (domain[1] - domain[0]) * (right - left), mapY = (v: number) => bottom - (v - domain[2]) / (domain[3] - domain[2]) * (bottom - top);
    c.fillStyle = ink; c.strokeStyle = ink;
    for (let i = 0; i <= 4; i++) {
      const xv = domain[0] + (domain[1] - domain[0]) * i / 4, yv = domain[2] + (domain[3] - domain[2]) * i / 4;
      c.globalAlpha = .12; c.beginPath(); c.moveTo(mapX(xv), top); c.lineTo(mapX(xv), bottom); c.moveTo(left, mapY(yv)); c.lineTo(right, mapY(yv)); c.stroke();
      c.globalAlpha = 1; c.textAlign = "center"; c.fillText(short(xScale === "log" ? 10 ** xv : xv), mapX(xv), bottom + 17); c.textAlign = "right"; c.fillText(short(yScale === "log" ? 10 ** yv : yv), left - 8, mapY(yv) + 4);
    }
    c.textAlign = "center"; c.fillText(`${x.label}${xScale === "log" ? " (log₁₀)" : ""}`, (left + right) / 2, h - 7);
    c.save(); c.translate(12, (top + bottom) / 2); c.rotate(-Math.PI / 2); c.fillText(`${y.label}${yScale === "log" ? " (log₁₀)" : ""}`, 0, 0); c.restore();
    c.save(); c.beginPath(); c.rect(left, top, right - left, bottom - top); c.clip();
    projected.current = valid.map(row => ({ row, x: mapX(axisValue(x.values[row], xScale)!), y: mapY(axisValue(y.values[row], yScale)!) }));
    // Selected rows last so dimmed context does not cover them. No sampling.
    for (const chosen of [false, true]) for (const p of projected.current) {
      if (Boolean(selection?.has(p.row)) !== chosen) continue;
      c.globalAlpha = selection ? chosen ? .95 : .12 : .72; c.fillStyle = rowColor(color, p.row, colorRange);
      c.beginPath(); c.arc(p.x, p.y, chosen ? 3.8 : 2.5, 0, Math.PI * 2); c.fill();
    }
    c.restore(); c.globalAlpha = 1;
    if (drag) { c.strokeStyle = accent; c.fillStyle = "#4388b730"; const a = drag.from, b = drag.to; c.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); c.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
  }, [w, visible, theme, x, y, color, colorRange, xScale, yScale, selection, domain, valid, drag]);
  const zoom = (factor: number) => { const result: number[] = []; for (const i of [0, 2]) { const span = Math.max((full[i + 1] - full[i]) / 100000, Math.min((full[i + 1] - full[i]) * 100, (domain[i + 1] - domain[i]) * factor)), center = (domain[i] + domain[i + 1]) / 2; result.push(center - span / 2, center + span / 2); } setView(result); };
  return <figure ref={ref} className="aw-explorer-scatter"><figcaption>Scatter</figcaption>
    <div className="aw-visual-controls"><label>Drag <select aria-label="Scatter drag action" value={mode} onChange={e => setMode(e.target.value)}><option value="select">Select rows</option><option value="pan">Pan view</option></select></label><button aria-label="Zoom scatter in" onClick={() => zoom(.6)}>+</button><button aria-label="Zoom scatter out" onClick={() => zoom(1.7)}>−</button><button onClick={() => setView(null)}>Fit</button></div>
    <canvas ref={canvas} role="img" aria-label={`Scatter: ${x.label} versus ${y.label}. ${valid.length} plottable rows. Use the exact row table for keyboard selection.`} style={{ touchAction: "none", cursor: mode === "pan" ? "grab" : "crosshair" }} onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const p = position(e); setDrag({ from: p, to: p }); }} onPointerMove={e => {
      const p = position(e); if (drag) setDrag({ ...drag, to: p });
      else { const row = nearest(p); setHover(row < 0 ? "" : `${visual.ids[row]} · ${x.label}: ${x.values[row]} · ${y.label}: ${y.values[row]}${color ? ` · ${color.label}: ${color.values[row] ?? "missing"}` : ""}`); }
    }} onPointerUp={e => {
      if (!drag) return; const to = position(e), a = invert(drag.from), b = invert(to), moved = Math.hypot(to[0] - drag.from[0], to[1] - drag.from[1]) > 5;
      if (mode === "pan" && moved) setView([domain[0] + a[0] - b[0], domain[1] + a[0] - b[0], domain[2] + a[1] - b[1], domain[3] + a[1] - b[1]]);
      else if (mode === "select") { const row = nearest(to); select(moved ? selectRectangle(x, y, [...a, ...b], xScale, yScale) : row < 0 ? [] : [row], e.shiftKey); }
      setDrag(null); e.currentTarget.releasePointerCapture(e.pointerId);
    }} onPointerCancel={() => setDrag(null)} onPointerLeave={() => setHover("")} />
    <small className="aw-visual-point">{hover || `Drag to select; Shift adds rows. ${valid.length}/${visual.ids.length} rows have both coordinates${xScale === "log" || yScale === "log" ? "; log axes omit nonpositive values" : ""}.`}</small>
    <button onClick={() => canvas.current?.toBlob(blob => blob && saveVisual(blob, "scatter.png", "image/png"))}>Save PNG</button>
  </figure>;
}

function Distribution({ column, selection, select }: { column: ExplorerColumn; selection: Selection; select: Select }) {
  const bins = useMemo(() => histogram(column, selection), [column, selection]), max = Math.max(1, ...bins.map(b => b.total));
  const missing = column.values.filter(v => v === null).length;
  return <figure className="aw-explorer-distribution"><figcaption>{column.label} · distribution</figcaption>
    <svg viewBox="0 0 600 240" role="group" aria-label={`Distribution of ${column.label}; 20 fixed full-data bins`}>
      <text x={5} y={14} fill="currentColor" fontSize={12}>{max} rows</text>
      {bins.map((bin, i) => <g key={i} role="button" tabIndex={0} aria-label={`Bin ${short(bin.lo)} to ${short(bin.hi)}: ${bin.total} rows, ${bin.selected} selected`} onClick={e => select(bin.rows, e.shiftKey)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(bin.rows, e.shiftKey); } }}>
        <rect x={i * 29 + 10} y={25} width={27} height={185} fill="transparent" />
        <rect x={i * 29 + 10} y={210 - bin.total / max * 180} width={27} height={bin.total / max * 180} fill={accent} opacity={selection ? .22 : .75} />
        {selection && <rect x={i * 29 + 10} y={210 - bin.selected / max * 180} width={27} height={bin.selected / max * 180} fill={accent} />}
        <title>{`${bin.lo} ≤ value ${i === bins.length - 1 ? "≤" : "<"} ${bin.hi}; ${bin.total} rows; ${bin.selected} selected`}</title>
      </g>)}
      <text x={10} y={233} fill="currentColor" fontSize={12}>{short(bins[0].lo)}</text><text x={590} y={233} textAnchor="end" fill="currentColor" fontSize={12}>{short(bins.at(-1)!.hi)}</text>
    </svg><small>Click a bin to select its rows; Shift adds. Fixed bins show counts, not a fitted density. {missing > 0 && `${missing} missing values omitted.`}</small>
  </figure>;
}

function Parallel({ columns, selection }: { columns: ExplorerColumn[]; selection: Selection }) {
  const { ref, width, visible, theme } = useVisualSurface(), canvas = useRef<HTMLCanvasElement>(null);
  const plotWidth = Math.max(width, columns.length * 85 + 80);
  const domains = useMemo(() => columns.map(c => columnDomain(c)), [columns]);
  useEffect(() => {
    if (!canvas.current || !visible) return;
    const h = 280, { c, ink } = context(canvas.current, plotWidth, h), mapX = (i: number) => 65 + i / (columns.length - 1) * (plotWidth - 130), mapY = (v: number, i: number) => 235 - (v - domains[i][0]) / (domains[i][1] - domains[i][0]) * 195;
    c.strokeStyle = ink; c.fillStyle = ink; c.textAlign = "center";
    columns.forEach((column, i) => { c.globalAlpha = .25; c.beginPath(); c.moveTo(mapX(i), 40); c.lineTo(mapX(i), 235); c.stroke(); c.globalAlpha = 1; c.fillText(column.label.slice(0, 22), mapX(i), 16, Math.max(50, (plotWidth - 60) / columns.length)); c.fillText(short(domains[i][1]), mapX(i), 32); c.fillText(short(domains[i][0]), mapX(i), 255); });
    for (const chosen of [false, true]) for (let row = 0; row < columns[0].values.length; row++) {
      if (Boolean(selection?.has(row)) !== chosen) continue;
      c.globalAlpha = selection ? chosen ? .65 : .025 : .12; c.strokeStyle = chosen ? accent : ink; c.lineWidth = chosen ? 1.5 : .7; c.beginPath();
      let previous = false;
      columns.forEach((column, i) => { const v = column.values[row]; if (typeof v !== "number") { previous = false; return; } if (previous) c.lineTo(mapX(i), mapY(v, i)); else c.moveTo(mapX(i), mapY(v, i)); previous = true; }); c.stroke();
    }
  }, [columns, domains, selection, plotWidth, visible, theme]);
  return <figure ref={ref} style={{ overflowX: "auto" }}><canvas ref={canvas} style={{ width: plotWidth }} role="img" aria-label={`Parallel coordinates: ${columns.map(c => c.label).join(", ")}. Selection linked to scatter and table.`} /><small>Each saved row is a line; axes use separate full-data linear ranges. Missing values break the line. This is not a trajectory or a common-unit scale.</small><button onClick={() => canvas.current?.toBlob(blob => blob && saveVisual(blob, "parallel-coordinates.png", "image/png"))}>Save PNG</button></figure>;
}

export function ExperimentExplorerView({ visual }: { visual: ExplorerVisual }) {
  const { ref } = useVisualSurface(), [xKey, setX] = useState(visual.x), [yKey, setY] = useState(visual.y), [colorKey, setColor] = useState(visual.color ?? ""), [distributionKey, setDistribution] = useState(visual.x);
  const [xScale, setXScale] = useState<AxisScale>("linear"), [yScale, setYScale] = useState<AxisScale>("linear"), [selection, setSelection] = useState<Set<number> | null>(null), [page, setPage] = useState(0);
  const [dimensions, setDimensions] = useState(visual.dimensions), [query, setQuery] = useState(""), [selectedOnly, setSelectedOnly] = useState(false), [copyNotice, setCopyNotice] = useState(""), [copyFallback, setCopyFallback] = useState("");
  useEffect(() => { setCopyNotice(""); setCopyFallback(""); }, [selection]);
  const numeric = useMemo(() => visual.columns.filter(numericColumn), [visual]), column = (key: string) => visual.columns.find(c => c.key === key)!;
  const selectedRows = useMemo(() => visual.ids.flatMap((_, i) => selection === null || selection.has(i) ? [i] : []), [visual, selection]);
  const tableRows = useMemo(() => visual.ids.flatMap((_, i) => (!selectedOnly || selection?.has(i)) && (!query || [visual.ids[i], ...visual.columns.map(c => c.values[i])].some(v => String(v ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase()))) ? [i] : []), [visual, selection, selectedOnly, query]);
  const pages = Math.max(1, Math.ceil(tableRows.length / 25)), safePage = Math.min(page, pages - 1);
  const select: Select = (rows, add) => { setSelection(old => new Set(add ? [...(old ?? []), ...rows] : rows)); setPage(0); };
  const options = numeric.map(c => <option key={c.key} value={c.key}>{c.label}</option>);
  const parallelColumns = useMemo(() => dimensions.map(key => visual.columns.find(c => c.key === key)!), [dimensions, visual]);
  return <section className="aw-research-visual aw-explorer" ref={ref} aria-label={visual.title}>
    <header><strong>{visual.title}</strong><button onClick={() => saveVisual(JSON.stringify(visual), "explorer.json")}>Save exact data</button><button onClick={() => void ref.current?.requestFullscreen()}>Expand</button></header>
    {visual.description && <p>{visual.description}</p>}
    <div className="aw-visual-controls"><label>X <select aria-label="Scatter X" value={xKey} onChange={e => setX(e.target.value)}>{options}</select></label><label>Scale <select aria-label="X scale" value={xScale} onChange={e => setXScale(e.target.value as AxisScale)}><option>linear</option><option>log</option></select></label><label>Y <select aria-label="Scatter Y" value={yKey} onChange={e => setY(e.target.value)}>{options}</select></label><label>Scale <select aria-label="Y scale" value={yScale} onChange={e => setYScale(e.target.value as AxisScale)}><option>linear</option><option>log</option></select></label><label>Color <select aria-label="Row color" value={colorKey} onChange={e => setColor(e.target.value)}><option value="">None</option>{visual.columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label></div>
    {colorKey && <details className="aw-explorer-color"><summary>Color key · {column(colorKey).label}</summary>{numericColumn(column(colorKey)) ? <small>Blue → warm: {columnDomain(column(colorKey)).map(short).join(" to ")}. Fixed full-data range; missing values gray.</small> : <><div className="aw-explorer-keys">{[...new Set(column(colorKey).values)].slice(0, 30).map((v, i) => <span key={i}><i style={{ background: rowColor(column(colorKey), column(colorKey).values.indexOf(v), [0, 1]) }} />{v ?? "missing"}</span>)}</div><small>First 30 category labels shown; all rows remain plotted. Colors can repeat; use the table for exact groups.</small></>}</details>}
    <div className="aw-explorer-selection" role="status">{selection === null ? `${visual.ids.length} saved rows · no selection` : `${selection.size} of ${visual.ids.length} selected`}<button disabled={selection === null} onClick={() => { setSelection(null); setPage(0); }}>Clear selection</button><details><summary>Save rows</summary><button onClick={() => saveVisual(JSON.stringify(explorerSubset(visual, selectedRows)), "selected-rows.json")}>JSON · {selectedRows.length} rows</button><button onClick={() => saveVisual(explorerCsv(visual, selectedRows), "selected-rows.csv", "text/csv;charset=utf-8")}>CSV · {selectedRows.length} rows</button><button disabled={selection === null || selectedRows.length > 200} title="Copy up to 200 selected row IDs for a question; download JSON for larger selections" onClick={async () => { const text = `Saved visual: ${visual.title}\nSelected row IDs: ${JSON.stringify(selectedRows.map(i => visual.ids[i]))}\nView selection only, not a new experiment. Use this cell's evidence link to locate the full dataset.`; try { await navigator.clipboard.writeText(text); setCopyNotice(`Copied ${selectedRows.length} row IDs`); setCopyFallback(""); } catch { setCopyFallback(text); setCopyNotice("Copy the selected row IDs below"); } }}>Copy row IDs</button>{copyNotice && <small>{copyNotice}</small>}{copyFallback && <textarea aria-label="Selected row IDs to copy" readOnly value={copyFallback} />}</details></div>
    <div className="aw-explorer-grid"><Scatter visual={visual} x={column(xKey)} y={column(yKey)} color={colorKey ? column(colorKey) : undefined} xScale={xScale} yScale={yScale} selection={selection} select={select} /><div><label className="aw-explorer-distribution-picker">Distribution <select aria-label="Distribution column" value={distributionKey} onChange={e => setDistribution(e.target.value)}>{options}</select></label><Distribution column={column(distributionKey)} selection={selection} select={select} /></div></div>
    <details><summary>Compare dimensions</summary><div className="aw-visual-controls">{numeric.map(c => <label key={c.key}><input type="checkbox" checked={dimensions.includes(c.key)} disabled={dimensions.includes(c.key) ? dimensions.length <= 2 : dimensions.length >= 8} onChange={e => setDimensions(e.target.checked ? [...dimensions, c.key] : dimensions.filter(k => k !== c.key))} />{c.label}</label>)}</div><Parallel columns={parallelColumns} selection={selection} /></details>
    <details><summary>Exact rows · {visual.ids.length}</summary><div className="aw-visual-controls"><label>Find in rows <input aria-label="Find saved rows" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label><label><input type="checkbox" checked={selectedOnly} onChange={e => { setSelectedOnly(e.target.checked); setPage(0); }} />Selected only</label></div><small>Checkboxes select rows across every view. Search filters this table only; downloads include the selection, not the search. Nulls mean missing, not zero.</small>
      <div className="aw-explorer-table"><table><thead><tr><th>Select</th><th>Row ID</th>{visual.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{tableRows.slice(safePage * 25, safePage * 25 + 25).map(i => <tr key={visual.ids[i]}><td><input type="checkbox" aria-label={`Select row ${visual.ids[i]}`} checked={selection?.has(i) ?? false} onChange={e => { setSelection(old => { const next = new Set(old ?? []); if (e.target.checked) next.add(i); else next.delete(i); return next; }); }} /></td><th scope="row">{visual.ids[i]}</th>{visual.columns.map(c => <td key={c.key}>{c.values[i] === null ? <em>missing</em> : String(c.values[i])}</td>)}</tr>)}</tbody></table></div>
      <div className="aw-visual-controls"><button disabled={!safePage} onClick={() => setPage(safePage - 1)}>Previous rows</button><span>{tableRows.length} matches · page {safePage + 1}/{pages}</span><button disabled={safePage >= pages - 1} onClick={() => setPage(safePage + 1)}>Next rows</button></div>
    </details><small>Saved samples only · selection, zoom and axis choices do not rerun Python or alter the notebook. Selected subsets are descriptive, not new independent evidence. View state resets when this display is reopened.</small>
  </section>;
}
