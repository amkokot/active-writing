import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { cellText, compactExperimentContext, experimentContext, experimentPlot, importExperimentNotebook, mergeExperimentNotebooks, newExperimentCell, newExperimentNotebook, validateExperimentNotebook } from "../src/experiments.ts";
import { cancelExperimentJob, experimentEtag, readExperimentJob, readExperiments, readExperimentsIfChanged, runExperiment, writeExperiments } from "./experiments.ts";
import { parseProject, registerProject } from "./projects.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { moveCatalogueItem } from "../src/notebookCatalogue.ts";
import { savedImageSize, removeCellImages, restoreCellImages } from "../src/experimentImages.ts";

test("cell reorder uses visible neighbors while preserving hidden cells and complete evidence",()=>{
  const nb=notebook(),hidden={...newExperimentCell("markdown"),metadata:{paperfocus:{filed:true}},source:"Filed notes"};
  const cells=[nb.cells[0],hidden,nb.cells[1]],moved=moveCatalogueItem(cells,nb.cells[0].id,nb.cells[1].id,false);
  assert.deepEqual(moved,[hidden,nb.cells[1],nb.cells[0]]);assert.equal(cells[0],nb.cells[0]);
  assert.equal(moveCatalogueItem(cells,"unknown",hidden.id),cells);
  validateExperimentNotebook({...nb,cells:moved});
});
test("image cleanup removes only PNG data, preserving text, code, alternatives, metadata and run identity",()=>{
  const cell=newExperimentCell("code");cell.outputs=[{output_type:"display_data",data:{"image/png":["YWJj","ZA=="],"text/plain":"Figure description","application/json":{value:3}}},{output_type:"stream",text:"Measurements"}];
  cell.execution_count=4;cell.metadata.paperfocus={runId:"run-one",lastRunAt:"today",lastRunSource:cellText(cell),pinned:true};
  assert.deepEqual(savedImageSize(cell),{count:1,bytes:4});
  const cleared=removeCellImages(cell);assert.equal(savedImageSize(cleared).count,0);assert.equal(cleared.source,cell.source);assert.equal(cleared.execution_count,4);
  assert.deepEqual(cleared.outputs![0].data,{"text/plain":"Figure description","application/json":{value:3}});assert.equal(cleared.outputs![1],cell.outputs[1]);assert.equal(cleared.metadata.paperfocus!.runId,"run-one");
  assert.equal(cell.outputs[0].data!["image/png"] instanceof Array,true);
  const restored=restoreCellImages({...cleared,source:"New code",metadata:{...cleared.metadata,paperfocus:{...cleared.metadata.paperfocus,folder:"New folder"}}},cell);
  assert.deepEqual(restored.outputs,cell.outputs);assert.equal(restored.source,"New code");assert.equal(restored.metadata.paperfocus!.folder,"New folder");
  assert.match(experimentContext({...newExperimentNotebook(),cells:[cleared]},"test"),/PNG images removed/);
});
test("image undo refuses new run outputs and unrelated cells",()=>{
  const cell=newExperimentCell("code");cell.outputs=[{output_type:"display_data",data:{"image/png":"YWJj"}}];
  const cleared=removeCellImages(cell);
  assert.throws(()=>restoreCellImages({...cleared,id:"another"},cell));
  assert.throws(()=>restoreCellImages({...cleared,outputs:[{output_type:"stream",text:"New run"}]},cell));
  assert.throws(()=>restoreCellImages({...cleared,metadata:{paperfocus:{runId:"new-run"}}},cell));
  assert.equal(removeCellImages(newExperimentCell("markdown")).cell_type,"markdown");
});

function notebook() { const nb = newExperimentNotebook(); nb.cells = [newExperimentCell("code"), newExperimentCell("markdown")]; return nb; }
async function fixture() {
  const base = path.resolve(".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "experiments-")), folder = path.join(workspace, "paper"); await mkdir(folder);
  await writeFile(path.join(folder, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Test}\nA result.\n\\end{document}\n");
  const project = await registerProject(workspace, "paper"); return { workspace, folder, project, notebookId: "research-one" };
}

test("image cleanup and catalogue order round-trip through guarded notebook storage",async()=>{
  const f=await fixture(),nb=notebook();
  nb.cells[0].outputs=[{output_type:"display_data",data:{"image/png":"YWJj","text/plain":"Retained description"}}];
  const saved=await writeExperiments(f.workspace,f.project.id,f.notebookId,"",nb);
  const cleared={...nb,cells:[nb.cells[1],removeCellImages(nb.cells[0])]};
  const next=await writeExperiments(f.workspace,f.project.id,f.notebookId,saved.revision,cleared);
  const read=await readExperiments(f.workspace,f.project.id,f.notebookId);
  assert.equal(read.revision,next.revision);assert.deepEqual(read.notebook,cleared);
  assert.equal(read.notebook.cells[1].metadata.paperfocus!.imagesCleared,true);
  const previous=JSON.parse(await readFile(next.path.replace("notebook.ipynb","notebook.previous.ipynb"),"utf8"));
  assert.equal(savedImageSize(previous.cells[0]).count,1);
  await assert.rejects(writeExperiments(f.workspace,f.project.id,f.notebookId,saved.revision,nb),/changed/);
});
test("standard Jupyter imports retain sources, outputs and metadata without execution", () => {
  const original = notebook(); original.cells[0].source = ["print('preserved')\n"]; original.cells[0].outputs = [{ output_type: "display_data", data: { "text/html": "<script>doNotRun()</script>", "text/plain": "Safe fallback" }, metadata: {} }];
  delete (original.cells[0] as { id?: string }).id;
  const imported = importExperimentNotebook(original); assert.ok(imported.cells[0].id); assert.equal(cellText(imported.cells[0]), "print('preserved')\n"); assert.deepEqual(imported.cells[0].outputs, original.cells[0].outputs); assert.equal(imported.cells[0].execution_count, null);
  assert.throws(() => importExperimentNotebook({ nbformat: 3 }));
  const nonPython = notebook(); nonPython.metadata = { language_info: { name: "julia" } }; assert.throws(() => importExperimentNotebook(nonPython), /Python only/);
  const duplicate = notebook(); duplicate.cells[1].id = duplicate.cells[0].id; assert.throws(() => validateExperimentNotebook(duplicate), /duplicate/);
  const invalid = notebook(); invalid.cells[0].metadata.paperfocus = [] as any; assert.throws(() => validateExperimentNotebook(invalid));
  invalid.cells[0].metadata = {}; invalid.cells[0].outputs = [{ output_type: "display_data", data: { "image/png": "<img>" } }]; assert.throws(() => validateExperimentNotebook(invalid), /PNG/);
});
test("experiment pins are persistent display metadata, not a change to agent relevance or execution", () => {
  const base = notebook(), local = structuredClone(base), remote = structuredClone(base);
  local.cells[0].metadata.paperfocus!.pinned = true;
  remote.cells[0].outputs = [{ output_type: "stream", text: "External experiment result" }];
  const merged = mergeExperimentNotebooks(base, local, remote);
  assert.equal(merged.cells[0].metadata.paperfocus!.pinned, true); assert.deepEqual(merged.cells[0].outputs, remote.cells[0].outputs);
  assert.equal(merged.cells[0].execution_count, null);
  assert.equal(experimentContext(local, "owner"), experimentContext(base, "owner"));
  assert.equal(importExperimentNotebook(merged).cells[0].metadata.paperfocus!.pinned, true); validateExperimentNotebook(merged);
  merged.cells[0].metadata.paperfocus!.pinned = "yes" as any; assert.throws(() => validateExperimentNotebook(merged), /metadata/);
});
test("experiment context omits filed/trash, prioritizes highlights and identifies stale output", () => {
  const nb = notebook(); nb.cells[0].source = "new code"; nb.cells[0].metadata.paperfocus = { title: "Highlighted finding", highlighted: true, suppressed: true, lastRunSource: "old code" }; nb.cells[0].outputs = [{ output_type: "stream", text: "numeric-only evidence" }];
  nb.cells[1].metadata.paperfocus = { filed: true }; nb.cells[1].source = "secret-filed-not-in-packet";
  const trashed = newExperimentCell("markdown"); trashed.source = "secret-trash-not-in-packet"; trashed.metadata.paperfocus = { deleted: true }; nb.cells.push(trashed);
  const context = experimentContext(nb, "research-one"); assert.match(context, /not proof|not.*proof/i); assert.match(context, /output from earlier code/); assert.match(context, /Highlighted finding/); assert.doesNotMatch(context, /secret-/); assert.ok(context.length <= 6000);
});

test("bounded local experiment context shares results across cells before source code", () => {
  const nb = newExperimentNotebook();
  for (let i=0;i<6;i++) {
    const cell=newExperimentCell("code");cell.id=`check-${i}`;cell.source="# code that should not displace results\n".repeat(200);
    cell.metadata.paperfocus={title:`Check ${i}`+" verbose title".repeat(40),folder:"long folder".repeat(20),lastRunSource:cellText(cell),lastRunAt:"now"};
    cell.outputs=[{output_type:"stream",text:`MEASURED_${i}: residual=${i}.001; local evidence only.\n`+"verbose output\n".repeat(300)}];
    nb.cells.push(cell);
  }
  nb.cells[4].metadata.paperfocus!.lastRunSource="old code";
  nb.cells[5].outputs!.push({output_type:"error",ename:"AssertionError",evalue:"negative control"});
  const full=experimentContext(nb,"multi-cell"), local=compactExperimentContext(full);
  assert.ok(full.length<=6000);assert.ok(local.length<=1800);
  for(let i=0;i<6;i++) assert.match(local,new RegExp(`MEASURED_${i}`));
  assert.match(local,/earlier code/);assert.match(local,/failed run/);assert.doesNotMatch(local,/# code/);
  assert.ok(compactExperimentContext("legacy".repeat(1000)).length<=1800);
  const tiny=compactExperimentContext(full,650);assert.ok(tiny.length<=650);
  for(let i=0;i<6;i++)assert.match(tiny,new RegExp(`MEASURED_${i}`));
});
test("independent agent outputs merge with author notes and catalogue edits; competing code never guesses", () => {
  const base = notebook(), local = structuredClone(base), remote = structuredClone(base);
  local.cells[0].metadata.paperfocus!.highlighted = true; local.cells[1].source = "Author reasoning";
  remote.cells[0].outputs = [{ output_type: "stream", text: "Agent calculation" }]; remote.cells[0].metadata.paperfocus!.lastRunSource = cellText(remote.cells[0]);
  const merged = mergeExperimentNotebooks(base, local, remote); assert.equal(merged.cells[0].metadata.paperfocus!.highlighted, true); assert.equal(merged.cells[1].source, "Author reasoning"); assert.deepEqual(merged.cells[0].outputs, remote.cells[0].outputs);
  local.cells[0].source = "Local code"; remote.cells[0].source = "Agent code"; assert.throws(() => mergeExperimentNotebooks(base, local, remote), /same experiment field/);
  const clean = structuredClone(base); clean.cells.reverse(); assert.equal(mergeExperimentNotebooks(base, clean, base).cells[0].id, clean.cells[0].id);
  const inserted = structuredClone(base), added = newExperimentCell("markdown"); inserted.cells.unshift(added);
  const notesOnly = structuredClone(base); notesOnly.cells[1].source = "Local note";
  assert.equal(mergeExperimentNotebooks(base, notesOnly, inserted).cells[0].id, added.id, "agent insertion stays before its anchor");
});
test("plots reject executable/non-numeric payloads and bound display complexity", () => {
  const valid = { title: "Trial", xLabel: "x", yLabel: "y", series: [{ name: "Curve", points: [[0, 1], [1, 2]] }] };
  assert.deepEqual(experimentPlot(valid), valid); assert.equal(experimentPlot({ ...valid, series: [{ name: "Bad", points: [[0, Infinity]] }] }), undefined);
  assert.equal(experimentPlot({ ...valid, series: [null] }), undefined);
  assert.equal(experimentPlot({ ...valid, series: [{ name: "Huge", points: Array.from({ length: 2001 }, () => [0, 1]) }] }), undefined);
});
test("experiment persistence is revision guarded, backed up and excluded from TeX source revisions", async () => {
  const f = await fixture(), before = await parseProject(f.workspace, f.project.id);
  const empty = await readExperiments(f.workspace, f.project.id, f.notebookId); assert.equal(empty.revision, "");
  const nb = notebook(), first = await writeExperiments(f.workspace, f.project.id, f.notebookId, "", nb);
  nb.cells[1].source = "Saved reasoning"; const second = await writeExperiments(f.workspace, f.project.id, f.notebookId, first.revision, nb);
  assert.equal((await readExperiments(f.workspace, f.project.id, f.notebookId)).revision, second.revision);
  assert.deepEqual(JSON.parse(await readFile(path.join(path.dirname(first.path), "notebook.previous.ipynb"), "utf8")), first.notebook);
  await assert.rejects(writeExperiments(f.workspace, f.project.id, f.notebookId, first.revision, notebook()), /changed/);
  assert.equal((await parseProject(f.workspace, f.project.id)).revision, before.revision);
  await assert.rejects(readExperiments(f.workspace, f.project.id, "../escape"), /Invalid/);
  await writeFile(first.path, "{broken"); await assert.rejects(writeExperiments(f.workspace, f.project.id, f.notebookId, second.revision, nb)); assert.equal(await readFile(first.path, "utf8"), "{broken");
});
test("junction escapes and missing/foreign Origin experiment writes are rejected", async () => {
  const f = await fixture(), outside = path.join(f.workspace, "outside"); await mkdir(outside); await symlink(outside, path.join(f.folder, ".paperfocus"), "junction");
  await assert.rejects(readExperiments(f.workspace, f.project.id, f.notebookId), /symbolic|junction/);
  let handler: any; (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  for (const origin of [undefined, "https://unrelated.example"]) {
    const req = Object.assign(Readable.from([JSON.stringify({ projectId: f.project.id, notebookId: f.notebookId })]), { url: "/api/paperfocus/experiments/run", method: "POST", headers: { host: "127.0.0.1:4173", ...(origin ? { origin } : {}) } });
    const res: any = { setHeader() {}, end(raw: string) { res.body = JSON.parse(raw); } }; await handler(req, res, () => assert.fail("unexpected fallthrough")); assert.equal(res.statusCode, 403);
  }
});
test("conditional experiment polls skip unchanged payloads but detect byte changes, deletion and invalid agent edits", async () => {
  const f = await fixture();
  assert.equal(await readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag("")), undefined);
  const stored = await writeExperiments(f.workspace, f.project.id, f.notebookId, "", notebook());
  assert.equal(await readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag(stored.revision)), undefined);
  const edited = structuredClone(stored.notebook); edited.cells[1].source = "Agent edit";
  await writeFile(stored.path, JSON.stringify(edited));
  const changed = await readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag(stored.revision));
  assert.equal(changed?.notebook.cells[1].source, "Agent edit"); assert.notEqual(changed?.revision, stored.revision);
  // Same-size/different-content updates must not be hidden by a timestamp cache.
  edited.cells[1].source = "Other edit"; await writeFile(stored.path, JSON.stringify(edited));
  assert.equal((await readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag(changed!.revision)))?.notebook.cells[1].source, "Other edit");
  await rename(stored.path, `${stored.path}.retained`);
  assert.equal((await readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag(changed!.revision)))?.revision, "", "removed file is detected, not an unchanged reply");
  await rename(`${stored.path}.retained`, stored.path);
  await writeFile(stored.path, "{broken");
  await assert.rejects(readExperimentsIfChanged(f.workspace, f.project.id, f.notebookId, experimentEtag(changed!.revision)));
  assert.equal(await readFile(stored.path, "utf8"), "{broken", "invalid external file preserved");
});
test("experiment HTTP ETags return an empty 304 only for the current exact revision", async () => {
  const f = await fixture(), store = await writeExperiments(f.workspace, f.project.id, f.notebookId, "", notebook());
  let handler: any; (latexPlugin(f.workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  for (const tag of [undefined, experimentEtag(store.revision), '"old"']) {
    const req = Object.assign(Readable.from([]), { url: `/api/paperfocus/experiments?projectId=${f.project.id}&notebookId=${f.notebookId}`, method: "GET", headers: { host: "127.0.0.1:4173", ...(tag ? { "if-none-match": tag } : {}) } });
    const headers: Record<string, string> = {}, res: any = { setHeader(key: string, value: string) { headers[key] = value; }, end(raw?: string) { res.body = raw ?? ""; } };
    await handler(req, res, () => assert.fail("unexpected fallthrough"));
    assert.equal(headers.ETag, experimentEtag(store.revision)); assert.equal(headers["Cache-Control"], "no-store");
    if (tag === experimentEtag(store.revision)) { assert.equal(res.statusCode, 304); assert.equal(res.body, ""); }
    else { assert.equal(res.statusCode, 200); assert.deepEqual(JSON.parse(res.body).notebook, store.notebook); }
  }
});
async function finished(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  for (let i = 0; i < 160; i++) { const job = await readExperimentJob(f.workspace, f.project.id, f.notebookId, id); if (job.status !== "working") return job; await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.fail("Python cell did not complete within test budget");
}
test("explicit Python execution keeps plots/tables and merges results without overwriting code edited while running", async () => {
  const f = await fixture(), nb = notebook(); nb.cells[0].source = "import time, numpy as np\ntime.sleep(0.2)\nprint(np.sum([1, 2, 3]))\ndisplay_plot('Curve', [{'name':'n', 'points':[[0,1],[1,2]]}])\ndisplay_table([{'sum':6}])";
  const first = await writeExperiments(f.workspace, f.project.id, f.notebookId, "", nb);
  await assert.rejects(runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, first.revision, false), /permission/);
  await assert.rejects(runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, "stale", true), /Save the cell and check outside edits/);
  const job = await runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, first.revision, true);
  await assert.rejects(runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, first.revision, true), /Another/);
  nb.cells[0].source = "print('Author revision')"; nb.cells[0].metadata.paperfocus!.highlighted = true;
  await writeExperiments(f.workspace, f.project.id, f.notebookId, first.revision, nb);
  assert.equal((await finished(f, job.id)).status, "ready");
  const stored = await readExperiments(f.workspace, f.project.id, f.notebookId), cell = stored.notebook.cells[0];
  assert.equal(cell.source, "print('Author revision')"); assert.equal(cell.metadata.paperfocus!.highlighted, true); assert.match(cell.metadata.paperfocus!.lastRunSource!, /numpy/); assert.equal(cell.outputs!.length, 3);
  assert.match(experimentContext(stored.notebook, f.notebookId), /earlier code/);
  const record = JSON.parse(await readFile(path.join(path.dirname(stored.path), "runs", `${job.id}.json`), "utf8")); assert.equal(record.source, cell.metadata.paperfocus!.lastRunSource); assert.equal(record.outputs.length, 3);
});
test("Python errors and cancellation are retained and do not auto-run a second cell", async () => {
  const f = await fixture(), nb = notebook(); nb.cells[0].source = "raise ValueError('negative control')";
  let saved = await writeExperiments(f.workspace, f.project.id, f.notebookId, "", nb);
  let job = await runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, saved.revision, true); assert.equal((await finished(f, job.id)).status, "failed");
  saved = await readExperiments(f.workspace, f.project.id, f.notebookId); assert.equal(saved.notebook.cells[0].outputs![0].ename, "ValueError");
  saved.notebook.cells[0].source = "import time\ntime.sleep(10)"; saved = await writeExperiments(f.workspace, f.project.id, f.notebookId, saved.revision, saved.notebook);
  job = await runExperiment(f.workspace, f.project.id, f.notebookId, nb.cells[0].id, saved.revision, true); await cancelExperimentJob(f.workspace, f.project.id, f.notebookId, job.id);
  // Cancellation status is immediate; wait for the saved completion record rather than starting more work.
  for (let i = 0; i < 80; i++) { const result = await readExperiments(f.workspace, f.project.id, f.notebookId); if (result.notebook.cells[0].metadata.paperfocus?.runId === job.id) { assert.equal(result.notebook.cells[0].outputs![0].ename, "ExecutionError"); return; } await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.fail("Cancelled result was not retained");
});
