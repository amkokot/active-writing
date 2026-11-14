import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { geometryMime, animationMime, htmlMime, geometryVisual, imageAnimation, htmlVisual, isolatedVisualDocument, visualSummary } from "../src/experimentVisual.ts";
import { newExperimentNotebook, newExperimentCell, validateExperimentNotebook, experimentContext } from "../src/experiments.ts";
import { savedOutputLabel, featuredOutputIndex } from "../src/experimentActions.ts";
import { researchCommand } from "../scripts/awResearch.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { experimentRuntime, runExperimentOffline, readExperiments, writeExperiments } from "./experiments.ts";
import { closePythonSessions, runInPythonSession } from "./pythonSessions.ts";
import { registerProject } from "./projects.ts";
import { explorerMime, explorerVisual, columnDomain, histogram, selectRectangle, explorerCsv, explorerSubset } from "../src/experimentExplorer.ts";
import type { ExplorerVisual } from "../src/experimentExplorer.ts";
import { linkedGeometryPoint } from "../src/experimentVisual.ts";
import { experimentPlot, plotCoordinates } from "../src/experiments.ts";
import { plotWindow } from "../src/plotInspection.ts";
import { experimentSweep, sweepDomain } from "../src/experimentSweep.ts";
import { visualRecipes } from "../src/visualRecipes.ts";
import { nativeVisualExport } from "./visualExport.ts";
import { importVisualFile } from "../scripts/awVisualImport.ts";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const explorerFixture = (): ExplorerVisual => ({ version: 1, title: "Trial trade-offs", description: "Saved measurements", ids: ["a", "b", "c", "d"], columns: [
  { key: "cost", label: "Time (s)", values: [1, 2, 10, null] }, { key: "error", label: "Error", values: [4, 3, 0, -1] },
  { key: "group", label: "Method", values: ["A", "B", "A", "=unsafe()"] },
], x: "cost", y: "error", color: "group", dimensions: ["cost", "error"] });
const fixture = () => ({ version: 1, title: "Pooling", description: "Actual weights", fps: 4, initial: 0, panels: [{ title: "Observed", points: [[0, 0], [1, 1]], values: [0, 1], anchors: [0] }], frames: [{ label: "Initial", panels: [{}] }, { label: "Pooled", panels: [{ weights: [1, .4], edges: [[0, 1, .5]], ellipses: [{ center: [0, 0], axes: [[1, 0], [0, .1]] }] }] }] });
test("geometry validates dimensions, shapes, indices, finite values and bounded cost", () => {
  const g = fixture(); assert.equal(geometryVisual(g), g);
  const bad = (fn: (x: any) => void) => { const x = structuredClone(g); fn(x); assert.equal(geometryVisual(x), undefined); };
  bad(x => x.panels[0].points[0] = [0]); bad(x => x.panels[0].points[1] = [1, 1, 1]); bad(x => x.panels[0].points[0][0] = Infinity);
  bad(x => x.frames[1].panels[0].weights = [-1, 2]); bad(x => x.frames[1].panels[0].values = [1]); bad(x => x.panels[0].anchors = [2]);
  bad(x => x.frames[1].panels[0].edges = [[0, 3]]); bad(x => x.frames[1].panels[0].ellipses[0].axes = [[1, 0]]); bad(x => x.frames[1].panels = []);
  bad(x => x.fps = 100); bad(x => x.initial = 2); bad(x => x.frames = Array(121).fill(x.frames[0])); bad(x => x.colorRange = [2, 1]);
  assert.equal(geometryVisual(null), undefined); assert.equal(geometryVisual({}), undefined);
});
test("new displays preserve exact evidence, receive useful labels, and reject malformed recognized MIME", () => {
  const g = fixture(), nb = newExperimentNotebook(), cell = newExperimentCell("code"); nb.cells = [cell];
  cell.outputs = [{ output_type: "stream", text: "log" }, { output_type: "display_data", data: { [geometryMime]: g } }];
  const original = JSON.stringify(g); validateExperimentNotebook(nb);
  assert.equal(featuredOutputIndex(cell), 1); assert.match(savedOutputLabel(cell.outputs[1], 1), /Pooling/);
  assert.match(experimentContext(nb, "owner"), /2 frames/); assert.match(visualSummary(cell.outputs[1].data)!, /2D/);
  assert.equal(JSON.stringify(g), original);
  cell.outputs[1].data![geometryMime] = { ...g, initial: -1 }; assert.throws(() => validateExperimentNotebook(nb), /geometry/);
  cell.outputs[1].data = { [htmlMime]: { version: 1, title: "Demo", description: "", html: "<b>Hi</b>", height: 700 } }; validateExperimentNotebook(nb);
  cell.outputs[1].data![htmlMime] = { html: "bad" }; assert.throws(() => validateExperimentNotebook(nb), /HTML/);
  assert.equal(imageAnimation({}), undefined); assert.equal(htmlVisual({}), undefined);
});
test("HTML uses a fixed double sandbox envelope, no parent bridge and no network resource allowance", async () => {
  const html = isolatedVisualDocument('</script><script>parent.stolen=true</script>');
  assert.match(html, /connect-src 'none'/); assert.match(html, /frame-src about:/); assert.match(html, /setAttribute\('sandbox','allow-scripts'\)/);
  assert.doesNotMatch(html, /allow-same-origin|https:|http:|<script>parent/);
  assert.match(html, /\\u003c\/script>/);
  const view = await readFile("src/components/ExperimentVisualView.tsx", "utf8");
  assert.match(view, /sandbox="allow-scripts"/); assert.match(view, /open && <iframe/); assert.match(view, /IntersectionObserver/);
  assert.doesNotMatch(view, /dangerouslySetInnerHTML|fetch\(|runExperiment|postMessage/);
});
test("Python helpers work in shared runs and round-trip guarded saved output without packages", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/visual-check-"));
  await mkdir(path.join(workspace, "paper")); await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\\begin{document}Visual fixture.\\end{document}");
  const runtime = await experimentRuntime();
  try {
    const result = await runInPythonSession("visual-check", runtime.executable, workspace, `display_geometry('Pooling',[{'title':'Observed','points':[(0,0),(1,1)],'anchors':[0]}],[{'label':'Start','panels':[{}]},{'label':'Pool','panels':[{'weights':[1,.4]}]}])\ndisplay_html('<button onclick="this.textContent=42">Click</button>',title='Controls')\nimport base64\npng=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDosAAAAASUVORK5CYII=')\ndisplay_animation([png,png],title='Frames',labels=['a','b'])`, "visual", "visual-run", () => {});
    assert.equal(result.error, null); assert.ok(geometryVisual(result.outputs[0].data![geometryMime])); assert.ok(htmlVisual(result.outputs[1].data![htmlMime])); assert.ok(imageAnimation(result.outputs[2].data![animationMime]));
    const project = await registerProject(workspace, "paper"), nb = newExperimentNotebook(), cell = newExperimentCell("code"); cell.outputs = result.outputs; nb.cells = [cell];
    const saved = await writeExperiments(workspace, project.id, "visual-check", "", nb), reread = await readExperiments(workspace, project.id, "visual-check");
    assert.equal(reread.revision, saved.revision); assert.deepEqual(reread.notebook.cells[0].outputs, result.outputs);
    const invalid = await runInPythonSession("visual-check", runtime.executable, workspace, "display_geometry('Bad',[{'title':'Bad','points':[[0,0]],'weights':[-1]}])", "bad", "visual-bad", () => {});
    assert.match(invalid.error!, /weights/);
  } finally { closePythonSessions(); }
});

test("offline fresh visuals preserve Unicode and guarded attachment never reruns or replaces evidence", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/visual-offline-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "active-writing" }));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\\begin{document}Visual.\\end{document}");
  const project = await registerProject(workspace, "paper"), nb = newExperimentNotebook(), cell = newExperimentCell("code");
  cell.id = "unicode"; cell.source = "display_geometry('Σ · S¹', [{'title':'σ²', 'points':[[0,0],[1,1]]}])"; nb.cells = [cell];
  let store = await writeExperiments(workspace, project.id, "visual", "", nb);
  const run = await runExperimentOffline(workspace, project.id, "visual", cell.id, store.revision, true);
  assert.equal(run.status, "ready"); store = await readExperiments(workspace, project.id, "visual");
  assert.equal(geometryVisual(store.notebook.cells[0].outputs![0].data![geometryMime])!.title, "Σ · S¹");
  const before = structuredClone(store.notebook.cells[0]), catalogue = await readNotebook(workspace, project.id), now = new Date().toISOString();
  await writeNotebook(workspace, project.id, catalogue.revision, [{ id: "visual", title: "Visuals", question: "", notes: "", reply: "", proposal: "", status: "open", route: "local", effort: 1, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now }]);
  const artifact = path.join(workspace, "saved.html"); await writeFile(artifact, "<b>Saved artifact</b><script>throw new Error('must not execute on import')</script>");
  const args = ["visual", "--offline", "--workspace", workspace, "--project", project.id, "--entry", "visual", "--cell", "unicode", "--revision", store.revision, "--file", artifact];
  const result = await researchCommand(args); assert.equal((result as any).executed, false);
  const saved = (await readExperiments(workspace, project.id, "visual")).notebook.cells[0];
  assert.equal(saved.execution_count, before.execution_count); assert.equal(saved.source, before.source); assert.deepEqual(saved.metadata, before.metadata);
  assert.deepEqual(saved.outputs![0], before.outputs![0]); assert.equal(saved.outputs!.length, 2);
  assert.match((saved.outputs![1].metadata!.aw_visual_import as any).sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(researchCommand(args), /changed/);
});

test("explorer validates exact finite heterogeneous columns, identity, dimensions and bounded cost", () => {
  const value = explorerFixture(); assert.equal(explorerVisual(value), value);
  const bad = (change: (x: any) => void) => { const x = structuredClone(value); change(x); assert.equal(explorerVisual(x), undefined); };
  for (const v of [null, {}, [], "data"]) assert.equal(explorerVisual(v), undefined);
  bad(x => x.columns[0].values[0] = Infinity); bad(x => x.columns[0].values[0] = true); bad(x => x.columns[0].values[0] = "1");
  bad(x => x.columns[0].values.pop()); bad(x => x.columns[0].values = [null, null, null, null]);
  bad(x => x.columns[0].key = "error"); bad(x => x.ids[0] = "b"); bad(x => x.ids[0] = "");
  bad(x => x.ids.pop()); bad(x => x.x = "group"); bad(x => x.y = "cost"); bad(x => x.color = "missing");
  bad(x => x.dimensions = ["cost", "cost"]); bad(x => x.dimensions = ["cost", "group"]); bad(x => x.dimensions = []);
  bad(x => x.columns = Array(33).fill(x.columns[0])); bad(x => x.ids = Array(10001).fill("a")); bad(x => x.description = "x".repeat(2001));
  const nb = newExperimentNotebook(), cell = newExperimentCell("code"); nb.cells = [cell];
  cell.outputs = [{ output_type: "stream", text: "log" }, { output_type: "display_data", data: { [explorerMime]: value } }];
  validateExperimentNotebook(nb); assert.equal(featuredOutputIndex(cell), 1); assert.match(savedOutputLabel(cell.outputs[1], 1), /Trial trade-offs/);
  assert.match(experimentContext(nb, "e"), /4 saved rows.*Time \(s\)/); assert.match(visualSummary(cell.outputs[1].data)!, /not new experiments/);
  cell.outputs[1].data![explorerMime] = {}; assert.throws(() => validateExperimentNotebook(nb), /explorer/);
});

test("linked selection, fixed histograms, null/log handling and exact safe exports do not mutate evidence", () => {
  const visual = explorerFixture(), before = JSON.stringify(visual), [x, y] = visual.columns;
  assert.deepEqual(selectRectangle(x, y, [0, 2, 3, 5]), [0, 1]);
  assert.deepEqual(selectRectangle(x, y, [3, 5, 0, 2]), [0, 1]);
  assert.deepEqual(selectRectangle(x, y, [-1, -1, 2, 2], "log", "log"), [0, 1]); // zero, negative and missing omitted, not rewritten
  assert.deepEqual(columnDomain(x), [1, 10]);
  const a = histogram(x, null, 3), b = histogram(x, new Set([1, 2]), 3);
  assert.equal(a.reduce((n, bin) => n + bin.total, 0), 3); assert.equal(b.reduce((n, bin) => n + bin.selected, 0), 2);
  assert.deepEqual(a.map(bin => [bin.lo, bin.hi, bin.total]), b.map(bin => [bin.lo, bin.hi, bin.total]));
  assert.ok(a.at(-1)!.rows.includes(2), "full-domain maximum included in last bin");
  assert.equal(histogram(y, null, 5, "log").reduce((n, bin) => n + bin.total, 0), 2);
  assert.deepEqual(explorerSubset(visual, [3, 1]).columns[0].values, [null, 2]);
  assert.deepEqual(explorerSubset(visual, []).ids, []);
  const csv = explorerCsv(visual, [2, 3]); assert.match(csv, /"0"/); assert.match(csv, /"'=unsafe\(\)"/); assert.match(csv, /"-1"/);
  assert.equal(JSON.stringify(visual), before);
});

test("geometry stable IDs link differing point orders, and saved motion preserves cardinality", () => {
  const g: any = fixture(); g.panels[0].pointIds = ["a", "b"]; g.panels[0].pointLabels = ["Trial A", "Trial B"]; g.panels[0].axisLabels = ["x", "y"];
  g.panels.push({ title: "Reordered", points: [[1, 1], [0, 0]], pointIds: ["b", "a"] });
  g.frames.forEach((f: any) => f.panels.push({})); g.frames[1].panels[0].points = [[100, 200], [1, 1]];
  assert.ok(geometryVisual(g)); assert.equal(linkedGeometryPoint(g, { panel: 0, row: 0 }, 1), 1);
  assert.equal(linkedGeometryPoint(g, { panel: 1, row: 0 }, 0), 1); delete g.panels[1].pointIds;
  assert.equal(linkedGeometryPoint(g, { panel: 0, row: 0 }, 1), -1); assert.equal(linkedGeometryPoint(g, { panel: 0, row: 0 }, 0), 0);
  assert.equal(linkedGeometryPoint(g, null, 1), -1);
  const bad = (change: (x: any) => void) => { const x = structuredClone(g); change(x); assert.equal(geometryVisual(x), undefined); };
  bad(x => x.panels[0].pointIds = ["a", "a"]); bad(x => x.panels[0].axisLabels = ["x"]); bad(x => x.panels[0].pointLabels.pop());
  bad(x => x.frames[1].panels[0].points.pop()); bad(x => x.frames[1].panels[0].points[0] = [1, 2, 3]);
});

test("uncertainty bands fit domains, follow zoom and series selection, and retain exact meaning", () => {
  const p = { title: "Error", xLabel: "n", yLabel: "risk", series: [{ name: "A", points: [[1, 2], [2, 3], [3, 4]], band: { label: "10–90% trial quantiles", lower: [0, 1, 2], upper: [4, 6, 10] } }] };
  assert.ok(experimentPlot(p)); const coords = plotCoordinates(p)!; assert.equal(coords.ymin, 0); assert.equal(coords.ymax, 10);
  const zoomed = plotWindow(p, [], [2, 3]); assert.deepEqual(zoomed.series[0].band!.lower, [1, 2]); assert.deepEqual(zoomed.series[0].band!.upper, [6, 10]);
  const hidden = plotWindow(p, [0]); assert.deepEqual(hidden.series[0].points, []); assert.deepEqual(hidden.series[0].band!.lower, []);
  const bad = (change: (x: any) => void) => { const x = structuredClone(p); change(x); assert.equal(experimentPlot(x), undefined); };
  bad(x => x.series[0].band.label = ""); bad(x => x.series[0].band.lower.pop()); bad(x => x.series[0].band.lower[0] = 6);
  bad(x => x.series[0].band.upper[0] = NaN); bad(x => x.series[0].points[1][0] = 1); bad(x => x.yScale = "log");
  const sweep = { title: "Bounds", parameter: "alpha", frames: [{ value: 0, plot: p }, { value: 1, plot: { ...p, series: [{ ...p.series[0], band: { ...p.series[0].band, upper: [10, 20, 30] } }] } }] };
  assert.ok(experimentSweep(sweep)); assert.equal(plotCoordinates(sweepDomain(sweep))!.ymax, 30);
  assert.deepEqual(p.series[0].band.lower, [0, 1, 2]);
});

test("visual recipes are discoverable without a workspace/service, and all examples execute in fresh Python", async () => {
  const catalogue: any = await researchCommand(["visuals", "--offline"]);
  assert.equal(catalogue.executed, false); assert.equal(catalogue.recipes.length, 5); assert.equal(catalogue.recipes[0].source, undefined);
  const recipe: any = await researchCommand(["visuals", "--recipe", "explorer"]); assert.match(recipe.recipes[0].source, /display_explorer/);
  await assert.rejects(researchCommand(["visuals", "--allow-python"]), /no project, execution/); await assert.rejects(researchCommand(["visuals", "--recipe", "unknown"]));
  await mkdir(".paperfocus/trials", { recursive: true }); const workspace = await mkdtemp(path.resolve(".paperfocus/trials/visual-suite-"));
  await mkdir(path.join(workspace, "paper")); await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\\begin{document}Visual suite.\\end{document}");
  const project = await registerProject(workspace, "paper"), nb = newExperimentNotebook(), cell = newExperimentCell("code");
  cell.id = "gallery"; cell.source = visualRecipes.map(r => r.source).join("\n\n"); nb.cells = [cell];
  let store = await writeExperiments(workspace, project.id, "visual-suite", "", nb);
  const job = await runExperimentOffline(workspace, project.id, "visual-suite", cell.id, store.revision, true);
  assert.equal(job.status, "ready"); store = await readExperiments(workspace, project.id, "visual-suite");
  const outputs = store.notebook.cells[0].outputs!; assert.equal(outputs.length, 5);
  assert.ok(explorerVisual(outputs[0].data![explorerMime])); assert.ok(experimentPlot(outputs[1].data!["application/vnd.paperfocus.plot+json"]));
  assert.ok(geometryVisual(outputs[2].data![geometryMime])); assert.ok(geometryVisual(outputs[4].data![geometryMime]));
  const file = path.join(workspace, "explorer.json"); await writeFile(file, JSON.stringify(outputs[0].data![explorerMime]));
  const imported = await importVisualFile(file); assert.deepEqual(imported.data![explorerMime], outputs[0].data![explorerMime]);
  validateExperimentNotebook(store.notebook);
});

test("Python explorer accepts records, rejects silent missing-data coercion, and validates band/identity errors", async () => {
  const runtime = await experimentRuntime(), workspace = await mkdtemp(path.resolve(".paperfocus/trials/visual-validate-"));
  try {
    const result = await runInPythonSession("visual-validate", runtime.executable, workspace, `display_explorer('Records',[{'x':1,'y':2,'group':'a'},{'x':2,'y':3}],ids=['a','b'])`, "v", "v0", () => {});
    assert.equal(result.error, null); const e = explorerVisual(result.outputs[0].data![explorerMime])!; assert.deepEqual(e.columns[2].values, ["a", null]);
    const invalid = [
      ["display_explorer('NaN',{'x':[float('nan')],'y':[1]})", /NaN/],
      ["display_explorer('Mixed',{'x':[1,'a'],'y':[1,2]})", /numbers OR strings/],
      ["display_explorer('Lengths',{'x':[1,2],'y':[1]})", /same row count/],
      ["display_explorer('IDs',{'x':[1,2],'y':[1,2]},ids=['a','a'])", /unique/],
      ["display_explorer('Bool',{'x':[True],'y':[1]})", /finite numbers/],
      ["display_geometry('IDs',[{'title':'bad','points':[[0,0],[1,1]],'pointIds':['a','a']}])", /unique/],
      ["display_plot('Band',[{'name':'a','points':[[1,2]],'band':{'lower':[0],'upper':[3],'label':''}}])", /label/],
    ] as const;
    for (const [source, match] of invalid) { const bad = await runInPythonSession("visual-validate", runtime.executable, workspace, source, "bad", "bad", () => {}); assert.match(bad.error!, match); }
  } finally { closePythonSessions(); }
});

test("portable native visual previews are static, escaped and retain complete downloadable values", () => {
  const e = explorerFixture(); e.title = '<script>alert(1)</script>'; const out = nativeVisualExport({ [explorerMime]: e }, "cell-1")!;
  assert.match(out.html, /&lt;script&gt;/); assert.doesNotMatch(out.html, /<script|iframe|onclick=/); assert.match(out.html, /Static initial-axis preview: 3/);
  assert.deepEqual(JSON.parse(out.files[0].data.toString()), e);
  const g = fixture(); const geom = nativeVisualExport({ [geometryMime]: g }, "cell-2")!;
  assert.match(geom.html, /Saved initial frame/); assert.deepEqual(JSON.parse(geom.files[0].data.toString()), g);
  assert.equal(nativeVisualExport({ "text/html": "<script>evil()</script>" }, "cell"), undefined);
});

test("native React displays expose compact, keyboard-accessible inspection without a browser or kernel", async ctx => {
  const cache = await mkdtemp(path.resolve(".paperfocus/trials/visual-ssr-"));
  const errors: unknown[][] = []; ctx.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
  const server = await createServer({ configFile: false, root: process.cwd(), cacheDir: cache, plugins: [react()], optimizeDeps: { noDiscovery: true, entries: [] }, server: { middlewareMode: true, watch: null }, logLevel: "error" });
  try {
    const { ExperimentExplorerView } = await server.ssrLoadModule("/src/components/ExperimentExplorerView.tsx");
    const html = renderToStaticMarkup(createElement(ExperimentExplorerView, { visual: explorerFixture() }));
    assert.match(html, /Scatter X/); assert.match(html, /Distribution column/); assert.match(html, /Compare dimensions/); assert.match(html, /Select row a/);
    assert.match(html, /aria-label="Bin .*rows, 0 selected"/); assert.match(html, /no selection/); assert.match(html, /Clear selection/);
    assert.doesNotMatch(html, /<script|<iframe|<details open/);
    const large = explorerFixture(); large.ids = Array.from({ length: 10000 }, (_, i) => `trial-${i}`); large.columns = large.columns.map(c => ({ ...c, values: Array.from({ length: 10000 }, (_, i) => c.values[i % 4]) }));
    assert.ok(explorerVisual(large)); const largeHtml = renderToStaticMarkup(createElement(ExperimentExplorerView, { visual: large }));
    assert.equal((largeHtml.match(/<tr>/g) ?? []).length, 26, "exact table renders only one page of 25 rows");
    assert.match(largeHtml, /10000 saved rows/);
    const { ExperimentVisualView } = await server.ssrLoadModule("/src/components/ExperimentVisualView.tsx");
    assert.match(renderToStaticMarkup(createElement(ExperimentVisualView, { data: { [geometryMime]: fixture() } })), /Inspect geometry point/);
    const { ExperimentPlotView } = await server.ssrLoadModule("/src/components/ExperimentPlotView.tsx");
    const plot = { title: "Spread", xLabel: "x", yLabel: "y", series: [{ name: "Trial", points: [[1, 2], [2, 1]], band: { lower: [1, 0], upper: [3, 2], label: "Trial range" } }] };
    const bandHtml = renderToStaticMarkup(createElement(ExperimentPlotView, { plot })); assert.match(bandHtml, /<polygon/); assert.match(bandHtml, /Trial range/);
    assert.deepEqual(errors, [], "React renders without warnings");
  } finally { await server.close(); }
});
