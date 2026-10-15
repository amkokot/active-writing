import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import { createPaperProject, addProjectFiles } from "./projectFiles.ts";
import { parseProject, registry, saveRegistry, getProject, projectFiles } from "./projects.ts";
import { writeNotebook, readNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { newExperimentNotebook, newExperimentCell } from "../src/experiments.ts";
import type { NotebookEntry } from "../src/types.ts";
import { collaboratorExport, collaborationPages } from "./collaboratorExport.ts";
import { latexMiddleware } from "./latexPlugin.ts";
import { renderSharingPdf } from "./sharingPdf.ts";
import { sharingPdfBrowser, sharingPdfHtml } from "./sharingPdf.ts";

function unzip(archive: Buffer) {
  const files = new Map<string, Buffer>(); let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), length = archive.readUInt16LE(offset + 26);
    const name = archive.subarray(offset + 30, offset + 30 + length).toString();
    files.set(name, inflateRawSync(archive.subarray(offset + 30 + length, offset + 30 + length + size))); offset += 30 + length + size;
  }
  return files;
}
async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "collaborator-export-"));
  const project = await createPaperProject(workspace, "Transport & collaboration");
  const document = await parseProject(workspace, project.id), p = document.paragraphs[0];
  const entry: NotebookEntry = { id: "question", cataloguePosition: 0, title: "A useful bound", question: "Does $x^2$ help?", notes: "## Unresolved\n\nCheck the constant.", reply: "A **candidate** argument.\n\n$$x^2\\le 1$$\n\n<script>do not run</script>", proposal: "", status: "open", route: "codex", effort: 2, createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z", handoffs: [{ id: "packet", packet: "PRIVATE_ARCHIVED_PROMPT", createdAt: "today" }], appliedChanges: [], source: { rootFile: project.mainFile, paragraphId: p.id, nodeId: p.nodeId, nodeTitle: "Introduction", file: p.file, paragraphText: p.text, excerpt: p.text, start: 0, end: p.text.length, revision: document.revision } };
  const conversations = await writeNotebook(workspace, project.id, 0, [entry, { ...entry, cataloguePosition: 1, id: "filed", filed: true, title: "PRIVATE_FILED_NOTE", source: undefined }, { ...entry, cataloguePosition: 2, id: "recovery", recoveryKey: "private-recovery", title: "PRIVATE_RECOVERY" }]);
  const nb = newExperimentNotebook(); nb.metadata = { privatePath: "PRIVATE_LOCAL_PATH" };
  const code = { ...newExperimentCell("code"), id: "plot", source: "print('changed')", metadata: { private: "PRIVATE_METADATA", paperfocus: { title: "Experiment", pinned: true, lastRunSource: "print('old')", runId: "saved-run", execution: { mode: "fresh" as const, timeoutMs: 30000, transport: "offline" as const, runtime: { executable: "PRIVATE_LOCAL_PATH/python.exe", packageFolder: "PRIVATE_LOCAL_PATH/packages", python: "3.12.2", packages: { numpy: "2.3.5" } } } } }, outputs: [{ output_type: "display_data", data: { "application/vnd.paperfocus.plot+json": { title: "Bounds", xLabel: "n", yLabel: "error", series: [{ name: "estimate", points: [[1, 0.3], [2, 0.2]] }] }, "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "text/html": "<script>EXECUTABLE_OUTPUT</script>" } }] };
  nb.cells = [code, { ...newExperimentCell("markdown"), id: "hidden", source: "PRIVATE_HIDDEN_CELL", metadata: { paperfocus: { suppressed: true } } }, { ...newExperimentCell("markdown"), id: "deleted", source: "PRIVATE_TRASH", metadata: { paperfocus: { deleted: true } } }];
  const experiments = await writeExperiments(workspace, project.id, entry.id, "", nb);
  return { workspace, document, conversations, experiments, request: { projectId: project.id, mainFile: project.mainFile, revision: document.revision, notebookRevision: conversations.revision } };
}

test("single-file sharing renders math and figures offline, links passages, excludes private records and never mutates", async () => {
  const f = await fixture(), original = await readFile(f.experiments.path), result = await collaboratorExport(f.workspace, { ...f.request, format: "html" });
  const html = result.data.toString();
  assert.equal(result.extension, "html"); assert.match(result.mime, /text\/html/);
  for (const value of ["class=\"katex\"", "data:font/woff2;base64,", "data:image/png;base64,", 'href="#passage-0"', 'href="#conversation-1"', "Stale output", "Saved snapshot", "<svg", "Check the constant.", "<td>estimate</td><td>1</td><td>0.3</td>", "<td>estimate</td><td>2</td><td>0.2</td>"]) assert.ok(html.includes(value), value);
  assert.doesNotMatch(html, /PRIVATE_ARCHIVED_PROMPT|PRIVATE_LOCAL_PATH|PRIVATE_METADATA|PRIVATE_FILED_NOTE|PRIVATE_RECOVERY|PRIVATE_HIDDEN_CELL|PRIVATE_TRASH|EXECUTABLE_OUTPUT|<script|notebooks\/|href="manuscript\.md"|https?:\/\/.*\.woff/);
  assert.ok(html.includes("script-src 'none'"));
  assert.deepEqual(await readFile(f.experiments.path), original); assert.equal((await readNotebook(f.workspace, f.request.projectId)).revision, f.conversations.revision);
});

test("sharing emits a section once when prose resumes after theorem/proof, preserving distinct same-title sections", async () => {
  const f = await fixture(), { root } = await getProject(f.workspace, f.request.projectId);
  const source = String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}
\begin{document}
\section*{Shared heading}
FIRST_PASSAGE.

\begin{theorem}[A claim]
THEOREM_PASSAGE.
\end{theorem}
\begin{proof}
PROOF_PASSAGE.
\end{proof}

AFTER_PROOF_PASSAGE.

\section*{Shared heading}
SECOND_SECTION_PASSAGE.
\end{document}`;
  await writeFile(path.join(root, f.request.mainFile), source);
  const document = await parseProject(f.workspace, f.request.projectId);
  assert.equal(document.nodes.filter(n => n.title === "Shared heading").length, 2);
  const result = collaborationPages(document, [], new Map(), false, "test");
  assert.equal((result.body.match(/<h2>Shared heading<\/h2>/g) ?? []).length, 2);
  const markdown = result.files.find(file => file.name === "manuscript.md")!.data.toString();
  assert.equal((markdown.match(/^## Shared heading$/gm) ?? []).length, 2);
  for (const text of ["FIRST_PASSAGE", "THEOREM_PASSAGE", "PROOF_PASSAGE", "AFTER_PROOF_PASSAGE", "SECOND_SECTION_PASSAGE"]) {
    assert.equal((result.body.match(new RegExp(`\\b${text}\\b`, "g")) ?? []).length, 1);
    assert.equal((markdown.match(new RegExp(`\\b${text}\\b`, "g")) ?? []).length, 1);
  }
  assert.equal((result.body.match(/class="passage"/g) ?? []).length, document.paragraphs.length);
  assert.equal(await readFile(path.join(root, f.request.mainFile), "utf8"), source);
});

test("ZIP shares editable companions, explicit hidden inclusion and revision/hash manifest without executing output", async () => {
  const f = await fixture(), result = await collaboratorExport(f.workspace, { ...f.request, format: "zip", includeFiled: true });
  const files = unzip(result.data);
  for (const file of ["START_HERE.html", "README.txt", "manuscript.md", "notebook.md", "notebooks/conversation-1.ipynb", "source/main.tex", "manifest.json"]) assert.ok(files.has(file), file);
  assert.ok(files.get("START_HERE.html")?.toString().includes("PRIVATE_FILED_NOTE"));
  const nb = JSON.parse(files.get("notebooks/conversation-1.ipynb")!.toString());
  assert.equal(nb.cells.length, 2); assert.equal(nb.cells[1].source, "PRIVATE_HIDDEN_CELL");
  assert.doesNotMatch(JSON.stringify(nb), /PRIVATE_TRASH|PRIVATE_LOCAL_PATH|PRIVATE_METADATA|EXECUTABLE_OUTPUT|text\/html/);
  assert.equal(JSON.parse(files.get("manifest.json")!.toString()).files.every((file: any) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  const only = unzip((await collaboratorExport(f.workspace, { ...f.request, format: "zip", entryId: "question", includeSource: false })).data);
  assert.ok(!only.has("source/main.tex")); assert.ok(!only.has("notebooks/conversation-2.ipynb"));
  assert.equal((await readExperiments(f.workspace, f.request.projectId, "question")).revision, f.experiments.revision);
});

test("sharing refuses unknown selections, stale roots/revisions, and foreign origins", async () => {
  const f = await fixture();
  for (const change of [{ mainFile: "other.tex" }, { revision: "stale" }, { notebookRevision: 0 }, { entryId: "unknown" }, { entryId: "recovery" }]) await assert.rejects(() => collaboratorExport(f.workspace, { ...f.request, ...change }));
  await assert.rejects(() => collaboratorExport(f.workspace, { ...f.request, format: "docx" as any }), /Choose PDF, HTML or ZIP/);
  const handler = latexMiddleware(f.workspace);
  for (const origin of [undefined, "https://foreign.example"]) {
    const req: any = Object.assign(Readable.from([JSON.stringify(f.request)]), { url: "/api/paperfocus/share.zip", method: "POST", headers: { host: "127.0.0.1:4204", origin } });
    const res: any = { setHeader() {}, end() {}, statusCode: 200 };
    await handler(req, res, () => assert.fail("Unexpected fallthrough")); assert.equal(res.statusCode, 403);
  }
});

test("PDF is the default, expands every selected conversation/code/frame, and retains the final save fence", async () => {
  const f = await fixture(), original = await readFile(f.experiments.path);
  let printed = "";
  const result = await collaboratorExport(f.workspace, f.request, async html => { printed = html.toString(); return Buffer.from("%PDF-test-print-engine"); });
  assert.equal(result.extension, "pdf"); assert.equal(result.mime, "application/pdf");
  assert.match(printed, /@page \{ size: A4/); assert.match(printed, /<details open><summary>Code/);
  assert.ok([...printed.matchAll(/<details([^>]*)>/g)].every(match => match[1].includes("open")));
  assert.doesNotMatch(printed, /loading="lazy"|PRIVATE_FILED_NOTE|PRIVATE_TRASH|PRIVATE_RECOVERY|PRIVATE_HIDDEN_CELL|href="notebooks\//);
  assert.match(printed, /class="katex"/); assert.match(printed, /data:image\/png;base64,/);
  assert.deepEqual(await readFile(f.experiments.path), original);
  await assert.rejects(() => collaboratorExport(f.workspace, { ...f.request, format: "pdf" }, async () => {
    await writeNotebook(f.workspace, f.request.projectId, f.conversations.revision, f.conversations.entries.map(entry => ({ ...entry, notes: `${entry.notes}\nA later saved edit.` })));
    return Buffer.from("%PDF-test-print-engine");
  }), /workspace changed during export/);
});

test("PDF print markup exposes closed details without changing the offline HTML copy", () => {
  const input = '<html><head><style>body{}</style></head><body><details><summary>Later reply</summary>FULL_REPLY</details><details open><summary>Code</summary>FULL_CODE</details><img loading="lazy"/></body></html>';
  const printed = sharingPdfHtml(input);
  assert.equal((printed.match(/<details open>/g) ?? []).length, 2);
  assert.match(printed, /loading="eager"/); assert.match(printed, /FULL_REPLY/); assert.match(printed, /FULL_CODE/);
  assert.match(input, /<details><summary>Later reply/);
});

test("installed local print engine produces a real PDF without source or notebook mutations", { timeout: 75_000 }, async context => {
  try { await sharingPdfBrowser(); } catch { context.skip("No installed Chrome/Edge on this test host; the missing-browser message is explicit."); return; }
  const f = await fixture(), original = await readFile(f.experiments.path);
  const result = await collaboratorExport(f.workspace, { ...f.request, format: "pdf" });
  assert.equal(result.data.subarray(0, 5).toString(), "%PDF-"); assert.ok(result.data.length > 1000);
  assert.deepEqual(await readFile(f.experiments.path), original);
  assert.equal((await parseProject(f.workspace, f.request.projectId)).revision, f.document.revision);
  assert.equal((await readNotebook(f.workspace, f.request.projectId)).revision, f.conversations.revision);
});

test("an explicit print-engine override never silently falls back to a different installed browser", async () => {
  const old = process.env.AW_PDF_BROWSER;
  process.env.AW_PDF_BROWSER = process.execPath;
  try { await assert.rejects(renderSharingPdf(Buffer.from("<!doctype html><p>Isolated print control</p>")), /print engine could not finish/); }
  finally { if (old === undefined) delete process.env.AW_PDF_BROWSER; else process.env.AW_PDF_BROWSER = old; }
});

test("reader ZIP has an overview, selected notes, portable links and a guarded aw/ snapshot; offline PDF removes local links", async () => {
  const f = await fixture();
  const tex = (body: string) => `\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}\n${body}\n\\end{document}`;
  const link = `http://127.0.0.1:4173/?awProject=${f.request.projectId}&awPanel=notebook&awNotebook=question&awCell=plot&awOutput=0&awEvidence=${f.experiments.revision}`;
  await addProjectFiles(f.workspace, f.request.projectId, f.request.revision, f.request.mainFile, [{ path: "overview.tex", data: Buffer.from(tex(`\\section{Aim}\nWe study a useful bound. \\href{${link}}{Saved experiment}. \\href{http://127.0.0.1:4173/?awProject=foreign}{Not selected}.\n50\\% remains. % PRIVATE_TEX_COMMENT\n% \\includegraphics{private-figure.png}`)).toString("base64") }, { path: "notes.tex", data: Buffer.from(tex("\\section{Details}\nAn unresolved assumption and $x^2$.")).toString("base64") }]);
  const reg = await registry(f.workspace); reg.projects.find(p => p.id === f.request.projectId)!.manuscriptPurposes = { "overview.tex": "overview" }; await saveRegistry(f.workspace, reg);
  const document = await parseProject(f.workspace, f.request.projectId), request = { ...f.request, revision: document.revision, overviewFile: "overview.tex", noteFiles: ["notes.tex"], repositoryUrl: "https://github.com/example/private-paper" };
  let printed = "";
  const files = unzip((await collaboratorExport(f.workspace, { ...request, format: "web" }, async html => { printed = html.toString(); return Buffer.from("%PDF-isolated-test"); })).data);
  for (const name of ["aw/index.html", "aw/overview.pdf", "aw/reading.html", "aw/notes/note-1.html", "aw/reader.json", "aw/notebooks/conversation-1.ipynb", "aw/LICENSE-KaTeX.txt"]) assert.ok(files.has(name), name);
  assert.match(files.get("aw/LICENSE-KaTeX.txt")!.toString(), /Copyright.*Khan Academy/);
  assert.ok([...files.keys()].every(name => name.startsWith("aw/") && !name.startsWith("aw/source/")));
  const index = files.get("aw/index.html")!.toString();
  assert.match(index, /We study a useful bound/); assert.match(index, /href="reading.html#output-1-plot-0"/); assert.match(index, /href="notes\/note-1.html#manuscript"/);
  assert.doesNotMatch(index, /127\.0\.0\.1|awProject|data:font|PRIVATE_TEX_COMMENT|private-figure|target="_blank"[^>]*>Saved experiment/); assert.match(index, /50% remains/); assert.doesNotMatch(printed, /href="(?:reading|notes|overview|reader)|127\.0\.0\.1|awProject|Download overview PDF|Download reading bundle/);
  assert.match(printed, /href="https:\/\/github.com\/example\/private-paper"/);
  const manifest = JSON.parse(files.get("aw/reader.json")!.toString());
  assert.equal(manifest.files.every((file: any) => createHash("sha256").update(files.get(`aw/${file.name}`)!).digest("hex") === file.sha256), true);
  assert.ok([...files.keys()].filter(name => /\.(woff|ttf)$/.test(name)).length === 0);
  assert.ok([...files.values()].reduce((n, data) => n + data.length, 0) < 3_000_000);
  assert.doesNotMatch(files.get("aw/notebooks/conversation-1.ipynb")!.toString(), /PRIVATE_LOCAL_PATH|PRIVATE_METADATA/);
  assert.equal((await getProject(f.workspace, f.request.projectId)).project.mainFile, f.request.mainFile);
  // Installing the snapshot must not invalidate source caches, but unlisted TeX remains ordinary source.
  const { root } = await getProject(f.workspace, f.request.projectId);
  for (const [name, data] of files) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), data); }
  assert.equal((await parseProject(f.workspace, f.request.projectId)).revision, document.revision);
  await writeFile(path.join(root, "aw/ordinary.tex"), tex("Keep this ordinary source visible."));
  assert.ok((await projectFiles(root)).includes("aw/ordinary.tex"));
  assert.notEqual((await parseProject(f.workspace, f.request.projectId)).revision, document.revision);
  await assert.rejects(() => collaboratorExport(f.workspace, { ...request, noteFiles: ["../secret.tex"], format: "web" }), /changed|notes manuscripts/);
});

test("a reader can share only manuscript/overview with no notebook reads or private conversation content", async () => {
  const f = await fixture();
  const { root } = await getProject(f.workspace, f.request.projectId);
  const link = `http://127.0.0.1:4173/?awProject=${f.request.projectId}&awPanel=paper&awRoot=main.tex`;
  const doc = await parseProject(f.workspace, f.request.projectId);
  const source = await readFile(path.join(root, doc.project.mainFile), "utf8");
  await writeFile(path.join(root, doc.project.mainFile), source.replace("\\end{document}", `\\href{${link}}{Local evidence}\n\\end{document}`));
  const updated = await parseProject(f.workspace, f.request.projectId);
  const files = unzip((await collaboratorExport(f.workspace, { ...f.request, revision: updated.revision, includeNotebook: false, format: "web" }, async () => Buffer.from("%PDF-test"))).data);
  assert.ok(![...files.keys()].some(name => /notebook|conversation|figures\//.test(name)));
  assert.doesNotMatch(files.get("aw/reading.html")!.toString(), /Notebook \(0\)|id="notebook"|href="notebook\.md"|PRIVATE_|Check the constant/);
  assert.doesNotMatch(files.get("aw/manuscript.md")!.toString(), /127\.0\.0\.1|awProject/);
  await assert.rejects(collaboratorExport(f.workspace, { ...f.request, revision: updated.revision, includeNotebook: false, entryId: "question", format: "web" }), /not both/);
});
