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
import { mkdtemp, writeFile, mkdir, readFile, readdir, stat, utimes } from "node:fs/promises";
import { sourceLine, sourcePath, syncPageIndex, syncRecords, compiledSourceRanges, correspondingRange, correspondingOffset } from "./sourceSync.ts";
import type { ParsedProject } from "./projects.ts";
import { buildDependencies, dependenciesUnchanged, seedFocusedBuild, compilationCommand } from "./buildCache.ts";

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
    { paragraphId: "p1", file: ".paperfocus-focus", startLine: 3, endLine: 4, text: "First\ncontinued" },
    { paragraphId: "p2", file: ".paperfocus-focus", startLine: 7, endLine: 7, text: "Second" },
  ]);
});

test("paragraph links survive edits and shifted ordinal IDs in both directions", () => {
  const range = (id: string, text: string, file = "main.tex") => ({ paragraphId: id, text, file, startLine: 1, endLine: 1 });
  const old = [range("p0", "First"), range("p1", "Middle"), range("p2", "Last")];
  const now = [range("p0", "New opening"), range("p1", "First"), range("p2", "Middle revised"), range("p3", "Last")];
  assert.equal(correspondingRange("p1", now, old)?.text, "First", "content anchor beats shifted ID");
  assert.equal(correspondingRange("p2", now, old)?.text, "Middle", "edited paragraph stays between surrounding anchors");
  assert.equal(correspondingRange("p1", old, now)?.text, "Middle revised");
  assert.equal(correspondingRange("p2", old, now)?.paragraphId, "p3");
  assert.equal(correspondingRange("p0", now, old)?.text, "First", "new text can land on a nearby old paragraph");
  assert.equal(correspondingRange("p0", now, [range("other", "First", "appendix.tex")]), undefined, "never match another file");
});

test("duplicate prose and old paragraph records remain navigable without claiming exactness", () => {
  const saved = [{ paragraphId: "a", file: "part.tex", text: "Repeated", startLine: 1, endLine: 1 }, { paragraphId: "b", file: "part.tex", text: "Repeated", startLine: 3, endLine: 3 }];
  assert.equal(correspondingRange("b", saved, saved)?.paragraphId, "b");
  const legacy = [{ paragraphId: "b", file: ".paperfocus-focus", startLine: 7, endLine: 7 }];
  assert.equal(correspondingRange("b", saved, legacy)?.startLine, 7);
  assert.equal(correspondingRange("b", legacy, saved)?.paragraphId, "b");
});

test("warm focus builds copy auxiliaries but preserve existing state and never copy PDF/maps/databases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-warm-")), old = path.join(root, "old"), next = path.join(root, "next");
  await mkdir(old); await mkdir(next);
  for (const extension of ["aux", "toc", "pdf", "synctex.gz", "fdb_latexmk"]) await writeFile(path.join(old, `paperfocus-focus.${extension}`), extension);
  await writeFile(path.join(next, "paperfocus-focus.toc"), "new contents");
  assert.equal(await seedFocusedBuild(old, next), 1);
  assert.deepEqual((await readdir(next)).sort(), ["paperfocus-focus.aux", "paperfocus-focus.toc"]);
  assert.equal(await readFile(path.join(next, "paperfocus-focus.toc"), "utf8"), "new contents");
});

test("one-pass drafts retain safety and sync flags; complete builds keep latexmk reruns", () => {
  for (const engine of ["pdflatex", "xelatex", "lualatex"]) {
    const draft = compilationCommand(engine, "paper.tex", "build folder", true);
    assert.equal(draft.command, engine); assert.ok(draft.args.includes("-no-shell-escape"));
    assert.ok(draft.args.includes("-synctex=1")); assert.ok(draft.args.includes("-output-directory=build folder"));
    const full = compilationCommand(engine, "paper.tex", "build folder", false, true);
    assert.equal(full.command, "latexmk"); assert.ok(full.args.includes("-norc")); assert.ok(full.args.includes("-g"));
  }
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

test("identical text rewrites refresh cache metadata while same-size real edits invalidate it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-build-touch-")), output = path.join(root, "build"); await mkdir(output);
  const input = path.join(root, "main.tex"); await writeFile(input, "original");
  await writeFile(path.join(output, "main.pdf"), "PDF"); await writeFile(path.join(output, "main.synctex.gz"), "Map");
  await writeFile(path.join(output, "main.fls"), `INPUT ${input}\n`);
  const dependencies = await buildDependencies(root, output, "main");
  const old = dependencies.find(d => d.file === input)!;
  const before = old.modified;
  await utimes(input, new Date(), new Date(before + 2000));
  assert.equal(await dependenciesUnchanged(dependencies), true, "sync timestamp changes alone need no TeX");
  assert.notEqual(old.modified, before, "accepted metadata is refreshed for the next check");
  await writeFile(input, "modified");
  await utimes(input, new Date(), new Date(old.modified));
  assert.equal(await dependenciesUnchanged(dependencies), false, "ctime/digest detects an edit even with size and mtime preserved");
});

test("published snapshots validate their own bytes, not the mutable compiler workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aw-build-publish-")), work = path.join(root, "work"), snapshot = path.join(root, "snapshot");
  await mkdir(work); await mkdir(snapshot);
  const input = path.join(root, "style.sty"); await writeFile(input, "style");
  await writeFile(path.join(work, "main.fls"), `INPUT ${input}\nINPUT ${path.join(work, "main.tex")}\n`);
  for (const ext of ["tex", "pdf", "synctex.gz"]) { await writeFile(path.join(work, `main.${ext}`), "work"); await writeFile(path.join(snapshot, `main.${ext}`), "snapshot"); }
  const dependencies = await buildDependencies(root, work, "main", [], snapshot);
  assert.equal(dependencies.some(d => path.dirname(d.file) === work), false);
  await writeFile(path.join(work, "main.tex"), "new editable source");
  assert.equal(await dependenciesUnchanged(dependencies), true);
  await writeFile(path.join(snapshot, "main.pdf"), "replaced PDF");
  assert.equal(await dependenciesUnchanged(dependencies), false);
});


test("inverse SyncTeX keeps the line inside a proof instead of its opening", () => {
  const text = "\\begin{proof}\nFirst paragraph.\n\nSecond argument.\nLast step.\n\\end{proof}";
  const range = {paragraphId:"proof",file:"appendix.tex",startLine:20,endLine:25,text};
  assert.equal(correspondingOffset(range,range,23),text.indexOf("Second"));
  assert.equal(correspondingOffset(range,range,22),text.indexOf("First"),"paragraph-ending blank line targets its prose");
  assert.equal(correspondingOffset(range,range,24,5),text.indexOf("Last")+5);
  const revised = {...range,text:text.replace("First paragraph.","New explanation.\nFirst paragraph.")};
  assert.equal(correspondingOffset(range,revised,23),revised.text.indexOf("Second"));
  assert.equal(correspondingOffset(range,range,999,-1),text.indexOf("\\end"));
  const crlf={...range,text:text.replaceAll("\n","\r\n")};
  assert.equal(correspondingOffset(crlf,crlf,23),crlf.text.indexOf("Second"));
});
