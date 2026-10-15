import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { desktopServer } from "../scripts/desktopServer.mjs";
import { researchCommand, researchOptions } from "../scripts/awResearch.ts";
import { researchPhase } from "./researchPhase.ts";
import { registerProject } from "./projects.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { readExperiments, writeExperiments } from "./experiments.ts";
import { newExperimentCell, newExperimentNotebook } from "../src/experiments.ts";
import { experimentAgentInstructions } from "../src/researchInstructions.ts";
import type { NotebookEntry } from "../src/types.ts";

test("phase flags require explicit scope/revision/handoff and copied instructions teach versioning", () => {
  const args = ["phase", "--workspace", process.cwd(), "--project", "paper", "--entry", "owner"];
  assert.throws(() => researchOptions(args), /revision/);
  assert.throws(() => researchOptions([...args, "--revision", "missing"]), /title/);
  assert.equal(researchOptions([...args, "--revision", "missing", "--title", "Next", "--file", "handoff.md", "--folder", "Earlier", "--commit"]).flags.commit, "true");
  assert.throws(() => researchOptions(["inspect", ...args.slice(1), "--commit"]), /does not apply/);
  assert.match(experimentAgentInstructions({ origin: "http://127.0.0.1:4173", workspace: process.cwd(), projectId: "paper", entryId: "owner", notebookId: "owner", path: "nb" }), /Version substantial research phases/);
});

test("phase plans read-only, preserves all old evidence, retries safely and never edits manuscripts", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/phase-test-"));
  await mkdir(path.join(workspace, "paper"));
  const tex = "\\documentclass{article}\n\\begin{document}Human manuscript.\\end{document}";
  await writeFile(path.join(workspace, "paper/main.tex"), tex);
  const project = await registerProject(workspace, "paper"), now = new Date().toISOString();
  const entry: NotebookEntry = { id: "conversation", experimentNotebookId: "owner", manuscriptFile: "main.tex", title: "Earlier proof", question: "Q", notes: "Human notes", reply: "Retained reply", proposal: "", status: "parked", route: "codex", effort: 1, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  const unrelated = { ...entry, id: "unrelated", experimentNotebookId: "independent", notes: "Never change" };
  await writeNotebook(workspace, project.id, 0, [entry, unrelated]);
  const notebook = newExperimentNotebook();
  const cell = newExperimentCell("code"); cell.id = "exact-proof-control"; cell.source = "raise Exception('NEVER RUN')";
  cell.outputs = [{ output_type: "stream", text: "Saved evidence" }]; cell.metadata.paperfocus = { filed: true, deleted: true, runId: "retained" };
  notebook.cells = [cell];
  const old = await writeExperiments(workspace, project.id, "owner", "", notebook);
  const originalBytes = await readFile(old.path);
  const handoff = path.join(workspace, "handoff.md"); await writeFile(handoff, "## Next phase\nProved: conditional identity. Open: sparse regime. Evidence: exact-proof-control.");
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const scope = ["--url", origin, "--workspace", workspace, "--project", project.id, "--entry", entry.id];
  const phase = ["phase", ...scope, "--revision", old.revision, "--title", "Sparse phase v2", "--file", handoff];
  try {
    const inspected = await researchCommand(["inspect", ...scope]);
    assert.equal(inspected.storage.diskBytes, originalBytes.length);
    const plan = await researchCommand(phase); assert.equal(plan.committed, false);
    assert.equal((await readNotebook(workspace, project.id)).entries.length, 2);
    await assert.rejects(readdir(plan.backupPath), /ENOENT/);
    await assert.rejects(researchCommand(phase.map(value => value === old.revision ? "0".repeat(64) : value)), /Notebook changed/);

    // Fail after preparation, before the guarded catalogue commit. Retrying must reuse the prepared notebook.
    let failCommit = true;
    const request = async (endpoint: string, body?: unknown) => {
      if (endpoint === "notebook" && body && failCommit) { failCommit = false; throw new Error("Simulated interruption"); }
      const response = await fetch(`${origin}/api/paperfocus/${endpoint}`, body === undefined ? {} : { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
    };
    const conversations = await readNotebook(workspace, project.id);
    const flags = researchOptions([...phase, "--commit"]).flags;
    await assert.rejects(researchPhase({ flags, origin, workspace, entry, conversations, store: old, request }), /Simulated interruption/);
    assert.equal((await readNotebook(workspace, project.id)).entries[0].filed, undefined);
    const prepared = await readExperiments(workspace, project.id, plan.notebookId);
    const edited = structuredClone(prepared.notebook); edited.cells[0].source = "Human edits during recovery";
    const editedStore = await writeExperiments(workspace, project.id, plan.notebookId, prepared.revision, edited);
    await assert.rejects(researchCommand([...phase, "--commit"]), /fresh notebook was edited/);
    assert.equal((await readExperiments(workspace, project.id, plan.notebookId)).notebook.cells[0].source, edited.cells[0].source);
    // Restore only this isolated fixture to verify an unchanged interrupted preparation can resume.
    await writeExperiments(workspace, project.id, plan.notebookId, editedStore.revision, prepared.notebook);
    const saved = await researchCommand([...phase, "--commit"]); assert.equal(saved.committed, true); assert.equal(saved.reused, false);
    assert.deepEqual(await readFile(old.path), originalBytes);
    assert.deepEqual(await readFile(path.join(saved.backupPath, "notebook.ipynb")), originalBytes);
    assert.deepEqual(JSON.parse(await readFile(path.join(saved.backupPath, "conversation.json"), "utf8")), entry);
    const catalogue = await readNotebook(workspace, project.id);
    assert.equal(catalogue.entries.find(item => item.id === saved.entryId)?.manuscriptFile, "main.tex");
    assert.deepEqual(catalogue.entries[1], unrelated);
    const archived = { ...catalogue.entries[0] }; delete archived.filed; delete archived.folder; archived.updatedAt = entry.updatedAt;
    assert.deepEqual(archived, entry);
    const fresh = await readExperiments(workspace, project.id, saved.notebookId);
    assert.equal(fresh.notebook.cells.length, 2); assert.equal(fresh.notebook.cells[0].id, "phase-handoff");
    assert.match(String(fresh.notebook.cells[1].source), /awNotebook=conversation/);
    assert.equal(fresh.notebook.cells.some(item => item.cell_type === "code"), false);
    fresh.notebook.cells[0].source = "Later scientific progress";
    const later = await writeExperiments(workspace, project.id, saved.notebookId, fresh.revision, fresh.notebook);
    // Human restoration is not undone by an idempotent retry.
    catalogue.entries[0].filed = false; await writeNotebook(workspace, project.id, catalogue.revision, catalogue.entries);
    const reused = await researchCommand([...phase, "--commit"]); assert.equal(reused.reused, true); assert.equal(reused.revision, later.revision);
    assert.equal((await readNotebook(workspace, project.id)).entries[0].filed, false);
    assert.equal(await readFile(path.join(workspace, "paper/main.tex"), "utf8"), tex);
    const redirected = phase.map(value => value === "Sparse phase v2" ? "Redirected phase" : value);
    const redirectPlan = await researchCommand(redirected);
    const outsideBackup = path.join(workspace, "redirect-target"); await mkdir(outsideBackup);
    await symlink(outsideBackup, redirectPlan.backupPath, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(researchCommand([...redirected, "--commit"]), /symlinks or junctions/);
    assert.deepEqual(await readdir(outsideBackup), []);
    await writeFile(path.join(saved.backupPath, "conversation.json"), "damaged");
    await assert.rejects(researchCommand([...phase, "--commit"]), /backup is damaged/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("phase refuses pending requests, shared owners and running jobs before writing", async () => {
  // The growing agent guide is not a bounded handoff fixture: its size can mask
  // the ownership/run rejection that this test is meant to exercise.
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/phase-guards-")), now = new Date().toISOString();
  const file = path.join(workspace, "handoff.md"); await writeFile(file, "Next phase: preserve evidence and inspect the open gap.");
  const entry: NotebookEntry = { id: "owner", title: "Old", question: "", notes: "", reply: "", proposal: "", status: "open", route: "codex", effort: 1, handoffs: [], appliedChanges: [], createdAt: now, updatedAt: now };
  const store = { path: "unused", revision: "rev", notebook: newExperimentNotebook(), runtime: { activeJobs: [{ projectId: "paper", notebookId: "owner" }] } };
  const flags = { project: "paper", revision: "rev", title: "Next", file, commit: "true" };
  const request = async (endpoint: string, body?: unknown) => { assert.equal(body, undefined); assert.match(endpoint, /workspace-folders/); return { data: { path: workspace }, paper: { path: workspace } }; };
  const input = { flags, origin: "http://127.0.0.1:4173", workspace, entry, conversations: { revision: 0, entries: [entry] }, store, request };
  await assert.rejects(researchPhase(input), /running job/);
  await assert.rejects(researchPhase({ ...input, conversations: { revision: 0, entries: [entry, { ...entry, id: "alias", experimentNotebookId: "owner" }] } }), /multiple conversation owners/);
  const pending = { ...entry, study: { mode: "understand" as const, depth: "intuition" as const, action: "explain" as const, background: "", localEffort: 1, turns: [{ id: "task", status: "queued" as const, route: "codex" as const, action: "explain" as const, depth: "intuition" as const, packet: "Pending", reply: "", createdAt: now }] } };
  await assert.rejects(researchPhase({ ...input, entry: pending }), /pending research/);
});
