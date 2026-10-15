import assert from "node:assert/strict";
import { test } from "node:test";
import { pdfFitScale, readingAnchorAdjustment, resizedPdfPosition, highlightActionsPosition, arrowBlockDirection, blockActionsBottom } from "../src/editorGeometry.ts";

test("arrow keys change hosts only at the corresponding text or visual-line edge",()=>{
  assert.equal(arrowBlockDirection("ArrowLeft",0,40,true,false),-1);
  assert.equal(arrowBlockDirection("ArrowRight",40,40,false,true),1);
  assert.equal(arrowBlockDirection("ArrowUp",8,40,true,false),-1);
  assert.equal(arrowBlockDirection("ArrowDown",32,40,false,true),1);
  assert.equal(arrowBlockDirection("ArrowRight",8,40,true,false),0);
  assert.equal(arrowBlockDirection("ArrowUp",8,40,false,false),0);
});

test("highlight tools sit below the cursor endpoint, not above it or below the whole block",()=>{
  assert.deepEqual(highlightActionsPosition({right:310,bottom:278},{left:56,right:660,top:80,bottom:720},180,28),{x:324,y:284});
});
test("highlight tools stay inside the source pane and away from its toolbar",()=>{
  const pane={left:56,right:660,top:80,bottom:720};
  assert.deepEqual(highlightActionsPosition({right:75,bottom:82},pane,180,28),{x:89,y:88});
  assert.deepEqual(highlightActionsPosition({right:900,bottom:900},pane,180,28),{x:472,y:684});
  assert.deepEqual(highlightActionsPosition({right:70,bottom:200},{left:56,right:160,top:80,bottom:720},220,28),{x:64,y:206});
  assert.deepEqual(highlightActionsPosition({right:310,bottom:680},pane,180,48),{x:324,y:664});
});
import { anchoredScrollTop, viewportParagraph } from "../src/sourceViewport.ts";
import { boundedPaneShare } from "../src/editorGeometry.ts";
import { sourceLineStarts, lineAtOffset } from "../src/sourceLines.ts";
import { readFile } from "node:fs/promises";

test("source navigation, full-document reel scrollbar and divider stay in the shared editor", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const manuscript = await readFile(new URL("../src/components/Manuscript.tsx", import.meta.url), "utf8");
  const raw = await readFile(new URL("../src/components/PlainSourceEditor.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(app, /effectivePreviewMode === "split" && <PaneDivider/);
  assert.match(app, /value=\{preambleEditing \? "file"/);
  assert.match(app, /if \(preambleEditing\) await savePaper\(\);/);
  assert.match(app, /!preambleEditing && blockWindow && <BlockWindowBar/);
  assert.match(app, /manuscriptReturnPositions.current.get\(`\$\{document.project.id\}:\$\{document.project.mainFile\}`\)/);
  assert.match(app, /viewportOffset: saved.viewportOffset/);
  assert.match(manuscript, /if \(position\) rememberViewport\(position\);[\s\S]*positionReader.current = undefined/);
  assert.match(app, /commandSaveQueue.current.catch\(\(\) => undefined\).then\(async \(\) =>/);
  assert.match(app, /before.project.id !== owner.project.id \|\| before.project.mainFile !== owner.project.mainFile/);
  assert.match(manuscript, /total=\{sourceWindow.available.length\}/);
  assert.match(manuscript, /data-sync-preview=\{paragraph.id\}/);
  assert.match(manuscript, /<SourceLineNumbers target=\{paragraphRef\}/);
  assert.match(raw, /<SourceLineNumbers target=\{input\}/);
  assert.match(css, /manuscript-scroll.block-reel \{ scrollbar-width: none/);
  assert.match(css, /var\(--source-share, 1fr\)/);
});

test("split divider keeps both panes usable and handles invalid widths", () => {
  assert.equal(boundedPaneShare(NaN), .5);
  assert.equal(boundedPaneShare(.5, 1200), .5);
  assert.ok(boundedPaneShare(0, 1000) >= .18);
  assert.ok(boundedPaneShare(1, 1000) <= .82);
  assert.equal(boundedPaneShare(0, 100), .4);
  assert.equal(boundedPaneShare(1, 100), .6);
});
test("source line numbers count literal newlines, not visual wraps", () => {
  const source = "\\section{A}\r\n" + "long-reference".repeat(30) + "\n\ntext";
  const starts = sourceLineStarts(source);
  assert.equal(starts.length, 4);
  assert.equal(lineAtOffset(starts, 0), 1);
  assert.equal(lineAtOffset(starts, source.indexOf("long")), 2);
  assert.equal(lineAtOffset(starts, source.indexOf("text")), 4);
  assert.equal(lineAtOffset(starts, source.length), 4);
  assert.deepEqual(sourceLineStarts(""), [0]);
});

test("PDF fit uses actual pane width and never forces a too-wide minimum canvas", () => {
  assert.equal(pdfFitScale(640, 612), 1);
  assert.ok(pdfFitScale(180, 612) < 0.35);
  assert.equal(pdfFitScale(3000, 612), 1.4);
  assert.equal(pdfFitScale(0, 0), 0.55);
});
test("PDF resizing preserves a natural page point with old and new viewport sizes", () => {
  assert.deepEqual(resizedPdfPosition({ top: 300, left: 100, width: 600, height: 500, scale: 1 }, 1.5, 900, 800), { top: 425, left: 150 });
  assert.deepEqual(resizedPdfPosition({ top: 0, left: 0, width: 300, height: 300, scale: 1 }, 0.5, 500, 500), { top: 0, left: 0 });
});
test("reading layout preserves a block's offset without changing source or progress", () => {
  assert.equal(readingAnchorAdjustment(-20, 80), 100);
  assert.equal(readingAnchorAdjustment(25, -10), -35);
  assert.equal(readingAnchorAdjustment(NaN, 10), 0);
});

test("passage tools use their own host coordinates at every editor zoom", () => {
  assert.equal(blockActionsBottom(480, 240, 600, 600), 240);
  assert.equal(blockActionsBottom(540, 240, 750, 600), 240);
  assert.equal(blockActionsBottom(360, 240, 300, 600), 240);
  assert.equal(blockActionsBottom(100, 240, 600, 600), 0);
  assert.equal(blockActionsBottom(NaN, 0, 600, 600), 0);
});

test("scope anchors prefer a visible caret, not an old offscreen editing location", () => {
  const boxes = [{ id: "old", top: -600, bottom: -200 }, { id: "first", top: -40, bottom: 100 }, { id: "reading", top: 160, bottom: 480 }, { id: "below", top: 620, bottom: 900 }];
  assert.equal(viewportParagraph(boxes, 600, "old"), "reading");
  assert.equal(viewportParagraph(boxes, 600, "first"), "first");
  assert.equal(viewportParagraph(boxes, 600), "reading");
  assert.equal(viewportParagraph([], 600), undefined);
  assert.equal(viewportParagraph([{ id: "long-proof", top: -400, bottom: 1600 }], 600), "long-proof");
});

test("scope restoration retains pixel offsets across removed headings and reel spacers", () => {
  // A target moved from y=240 to y=800 while its pane still starts at y=100.
  assert.equal(anchoredScrollTop(200, 800, 100, 140), 760);
  assert.equal(anchoredScrollTop(760, 240, 100, 140), 760);
  // Partly visible paragraphs and top-of-document clamping remain valid.
  assert.equal(anchoredScrollTop(500, 170, 100, -70), 640);
  assert.equal(anchoredScrollTop(0, 120, 100, 300), 0);
});
