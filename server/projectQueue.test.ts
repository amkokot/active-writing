import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { attentionQueue } from "../src/attention.ts";
import { defaultQueueView, loadQueueView, moveProjectQueue, nextQueueTask, projectQueueId, projectQueueTask, scopedProjectQueue, touchQueueView } from "../src/projectQueue.ts";
import { notebookAttentionTasks } from "../src/notebookSync.ts";
import type { AttentionTask, NotebookEntry } from "../src/types.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { readProjectQueue } from "./projectQueue.ts";
import { registerProject, registry, saveRegistry } from "./projects.ts";
import { projectStorage } from "./projectStorage.ts";
import { writeWorkbench, readWorkbench } from "./workbenchStore.ts";
import { readNotebook, writeNotebook } from "./notebookStore.ts";
import { latexPlugin } from "./latexPlugin.ts";

const stamp = "2026-10-06T10:00:00Z";
const task = (id: string, patch: Partial<AttentionTask> = {}): AttentionTask => ({ id, title: `Task ${id}`, nodeId: "section", route: "codex", status: "queued", createdAt: stamp, updatedAt: stamp, ...patch });
const note = (turnId: string): NotebookEntry => ({ id: "entry", title: "Question", question: "Q", notes: "Human note must survive", reply: "", proposal: "", status: "open", route: "codex", effort: 1, createdAt: stamp, updatedAt: stamp, handoffs: [], appliedChanges: [],
  study: { mode: "develop", depth: "derivation", action: "assumptions", background: "", localEffort: 1, turns: [{ id: turnId, action: "assumptions", depth: "derivation", route: "codex", status: "ready", packet: "Large prompt must not be exported", reply: "Saved findings must not be exported", createdAt: stamp }] } });

test("queue scope and global ordering are display-only, project-qualified and reversible", () => {
  const project = { id: "one", name: "First" }, other = { id: "two", name: "Second" };
  const local = [task("shared", { queuePosition: 0 }), task("second", { queuePosition: 1 })];
  const remote = [projectQueueTask(other, task("shared", { queuePosition: 0 }))];
  const original = JSON.stringify({ local, remote });
  assert.notEqual(projectQueueId("a:b", "c"), projectQueueId("a", "b:c"));
  assert.equal(scopedProjectQueue(project, local, remote, defaultQueueView).length, 2);
  const all = scopedProjectQueue(project, local, remote, { scope: "all", order: [] });
  assert.equal(new Set(all.map(item => item.id)).size, 3);
  const moved = moveProjectQueue({ scope: "all", order: [] }, all, remote[0].id, all[0].id, false, stamp);
  const ordered = attentionQueue(scopedProjectQueue(project, local, remote, moved), Date.parse(stamp));
  assert.equal(ordered[0].projectId, "two");
  assert.equal(ordered[0].taskId, "shared");
  assert.equal(JSON.stringify({ local, remote }), original, "global drag cannot rewrite either paper's task records");
  assert.deepEqual(attentionQueue(scopedProjectQueue(project, local, remote, { ...moved, scope: "project" }), Date.parse(stamp)).map(item => item.taskId), ["shared", "second"]);
  assert.equal(moveProjectQueue(moved, all, "missing", all[0].id), moved);
});

test("Next advances and wraps without finishing work; preferences and monthly reset retain order", () => {
  const queued = [task("first"), task("next"), task("last")];
  assert.equal(nextQueueTask(queued)?.id, "first");
  assert.equal(nextQueueTask(queued, "first")?.id, "next");
  assert.equal(nextQueueTask(queued, "last")?.id, "first");
  assert.equal(nextQueueTask([queued[0]], "first"), undefined);
  assert.equal(nextQueueTask([], "first"), undefined);
  assert.ok(queued.every(item => item.status === "queued"));
  const view = touchQueueView({ scope: "all", order: ["two:shared", "one:shared"], lastActiveAt: "2026-08-01T00:00:00Z" }, stamp);
  assert.equal(view.colorsResetAt, stamp); assert.deepEqual(view.order, ["two:shared", "one:shared"]);
  assert.deepEqual(loadQueueView({ getItem: () => JSON.stringify(view) }), view);
  assert.deepEqual(loadQueueView({ getItem: () => "not JSON" }), defaultQueueView);
  assert.deepEqual(loadQueueView({ getItem: () => JSON.stringify({ scope: "invented", order: ["one:shared", "one:shared", 5], orderedAt: "invalid" }) }), { scope: "project", order: ["one:shared"] });
  const all = scopedProjectQueue({ id: "one", name: "First" }, [task("shared")], [], view);
  assert.equal(all[0].queueColorResetAt, stamp);
});

test("notebook queue projection preserves saved request status and keeps recoveries out of the queue", () => {
  const entry = note("shared");
  const recovered = { ...entry, id: "recovery", recoveryKey: "key" };
  const tasks = notebookAttentionTasks([entry, recovered], [task("comment", { review: { kind: "comment", author: "human", body: "Note", start: 0, end: 1, quote: "x" } })]);
  assert.equal(tasks.length, 2); assert.equal(tasks[1].status, "ready"); assert.equal(tasks[1].notebookId, entry.id);
  assert.equal(tasks[0].review?.kind, "comment");
  assert.equal(entry.notes, "Human note must survive");
});

test("cross-project catalogue combines notebook and manuscript tasks without source parsing or destructive failure", async () => {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/project-queue-"));
  await saveRegistry(workspace, { activeId: "", projects: [] });
  const paper = String.raw`\documentclass{article}\begin{document}\section{Aim}Hello.\end{document}`;
  const projects = [];
  for (const folder of ["paper", "other"]) {
    await mkdir(path.join(workspace, folder)); await writeFile(path.join(workspace, folder, "main.tex"), paper);
    const project = await registerProject(workspace, folder, folder); projects.push(project);
    await writeWorkbench(workspace, project.id, 0, { ...emptyWorkbench(), attentionTasks: [task("shared", { packet: "Full outgoing prompt", replyDraft: "Unsubmitted answer" })] });
    await writeNotebook(workspace, project.id, 0, [note("notebook-turn")]);
  }
  await saveRegistry(workspace, { activeId: projects[0].id, projects });
  const before = await registry(workspace);
  const originals = await Promise.all(projects.map(async project => ({ work: await readWorkbench(workspace, project.id), notes: await readNotebook(workspace, project.id) })));
  // Prove this endpoint doesn't parse all manuscripts just to display the queue.
  await writeFile(path.join(workspace, "other/main.tex"), "An unfinished editor draft, not parseable LaTeX");
  const result = await readProjectQueue(workspace, projects[0].id);
  assert.equal(result.tasks.length, 2); assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  assert.ok(result.tasks.every(item => item.projectId === projects[1].id));
  assert.equal(result.tasks.find(item => item.taskId === "notebook-turn")!.status, "ready");
  assert.ok(result.tasks.every(item => item.packet === undefined && item.reply === undefined && item.replyDraft === undefined && item.sourceSnapshot === undefined));
  assert.equal((await readProjectQueue(workspace)).tasks.length, 4, "colliding raw task IDs from different projects stay distinct");
  assert.deepEqual(await registry(workspace), before, "reading never switches the selected project");
  for (let i = 0; i < projects.length; i++) {
    assert.deepEqual(await readWorkbench(workspace, projects[i].id), originals[i].work);
    assert.deepEqual(await readNotebook(workspace, projects[i].id), originals[i].notes);
  }
  await assert.rejects(readProjectQueue(workspace, "unregistered"), /no longer registered/);
  let handler: any; (latexPlugin(workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  const call = async (method: string) => {
    const req = Object.assign(Readable.from([]), { method, url: "/api/paperfocus/project-queue", headers: { host: "127.0.0.1:4173" } });
    const res: any = { setHeader: () => undefined, end: (body: string) => { res.body = JSON.parse(body); } };
    await handler(req, res, () => assert.fail("must not fall through")); return res;
  };
  assert.equal((await call("GET")).body.tasks.length, 4); assert.equal((await call("POST")).statusCode, 405);
  // A damaged store is reported, not silently erased or allowed to hide other papers.
  const { folder } = await projectStorage(workspace, projects[1].id);
  const broken = path.join(folder, "notebook.json");
  await writeFile(broken, "broken notebook");
  const partial = await readProjectQueue(workspace);
  assert.equal(partial.errors.length, 1); assert.equal(partial.errors[0].projectId, projects[1].id);
  assert.equal(partial.tasks.length, 2); assert.equal(await readFile(broken, "utf8"), "broken notebook");
  const route = await readFile("src/App.tsx", "utf8"), hook = await readFile("src/useProjectQueue.ts", "utf8");
  assert.match(route, /await prepareNavigation\(\)/); assert.match(route, /saved\.workbench\.pending/);
  assert.match(route, /notebookStorage\.ready && workbenchStorage\.ready/);
  assert.match(hook, /if \(!enabled \|\| !projectId\) return/);
  const css = await readFile("src/editingFramework.css", "utf8");
  assert.match(css, /\.priority-queue-menu \{[^}]*left: auto; right: 0;/, "wide-screen dropdown stays aligned to the control's right edge");
});
