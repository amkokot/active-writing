/** Saved rows, not a query language. Interactions never mutate experiment evidence. */
export const explorerMime = "application/vnd.aw.explorer+json";
export type ExplorerValue = number | string | null;
export interface ExplorerColumn { key: string; label: string; values: ExplorerValue[] }
export interface ExplorerVisual {
  version: 1; title: string; description: string; ids: string[]; columns: ExplorerColumn[];
  x: string; y: string; color?: string; dimensions: string[];
}
export function numericColumn(column: ExplorerColumn) {
  return column.values.some(v => typeof v === "number") && column.values.every(v => v === null || typeof v === "number");
}
export function explorerVisual(value: unknown): ExplorerVisual | undefined {
  const v = value as ExplorerVisual, short = (x: unknown, n: number) => typeof x === "string" && x.length > 0 && x.length <= n;
  if (!v || v.version !== 1 || !short(v.title, 300) || typeof v.description !== "string" || v.description.length > 2000
    || !Array.isArray(v.ids) || !v.ids.length || v.ids.length > 10000 || !v.ids.every(id => short(id, 160)) || new Set(v.ids).size !== v.ids.length
    || !Array.isArray(v.columns) || v.columns.length < 2 || v.columns.length > 32 || JSON.stringify(v).length > 1_500_000) return;
  for (const c of v.columns) {
    if (!c || !short(c.key, 80) || !short(c.label, 160) || !Array.isArray(c.values) || c.values.length !== v.ids.length
      || !c.values.every(x => x === null || typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e100 || typeof x === "string" && x.length <= 300)) return;
    const kinds = new Set(c.values.filter(x => x !== null).map(x => typeof x));
    if (kinds.size > 1) return;
  }
  const keys = new Set(v.columns.map(c => c.key)), numeric = new Set(v.columns.filter(numericColumn).map(c => c.key));
  if (keys.size !== v.columns.length || !numeric.has(v.x) || !numeric.has(v.y) || v.x === v.y || v.color !== undefined && !keys.has(v.color)
    || !Array.isArray(v.dimensions) || v.dimensions.length < 2 || v.dimensions.length > 8 || new Set(v.dimensions).size !== v.dimensions.length || !v.dimensions.every(k => numeric.has(k))) return;
  return v;
}
export type AxisScale = "linear" | "log";
export function axisValue(value: ExplorerValue, scale: AxisScale): number | undefined {
  return typeof value === "number" && (scale !== "log" || value > 0) ? scale === "log" ? Math.log10(value) : value : undefined;
}
/** Full-data domain stays fixed when a subset is selected. Constant columns get padding. */
export function columnDomain(column: ExplorerColumn, scale: AxisScale = "linear"): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const v of column.values) { const x = axisValue(v, scale); if (x !== undefined) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
  if (lo === Infinity) return [0, 1];
  if (lo === hi) { const pad = Math.max(1, Math.abs(lo)) * .05; return [lo - pad, hi + pad]; }
  return [lo, hi];
}
export function selectRectangle(x: ExplorerColumn, y: ExplorerColumn, bounds: number[], xScale: AxisScale = "linear", yScale: AxisScale = "linear") {
  const [x0, y0, x1, y1] = bounds, result: number[] = [];
  x.values.forEach((v, i) => {
    const a = axisValue(v, xScale), b = axisValue(y.values[i], yScale);
    if (a !== undefined && b !== undefined && a >= Math.min(x0, x1) && a <= Math.max(x0, x1) && b >= Math.min(y0, y1) && b <= Math.max(y0, y1)) result.push(i);
  });
  return result;
}
export function histogram(column: ExplorerColumn, selected: ReadonlySet<number> | null, count = 20, scale: AxisScale = "linear") {
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new Error("Use 1–200 histogram bins.");
  const domain = columnDomain(column, scale), bins = Array.from({ length: count }, (_, i) => ({ lo: domain[0] + (domain[1] - domain[0]) * i / count, hi: domain[0] + (domain[1] - domain[0]) * (i + 1) / count, total: 0, selected: 0, rows: [] as number[] }));
  column.values.forEach((v, i) => {
    const x = axisValue(v, scale); if (x === undefined) return;
    const bin = bins[Math.max(0, Math.min(count - 1, Math.floor((x - domain[0]) / (domain[1] - domain[0]) * count)))];
    bin.total++; if (selected?.has(i)) bin.selected++; bin.rows.push(i);
  });
  return bins;
}
export function explorerSubset(visual: ExplorerVisual, indices: number[]) {
  return { title: visual.title, description: "View selection from saved rows; not a new experiment or population estimate.", ids: indices.map(i => visual.ids[i]), columns: visual.columns.map(c => ({ ...c, values: indices.map(i => c.values[i]) })) };
}
/** Spreadsheet-safe text fields, while keeping scientific numeric values exact. */
export function explorerCsv(visual: ExplorerVisual, indices: number[]) {
  const quote = (v: ExplorerValue) => { const s = v === null ? "" : String(v), safe = typeof v === "string" && /^[\s]*[=+@-]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };
  return [["id", ...visual.columns.map(c => c.label)].map(quote).join(","), ...indices.map(i => [visual.ids[i], ...visual.columns.map(c => c.values[i])].map(quote).join(","))].join("\r\n");
}
