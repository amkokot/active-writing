import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, symlink, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { registerProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { saveEvidenceSnapshot, readEvidenceFile } from "./experimentEvidence.ts";
import { experimentEvidence, experimentEvidenceText } from "../src/experimentEvidence.ts";
import { newExperimentNotebook, newExperimentCell } from "../src/experiments.ts";
import { desktopServer } from "../scripts/desktopServer.mjs";
import { researchCommand, researchOptions } from "../scripts/awResearch.ts";
import { saveFreshExperimentEvidence } from "../src/freshExperimentContext.ts";
import { registerExperimentDraft } from "../src/experimentDrafts.ts";

async function fixture() {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/evidence-check-"));
  await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\\begin{document}Test.\\end{document}");
  const project = await registerProject(workspace, "paper"), conversations = await readNotebook(workspace, project.id), now = new Date().toISOString();
  const entry = { id: "conversation", experimentNotebookId: "owner", title: "Snapshot trial", question: "Keep", notes: "Human", reply: "", proposal: "", status: "open", route: "local", effort: 0, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  await writeNotebook(workspace, project.id, conversations.revision, [entry]);
  const nb = newExperimentNotebook();
  nb.cells = [
    { ...newExperimentCell("code"), id: "code", source: "print('new')", outputs: [{ output_type: "stream", text: "COMPLETE_END " + "data ".repeat(5000) }, { output_type: "display_data", data: { "application/json": [{ exact: 1.234567890123456 }], "text/markdown": "$$x^2$$", "text/html": "<script>no()</script>" } }], metadata: { paperfocus: { lastRunSource: "old", suppressed: true } } },
    { ...newExperimentCell("markdown"), id: "hidden", source: "HIDDEN_ACTIVE", metadata: { paperfocus: { suppressed: true } } },
    { ...newExperimentCell("markdown"), id: "filed", source: "EXCLUDED_FILED", metadata: { paperfocus: { filed: true } } },
    { ...newExperimentCell("markdown"), id: "trash", source: "EXCLUDED_TRASH", metadata: { paperfocus: { deleted: true } } },
  ];
  const store = await writeExperiments(workspace, project.id, "owner", "", nb);
  return { workspace, projectId: project.id, entry, store };
}

test("complete text handles fences and long evidence without executing rich output or clipping", () => {
  const nb = newExperimentNotebook(); nb.cells = [{ ...newExperimentCell("raw"), id: "raw", source: "`a".repeat(49990) }];
  const text = experimentEvidenceText(experimentEvidence({ notebook: nb, revision: "a".repeat(64), path: "private" }, { projectId: "p", entryId: "e", notebookId: "n" }));
  assert.ok(text.includes(nb.cells[0].source as string)); assert.doesNotMatch(text, /private/);
  nb.cells[0].source = "```inject\n``````";
  assert.match(experimentEvidenceText(experimentEvidence({ notebook: nb, revision: "a".repeat(64), path: "" }, { projectId: "p", entryId: "e", notebookId: "n" })), /```````raw/);
});

test("snapshots are complete, owner/revision guarded, immutable and concurrent retries reuse files", async () => {
  const { workspace, projectId, store, entry } = await fixture();
  const args = [workspace, projectId, entry.id, "owner", store.revision] as const;
  await assert.rejects(saveEvidenceSnapshot(workspace, projectId, "missing", "owner", store.revision), /another conversation/);
  await assert.rejects(saveEvidenceSnapshot(workspace, projectId, entry.id, "other", store.revision), /another conversation/);
  await assert.rejects(saveEvidenceSnapshot(workspace, projectId, entry.id, "owner", "b".repeat(64)), /changed/);
  const [a, b] = await Promise.all([saveEvidenceSnapshot(...args), saveEvidenceSnapshot(...args)]);
  assert.deepEqual(a, b); assert.equal(a.activeCells, 2); assert.equal(a.excludedCells, 2);
  assert.deepEqual(await saveEvidenceSnapshot(...args), a);
  const raw = await readFile(a.files.text.path, "utf8"), nb = JSON.parse(await readFile(a.files.notebook.path, "utf8"));
  assert.match(raw, /HIDDEN_ACTIVE/); assert.ok(raw.includes(store.notebook.cells[0].outputs![0].text as string));
  assert.match(raw, /1.234567890123456/); assert.match(raw, /not executed/); assert.doesNotMatch(raw, /EXCLUDED_FILED|EXCLUDED_TRASH|<script>/);
  assert.equal(nb.cells.length, 2); assert.match(nb.cells[0].metadata.paperfocus_evidence.staleReason, /code changed/);
  assert.equal((await readExperiments(workspace, projectId, "owner")).revision, store.revision);
  assert.deepEqual((await readNotebook(workspace, projectId)).entries, [entry]);
  await assert.rejects(readEvidenceFile(workspace, projectId, "other", a.id, "text"));
  await assert.rejects(readEvidenceFile(workspace, projectId, "owner", "../escape", "text"), /identity/);
  await assert.rejects(readEvidenceFile(workspace, projectId, "owner", a.id, "manifest"), /Choose/);
  await writeFile(a.files.text.path, "Changed externally");
  await assert.rejects(readEvidenceFile(workspace, projectId, "owner", a.id, "text"), /changed/);
  await assert.rejects(saveEvidenceSnapshot(...args), /changed/);
  assert.equal(await readFile(a.files.text.path, "utf8"), "Changed externally");
});

test("evidence refuses linked storage folders", async () => {
  const { workspace, projectId, entry, store } = await fixture();
  const target = path.join(workspace, "linked"); await mkdir(target);
  await symlink(target, path.join(path.dirname(store.path), "evidence"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(saveEvidenceSnapshot(workspace, projectId, entry.id, "owner", store.revision), /links|junction/);
});

test("interrupted identical files recover but incomplete committed snapshots and differing files are preserved", async () => {
  const { workspace, projectId, store, entry } = await fixture();
  const args = [workspace, projectId, entry.id, "owner", store.revision] as const;
  const id = createHash("sha256").update(JSON.stringify(["evidence-v1", projectId, entry.id, "owner", store.revision])).digest("hex");
  const target = path.join(path.dirname(store.path), "evidence", id); await mkdir(target, { recursive: true });
  const evidence = experimentEvidence(store, { projectId, entryId: entry.id, notebookId: "owner" });
  await writeFile(path.join(target, "evidence.ipynb"), JSON.stringify(evidence.notebook, null, 2));
  const snapshot = await saveEvidenceSnapshot(...args);
  assert.match(await readFile(snapshot.files.text.path, "utf8"), /HIDDEN_ACTIVE/);
  await rename(snapshot.files.text.path, path.join(target, "evidence-retained.md"));
  await assert.rejects(saveEvidenceSnapshot(...args), /incomplete/);
  assert.match(await readFile(path.join(target, "evidence-retained.md"), "utf8"), /HIDDEN_ACTIVE/);
  const other = await fixture(), otherId = createHash("sha256").update(JSON.stringify(["evidence-v1", other.projectId, other.entry.id, "owner", other.store.revision])).digest("hex");
  const otherTarget = path.join(path.dirname(other.store.path), "evidence", otherId); await mkdir(otherTarget, { recursive: true });
  await writeFile(path.join(otherTarget, "evidence.ipynb"), "Different partial file");
  await assert.rejects(saveEvidenceSnapshot(other.workspace, other.projectId, other.entry.id, "owner", other.store.revision), /different content/);
  assert.equal(await readFile(path.join(otherTarget, "evidence.ipynb"), "utf8"), "Different partial file");
});

test("HTTP downloads match saved hashes and CLI cannot mix workspaces or stale evidence", async () => {
  const { workspace, projectId, store } = await fixture(), server = desktopServer(workspace);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const args = ["--url", origin, "--workspace", workspace, "--project", projectId, "--entry", "conversation"];
  try {
    assert.throws(() => researchOptions(["evidence", ...args]), /revision/);
    await assert.rejects(researchCommand(["evidence", ...args, "--revision", "b".repeat(64)]), /changed/);
    const { snapshot } = await researchCommand(["evidence", ...args, "--revision", store.revision]);
    for (const format of ["notebook", "text"] as const) {
      const response = await fetch(origin + snapshot.files[format].url);
      assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition")!, /attachment; filename=/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash("sha256").update(data).digest("hex"), snapshot.files[format].sha256);
      assert.deepEqual(data, await readFile(snapshot.files[format].path));
    }
    const rejected = await fetch(origin + "/api/paperfocus/experiments/evidence", { method: "POST", headers: { Origin: "https://elsewhere.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ projectId, entryId: "conversation", notebookId: "owner", revision: store.revision }) });
    assert.equal(rejected.status, 403);
    await assert.rejects(researchCommand(["evidence", ...args.map(v => v === workspace ? path.join(workspace, "paper") : v), "--revision", store.revision]), /Wrong Aw workspace/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("client flushes drafts before snapshot and rejects wrong owners or failed preparation", async () => {
  const nb = newExperimentNotebook(), revision = "a".repeat(64), entry = { id: "entry", experimentNotebookId: "owner" } as any;
  let flushed = false, calls = 0;
  const unregister = registerExperimentDraft("paper", "owner", async () => { flushed = true; });
  try {
    const request = (async (url: string, options?: RequestInit) => {
      assert.equal(flushed, true); calls++;
      if (!options?.body) return new Response(JSON.stringify({ notebook: nb, revision }));
      assert.deepEqual(JSON.parse(options.body as string), { projectId: "paper", entryId: "entry", notebookId: "owner", revision });
      return new Response(JSON.stringify({ projectId: "other", entryId: "entry", notebookId: "owner", revision, id: revision }));
    }) as typeof fetch;
    await assert.rejects(saveFreshExperimentEvidence(entry, "paper", request), /another notebook/); assert.equal(calls, 2);
    await assert.rejects(saveFreshExperimentEvidence(entry, "paper", (async (_url, options) => options?.body ? new Response("not found", { status: 404 }) : new Response(JSON.stringify({ notebook: nb, revision }))) as typeof fetch), /Restart/);
  } finally { unregister(); }
});
