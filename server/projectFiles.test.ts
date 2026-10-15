import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { Readable } from "node:stream";
import { latexMiddleware } from "./latexPlugin.ts";
import { addProjectFiles, checkedProjectPath, createPaperProject, projectFileContent, projectFilePreview } from "./projectFiles.ts";
import { getProject, parseProject, readSourceFile, registry } from "./projects.ts";
import { selectProject } from "./repositories.ts";
import { isProjectCachePath, projectFileCommand, projectFileKind, uploadPaths } from "../src/projectFiles.ts";
import { manuscriptRoots } from "./manuscriptRoots.ts";
import { createSectionFile, undoSectionFile } from "./sectionFiles.ts";
import { newManuscript } from "../src/manuscripts.ts";
import { readSourceDraftCopies } from "./sourceDrafts.ts";
import { sourceZip, zipEntries } from "./sourceZip.ts";
import { inflateRawSync } from "node:zlib";

test("source ZIP preserves nested source, bibliography and PDF figures, excluding private/build files", async () => {
  const { workspace, document, root } = await fixture();
  await mkdir(path.join(root, "sections")); await mkdir(path.join(root, "figures"));
  await mkdir(path.join(root, ".paperfocus")); await mkdir(path.join(root, "build"));
  for (const [file, text] of Object.entries({ "sections/étude.tex": "A theorem.", "refs.bib": "@article{a}", "main.bbl": "Bibliography", "figures/plot.pdf": "%PDF-figure", "main.pdf": "%PDF-build", "main.aux": "aux", ".env": "SECRET", ".paperfocus/notes.json": "PRIVATE", "build/file.tex": "BUILD" })) await writeFile(path.join(root, file), text);
  const source = await readFile(path.join(root, "main.tex")), archive = await sourceZip(workspace, document.project.id);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 6), 0x800);
    const size = archive.readUInt32LE(offset + 18), length = archive.readUInt16LE(offset + 26);
    const name = archive.subarray(offset + 30, offset + 30 + length).toString();
    entries.set(name, inflateRawSync(archive.subarray(offset + 30 + length, offset + 30 + length + size)));
    offset += 30 + length + size;
  }
  assert.deepEqual([...entries.keys()].sort(), ["figures/plot.pdf", "main.bbl", "main.tex", "refs.bib", "sections/étude.tex"].sort());
  assert.deepEqual(entries.get("main.tex"), source); assert.equal(entries.get("sections/étude.tex")?.toString(), "A theorem.");
  assert.equal(archive.readUInt32LE(offset), 0x02014b50); assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  await assert.rejects(() => sourceZip(workspace, "../other"));
  const check = await zipEntries([{ name: "crc.txt", data: Buffer.from("123456789") }]);
  assert.equal(check.readUInt32LE(14), 0xcbf43926);
  await writeFile(path.join(root, "oversized.dat"), Buffer.alloc(20 * 1024 * 1024 + 1));
  await assert.rejects(() => sourceZip(workspace, document.project.id), /20 MB/);
});

const upload = (file: string, content: string | Buffer) => ({ path: file, data: Buffer.from(content).toString("base64") });

test("manuscripts are parent containers, with nested/shared children and comment-safe root detection", () => {
  const sources = { "main.tex": "\\documentclass{article}\n\\input{sections/container}\n", "sections/container.tex": "\\input{child}\n", "sections/child.tex": "\\documentclass{article}\n",
    "notes.tex": "\\documentclass{article}\n\\include{sections/shared}\n", "sections/shared.tex": "Text", "fragment.tex": "% \\documentclass{article}\nNot a root." };
  assert.deepEqual(manuscriptRoots(sources), ["main.tex", "notes.tex"]);
  assert.deepEqual(manuscriptRoots({ "main.tex": "\\input{preamble}\n\\begin{document}\nText\\end{document}", "preamble.tex": "\\documentclass{article}" }), ["main.tex"]);
  assert.deepEqual(manuscriptRoots({ "a.tex": "\\documentclass{article}\\input{b}", "b.tex": "\\documentclass{article}\\input{a}" }), ["a.tex"]);
});

test("paper and notes templates escape titles and cannot name existing/reserved paths", () => {
  const notes = newManuscript("research-notes.tex", "SIS & 50% {test}", "notes");
  assert.match(notes.source, /SIS \\& 50\\% \\{test\\}/);
  assert.match(notes.source, /\\section\{Open questions\}/);
  assert.match(newManuscript("paper.tex", "Paper", "paper").source, /\\section\{Introduction\}/);
  for (const file of ["../paper.tex", "CON.tex", "x\\y.tex", "bad/name.tex", "paper.pdf"]) assert.throws(() => newManuscript(file, "Title", "paper"));
});

test("creating a notes root and guarded switching preserve manuscript bytes and the project identity", async () => {
  const { workspace, document, root } = await fixture(), original = await readFile(path.join(root, "main.tex"), "utf8");
  const notes = newManuscript("notes.tex", "Research notes", "notes");
  await addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload(notes.path, notes.source)]);
  const changed = await parseProject(workspace, document.project.id);
  await assert.rejects(() => selectProject(workspace, document.project.id, "notes.tex", undefined, { mainFile: "main.tex", revision: document.revision }), /changed/);
  const opened = await selectProject(workspace, document.project.id, "notes.tex", undefined, { mainFile: "main.tex", revision: changed.revision });
  assert.equal(opened.project.id, document.project.id); assert.equal(opened.project.mainFile, "notes.tex");
  assert.deepEqual(opened.rootFiles, ["main.tex", "notes.tex"]);
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), original);
});

test("moving a section preserves assembled text, keeps subsections together and has a guarded recoverable undo", async () => {
  const { workspace, document, root } = await fixture();
  const main = "\\documentclass{article}\n\\begin{document}\n\\section{First}\nOne.\n\n\\subsection{Detail}\nTwo.\n\n\\section{Second}\nThree.\n\\end{document}\n";
  await writeFile(path.join(root, "main.tex"), main);
  const before = await parseProject(workspace, document.project.id), first = before.nodes.find(node => node.title === "First")!;
  const result = await createSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: before.revision, file: "sections/first.tex", nodeId: first.id });
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /\\input\{sections\/first.tex\}/);
  const child = await readFile(path.join(root, "sections/first.tex"), "utf8");
  assert.match(child, /\\section\{First\}/); assert.match(child, /\\subsection\{Detail\}/); assert.doesNotMatch(child, /\\section\{Second\}/);
  assert.deepEqual(result.document.paragraphs.map(p => p.text), before.paragraphs.map(p => p.text));
  assert.deepEqual(result.document.rootFiles, ["main.tex"]); assert.equal(result.relocations.length, 2);
  assert.equal((await readSourceDraftCopies(workspace, document.project.id))[0].drafts[0].draftText, main);
  const undo = await undoSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: result.document.revision, operationId: result.operationId });
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main); assert.equal(undo.document.files.includes("sections/first.tex"), false);
  assert.equal(undo.relocations.length, 2);
  await assert.rejects(() => undoSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: result.document.revision, operationId: result.operationId }));
});

test("new section files are explicitly included and undo refuses later edits, stale roots and collisions", async () => {
  const { workspace, document, root } = await fixture(), original = await readFile(path.join(root, "main.tex"), "utf8");
  for (const patch of [{ revision: "stale" }, { mainFile: "wrong.tex" }, { file: "main.tex" }, { file: "../outside.tex" }]) {
    await assert.rejects(() => createSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: document.revision, file: "sections/new.tex", title: "New", ...patch }));
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), original);
  }
  const result = await createSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: document.revision, file: "sections/new.tex", title: "New & useful" });
  assert.ok(result.document.nodes.some(node => node.title === "New \\& useful"));
  await writeFile(path.join(root, "sections/new.tex"), "\\section{Human edits}\nKeep me.\n");
  await assert.rejects(() => undoSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: result.document.revision, operationId: result.operationId }), /changed/);
  assert.match(await readFile(path.join(root, "sections/new.tex"), "utf8"), /Keep me/);
});

test("moving an included section preserves literal child targets and ignores commented inputs", async () => {
  const { workspace, document, root } = await fixture();
  const parent = "\\section{Nested}\nBefore.\n\n% \\input{missing} and \\subfile{also-missing}\n\\input{body}\n";
  await addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload("chapters/container.tex", parent), upload("chapters/body.tex", "Included body.\n")]);
  await writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\input{chapters/container}\n\\end{document}\n");
  const before = await parseProject(workspace, document.project.id);
  const result = await createSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: before.revision, file: "sections/moved.tex", nodeId: before.nodes.find(node => node.title === "Nested")!.id });
  const child = await readFile(path.join(root, "sections/moved.tex"), "utf8");
  assert.match(child, /\\input\{chapters\/body\.tex\}/);
  assert.match(child, /% \\input\{missing\} and \\subfile\{also-missing\}/);
  assert.deepEqual(result.document.paragraphs.map(p => p.text), before.paragraphs.map(p => p.text));
  assert.deepEqual(result.document.rootFiles, ["main.tex"]);
  await undoSectionFile(workspace, { projectId: document.project.id, mainFile: "main.tex", revision: result.document.revision, operationId: result.operationId });
  assert.equal(await readFile(path.join(root, "chapters/container.tex"), "utf8"), parent);
  assert.equal(await readFile(path.join(root, "chapters/body.tex"), "utf8"), "Included body.\n");
});
async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus", "trials");
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "project-files-"));
  const project = await createPaperProject(workspace, "File browser trial");
  const document = await selectProject(workspace, project.id);
  return { workspace, document, ...(await getProject(workspace, project.id)) };
}

test("blank projects are ordinary LaTeX, have distinct roots, and do not replace existing selections until opened", async () => {
  const { workspace, document, root } = await fixture();
  const main = await readFile(path.join(root, "main.tex"), "utf8");
  assert.match(main, /\\documentclass\{article\}/);
  assert.match(main, /graphicx,hyperref/);
  assert.ok(document.nodes.some(node => node.title === "Introduction"));
  const another = await createPaperProject(workspace, "File browser trial");
  assert.notEqual(another.folder, document.project.folder);
  assert.equal((await registry(workspace)).activeId, document.project.id);
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), main);
});

test("nested uploads, unincluded TeX and figures remain discoverable without changing the root", async () => {
  const { workspace, document, root } = await fixture();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPp8AAAAASUVORK5CYII=", "base64");
  await addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload("sections/related.tex", "Unincluded material.\n"), upload("figures/test.png", png), upload("refs.bib", "@article{result, title={Result}}")]);
  const next = await parseProject(workspace, document.project.id);
  assert.ok(next.files.includes("sections/related.tex"));
  assert.ok(next.files.includes("figures/test.png"));
  assert.notEqual(next.revision, document.revision);
  assert.equal(next.project.mainFile, "main.tex");
  const raw = await readSourceFile(workspace, document.project.id, "sections/related.tex");
  assert.equal(raw.source, "Unincluded material.\n");
  assert.equal((await projectFilePreview(workspace, document.project.id, "figures/test.png")).kind, "image");
  const image = await projectFileContent(workspace, document.project.id, "figures/test.png");
  assert.equal(image.mime, "image/png"); assert.deepEqual(image.data, png);
  assert.equal((await projectFilePreview(workspace, document.project.id, "refs.bib")).text, "@article{result, title={Result}}");
  assert.equal(await readFile(path.join(root, "sections/related.tex"), "utf8"), raw.source);
});

test("stale revisions, wrong roots, collisions and invalid batches never overwrite source or partially add files", async () => {
  const { workspace, document, root } = await fixture();
  const original = await readFile(path.join(root, "main.tex"));
  for (const files of [[upload("safe.tex", "new"), upload("main.tex", "overwrite")], [upload("a.tex", "one"), upload("A.tex", "two")], [upload("outside/../bad.tex", "bad")], [upload("a", "file"), upload("a/b.tex", "conflicting folder")], [{ path: "bad.tex", data: "Zg=" }]]) {
    await assert.rejects(() => addProjectFiles(workspace, document.project.id, document.revision, "main.tex", files));
    assert.equal((await readdir(root)).length, 1);
    assert.deepEqual(await readFile(path.join(root, "main.tex")), original);
  }
  await assert.rejects(() => addProjectFiles(workspace, document.project.id, "old", "main.tex", [upload("safe.tex", "new")]), /changed/);
  await assert.rejects(() => addProjectFiles(workspace, document.project.id, document.revision, "other.tex", [upload("safe.tex", "new")]), /changed/);
  await writeFile(path.join(root, "collaborator.tex"), "external work");
  await assert.rejects(() => addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload("safe.tex", "new")]), /changed/);
  assert.equal((await readdir(root)).length, 2);
});

test("folder imports preserve relative includes and reject fragment-only imports before creating a project", async () => {
  const { workspace } = await fixture();
  const main = "\\documentclass{article}\n\\begin{document}\n\\input{sections/body}\n\\end{document}\n";
  const project = await createPaperProject(workspace, "Imported paper", [upload("paper.tex", main), upload("sections/body.tex", "\\section{Body}\nIncluded text.\n")]);
  const document = await selectProject(workspace, project.id);
  assert.equal(document.project.mainFile, "paper.tex");
  assert.ok(document.paragraphs.some(paragraph => paragraph.text === "Included text."));
  const before = await readdir(path.join(workspace, "papers"));
  await assert.rejects(() => createPaperProject(workspace, "No root", [upload("fragment.tex", "A fragment.")]), /documentclass/);
  assert.deepEqual(await readdir(path.join(workspace, "papers")), before);
});

test("paths and preview types do not allow traversal, reserved folders, device names or active SVG/HTML delivery", async () => {
  for (const file of ["../x", "/x", "C:/x", "x\\y", ".paperfocus/x", ".GIT/config", "node_modules/x", "a//b", "a/./b", "x:stream", "NUL.tex", "CON", "a/b. ", "a\n.tex"]) assert.throws(() => checkedProjectPath(file));
  assert.equal(checkedProjectPath("figures/plot_2.png"), "figures/plot_2.png");
  const { workspace, document } = await fixture();
  await addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload("active.svg", '<svg onload="bad()"/>'), upload("fake.png", "<html>not a PNG</html>"), upload("long.txt", "x".repeat(150_000))]);
  const svg = await projectFilePreview(workspace, document.project.id, "active.svg");
  assert.equal(svg.kind, "text"); assert.match(svg.text!, /onload/);
  await assert.rejects(() => projectFileContent(workspace, document.project.id, "active.svg"), /not a supported/);
  await assert.rejects(() => projectFileContent(workspace, document.project.id, "fake.png"), /not a supported/);
  await assert.rejects(() => projectFilePreview(workspace, document.project.id, "../other.tex"));
  const long = await projectFilePreview(workspace, document.project.id, "long.txt");
  assert.equal(long.truncated, true); assert.equal(long.text?.length, 128 * 1024);
});

test("linked upload directories cannot escape the project", async () => {
  const { workspace, document, root } = await fixture();
  const outside = path.join(workspace, "outside"); await mkdir(outside);
  await symlink(outside, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => addProjectFiles(workspace, document.project.id, document.revision, "main.tex", [upload("linked/bad.tex", "bad")]), /links/);
  assert.deepEqual(await readdir(outside), []);
});

test("copy commands and folder-relative paths are concise and do not inject LaTeX", () => {
  assert.equal(projectFileCommand("sections/related.tex"), "\\input{sections/related.tex}");
  assert.equal(projectFileCommand("figures/plot_2.pdf"), "\\includegraphics[width=\\linewidth]{figures/plot_2.pdf}");
  assert.equal(projectFileCommand("figures/my plot.png"), "\\includegraphics[width=\\linewidth]{\\detokenize{figures/my plot.png}}");
  assert.equal(projectFileCommand("x}\\write18{x.tex"), undefined);
  assert.equal(projectFileCommand("refs.bib"), undefined);
  assert.equal(projectFileKind("A.SVG"), "text");
  assert.deepEqual(uploadPaths([{ name: "main.tex", webkitRelativePath: "Paper/main.tex" }, { name: "a.png", webkitRelativePath: "Paper/figures/a.png" }]), ["main.tex", "figures/a.png"]);
  assert.deepEqual(uploadPaths([{ name: "main.tex" }, { name: "other.tex" }]), ["main.tex", "other.tex"]);
  assert.equal(isProjectCachePath(".git/objects/foo"), true);
});

test("file endpoints require the editor origin for writes and serve only validated inline media", async () => {
  const { workspace, document } = await fixture(), handler = latexMiddleware(workspace);
  async function call(url: string, method: string, body?: unknown, origin?: string) {
    const req: any = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { url, method, headers: { host: "127.0.0.1:4201", ...(origin ? { origin } : {}) } });
    const headers: Record<string, string> = {};
    const res: any = { statusCode: 200, setHeader(key: string, value: string) { headers[key] = value; }, end(data: string | Buffer) { res.data = data; } };
    await handler(req, res, () => assert.fail("Unexpected fallthrough"));
    return { status: res.statusCode, headers, data: res.data, json: headers["Content-Type"]?.includes("json") ? JSON.parse(res.data) : undefined };
  }
  const files = [upload("figure.pdf", "%PDF-1.4\nTest metadata only; not a complete PDF."), upload("refs.bib", "@article{x, title={X}}")];
  for (const origin of [undefined, "https://foreign.example"]) {
    assert.equal((await call("/api/paperfocus/projects", "POST", { action: "create", name: "Unwanted" }, origin)).status, 403);
    assert.equal((await call("/api/paperfocus/files", "POST", { projectId: document.project.id, revision: document.revision, mainFile: "main.tex", files }, origin)).status, 403);
    for (const endpoint of ["/api/paperfocus/files/section", "/api/paperfocus/files/section/undo"]) assert.equal((await call(endpoint, "POST", {}, origin)).status, 403);
  }
  const added = await call("/api/paperfocus/files", "POST", { projectId: document.project.id, revision: document.revision, mainFile: "main.tex", files }, "http://127.0.0.1:4201");
  assert.equal(added.status, 200); assert.equal(added.json.document.files.length, 3);
  const pdf = await call(`/api/paperfocus/files/content?projectId=${document.project.id}&file=figure.pdf`, "GET");
  assert.equal(pdf.headers["Content-Type"], "application/pdf"); assert.equal(pdf.headers["X-Content-Type-Options"], "nosniff");
  assert.match(pdf.headers["Content-Security-Policy"], /sandbox/);
  const text = await call(`/api/paperfocus/files?projectId=${document.project.id}&file=refs.bib`, "GET");
  assert.equal(text.json.text, "@article{x, title={X}}");
  assert.equal((await call(`/api/paperfocus/files/content?projectId=${document.project.id}&file=refs.bib`, "GET")).status, 400);
  assert.equal((await call(`/api/paperfocus/files?projectId=${document.project.id}&file=..%2Fprojects.json`, "GET")).status, 400);
  const archive = await call(`/api/paperfocus/source.zip?projectId=${document.project.id}`, "GET");
  assert.equal(archive.status, 200); assert.equal(archive.headers["Content-Type"], "application/zip");
  assert.equal(archive.headers["Cache-Control"], "no-store"); assert.equal(archive.data.readUInt32LE(0), 0x04034b50);
  assert.equal((await call(`/api/paperfocus/source.zip?projectId=${document.project.id}`, "GET", undefined, "https://foreign.example")).status, 403);
});
