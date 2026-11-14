import { useEffect, useMemo, useRef, useState } from "react";

import { geometryVisual, imageAnimation, htmlVisual, isolatedVisualDocument, geometryMime, animationMime, htmlMime, geometryColorRange, linkedGeometryPoint } from "../experimentVisual";

import type { GeometryVisual, GeometryLayer, HtmlVisual } from "../experimentVisual";

import "../experimentVisual.css";
import { explorerMime, explorerVisual } from "../experimentExplorer";
import { ExperimentExplorerView } from "./ExperimentExplorerView";



function download(value: BlobPart, name: string, type = "application/json") {

  const url = URL.createObjectURL(new Blob([value], { type })), a = document.createElement("a");

  a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);

}

function useVisible() {

  const ref = useRef<HTMLElement>(null), [visible, setVisible] = useState(false);

  useEffect(() => {

    const el = ref.current; if (!el) return;

    let intersects = false;

    const update = () => setVisible(intersects && document.visibilityState === "visible");

    const observer = new IntersectionObserver(entries => { intersects = entries[0].isIntersecting; update(); });

    observer.observe(el); document.addEventListener("visibilitychange", update);

    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };

  }, []);

  return { ref, visible };

}

function useTimeline(length: number, initial: number, fps: number, visible: boolean) {

  const [index, setIndex] = useState(initial), [playing, setPlaying] = useState(false);

  useEffect(() => { if (!visible) setPlaying(false); }, [visible]);

  useEffect(() => {

    if (!playing || !visible) return;

    const timer = window.setInterval(() => setIndex(i => { if (i >= length - 1) { setPlaying(false); return i; } return i + 1; }), 1000 / fps);

    return () => window.clearInterval(timer);

  }, [playing, visible, length, fps]);

  return { index: Math.min(index, length - 1), setIndex, playing, setPlaying };

}

type Timeline = ReturnType<typeof useTimeline>;

function TimelineBar({ time, frames }: { time: Timeline; frames: { label: string }[] }) {

  return <div className="aw-visual-controls">

    <button disabled={frames.length < 2} aria-pressed={time.playing} onClick={() => { if (!time.playing && time.index === frames.length - 1) time.setIndex(0); time.setPlaying(!time.playing); }}>{time.playing ? "Pause" : "Play"}</button>

    <button disabled={!time.index} onClick={() => { time.setPlaying(false); time.setIndex(i => i - 1); }} aria-label="Previous saved frame">←</button>

    <input aria-label="Saved animation frame" aria-valuetext={frames[time.index].label} type="range" min={0} max={frames.length - 1} value={time.index} onChange={e => { time.setPlaying(false); time.setIndex(Number(e.target.value)); }} />

    <button disabled={time.index === frames.length - 1} onClick={() => { time.setPlaying(false); time.setIndex(i => i + 1); }} aria-label="Next saved frame">→</button>

    <output aria-live={time.playing ? "off" : "polite"}>{time.index + 1}/{frames.length} · {frames[time.index].label}</output>

  </div>;

}

function GeometryCanvas({ visual, index, panelIndex, camera, anchor, visible, picked, onPick, onRotate, zoom }: { visual: GeometryVisual; index: number; panelIndex: number; camera: number[]; anchor: number; visible: boolean; picked: { panel: number; row: number } | null; onPick: (point: { panel: number; row: number }) => void; onRotate: (camera: number[]) => void; zoom: number }) {

  const canvas = useRef<HTMLCanvasElement>(null), [size, setSize] = useState(400), [hover, setHover] = useState("");

  const panel = visual.panels[panelIndex], layer: GeometryLayer = useMemo(() => ({ ...panel, ...visual.frames[index].panels[panelIndex] }), [panel, visual, index, panelIndex]);

  const projected = useRef<number[][]>([]);
  const pointer = useRef<number[] | null>(null), moved = useRef(false);
  const selectedPoint = linkedGeometryPoint(visual, picked, panelIndex);

  const range = useMemo(() => geometryColorRange(visual), [visual]);
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(x => x + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const bounds = useMemo(() => {

    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];

    for (const points of [panel.points, ...visual.frames.map(f => f.panels[panelIndex].points ?? [])]) for (const p of points) p.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });

    const d = panel.points[0].length, center = lo.slice(0, d).map((v, i) => (v + hi[i]) / 2);

    const radius = Math.max(1e-100, ...hi.slice(0, d).map((v, i) => (v - lo[i]) / 2)) * (d === 3 ? 1.8 : 1.15);

    return { center, radius, d };

  }, [panel, visual, panelIndex]);

  useEffect(() => {

    const el = canvas.current; if (!el) return;

    const obs = new ResizeObserver(() => setSize(Math.max(180, el.clientWidth))); obs.observe(el);

    return () => obs.disconnect();

  }, []);

  useEffect(() => {

    const el = canvas.current; if (!el || !visible) return;

    const w = size, h = Math.max(250, Math.min(420, size * .85)), ratio = Math.min(2, window.devicePixelRatio || 1);

    el.width = w * ratio; el.height = h * ratio; el.style.height = `${h}px`;

    const c = el.getContext("2d")!; c.scale(ratio, ratio);

    const style = getComputedStyle(el), ink = style.color;
    c.fillStyle = style.getPropertyValue("--paper").trim() || "white"; c.fillRect(0, 0, w, h);

    const project = (p: number[]) => {

      let [x, y, z = 0] = p.map((v, i) => (v - bounds.center[i]) / bounds.radius);

      if (bounds.d === 3) { const a = camera[0], b = camera[1], xx = Math.cos(a) * x + Math.sin(a) * z, zz = -Math.sin(a) * x + Math.cos(a) * z; x = xx; z = Math.sin(b) * y + Math.cos(b) * zz; y = Math.cos(b) * y - Math.sin(b) * zz; }

      return [w / 2 + x * Math.min(w, h) * .43 * zoom, h / 2 - y * Math.min(w, h) * .43 * zoom, z];

    };

    const points = (layer.points ?? panel.points).map(project); projected.current = points;

    const selected = anchor < 0 ? panel.anchors ?? [] : panel.anchors?.slice(anchor, anchor + 1) ?? [];

    const maxWeight = Math.max(1e-100, ...(layer.weights ?? [1]));

    for (const e of layer.edges ?? []) {

      if (selected.length && anchor >= 0 && !selected.includes(e[0]) && !selected.includes(e[1])) continue;

      c.globalAlpha = .15 + .6 * Math.min(1, e[2] ?? 1); c.strokeStyle = ink; c.lineWidth = .8;

      c.beginPath(); c.moveTo(points[e[0]][0], points[e[0]][1]); c.lineTo(points[e[1]][0], points[e[1]][1]); c.stroke();

    }

    for (const i of points.map((_, i) => i).sort((a, b) => points[a][2] - points[b][2])) {

      const p = points[i], v = layer.values?.[i], t = v === undefined ? .5 : range[1] === range[0] ? .5 : Math.max(0, Math.min(1, (v - range[0]) / (range[1] - range[0])));

      const weight = layer.weights ? Math.sqrt(layer.weights[i] / maxWeight) : 1;

      c.globalAlpha = layer.weights ? .08 + .92 * weight : .8;

      c.fillStyle = v === undefined ? ink : `hsl(${245 - 225 * t} 72% 52%)`;

      c.beginPath(); c.arc(p[0], p[1], layer.weights ? 1.3 + 3.5 * weight : 2.6, 0, Math.PI * 2); c.fill();

    }

    c.globalAlpha = 1;

    for (const ellipse of layer.ellipses ?? []) for (let a = 0; a < bounds.d; a++) for (let b = a + 1; b < bounds.d; b++) {

      c.strokeStyle = ink; c.lineWidth = 1.4; c.beginPath();

      for (let k = 0; k <= 64; k++) {

        const t = k / 64 * 2 * Math.PI, p = project(ellipse.center.map((v, j) => v + Math.cos(t) * ellipse.axes[a][j] + Math.sin(t) * ellipse.axes[b][j]));

        if (!k) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]);

      } c.stroke();

    }

    selected.forEach((i, j) => { const p = points[i]; c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 2; c.beginPath(); c.arc(p[0], p[1], 7, 0, Math.PI * 2); c.stroke(); c.fillText(String.fromCharCode(65 + (anchor < 0 ? j : anchor)), p[0] + 9, p[1] - 8); });
    if (selectedPoint >= 0) { const p = points[selectedPoint]; c.strokeStyle = "#36a786"; c.lineWidth = 3; c.beginPath(); c.arc(p[0], p[1], 9, 0, Math.PI * 2); c.stroke(); }
    if (panel.axisLabels) { c.fillStyle = ink; c.font = "12px system-ui"; c.fillText(panel.axisLabels.join(" · ") + (bounds.d === 3 ? " (rotated projection)" : ""), 8, h - 8); }

  }, [visual, panel, layer, index, size, camera, anchor, visible, bounds, range, theme, selectedPoint, zoom]);

  return <figure><figcaption>{panel.title}</figcaption><canvas ref={canvas} role="img" aria-label={`${panel.title}, ${visual.frames[index].label}; ${panel.points.length} points`} style={{ touchAction: "none" }} onPointerDown={e => { if (e.button !== 0) return; pointer.current = [e.clientX, e.clientY]; moved.current = false; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerUp={e => { if (pointer.current && !moved.current) { const r = e.currentTarget.getBoundingClientRect(); let row = -1, distance = 81; projected.current.forEach((p, i) => { const d = (p[0] - e.clientX + r.left) ** 2 + (p[1] - e.clientY + r.top) ** 2; if (d < distance) { row = i; distance = d; } }); if (row >= 0) onPick({ panel: panelIndex, row }); } pointer.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { pointer.current = null; }} onPointerMove={e => {
    if (pointer.current && bounds.d === 3) { const [x, y] = pointer.current, dx = e.clientX - x, dy = e.clientY - y; if (Math.hypot(dx, dy) > 2 || moved.current) { moved.current = true; onRotate([camera[0] + dx * .01, Math.max(-1.5, Math.min(1.5, camera[1] + dy * .01))]); pointer.current = [e.clientX, e.clientY]; } return; }

    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;

    let best = -1, distance = 64;

    projected.current.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < distance) { best = i; distance = d; } });

    setHover(best < 0 ? "" : `${panel.pointLabels?.[best] || panel.pointIds?.[best] || `Point ${best}`}: [${(layer.points ?? panel.points)[best].join(", ")}]${layer.values ? `; value=${layer.values[best]}` : ""}${layer.weights ? `; weight=${layer.weights[best]}` : ""}`);

  }} onPointerLeave={() => setHover("")} /><small className="aw-visual-point">{hover || `${panel.points.length} points · ${panel.points[0].length}D${layer.weights ? " · size/opacity: relative pooling weight" : ""}`}</small>

  <button onClick={() => canvas.current?.toBlob(blob => { if (blob) download(blob, `panel-${panelIndex + 1}-frame-${index + 1}.png`, "image/png"); })}>Save frame PNG</button></figure>;

}

function GeometryView({ visual }: { visual: GeometryVisual }) {

  const { ref, visible } = useVisible(), time = useTimeline(visual.frames.length, visual.initial, visual.fps, visible);

  const [camera, setCamera] = useState([.55, -.25]), [anchor, setAnchor] = useState(-1);
  const [picked, setPicked] = useState<{ panel: number; row: number } | null>(null), [zoom, setZoom] = useState(1);

  const range = useMemo(() => geometryColorRange(visual), [visual]);
  const anchors = Math.max(0, ...visual.panels.map(p => p.anchors?.length ?? 0)), is3d = visual.panels.some(p => p.points[0].length === 3);

  return <section className="aw-research-visual" ref={ref} aria-label={visual.title}>

    <header><strong>{visual.title}</strong><button onClick={() => download(JSON.stringify(visual), "geometry.json")}>Save exact data</button><button onClick={() => void ref.current?.requestFullscreen()}>Expand</button></header>

    {visual.description && <p>{visual.description}</p>}<TimelineBar time={time} frames={visual.frames} />

    <div className="aw-visual-controls">{anchors > 0 && <label>Anchor <select value={anchor} onChange={e => setAnchor(Number(e.target.value))}><option value={-1}>All</option>{Array.from({ length: anchors }, (_, i) => <option key={i} value={i}>{String.fromCharCode(65 + i)}</option>)}</select></label>}

      {is3d && <><label>Rotate <input type="range" aria-label="Rotate 3D panels" min={-3.14} max={3.14} step={.05} value={camera[0]} onChange={e => setCamera([Number(e.target.value), camera[1]])} /></label><label>Tilt <input aria-label="Tilt 3D panels" type="range" min={-1.5} max={1.5} step={.05} value={camera[1]} onChange={e => setCamera([camera[0], Number(e.target.value)])} /></label></>}

      <label>Zoom <input aria-label="Geometry zoom" type="range" min={.5} max={5} step={.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><button onClick={() => { setZoom(1); setCamera([.55, -.25]); }}>Reset view</button>
    </div>{visual.panels.some(p => p.values) || visual.frames.some(f => f.panels.some(p => p.values)) ? <div className="aw-visual-legend" aria-label={`Shared value color scale: ${range[0]} to ${range[1]}`}><span>{range[0].toPrecision(4)}</span><i aria-hidden="true" /><span>{range[1].toPrecision(4)} · value color</span></div> : null}<details><summary>Inspect point{picked ? ` · ${visual.panels[picked.panel].pointIds?.[picked.row] ?? picked.row}` : ""}</summary><label>Panel <select aria-label="Inspect geometry panel" value={picked?.panel ?? 0} onChange={e => setPicked({ panel: Number(e.target.value), row: 0 })}>{visual.panels.map((p, i) => <option key={i} value={i}>{p.title}</option>)}</select></label><label> Point index <input aria-label="Inspect geometry point" type="number" min={0} max={visual.panels[picked?.panel ?? 0].points.length - 1} value={picked?.row ?? ""} onChange={e => { const row = Number(e.target.value), panel = picked?.panel ?? 0; if (Number.isInteger(row) && row >= 0 && row < visual.panels[panel].points.length) setPicked({ panel, row }); }} /></label>{picked && <><button onClick={() => setPicked(null)}>Clear point</button>{visual.panels.map((p, i) => { const row = linkedGeometryPoint(visual, picked, i); if (row < 0) return null; const layer = { ...p, ...visual.frames[time.index].panels[i] }; return <small key={i}>{p.title} · {p.pointLabels?.[row] || p.pointIds?.[row] || row}: [{(layer.points ?? p.points)[row].join(", ")}] {layer.values && `value=${layer.values[row]}`} {layer.weights && `weight=${layer.weights[row]}`}</small>; })}</>}</details><div className="aw-geometry-panels">{visual.panels.map((_, i) => <GeometryCanvas key={i} visual={visual} index={time.index} panelIndex={i} camera={camera} anchor={anchor} visible={visible} picked={picked} onPick={setPicked} onRotate={setCamera} zoom={zoom} />)}</div>

    <small>Saved frames only · no Python rerun or interpolation · fixed full-trajectory bounds and color scale · click to inspect; drag 3D panels to rotate. Matching explicit point IDs link panels, not array positions. Ellipse axes are supplied by the experiment. Anchor selection filters incident edges and highlights; supplied weights remain unchanged.</small>

  </section>;

}

function AnimationView({ data }: { data: NonNullable<ReturnType<typeof imageAnimation>> }) {

  const { ref, visible } = useVisible(), time = useTimeline(data.frames.length, data.initial, data.fps, visible);

  return <section className="aw-research-visual" ref={ref} aria-label={data.title}><header><strong>{data.title}</strong><button onClick={() => void ref.current?.requestFullscreen()}>Expand</button><button onClick={() => download(JSON.stringify(data), "animation.json")}>Save all frames</button></header><p>{data.description}</p><TimelineBar time={time} frames={data.frames} /><img src={`data:image/png;base64,${data.frames[time.index].png}`} alt={`${data.title}: ${data.frames[time.index].label}`} /><small>Precomputed PNG frames; playback never runs Python. Pauses offscreen and when the window is hidden.</small></section>;

}

function HtmlView({ data }: { data: HtmlVisual }) {

  const [open, setOpen] = useState(false), { ref, visible } = useVisible();

  const source = useMemo(() => isolatedVisualDocument(data.html), [data.html]);

  useEffect(() => { if (!visible) setOpen(false); }, [visible]);

  return <section className="aw-research-visual" ref={ref} aria-label={data.title}><header><strong>{data.title}</strong><button onClick={() => setOpen(!open)}>{open ? "Close interactive visual" : "Open interactive visual"}</button><button onClick={() => download(source, "research-visual.html", "text/html")}>Save HTML</button>{open && <button onClick={() => void ref.current?.requestFullscreen()}>Expand</button>}</header><p>{data.description}</p><small>Runs only when opened here. Isolated from Aw; external libraries, network requests and file access are blocked. Closes offscreen to stop background animation.</small>{open && <iframe title={data.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={source} style={{ height: data.height }} />}</section>;

}

export function ExperimentVisualView({ data }: { data?: Record<string, unknown> }) {

  const g = useMemo(() => geometryVisual(data?.[geometryMime]), [data]), a = useMemo(() => imageAnimation(data?.[animationMime]), [data]), h = useMemo(() => htmlVisual(data?.[htmlMime]), [data]), e = useMemo(() => explorerVisual(data?.[explorerMime]), [data]);

  return e ? <ExperimentExplorerView visual={e} /> : g ? <GeometryView visual={g} /> : a ? <AnimationView data={a} /> : h ? <HtmlView data={h} /> : null;

}

