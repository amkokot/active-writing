import assert from "node:assert/strict";
import { focusedJobName } from "./buildCache.ts";

test("deep Windows focus builds reserve room for the temporary SyncTeX filename", () => {
  assert.equal(focusedJobName("C:/Aw/build/focus/example", "win32"), "paperfocus-focus");
  assert.equal(focusedJobName("C:/" + "x".repeat(235), "win32"), "aw");
  assert.equal(focusedJobName("/" + "x".repeat(235), "linux"), "paperfocus-focus");
});
import { test } from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { sourceLine, sourcePath, syncPageIndex, syncRecords, compiledSourceRanges } from "./sourceSync.ts";
import type { ParsedProject } from "./projects.ts";
import { buildDependencies, dependenciesUnchanged } from "./buildCache.ts";

test("SyncTeX page indexing retains all pages and excludes foreign inputs", () => {
  const root = path.resolve("paper");
  const text = `Input:1:${path.join(root, "main.tex")}\nInput:2:${path.join(root, "section.tex")}\nInput:3:${path.resolve("outside.sty")}\nContent:\n{1\n[1,12:0,0:0,0,0\nh1,12:0,0:0,0,0\nx2,4:0,0\n}\n{2\nh2,4:0,0:0,0,0\n$2,5:0,0\nh3,1:0,0:0,0,0\n}\nPostamble:`;
  const result = syncPageIndex(text, root);
  assert.deepEqual([...result.get(sourcePath(path.join(root, "main.tex")))!.get(12)!], [1]);
  assert.deepEqual([...result.get(sourcePath(path.join(root, "section.tex")))!.get(4)!], [1, 2]);
  assert.equal(result.has(sourcePath("outside.sty")), false);
  assert.equal(sourceLine("a\r\nb\nc", 3), 2);
});

test("source identity tolerates SyncTeX drive-letter casing on Windows", () => {
  if (process.platform === "win32") assert.equal(sourcePath("C:/paper/main.tex"), sourcePath("c:/PAPER/main.tex"));
  else assert.notEqual(sourcePath("/paper/main.tex"), sourcePath("/PAPER/main.tex"));
});

test("SyncTeX records preserve Windows paths and multiple candidate positions", () => {
  const records = syncRecords("SyncTeX result begin\nOutput:C:/papers/a.pdf\nPage:2\nx:120\ny:200\nOutput:C:/papers/a.pdf\nPage:3\nx:140\ny:400\nSyncTeX result end");
  assert.equal(records.length, 2); assert.equal(records[0].Page, "2"); assert.equal(records[1].Page, "3");
  const inverse = syncRecords("Output:C:/papers/a.pdf\nInput:C:/papers/section.tex\nLine:42\nColumn:-1\nOffset:0\n");
  assert.equal(inverse.length, 1, "ignore inverse Output header without a page");
  assert.equal(inverse[0].Input, "C:/papers/section.tex"); assert.equal(inverse[0].Line, "42");
});

test("focused shadows map paragraph markers without including later commands", () => {
  const parsed = { paragraphs: [{ id: "p1", text: "First\ncontinued" }, { id: "p2", text: "Second" }] } as ParsedProject;
  const ranges = compiledSourceRanges(parsed, "Preamble\n% aw-sync:p1\nFirst\ncontinued\n\n% aw-sync:p2\nSecond\n\\end{document}\n");
  assert.deepEqual(ranges, [
    { paragraphId: "p1", file: ".paperfocus-focus", startLine: 3, endLine: 4 },
    { paragraphId: "p2", file: ".paperfocus-focus", startLine: 7, endLine: 7 },
  ]);
});

test("build reuse validates actual dependencies, PDF and map, not only the root source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-build-cache-")); const output = path.join(root, "build"); await mkdir(output);
  const main = path.join(root, "main.tex"), include = path.join(root, "part.tex"), aux = path.join(output, "main.aux");
  await Promise.all([[main, "Main"], [include, "Part"], [aux, "Generated"], [path.join(output, "main.pdf"), "PDF"], [path.join(output, "main.synctex.gz"), "Map"]].map(([file, text]) => writeFile(file, text)));
  await writeFile(path.join(output, "main.fls"), `INPUT ${main}\nINPUT ${include}\nINPUT ${aux}\nINPUT ${main}\n`);
  const dependencies = await buildDependencies(root, output, "main");
  assert.equal(dependencies.length, 4); assert.equal(dependencies.some(item => item.file === aux), false);
  assert.equal(await dependenciesUnchanged(dependencies), true);
  await writeFile(include, "Changed included source"); assert.equal(await dependenciesUnchanged(dependencies), false);
  assert.equal(await dependenciesUnchanged(undefined), false);
  assert.equal(await dependenciesUnchanged([]), false);
  const bib = path.join(root, "references.bib"); await writeFile(bib, "Bibliography");
  const withBib = await buildDependencies(root, output, "main", ["references.bib"]);
  assert.equal(await dependenciesUnchanged(withBib), true);
  await writeFile(bib, "Changed bibliography"); assert.equal(await dependenciesUnchanged(withBib), false, "BibTeX inputs need validation even when absent from TeX's recorder");
});
