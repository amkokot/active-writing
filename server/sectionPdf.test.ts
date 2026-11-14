import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { compile, latexPlugin } from "./latexPlugin.ts";
import { parseProject, registerProject } from "./projects.ts";
import { projectBuildFolder } from "./projectStorage.ts";
import { sectionPdfGroups } from "./sectionPdf.ts";
import { SectionPdfPool, sectionPdfDocument, sectionPageOwner, sectionPdfUrl, sectionReadingPosition } from "../src/sectionPdfDocument.ts";
import type { SectionPdfPart } from "../src/types.ts";
import type { PDFDocumentProxy } from "pdfjs-dist";

const part = (index: number, count = 1): SectionPdfPart => ({ nodeId: `s${index}`, title: `Section ${index}`, artifactKey: `${index}`.repeat(16), paragraphIds: [`p${index}`],
  pdfUrl: `/api/paperfocus/pdf/focus?projectId=p&build=${index.toString().repeat(16)}`, compiledAt: "now", cacheHit: false, pageCount: count, pageOffset: index });

test("virtual section pages translate local destinations and skip synthetic missing-target fallbacks", async () => {
  const first = part(0), second = part(1); first.unavailablePdfDestinations = ["result"];
  const document = (index: number) => ({ numPages: 1,
    getPage: async () => ({ getAnnotations: async () => [{ dest: "result" }, { dest: [{ num: 4, gen: 0 }, { name: "Fit" }] }], getTextContent: async () => ({ items: [`text${index}`] }) }),
    getDestination: async (name: string) => name === "result" ? [{ num: 4, gen: 0 }, { name: "Fit" }] : null, getPageIndex: async () => 0 }) as unknown as PDFDocumentProxy;
  const joined = sectionPdfDocument([first, second], [document(0), document(1)]);
  assert.equal(joined.numPages, 2); assert.equal(sectionPageOwner([first, second], 2), 1);
  const annotations = await (await joined.getPage(1)).getAnnotations();
  assert.deepEqual((await joined.getDestination(annotations[0].dest))?.[0], 1, "cross-section result resolves to its real page");
  assert.equal(annotations[1].dest[0], 0, "local array targets retain their section owner");
  assert.deepEqual((await (await joined.getPage(2)).getAnnotations())[1].dest[0], 1);
  assert.throws(() => sectionPdfDocument([first, { ...second, pageOffset: 5 }], [document(0), document(1)]), /page counts/);
});

test("section pool reloads only changed PDFs and rejects foreign or external links", async () => {
  const loads: string[] = [], destroyed: string[] = [];
  const pool = new SectionPdfPool(url => { loads.push(url); return { promise: Promise.resolve({ numPages: 1 } as PDFDocumentProxy), destroy: async () => { destroyed.push(url); } }; });
  await pool.load([part(0), part(1)]);
  const changed = { ...part(1), pdfUrl: part(2).pdfUrl };
  await pool.load([part(0), changed]);
  assert.equal(loads.length, 3); assert.deepEqual(destroyed, [part(1).pdfUrl]);
  assert.ok(sectionPdfUrl(part(0).pdfUrl, "/api/paperfocus/section-pdf?projectId=p", "http://localhost:4173").startsWith("http://localhost:4173/"));
  assert.throws(() => sectionPdfUrl("https://example.com/a.pdf", "?projectId=p", "http://localhost:4173"), /Invalid/);
  assert.throws(() => sectionPdfUrl(part(0).pdfUrl, "?projectId=other", "http://localhost:4173"), /Invalid/);
  await pool.destroy(); assert.equal(destroyed.length, 3);
});

test("reading position follows its section when an earlier section grows", () => {
  const saved = { revision: "old", top: 30, left: 0, page: 2, sectionId: "s1", sectionPage: 1 };
  assert.equal(sectionReadingPosition([{ ...part(0), pageCount: 5 }, { ...part(1), pageOffset: 5 }], saved).page, 6);
});

test("Section PDFs reuse unchanged sections, retain navigation and never write page breaks to source", async t => {
  const probe = spawnSync("latexmk", ["-v"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (probe.error || probe.status !== 0) { t.skip("latexmk is not installed"); return; }
  const home = await mkdtemp(path.join(os.tmpdir(), "aw-section-pdf-")); await mkdir(path.join(home, "paper"));
  const main = path.join(home, "paper/main.tex"), file = path.join(home, "paper/content.tex");
  let source = String.raw`\documentclass{article}
\usepackage{hyperref,amsthm}
\newtheorem{theorem}{Theorem}
\begin{document}
\section{First}
A first paragraph refers to Theorem~\ref{result}.

A second paragraph stays in the first section.
\begin{figure}[p]\centering\rule{20mm}{10mm}\caption{A deferred figure.}\end{figure}
\section{Second}
A paragraph in the second section.
\begin{theorem}\label{result}For real $x$, $x^2\geq0$.\end{theorem}
\begin{proof}Square the absolute value of $x$.\end{proof}
\end{document}
`;
  const begin = source.indexOf("\\begin{document}"), end = source.indexOf("\\end{document}");
  const mainSource = source.slice(0, begin) + "\\begin{document}\n\\input{content}\n\\end{document}\n";
  source = source.slice(begin + "\\begin{document}".length, end);
  await writeFile(main, mainSource); const mainBefore = await stat(main);
  await writeFile(file, source); const project = await registerProject(home, "paper");
  const parsed = await parseProject(home, project.id), before = await stat(file);
  assert.equal(sectionPdfGroups(parsed, {}).length, 2);
  const request = { projectId: project.id, mode: "focus" as const, sectionPdf: true };
  const first = await compile(home, { ...request, revision: parsed.revision }); assert.equal(first.success, true, first.log);
  assert.equal(first.sectionParts?.length, 2); assert.ok(first.sectionParts![0].pageCount >= 2, "pending figure is flushed within its section");
  assert.equal(await readFile(file, "utf8"), source); assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.doesNotMatch(source, /\\(?:clearpage|newpage)/);
  const stable = first.sectionParts![1], stableFolder = await projectBuildFolder(home, project.id, "focus", stable.artifactKey), stableRecord = await readFile(path.join(stableFolder, "compile.json"), "utf8");
  const cached = await compile(home, { ...request, revision: parsed.revision }); assert.equal(cached.cacheHit, true);
  await writeFile(file, source.replace("A first paragraph", "An edited first paragraph"));
  const edited = await parseProject(home, project.id), next = await compile(home, { ...request, revision: edited.revision });
  assert.equal(next.success, true, next.log); assert.equal(next.sectionParts![0].cacheHit, false); assert.equal(next.sectionParts![1].cacheHit, true);
  assert.equal(next.sectionParts![1].artifactKey, stable.artifactKey); assert.equal(await readFile(path.join(stableFolder, "compile.json"), "utf8"), stableRecord);
  assert.equal(await readFile(file, "utf8"), source.replace("A first paragraph", "An edited first paragraph"));
  const growth = source.replace("A first paragraph", "An edited first paragraph").replace("\\section{Second}",
    Array.from({ length: 24 }, (_, i) => `Extra paragraph ${i}: ` + "This added explanation expands the first section without changing any later section. ".repeat(6)).join("\n\n") + "\n\\section{Second}");
  await writeFile(file, growth);
  const grown = await parseProject(home, project.id), expanded = await compile(home, { ...request, revision: grown.revision });
  assert.equal(expanded.success, true, expanded.log);
  assert.ok(expanded.sectionParts![1].pageOffset > next.sectionParts![1].pageOffset);
  assert.equal(expanded.sectionParts![1].artifactKey, stable.artifactKey);
  let handler: any; (latexPlugin(home).configureServer as Function)({ middlewares: { use(value: unknown) { handler = value; } } });
  const invoke = async (body: object) => { const res: any = { setHeader() {}, end(text: string) { this.body = JSON.parse(text); } };
    await handler(Object.assign(Readable.from([JSON.stringify(body)]), { method: "POST", url: "/api/paperfocus/source-sync", headers: { host: "localhost:4173" } }), res, () => assert.fail("Unexpected route"));
    assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body; };
  const target = grown.paragraphs.find(p => p.text.startsWith("A paragraph in the second"))!;
  const forward = await invoke({ projectId: project.id, mode: "focus", artifactKey: expanded.artifactKey, compiledAt: expanded.compiledAt, direction: "forward", paragraphId: target.id });
  assert.ok(forward.page > expanded.sectionParts![1].pageOffset);
  const inverse = await invoke({ projectId: project.id, mode: "focus", artifactKey: expanded.artifactKey, direction: "inverse", ...forward });
  assert.equal(inverse.paragraphId, target.id);
  const oldForward = await invoke({ projectId: project.id, mode: "focus", artifactKey: next.artifactKey, compiledAt: next.compiledAt, direction: "forward", paragraphId: target.id });
  const oldInverse = await invoke({ projectId: project.id, mode: "focus", artifactKey: next.artifactKey, direction: "inverse", ...oldForward });
  assert.equal(oldInverse.paragraphId, target.id, "an older combined PDF retains its own offsets and still finds current source");
  const full = await compile(home, { projectId: project.id, mode: "full", revision: grown.revision }); assert.equal(full.success, true, full.log);
  assert.equal(full.sectionParts, undefined); assert.equal(await readFile(file, "utf8"), growth);
  assert.equal(await readFile(main, "utf8"), mainSource); assert.equal((await stat(main)).mtimeMs, mainBefore.mtimeMs, "the root and included source files remain ordinary unchanged LaTeX");
});
