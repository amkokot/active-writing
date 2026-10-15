import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { experimentHeatmap, heatmapFraction, heatmapMime, heatmapRange, heatmapSummary } from "../src/experimentHeatmap.ts";
import { experimentContext, newExperimentCell, newExperimentNotebook, validateExperimentNotebook } from "../src/experiments.ts";
import { experimentRuntime } from "./experiments.ts";
import { closePythonSessions, runInPythonSession } from "./pythonSessions.ts";
const fixture = () => ({ title: "Spectral contraction", xLabel: "alpha", yLabel: "mu", x: [0.5, 1, 2.2], y: [0.05, 1], values: [[0.975, 0.95, 1.2], [0.5, 0, 1.2]] });

test("sample grids reject ambiguous axes, invalid shapes/scales and excessive display cost", () => {
  const grid = fixture(); assert.equal(experimentHeatmap(grid), grid);
  const bad = (edit: (g: any) => void) => { const g = structuredClone(grid); edit(g); assert.equal(experimentHeatmap(g), undefined); };
  bad(g => g.x = []); bad(g => g.x[1] = g.x[0]); bad(g => g.x[1] = Infinity); bad(g => g.y[0] = true);
  bad(g => g.values[0] = null); bad(g => g.values[0].push(1)); bad(g => g.values.pop()); bad(g => g.values[0][0] = NaN);
  bad(g => g.colorScale = "power"); bad(g => g.colorScale = "log"); bad(g => g.xLabel = "x".repeat(101));
  bad(g => g.x = Array.from({ length: 61 }, (_, i) => i));
  const maximum = { ...grid, x: Array.from({ length: 60 }, (_, i) => i), y: Array.from({ length: 60 }, (_, i) => i), values: Array.from({ length: 60 }, () => Array(60).fill(1)) };
  assert.ok(experimentHeatmap(maximum)); assert.deepEqual(heatmapRange(maximum).low, [0, 0]);
});

test("exact grid values, extrema and compact evidence preserve controls without data mutation", () => {
  const grid = fixture(), before = JSON.stringify(grid), range = heatmapRange(grid);
  assert.deepEqual(range, { min: 0, max: 1.2, low: [1, 1], high: [2, 0] });
  assert.match(heatmapSummary(grid), /maximum 1.2 at alpha=2.2, mu=0.05/);
  const nb = newExperimentNotebook(), cell = newExperimentCell("code"); cell.outputs = [{ output_type: "display_data", data: { [heatmapMime]: grid, "text/plain": "Just a title" } }]; nb.cells = [cell];
  validateExperimentNotebook(nb); assert.match(experimentContext(nb, "owner"), /Maximum|maximum 1.2/);
  assert.equal(JSON.stringify(grid), before);
});

test("heatmap colors remain finite for extreme linear, logarithmic and constant data", () => {
  assert.equal(heatmapFraction(0, -1e308, 1e308), 0.5);
  assert.equal(heatmapFraction(-1e308, -1e308, 1e308), 0);
  assert.equal(heatmapFraction(1e308, -1e308, 1e308), 1);
  assert.equal(heatmapFraction(1, 1, 1), 0.5);
  assert.equal(heatmapFraction(10, 1, 100, "log"), 0.5);
  assert.ok(Number.isFinite(heatmapFraction(1e308, 1e308, 1.0000000000000002e308, "log")));
});

test("Python heatmaps retain all numeric samples and text fallback; invalid values fail visibly", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const cwd = await mkdtemp(path.resolve(".paperfocus/trials/grid-check-")), runtime = await experimentRuntime();
  try {
    const result = await runInPythonSession("grid-check", runtime.executable, cwd, "x=[0.5,1.0,2.2]; y=[0.05,1.0]\nvalues=[[max(abs(1-a*m),abs(1-a)) for a in x] for m in y]\ndisplay_heatmap('Contraction',x,y,values,x_label='alpha',y_label='mu')", "grid", "grid-run", () => {});
    assert.equal(result.error, null);
    const grid = experimentHeatmap(result.outputs[0].data![heatmapMime]); assert.ok(grid);
    assert.equal(grid.values[1][1], 0); assert.ok(grid.values[0][2] > 1);
    assert.match(String(result.outputs[0].data!["text/plain"]), /mu=1.0: \[0.5, 0.0, 1.2000000000000002\]/);
    const bad = await runInPythonSession("grid-check", runtime.executable, cwd, "display_heatmap('Bad',x,y,values,color_scale='log')", "bad", "bad-run", () => {});
    assert.match(bad.error!, /log color requires positive/);
  } finally { closePythonSessions(); }
});

test("grid UI exposes exact sample selection and no execution hooks", async () => {
  const view = await readFile("src/components/ExperimentHeatmapView.tsx", "utf8");
  assert.match(view, /onKeyDown=\{move\}/); assert.match(view, /Select exact sample/); assert.match(view, /no interpolation or rerun/);
  assert.doesNotMatch(view, /fetch\(|runExperiment|dangerouslySetInnerHTML/);
});
