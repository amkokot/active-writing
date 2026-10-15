import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rename, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { projectBuildFolder, projectDataPath, projectStorage } from "./projectStorage.ts";
import { getProject, parseProject, registerProject, registry, saveRegistry } from "./projects.ts";
import { checked } from "./commands.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import { createHandoff, readHandoff, readHandoffTicket } from "./handoffs.ts";
import { storeReference, readReferencePdf } from "./referenceLibrary.ts";
import { compile, latexPlugin } from "./latexPlugin.ts";

async function fixture(minWorkspaceLength = 0) {
  const base = path.resolve(".paperfocus/trials"); await mkdir(base, { recursive: true });
  const prefix = "external-storage-" + "x".repeat(Math.max(0, minWorkspaceLength - base.length - 24));
  const workspace = await mkdtemp(path.join(base, prefix)), root = path.join(workspace, "paper with spaces");
  await mkdir(root);
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{Result}\nOriginal text.\n\\end{document}\n";
  await writeFile(path.join(root, "main.tex"), source);
  const project = await registerProject(workspace, root, "External storage trial");
  return { workspace, root, source, project, data: projectDataPath(workspace, project.id), legacy: path.join(root, ".paperfocus") };
}
async function exists(file: string) { try { await stat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }

test("Aw stores notes, editing work, notebooks, handoffs and references outside the paper; catalogues are project-scoped", async () => {
  const f = await fixture(), before = await parseProject(f.workspace, f.project.id);
  await writeNotebook(f.workspace, f.project.id, 0, []);
  await writeWorkbench(f.workspace, f.project.id, 0, emptyWorkbench());
  const notebook = newExperimentNotebook(); notebook.cells.push({ ...newExperimentCell("markdown"), source: "A retained experiment note." });
  const experiment = await writeExperiments(f.workspace, f.project.id, "question", "", notebook);
  const ticket = await createHandoff(f.workspace, f.project.id, { packet: "Scoped reasoning only.", transport: "files" });
  await storeReference(f.workspace, f.project.id, "ref", Buffer.from("%PDF-1.4\nfixture bytes"), "reference.pdf");
  await projectBuildFolder(f.workspace, f.project.id, "full");
  assert.equal(experiment.path, path.join(f.data, "experiments/question/notebook.ipynb"));
  assert.equal(ticket.promptPath, path.join(f.data, "handoffs", ticket.id, "prompt.md"));
  assert.equal((await readReferencePdf(f.workspace, f.project.id, "ref")).toString(), "%PDF-1.4\nfixture bytes");
  const catalogue = JSON.parse(await readFile(path.join(f.data, "project.json"), "utf8"));
  assert.equal(catalogue.projectId, f.project.id); assert.equal(catalogue.paperFolder, f.project.folder);
  assert.equal(catalogue.categories.experiments, "experiments"); assert.equal(catalogue.categories.sourceBackups, `../../backups/${f.project.id}`);
  assert.deepEqual(await readdir(f.root), ["main.tex"]);
  assert.equal((await parseProject(f.workspace, f.project.id)).revision, before.revision);
  const other = path.join(f.workspace, "another"); await mkdir(other); await writeFile(path.join(other, "main.tex"), f.source);
  const project = await registerProject(f.workspace, other);
  assert.notEqual((await projectStorage(f.workspace, project.id)).folder, f.data);
  assert.equal((await readNotebook(f.workspace, project.id)).revision, 0);
});

test("recognized legacy data migrates byte-for-byte, including finalized replies and experiment revisions; unknown files stay put", async () => {
  const f = await fixture(), before = await parseProject(f.workspace, f.project.id);
  await mkdir(path.join(f.legacy, "experiments/question"), { recursive: true });
  const bytes = JSON.stringify(newExperimentNotebook());
  await writeFile(path.join(f.legacy, "experiments/question/notebook.ipynb"), bytes);
  await writeFile(path.join(f.legacy, "notebook.json"), JSON.stringify({ version: 1, revision: 8, entries: [] }));
  await writeFile(path.join(f.legacy, "workbench.json"), JSON.stringify({ version: 1, revision: 3, ...emptyWorkbench() }));
  await writeFile(path.join(f.legacy, "author-file.txt"), "Not known to Aw. Leave this alone.");
  const id = randomUUID(), packet = "Original immutable request", requestHash = createHash("sha256").update(packet).digest("hex");
  const handoff = path.join(f.legacy, "handoffs", id); await mkdir(handoff, { recursive: true });
  const oldTicket = { id, transport: "files", label: "Agent", requestHash, promptPath: path.join(handoff, "prompt.md"), responsePath: path.join(handoff, "response.json"), copyText: "Read the old path" };
  await writeFile(oldTicket.promptPath, packet);
  const request = JSON.stringify({ version: 1, ticket: oldTicket, packet, createdAt: "2026-10-01" });
  await writeFile(path.join(handoff, "request.json"), request);
  await writeFile(oldTicket.responsePath, JSON.stringify({ version: 1, taskId: id, requestHash, complete: true, reply: "Retained findings." }));
  assert.equal((await readNotebook(f.workspace, f.project.id)).revision, 8);
  assert.equal((await readWorkbench(f.workspace, f.project.id)).revision, 3);
  assert.equal((await readExperiments(f.workspace, f.project.id, "question")).revision, createHash("sha256").update(bytes).digest("hex"));
  const result = await readHandoff(f.workspace, f.project.id, id);
  assert.equal(result.status, "ready"); assert.equal(result.reply, "Retained findings.");
  const current = await readHandoffTicket(f.workspace, f.project.id, id);
  assert.equal(current.requestHash, requestHash); assert.equal(current.promptPath, path.join(f.data, "handoffs", id, "prompt.md"));
  assert.ok(current.copyText.includes(current.responsePath)); assert.match(current.copyText, /not the older path/);
  assert.equal(await readFile(path.join(f.data, "handoffs", id, "request.json"), "utf8"), request, "captured prompt/ticket remain unchanged on disk");
  assert.deepEqual(await readdir(f.legacy), ["author-file.txt"]);
  const journal = await readFile(path.join(f.data, "migration.json"), "utf8");
  await projectStorage(f.workspace, f.project.id);
  assert.equal(await readFile(path.join(f.data, "migration.json"), "utf8"), journal, "normal reads do not redo the migration");
  assert.equal((await parseProject(f.workspace, f.project.id)).revision, before.revision);
});

test("Git-tracked legacy originals are retained, not deleted or repeatedly imported over the new live store", async () => {
  const f = await fixture(); await mkdir(f.legacy);
  const original = JSON.stringify({ version: 1, revision: 2, entries: [] });
  await writeFile(path.join(f.legacy, "notebook.json"), original);
  await checked("git", ["init"], f.root); await checked("git", ["add", "main.tex", ".paperfocus/notebook.json"], f.root);
  const gitBefore = await checked("git", ["status", "--porcelain"], f.root);
  assert.equal((await readNotebook(f.workspace, f.project.id)).revision, 2);
  await writeNotebook(f.workspace, f.project.id, 2, []);
  assert.equal((await readNotebook(f.workspace, f.project.id)).revision, 3);
  assert.equal(await readFile(path.join(f.legacy, "notebook.json"), "utf8"), original);
  assert.equal(await checked("git", ["status", "--porcelain"], f.root), gitBefore);
  const journal = JSON.parse(await readFile(path.join(f.data, "migration.json"), "utf8"));
  assert.ok(journal.kept.includes("notebook.json"));
});

test("different destination copies block migration before any source is moved", async () => {
  const f = await fixture(); await mkdir(f.legacy); await mkdir(f.data, { recursive: true });
  await writeFile(path.join(f.legacy, "notebook.json"), "old"); await writeFile(path.join(f.data, "notebook.json"), "new");
  await writeFile(path.join(f.legacy, "workbench.json"), "also old");
  await assert.rejects(projectStorage(f.workspace, f.project.id), /Both copies are preserved/);
  assert.equal(await readFile(path.join(f.legacy, "notebook.json"), "utf8"), "old"); assert.equal(await readFile(path.join(f.data, "notebook.json"), "utf8"), "new");
  assert.equal(await exists(path.join(f.legacy, "workbench.json")), true);
  assert.equal(await exists(path.join(f.data, "migration.json")), false);
});

test("interrupted relocation resumes while preserving its entry catalogue", async () => {
  const f = await fixture(); await mkdir(f.legacy); await mkdir(f.data, { recursive: true });
  await writeFile(path.join(f.legacy, "notebook.json"), "captured notes"); await writeFile(path.join(f.legacy, "workbench.json"), "editing work");
  await rename(path.join(f.legacy, "notebook.json"), path.join(f.data, "notebook.json"));
  await writeFile(path.join(f.data, "migration.json"), JSON.stringify({ version: 1, legacyRoot: f.legacy, dataRoot: f.data, phase: "moving", entries: ["notebook.json", "workbench.json"] }));
  await projectStorage(f.workspace, f.project.id);
  assert.equal(await readFile(path.join(f.data, "workbench.json"), "utf8"), "editing work");
  assert.equal(await exists(f.legacy), false);
  const journal = JSON.parse(await readFile(path.join(f.data, "migration.json"), "utf8"));
  assert.equal(journal.phase, "complete"); assert.deepEqual(journal.moved.sort(), ["notebook.json", "workbench.json"]);
});

test("external data parents, per-project folders and legacy assets refuse junction escapes", async () => {
  for (const kind of ["parent", "project", "legacy"]) {
    const f = await fixture(), outside = await mkdtemp(path.join(f.workspace, "outside-"));
    if (kind === "parent") await symlink(outside, path.join(f.workspace, ".paperfocus/project-data"), "junction");
    if (kind === "project") { await mkdir(path.dirname(f.data), { recursive: true }); await symlink(outside, f.data, "junction"); }
    if (kind === "legacy") { await mkdir(f.legacy); await symlink(outside, path.join(f.legacy, "experiments"), "junction"); }
    await assert.rejects(projectStorage(f.workspace, f.project.id), /symbolic links|junctions/);
    assert.deepEqual(await readdir(outside), []);
  }
});

test("identity and catalogue guards keep app storage outside a registered checkout and preserve corrupt files", async () => {
  const f = await fixture();
  assert.throws(() => projectDataPath(f.workspace, "../../outside"), /registered paper/);
  await mkdir(f.data, { recursive: true }); await writeFile(path.join(f.data, "project.json"), '{"version":');
  await assert.rejects(projectStorage(f.workspace, f.project.id));
  assert.equal(await readFile(path.join(f.data, "project.json"), "utf8"), '{"version":');
  await writeFile(path.join(f.workspace, "main.tex"), f.source);
  const home = await registerProject(f.workspace, f.workspace);
  await assert.rejects(projectStorage(f.workspace, home.id), /own subfolder/);
  assert.equal(await exists(projectDataPath(f.workspace, home.id)), false);
});

test("catalogue follows a renamed paper folder without duplicating or erasing its Aw data", async () => {
  const f = await fixture(); await writeNotebook(f.workspace, f.project.id, 0, []);
  const nextRoot = path.join(f.workspace, "renamed paper"); await rename(f.root, nextRoot);
  const list = await registry(f.workspace), entry = list.projects.find(p => p.id === f.project.id)!;
  entry.folder = "renamed paper"; entry.name = "New title"; await saveRegistry(f.workspace, list);
  assert.equal((await projectStorage(f.workspace, f.project.id)).folder, f.data);
  assert.equal((await readNotebook(f.workspace, f.project.id)).revision, 1);
  const record = JSON.parse(await readFile(path.join(f.data, "project.json"), "utf8"));
  assert.equal(record.name, "New title"); assert.equal(record.paperFolder, "renamed paper");
  assert.deepEqual(await readdir(nextRoot), ["main.tex"]);
});

test("full and focused LaTeX builds, cached references and source links work with external space-containing paths", async t => {
  const probe = spawnSync("latexmk", ["-v"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (probe.error || probe.status !== 0) { t.skip("latexmk is not available; external path unit tests still run"); return; }
  const f = await fixture(process.platform === "win32" ? 143 : 0); await mkdir(path.join(f.root, "sections"));
  await writeFile(path.join(f.root, "main.tex"), "\\documentclass[twocolumn]{article}\n\\usepackage{amsthm,hyperref}\n\\newtheorem{theorem}{Theorem}\n\\begin{document}\n\\include{sections/result}\n\\include{sections/context}\n\\end{document}\n");
  await writeFile(path.join(f.root, "sections/result.tex"), "\\section{Result}\nA source-linked paragraph.\n\n\\begin{theorem}\\label{result}\nFor every real $x$, $x^2 \\geq 0$.\n\\end{theorem}\n");
  await writeFile(path.join(f.root, "sections/context.tex"), "\\section{Context}\nTheorem~\\ref{result} is useful here.\n");
  const before = await parseProject(f.workspace, f.project.id);
  const full = await compile(f.workspace, { projectId: f.project.id, mode: "full", revision: before.revision });
  assert.equal(full.success, true, full.log);
  assert.equal((await compile(f.workspace, { projectId: f.project.id, mode: "full", revision: before.revision })).cacheHit, true);
  const section = before.nodes.find(node => node.title === "Context")!;
  const request = { projectId: f.project.id, mode: "focus" as const, revision: before.revision, focusNodeId: section.id, lens: "paper" as const };
  const focused = await compile(f.workspace, request); assert.equal(focused.success, true, focused.log);
  assert.match(focused.viewNote!, /last full build/);
  assert.doesNotMatch(focused.log, /Reference [`']result'[^\n]*undefined/);
  assert.equal((await compile(f.workspace, request)).cacheHit, true);
  let handler: any;
  (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  const pdfResponse: any = { setHeader() {}, end(bytes: Buffer) { this.bytes = bytes; } };
  await handler(Object.assign(Readable.from([]), { url: focused.pdfUrl, method: "GET", headers: { host: "127.0.0.1:4173" } }), pdfResponse, () => assert.fail("PDF route fell through"));
  assert.equal(pdfResponse.statusCode, 200);
  assert.equal(pdfResponse.bytes.subarray(0, 4).toString(), "%PDF");
  const invoke = async (body: object) => {
    const req = Object.assign(Readable.from([JSON.stringify(body)]), { url: "/api/paperfocus/source-sync", method: "POST", headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" } });
    const res: any = { setHeader() {}, end(text: string) { res.body = JSON.parse(text); } };
    await handler(req, res, () => assert.fail("Unexpected fallthrough")); assert.equal(res.statusCode, 200, JSON.stringify(res.body)); return res.body;
  };
  const paragraph = before.paragraphs.find(p => p.text.startsWith("Theorem~"))!;
  const forward = await invoke({ projectId: f.project.id, mode: "focus", artifactKey: focused.artifactKey, revision: before.revision, direction: "forward", paragraphId: paragraph.id });
  assert.ok(forward.page >= 1);
  const inverse = await invoke({ projectId: f.project.id, mode: "focus", artifactKey: focused.artifactKey, revision: before.revision, direction: "inverse", ...forward });
  assert.equal(inverse.paragraphId, paragraph.id);
  assert.deepEqual((await readdir(f.root)).sort(), ["main.tex", "sections"]);
  assert.deepEqual((await readdir(path.join(f.root, "sections"))).sort(), ["context.tex", "result.tex"]);
  assert.equal((await parseProject(f.workspace, f.project.id)).revision, before.revision);
  assert.equal((await getProject(f.workspace, f.project.id)).root, f.root);
});
