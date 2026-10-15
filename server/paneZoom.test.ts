import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { clampPaneZoom, loadPaneZoom, paneZoomKey, savePaneZoom, wheelPaneZoom } from "../src/paneZoom.ts";

test("pane zoom stays bounded and normalizes mouse and trackpad wheel units", () => {
  assert.equal(clampPaneZoom(NaN), 1);
  assert.equal(clampPaneZoom(-10), 0.5);
  assert.equal(clampPaneZoom(100), 2.5);
  assert.ok(wheelPaneZoom(1, -100) > 1);
  assert.ok(wheelPaneZoom(1, 100) < 1);
  assert.equal(wheelPaneZoom(1, -16), wheelPaneZoom(1, -1, 1));
  assert.equal(wheelPaneZoom(1, -160), wheelPaneZoom(1, -1, 2));
  assert.equal(wheelPaneZoom(1, 0), 1);
  assert.equal(wheelPaneZoom(2.5, -1000), 2.5);
  assert.equal(wheelPaneZoom(0.5, 1000), 0.5);
  assert.ok(Math.abs(wheelPaneZoom(wheelPaneZoom(1, -20), 20) - 1) < 1e-10);
});

test("each pane retains its own zoom without writing manuscript state", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  savePaneZoom("editor", 1.5, storage); savePaneZoom("preview", 0.8, storage);
  assert.equal(loadPaneZoom("editor", storage), 1.5);
  assert.equal(loadPaneZoom("preview", storage), 0.8);
  assert.equal(loadPaneZoom("pdf-reader", storage), 1);
  assert.ok([...values.keys()].every(key => key.startsWith("active-writing.zoom.")));
  assert.equal(loadPaneZoom("editor", { getItem() { throw new Error("unavailable"); } }), 1);
  assert.doesNotThrow(() => savePaneZoom("editor", 1.2, { setItem() { throw new Error("full"); } }));
  assert.equal(loadPaneZoom("editor", { getItem: () => "bad" }), 1);
});

test("standard pane keyboard shortcuts do not claim ordinary editing keys", () => {
  assert.equal(paneZoomKey("+"), "in"); assert.equal(paneZoomKey("="), "in");
  assert.equal(paneZoomKey("-"), "out"); assert.equal(paneZoomKey("0"), "reset");
  for (const key of ["Enter", "Backspace", "z", "a", "1"]) assert.equal(paneZoomKey(key), undefined);
});

test("pane gestures cancel browser zoom without advancing wording checks and PDF zoom never recompiles", async () => {
  const [hook, manuscript, preview, pdf] = await Promise.all(["src/usePaneZoom.ts", "src/components/Manuscript.tsx", "src/components/Preview.tsx", "src/components/PdfViewer.tsx"].map(file => readFile(file, "utf8")));
  assert.match(hook, /addEventListener\("wheel", wheel, \{ passive: false \}\)/);
  assert.match(hook, /event.preventDefault\(\); event.stopPropagation\(\)/);
  assert.match(hook, /!event.ctrlKey && !event.metaKey/);
  assert.match(hook, /cancelAnimationFrame\(frame\)/);
  assert.match(manuscript, /event.ctrlKey \|\| event.metaKey/);
  assert.match(preview, /zoomFactor=\{zoom\} onZoomFactorChange=\{setZoom\}/);
  assert.match(pdf, /const scale = fitScale \* zoom/);
  assert.match(pdf, /positionedPage.current = \{ document, page: pageNumber, scale, zoom, width:/);
  assert.match(pdf, /resizedPdfPosition\(scrollPosition, scale, scroll.clientWidth, scroll.clientHeight\)/);
  assert.equal(pdf.includes("setManualScale"), false);
  assert.equal(hook.includes("compile"), false);
});
