import assert from "node:assert/strict";
import { test } from "node:test";
import { loadDocument } from "../src/loadDocument.ts";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { activityOrderedProjects } from "./projectActivity.ts";
import { registerProject, registry, saveRegistry } from "./projects.ts";
import { selectProject } from "./repositories.ts";

test("project activity combines external source and Aw records without promoting builds or changing selection", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/project-activity-"));
  const source = "\\documentclass{article}\n\\begin{document}Original prose.\\end{document}";
  for (const name of ["first", "second"]) {
    await mkdir(path.join(workspace, name)); await writeFile(path.join(workspace, name, "main.tex"), source);
    await utimes(path.join(workspace, name, "main.tex"), new Date("2001-01-01"), new Date("2001-01-01"));
  }
  const first = await registerProject(workspace, "first"), second = await registerProject(workspace, "second");
  const entries = await registry(workspace); entries.activeId = first.id;
  entries.projects = entries.projects.filter(project => [first.id, second.id].includes(project.id));
  entries.projects.forEach(project => { project.createdAt = "2000-01-01T00:00:00Z"; });
  entries.projects.push({ id: "unavailable", name: "Unavailable", folder: "missing", mainFile: "main.tex", createdAt: "1999-01-01T00:00:00Z" });
  await saveRegistry(workspace, entries);
  const registryFile = path.join(workspace, ".paperfocus/projects.json"), before = await readFile(registryFile, "utf8");
  assert.deepEqual((await activityOrderedProjects(workspace)).projects.map(p => p.id), [first.id, second.id, "unavailable"], "ties keep registry order");
  await writeFile(path.join(workspace, "second/appendix.tex"), "External edit");
  await utimes(path.join(workspace, "second/appendix.tex"), new Date("2002-01-01"), new Date("2002-01-01"));
  assert.equal((await activityOrderedProjects(workspace)).projects[0].id, second.id);
  const data = path.join(workspace, ".paperfocus/project-data", first.id);
  await mkdir(path.join(data, "experiments/thread"), { recursive: true });
  await writeFile(path.join(data, "experiments/thread/notebook.ipynb"), "Saved experiment");
  await utimes(path.join(data, "experiments/thread/notebook.ipynb"), new Date("2003-01-01"), new Date("2003-01-01"));
  assert.equal((await activityOrderedProjects(workspace)).projects[0].id, first.id);
  const otherData = path.join(workspace, ".paperfocus/project-data", second.id);
  await mkdir(path.join(otherData, "build/full"), { recursive: true });
  await writeFile(path.join(otherData, "build/full/compile.json"), "Generated");
  await writeFile(path.join(otherData, "project.json"), "Read-time catalogue");
  await writeFile(path.join(workspace, "second/main.pdf"), "Compiled PDF");
  await writeFile(path.join(workspace, "second/main.aux"), "TeX bookkeeping");
  await mkdir(path.join(workspace, "second/.venv")); await writeFile(path.join(workspace, "second/.venv/probe.py"), "Cache");
  const ordered = await activityOrderedProjects(workspace);
  assert.equal(ordered.projects[0].id, first.id, "builds, generated root PDFs, catalogues and caches don't count");
  assert.equal(ordered.activeId, first.id); assert.equal(await readFile(registryFile, "utf8"), before, "listing is read-only");
  assert.equal(await readFile(path.join(workspace, "first/main.tex"), "utf8"), source);
  await writeFile(path.join(workspace, "second/notes.md"), "External research note");
  assert.equal((await activityOrderedProjects(workspace)).projects[0].id, second.id, "metadata is freshly checked on later lists");
  await selectProject(workspace, first.id);
  assert.ok((await registry(workspace)).projects.find(project => project.id === first.id)?.lastOpenedAt);
  assert.equal((await activityOrderedProjects(workspace)).projects[0].id, first.id, "opening a paper is activity too");
  assert.equal(await readFile(path.join(workspace, "first/main.tex"), "utf8"), source);
});

test("concurrent startup reads share one fetch; later reads never reuse an old document", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  const resolvers: Array<(response: Response) => void> = [];
  globalThis.fetch = (() => { calls++; return new Promise<Response>(resolve => { resolvers.push(resolve); }); }) as typeof fetch;
  const first = loadDocument("/startup-one"), strictReplay = loadDocument("/startup-one"), anotherPaper = loadDocument("/startup-other");
  assert.equal(first, strictReplay); assert.equal(calls, 2);
  resolvers[0](Response.json({ revision: "first" })); resolvers[1](Response.json({ revision: "other" })); await Promise.all([first, strictReplay, anotherPaper]);
  let resolve!: (response: Response) => void;
  globalThis.fetch = (() => { calls++; return new Promise<Response>(done => { resolve = done; }); }) as typeof fetch;
  const pending = loadDocument("/complete"), duplicate = loadDocument("/complete"); assert.equal(pending, duplicate);
  resolve(Response.json({ revision: "initial" })); assert.equal((await pending).revision, "initial");
  const next = loadDocument("/complete"); resolve(Response.json({ revision: "new" })); assert.equal((await next).revision, "new");
});
test("failed startup requests can be retried without caching errors", async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => Response.json({ error: "Unavailable" }, { status: 409 })) as typeof fetch;
  await assert.rejects(loadDocument("/retry"), /Unavailable/);
  globalThis.fetch = (async () => Response.json({ revision: "recovered" })) as typeof fetch;
  assert.equal((await loadDocument("/retry")).revision, "recovered");
});
