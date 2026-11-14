import { explorerMime, explorerVisual } from "./experimentExplorer.ts";
/** Saved, declarative research displays. No callbacks, code, file paths or network. */
export const geometryMime = "application/vnd.aw.geometry+json";
export const animationMime = "application/vnd.aw.animation+json";
export const htmlMime = "application/vnd.aw.html+json";
export interface GeometryLayer { points?: number[][]; values?: number[]; weights?: number[]; edges?: number[][]; ellipses?: { center: number[]; axes: number[][] }[] }
export interface GeometryPanel extends GeometryLayer { title: string; points: number[][]; anchors?: number[]; pointIds?: string[]; pointLabels?: string[]; axisLabels?: string[] }
export interface GeometryVisual { version: 1; title: string; description: string; panels: GeometryPanel[]; frames: { label: string; panels: GeometryLayer[] }[]; initial: number; fps: number; colorRange?: number[] }
export interface ImageAnimation { version: 1; title: string; description: string; frames: { label: string; png: string }[]; initial: number; fps: number }
export interface HtmlVisual { version: 1; title: string; description: string; html: string; height: number }
const record = (v: any) => v && typeof v === "object" && !Array.isArray(v);
const text = (v: any, max = 300) => typeof v === "string" && v.length <= max;
const finite = (v: any) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e100;
const vector = (v: any, d: number) => Array.isArray(v) && v.length === d && v.every(finite);
const numbers = (v: any, n: number, positive = false) => Array.isArray(v) && v.length === n && v.every(x => finite(x) && (!positive || x >= 0));
function layer(v: any, n: number, d: number) {
  return record(v) && (v.points === undefined || Array.isArray(v.points) && v.points.length === n && v.points.every((p: any) => vector(p, d))) && (v.values === undefined || numbers(v.values, n)) && (v.weights === undefined || numbers(v.weights, n, true))
    && (v.edges === undefined || Array.isArray(v.edges) && v.edges.length <= 1500 && v.edges.every((e: any) => Array.isArray(e) && [2, 3].includes(e.length) && e.slice(0, 2).every((i: any) => Number.isInteger(i) && i >= 0 && i < n) && (e.length === 2 || finite(e[2]) && e[2] >= 0)))
    && (v.ellipses === undefined || Array.isArray(v.ellipses) && v.ellipses.length <= 24 && v.ellipses.every((e: any) => record(e) && vector(e.center, d) && Array.isArray(e.axes) && e.axes.length === d && e.axes.every((a: any) => vector(a, d))));
}
function timed(v: any) { return record(v) && v.version === 1 && text(v.title) && text(v.description, 2000) && Number.isInteger(v.initial) && Number.isInteger(v.fps) && v.fps >= 1 && v.fps <= 24 && Array.isArray(v.frames) && v.frames.length >= 1 && v.frames.length <= 120 && v.initial >= 0 && v.initial < v.frames.length; }
export function geometryVisual(value: unknown): GeometryVisual | undefined {
  const v = value as GeometryVisual;
  if (!timed(v) || JSON.stringify(v).length > 1_500_000 || !Array.isArray(v.panels) || v.panels.length < 1 || v.panels.length > 6) return;
  let total = 0;
  for (const p of v.panels) {
    if (!record(p) || !text(p.title) || !Array.isArray(p.points) || !p.points.length || p.points.length > 12000) return;
    const d = p.points[0]?.length;
    if (![2, 3].includes(d) || !p.points.every(x => vector(x, d)) || !layer(p, p.points.length, d)) return;
    if (p.anchors !== undefined && (!Array.isArray(p.anchors) || p.anchors.length > 24 || !p.anchors.every(i => Number.isInteger(i) && i >= 0 && i < p.points.length))) return;
    if (p.pointIds !== undefined && (!Array.isArray(p.pointIds) || p.pointIds.length !== p.points.length || !p.pointIds.every(id => text(id, 160) && id.length > 0) || new Set(p.pointIds).size !== p.pointIds.length)) return;
    if (p.pointLabels !== undefined && (!Array.isArray(p.pointLabels) || p.pointLabels.length !== p.points.length || !p.pointLabels.every(label => text(label)))) return;
    if (p.axisLabels !== undefined && (!Array.isArray(p.axisLabels) || p.axisLabels.length !== d || !p.axisLabels.every(label => text(label, 80)))) return;
    total += p.points.length;
  }
  if (total > 20000 || v.colorRange !== undefined && (!vector(v.colorRange, 2) || v.colorRange[0] > v.colorRange[1])) return;
  for (const f of v.frames) if (!record(f) || !text(f.label) || !Array.isArray(f.panels) || f.panels.length !== v.panels.length || !f.panels.every((l, i) => layer(l, v.panels[i].points.length, v.panels[i].points[0].length))) return;
  return v;
}
export function imageAnimation(value: unknown): ImageAnimation | undefined {
  const v = value as ImageAnimation;
  if (!timed(v) || JSON.stringify(v).length > 1_500_000 || !v.frames.every(f => record(f) && text(f.label) && typeof f.png === "string" && f.png.startsWith("iVBORw0KGgo") && /^[A-Za-z0-9+/=]+$/.test(f.png))) return;
  return v;
}
export function htmlVisual(value: unknown): HtmlVisual | undefined {
  const v = value as HtmlVisual;
  if (!record(v) || v.version !== 1 || !text(v.title) || !text(v.description, 2000) || typeof v.html !== "string" || !v.html || v.html.length > 1_000_000 || !Number.isInteger(v.height) || v.height < 200 || v.height > 1600) return;
  return v;
}
export function visualSummary(data: Record<string, unknown> | undefined) {
  const e = explorerVisual(data?.[explorerMime]);
  if (e) return `${e.title}: linked data explorer; ${e.ids.length} saved rows; columns: ${e.columns.map(c => `${c.label} [${c.key}]`).join(", ")}; scatter ${e.x}/${e.y}, distributions and parallel coordinates. All rows retained, including nulls; inspect exact output for values. View selections are not new experiments. No rerun. ${e.description}`;
  const g = geometryVisual(data?.[geometryMime]);
  if (g) return `${g.title}: saved geometry; ${g.panels.map(p => `${p.title} (${p.points.length} points, ${p.points[0].length}D${p.pointIds ? ", linked row IDs" : ""})`).join("; ")}; ${g.frames.length} frames (${g.frames[0].label} → ${g.frames.at(-1)!.label}); initial=${g.initial}. All frames retained; inspect exact output for coordinates/values/weights/edges/ellipses. No interpolation or rerun.`;
  const a = imageAnimation(data?.[animationMime]);
  if (a) return `${a.title}: ${a.frames.length} saved PNG frames (${a.frames[0].label} → ${a.frames.at(-1)!.label}); ${a.fps} fps, initial=${a.initial}. No rerun.`;
  const h = htmlVisual(data?.[htmlMime]);
  if (h) return `${h.title}: saved interactive HTML (${h.html.length} characters). Explicit isolated viewer; network and parent access blocked. ${h.description}`;
}
// CSP precedes even a supplied full document. Sandbox omits same-origin, forms,
// popups and downloads. Do not add external script/CDN allowances here.
export const visualCsp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
export function isolatedVisualDocument(html: string) {
  const inner = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${visualCsp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;font:14px system-ui;color:#202733;background:#fff}canvas,svg,img{max-width:100%}</style>${html}`;
  // A fixed outer document permits only an inline about: child. Its frame-src
  // also blocks the child's self-navigation to network URLs. Both frames have
  // opaque sandbox origins; no parent message bridge or same-origin allowance.
  const payload = JSON.stringify(inner).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${visualCsp.replace("frame-src 'none'", "frame-src about:")}"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block}</style><script>const f=document.createElement('iframe');f.title='Saved interactive content';f.setAttribute('sandbox','allow-scripts');f.referrerPolicy='no-referrer';f.srcdoc=${payload};window.addEventListener('DOMContentLoaded',()=>document.body.append(f));</script><body></body>`;

}

export function geometryColorRange(visual: GeometryVisual): number[] {
  if (visual.colorRange) return visual.colorRange;
  let lo = Infinity, hi = -Infinity;
  const read = (xs?: number[]) => { for (const x of xs ?? []) { lo = Math.min(lo, x); hi = Math.max(hi, x); } };
  for (const p of visual.panels) read(p.values);
  for (const f of visual.frames) for (const p of f.panels) read(p.values);
  return lo === Infinity ? [0, 1] : [lo, hi];
}
/** Never infer correspondence from array position in unrelated panels. */
export function linkedGeometryPoint(visual: GeometryVisual, picked: { panel: number; row: number } | null, target: number) {
  if (!picked) return -1;
  if (picked.panel === target) return picked.row;
  const id = visual.panels[picked.panel].pointIds?.[picked.row];
  return id === undefined ? -1 : visual.panels[target].pointIds?.indexOf(id) ?? -1;
}
