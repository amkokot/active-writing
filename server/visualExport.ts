import { explorerVisual, explorerMime, columnDomain } from "../src/experimentExplorer.ts";
import { geometryVisual, geometryMime, imageAnimation, animationMime, geometryColorRange } from "../src/experimentVisual.ts";
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
const normalize = (v: number, lo: number, hi: number) => lo === hi ? .5 : (v - lo) / (hi - lo);
/** Static sharing/PDF fallbacks; scripts and live selections are never exported. */
export function nativeVisualExport(data: Record<string, unknown>, prefix: string) {
  const explorer = explorerVisual(data[explorerMime]), geometry = geometryVisual(data[geometryMime]), animation = imageAnimation(data[animationMime]);
  const value = explorer ?? geometry ?? animation;
  if (!value) return;
  const name = `figures/${prefix}-visual.json`, files = [{ name, data: Buffer.from(JSON.stringify(value)) }];
  let figure = "";
  if (explorer) {
    const x = explorer.columns.find(c => c.key === explorer.x)!, y = explorer.columns.find(c => c.key === explorer.y)!, xd = columnDomain(x), yd = columnDomain(y);
    const valid = explorer.ids.flatMap((_, i) => typeof x.values[i] === "number" && typeof y.values[i] === "number" ? [i] : []), preview = valid.slice(0, 2000);
    const dots = preview.map(i => `<circle cx="${(60 + normalize(x.values[i] as number, ...xd) * 580).toFixed(2)}" cy="${(270 - normalize(y.values[i] as number, ...yd) * 230).toFixed(2)}" r="2.4" fill="#4388b7" opacity=".6"/>`).join("");
    figure = `<svg viewBox="0 0 700 325" role="img" aria-label="${escape(explorer.title)}"><path d="M60 35V275H650" fill="none" stroke="#999"/>${dots}<text x="350" y="318" text-anchor="middle">${escape(x.label)}</text><text x="14" y="160" transform="rotate(-90 14 160)" text-anchor="middle">${escape(y.label)}</text><text x="60" y="294">${escape(xd[0])}</text><text x="650" y="294" text-anchor="end">${escape(xd[1])}</text><text x="58" y="30">${escape(yd[1])}</text><text x="58" y="269" text-anchor="end">${escape(yd[0])}</text></svg><p>Static initial-axis preview: ${preview.length} of ${valid.length} rows with both coordinates (${explorer.ids.length} saved rows total).${valid.length > preview.length ? " First 2,000 plottable rows only; full data retained in the download." : ""} Group colors, interactive selection and other dimensions are available in Aw, not this static figure.</p>`;
  } else if (geometry) {
    const range = geometryColorRange(geometry);
    figure = geometry.panels.map((p, index) => {
      const layer = { ...p, ...geometry.frames[geometry.initial].panels[index] }, points = layer.points, d = p.points[0].length;
      const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (const point of points) for (let i = 0; i < 2; i++) { lo[i] = Math.min(lo[i], point[i]); hi[i] = Math.max(hi[i], point[i]); }
      const radius = Math.max(hi[0] - lo[0], hi[1] - lo[1], 1e-100), center = lo.map((v, i) => (v + hi[i]) / 2);
      const project = (point: number[]) => [180 + (point[0] - center[0]) / radius * 230, 135 - (point[1] - center[1]) / radius * 230];
      const edges = (layer.edges ?? []).map(edge => { const a = project(points[edge[0]]), b = project(points[edge[1]]); return `<path d="M${a.join(" ")}L${b.join(" ")}" stroke="#606c78" opacity=".2"/>`; }).join("");
      const dots = points.slice(0, 2000).map((point, i) => { const [x, y] = project(point), v = layer.values?.[i]; return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2" fill="${v === undefined ? "#4388b7" : `hsl(${245 - 225 * Math.max(0, Math.min(1, normalize(v, range[0], range[1])))} 65% 49%)`}" opacity=".65"/>`; }).join("");
      return `<figure><figcaption>${escape(p.title)}</figcaption><svg viewBox="0 0 360 270" role="img" aria-label="${escape(p.title)}">${edges}${dots}</svg><p>${Math.min(points.length, 2000)} of ${points.length} points; ${d === 3 ? "first two coordinates of 3D data, not the interactive camera" : "2D coordinates"}. Static sharing omits interactive weights/ellipses/selection; exact frames retained in the download.</p></figure>`;
    }).join("");
    figure = `<p>Saved initial frame: ${escape(geometry.frames[geometry.initial].label)} (${geometry.initial + 1}/${geometry.frames.length}).</p>${figure}`;
  } else if (animation) {
    figure = `<img src="data:image/png;base64,${animation.frames[animation.initial].png}" alt="${escape(animation.title)}: ${escape(animation.frames[animation.initial].label)}"/><p>Static frame ${animation.initial + 1}/${animation.frames.length}: ${escape(animation.frames[animation.initial].label)}. All saved frames retained in the download.</p>`;
  }
  return { files, html: `<figure><figcaption>${escape(value.title)}</figcaption><p>${escape(value.description)}</p>${figure}<p><a href="${name}" download>Complete saved visual data (JSON)</a> · No new computation or live interaction in this reading copy.</p></figure>` };
}
