import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import type { AppState, AttentionTask, RewriteSession, WorkbenchData, WorkbenchStore } from "../src/types.ts";
import { emptyWorkbench, receiveWorkbench, reconcileWorkbench, restoreWorkbenchDraft, rewriteSourceMatches, workbenchData, workbenchSync } from "../src/workbench.ts";
import { freshTurbo } from "../src/turbo.ts";
import { registerProject } from "./projects.ts";
import { readWorkbench, validateWorkbench, writeWorkbench, WorkbenchConflict } from "./workbenchStore.ts";
import { latexPlugin } from "./latexPlugin.ts";
import { reopenAttentionTask } from "../src/attention.ts";

const task: AttentionTask = { id: "task-one", title: "Statement audit", nodeId: "section-one", paragraphId: "paragraph-one", route: "codex", status: "ready",
  reply: "Original findings", replyDraft: "Author correction", authorEditedReply: true, previousTaskId: "task-zero", packet: "Original prompt",
  ticket: { id: "a156dd65-45ec-4184-a2a8-91856fe0ba2d", transport: "files", label: "Any file agent", promptPath: "saved/prompt.md", responsePath: "saved/response.json", requestHash: "request-hash", replyHash: "reply-hash", copyText: "Read saved/prompt.md" },
  createdAt: "2026-10-03T10:00:00Z", updatedAt: "2026-10-03T10:01:00Z" };
const session: RewriteSession = { id: "rewrite-one", paragraphId: "paragraph-one", nodeId: "section-one", start: 0, end: 8, sourceText: "A result", sourceFingerprint: "fingerprint",
  beforeAnchor: "", afterAnchor: " follows", instruction: "Keep the math intact", route: "rules", effortByRoute: { rules: 0, local: 1, chatgpt: 1, codex: 1 },
  candidates: [{ id: "candidate-one", text: "A finding", source: "Rules", dismissed: false, userEdited: true }, { id: "candidate-two", text: "An outcome", source: "Local", dismissed: true, userEdited: false }],
  selectedCandidateId: "candidate-one", status: "draft", createdAt: task.createdAt, updatedAt: task.updatedAt };
function data(): WorkbenchData { return { attentionTasks: [structuredClone(task)], rewriteSessions: [structuredClone(session)],
  handoffDrafts: { "codex:section-one": { effort: 1, scope: "none", includeProject: false, instruction: "Explain the missing step", contextMode: "continuation", previousTaskId: task.id } }, recoveredDrafts: [] }; }
function state(): AppState { return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "project",
  activeNodeId: "another-section", hiddenNodeIds: ["section-one"], progressByNode: { "another-section": "progress" }, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" }; }
function store(value = data(), revision = 1): WorkbenchStore { return { ...value, version: 1, revision }; }
async function fixture() {
  const base = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "workbench-")); const folder = path.join(workspace, "paper");
  await mkdir(path.join(folder, "sections"), { recursive: true });
  const source = "\\documentclass{article}\n\\begin{document}\n\\input{sections/one}\n\\end{document}\n";
  const child = "\\section{First}\nA result follows.\n";
  await writeFile(path.join(folder, "main.tex"), source); await writeFile(path.join(folder, "sections/one.tex"), child);
  const project = await registerProject(workspace, "paper");
  return { workspace, folder, project, source, child };
}

test("disk hydration recovers queue history, edited findings, drafts and candidates with no browser cache or navigation", () => {
  const original = state(); const disk = store();
  disk.attentionTasks.push({ ...task, id: "older-task", status: "reviewed", archivedStatus: "ready" });
  const restored = receiveWorkbench(original, disk);
  assert.deepEqual(workbenchData(restored), diskData(disk));
  assert.equal(restored.attentionTasks[0].replyDraft, "Author correction");
  assert.equal(restored.rewriteSessions[0].candidates[1].dismissed, true);
  for (const key of ["activeNodeId", "hiddenNodeIds", "paragraphEdits", "progressByNode", "turbo"] as const) assert.deepEqual(restored[key], original[key]);
  const notebookTask = { ...task, id: "notebook-task", notebookId: "question-one" };
  const mixed = receiveWorkbench({ ...original, attentionTasks: [notebookTask] }, disk);
  assert.equal(mixed.attentionTasks.at(-1), notebookTask);
  assert.equal(workbenchData(mixed).attentionTasks.some((t) => t.notebookId), false);
  assert.equal(receiveWorkbench({ ...original, attentionTasks: [{ ...task, subscriptionJobId: "retired", status: "queued" }] }, store(emptyWorkbench(), 0)).attentionTasks[0].status, "failed");
});

test("project activity and color resets survive disk writes and cold hydration; newer human visits win merges", async () => {
  const f = await fixture(), saved = data();
  saved.queueLastActiveAt = "2026-10-06T10:00:00Z";
  saved.attentionTasks[0].queueColorResetAt = saved.queueLastActiveAt;
  await writeWorkbench(f.workspace, f.project.id, 0, saved);
  const disk = await readWorkbench(f.workspace, f.project.id);
  const cold = receiveWorkbench(state(), disk);
  assert.equal(cold.queueLastActiveAt, saved.queueLastActiveAt);
  assert.equal(cold.attentionTasks[0].queueColorResetAt, saved.queueLastActiveAt);
  const older = { ...saved, queueLastActiveAt: "2026-09-01T10:00:00Z" };
  assert.equal(reconcileWorkbench(saved, older).queueLastActiveAt, saved.queueLastActiveAt);
  assert.equal(reconcileWorkbench(older, saved).queueLastActiveAt, saved.queueLastActiveAt);
  assert.throws(() => validateWorkbench({ ...saved, queueLastActiveAt: "invalid" }), /activity timestamp/);
});
function diskData(disk: WorkbenchStore): WorkbenchData { const { version, revision, ...value } = disk; return value; }

test("finish-without-import metadata round-trips on disk and reopening does not fabricate an answer", async () => {
  const f = await fixture(); const saved = emptyWorkbench();
  saved.attentionTasks = [{ ...task, status: "reviewed", archivedStatus: "queued", completedExternally: true,
    reply: undefined, replyDraft: undefined, ticket: { ...task.ticket!, transport: "paste", replyHash: undefined } }];
  await writeWorkbench(f.workspace, f.project.id, 0, saved);
  const disk = await readWorkbench(f.workspace, f.project.id);
  assert.equal(disk.attentionTasks[0].completedExternally, true); assert.equal(disk.attentionTasks[0].reply, undefined);
  const restored = reopenAttentionTask(receiveWorkbench(state(), disk), task.id);
  assert.equal(restored.attentionTasks[0].status, "queued"); assert.equal(restored.attentionTasks[0].completedExternally, undefined);
  assert.equal(restored.attentionTasks[0].reply, undefined);
  const invalid = structuredClone(saved); (invalid.attentionTasks[0] as any).completedExternally = "yes";
  assert.throws(() => validateWorkbench(invalid), /flag/);
  assert.equal(await readFile(path.join(f.folder, "main.tex"), "utf8"), f.source);
});

test("browser migration is lossless and baselines identify unsaved edits rather than timestamp guesses", () => {
  const cached = data(); const original = { ...state(), ...cached };
  const migrated = receiveWorkbench(original, store(emptyWorkbench(), 0));
  assert.deepEqual(workbenchData(migrated), cached);
  const baseline = workbenchSync(cached, 1);
  const edited = structuredClone(cached); edited.attentionTasks[0].replyDraft = "My unsaved clarification";
  edited.handoffDrafts["codex:section-one"].instruction = "A more precise question";
  assert.deepEqual(reconcileWorkbench(edited, cached, baseline), edited, "author edits survive even with the same timestamp");
  const sameWithReorderedProperties = JSON.parse(JSON.stringify(cached));
  sameWithReorderedProperties.attentionTasks[0] = Object.fromEntries(Object.entries(sameWithReorderedProperties.attentionTasks[0]).reverse());
  assert.deepEqual(workbenchSync(sameWithReorderedProperties, 1), baseline, "comparison is property-order independent");
});

test("three-way reconciliation merges independent edits and retains both versions of conflicting records", () => {
  const base = data(); const local = structuredClone(base); const remote = structuredClone(base);
  local.attentionTasks[0].replyDraft = "Local correction";
  remote.rewriteSessions[0].candidates[0].text = "Remote wording";
  const independent = reconcileWorkbench(local, remote, workbenchSync(base, 1));
  assert.equal(independent.attentionTasks[0].replyDraft, "Local correction"); assert.equal(independent.rewriteSessions[0].candidates[0].text, "Remote wording");
  assert.deepEqual(independent.recoveredDrafts, []);
  remote.attentionTasks[0].replyDraft = "Remote correction";
  local.rewriteSessions[0].candidates[0].text = "Local wording";
  local.handoffDrafts["codex:section-one"].instruction = "Local question";
  remote.handoffDrafts["codex:section-one"].instruction = "Remote question";
  const conflict = reconcileWorkbench(local, remote, workbenchSync(base, 1));
  assert.equal(conflict.attentionTasks[0].replyDraft, "Local correction", "do not replace the active author field while typing");
  assert.equal(conflict.recoveredDrafts.length, 3);
  assert.equal(conflict.recoveredDrafts.find((draft) => draft.kind === "task")!.value.replyDraft, "Remote correction");
  assert.equal(reconcileWorkbench(conflict, remote, workbenchSync(remote, 2)).recoveredDrafts.length, 3, "reload does not duplicate conflict copies");
  assert.equal(reconcileWorkbench(base, remote, workbenchSync(base, 1)).recoveredDrafts.length, 0, "stale unedited browser records are replaced safely");
  assert.equal(reconcileWorkbench(emptyWorkbench(), remote).attentionTasks.length, 1, "missing browser state is not deletion");
  const laterPoll = structuredClone(base); laterPoll.attentionTasks[0].updatedAt = "2026-10-03T10:03:00Z";
  assert.equal(reconcileWorkbench(laterPoll, base, workbenchSync(base, 1)).recoveredDrafts.length, 0, "different poll times are not author conflicts");
});

test("restoring conflict copies cannot launch jobs or apply source edits, and retains complete original metadata", () => {
  const base = data(); const local = structuredClone(base); local.attentionTasks[0].replyDraft = "Unmerged author finding";
  local.attentionTasks[0].localJobId = "saved-job"; local.rewriteSessions[0].candidates[0].text = "Recovered phrasing";
  const remote = structuredClone(base); remote.attentionTasks[0].replyDraft = "Other author finding"; remote.rewriteSessions[0].instruction = "Different constraint";
  const merged = reconcileWorkbench(local, remote, workbenchSync(base, 1));
  let restored: AppState = { ...state(), attentionTasks: merged.attentionTasks, rewriteSessions: merged.rewriteSessions, recoveredWorkbenchDrafts: merged.recoveredDrafts };
  const conflictTask = merged.recoveredDrafts.find((draft) => draft.kind === "task")!;
  restored = restoreWorkbenchDraft(restored, conflictTask.id);
  const copy = restored.attentionTasks.at(-1)!;
  assert.equal(copy.status, "reviewed"); assert.equal(copy.ticket, undefined); assert.equal(copy.localJobId, undefined);
  assert.equal(copy.replyDraft, "Other author finding");
  assert.equal(reopenAttentionTask(restored, copy.id).attentionTasks.at(-1)!.status, "ready");
  const retained = restored.recoveredWorkbenchDrafts!.find((draft) => draft.id === conflictTask.id)!;
  assert.ok(retained.kind === "task"); assert.equal(retained.value.ticket!.id, task.ticket!.id);
  assert.equal(restoreWorkbenchDraft(restored, conflictTask.id), restored, "restoration is idempotent");
  const conflictRewrite = merged.recoveredDrafts.find((draft) => draft.kind === "rewrite")!;
  restored = restoreWorkbenchDraft(restored, conflictRewrite.id);
  assert.equal(restored.rewriteSessions.at(-1)!.status, "stale"); assert.equal(restored.rewriteSessions.at(-1)!.candidates[0].text, "A finding");
  assert.equal(restored.rewriteSessions.at(-1)!.instruction, "Different constraint");
  assert.deepEqual(restored.paragraphEdits, {}); assert.equal(restored.activeNodeId, "another-section");
  assert.equal(rewriteSourceMatches(restored.rewriteSessions.at(-1)!, "A result follows"), true);
  assert.equal(rewriteSourceMatches(restored.rewriteSessions.at(-1)!, "An altered result follows"), false);
  assert.equal(rewriteSourceMatches(restored.rewriteSessions.at(-1)!, undefined), false);
  validateWorkbench(workbenchData(restored));
});

test("workbench storage is isolated, revision guarded, atomic and bounded; LaTeX files remain unchanged", async () => {
  const { workspace, folder, project, source, child } = await fixture();
  assert.deepEqual(await readWorkbench(workspace, project.id), store(emptyWorkbench(), 0));
  const first = await writeWorkbench(workspace, project.id, 0, data());
  assert.deepEqual(await readWorkbench(workspace, project.id), first);
  const next = data(); next.attentionTasks[0].replyDraft = "Newest finding";
  const writes = await Promise.allSettled([writeWorkbench(workspace, project.id, 1, next), writeWorkbench(workspace, project.id, 1, emptyWorkbench())]);
  assert.equal(writes.filter((write) => write.status === "fulfilled").length, 1);
  assert.ok(writes.some((write) => write.status === "rejected" && write.reason instanceof WorkbenchConflict));
  assert.deepEqual(JSON.parse(await readFile(path.join(workspace, ".paperfocus/project-data", project.id, "workbench.previous.json"), "utf8")), first);
  assert.equal((await readWorkbench(workspace, project.id)).attentionTasks[0].replyDraft, "Newest finding");
  const otherFolder = path.join(workspace, "other-paper"); await mkdir(otherFolder); await writeFile(path.join(otherFolder, "main.tex"), source.replace("\\input{sections/one}", "Other paper."));
  const other = await registerProject(workspace, "other-paper"); assert.deepEqual(await readWorkbench(workspace, other.id), store(emptyWorkbench(), 0));
  await assert.rejects(readWorkbench(workspace, "unknown"), /no longer registered/);
  await assert.rejects(writeWorkbench(workspace, project.id, -1, data()), /revision/);
  assert.equal(await readFile(path.join(folder, "main.tex"), "utf8"), source); assert.equal(await readFile(path.join(folder, "sections/one.tex"), "utf8"), child);
});

test("invalid, duplicate and corrupt saved work is refused without overwriting recoverable files", async () => {
  for (const change of [(d: WorkbenchData) => d.attentionTasks.push(d.attentionTasks[0]), (d: WorkbenchData) => { d.attentionTasks[0].notebookId = "question"; },
    (d: WorkbenchData) => { d.handoffDrafts["codex:section-one"].effort = 8; }, (d: WorkbenchData) => { d.rewriteSessions[0].end = -1; },
    (d: WorkbenchData) => { d.rewriteSessions[0].selectedCandidateId = "missing"; }, (d: WorkbenchData) => { d.attentionTasks[0].reply = "x".repeat(100_001); }]) {
    const invalid = data(); change(invalid); assert.throws(() => validateWorkbench(invalid));
  }
  const oversized = data(); oversized.attentionTasks = Array.from({ length: 48 }, (_, index) => ({ ...task, id: `large-${index}`, reply: "x".repeat(90_000) }));
  assert.throws(() => validateWorkbench(oversized), /4 MB/);
  const { workspace, folder, project } = await fixture(); await writeWorkbench(workspace, project.id, 0, data());
  const target = path.join(workspace, ".paperfocus/project-data", project.id, "workbench.json"); const broken = "{incomplete disk content";
  await writeFile(target, broken); await assert.rejects(readWorkbench(workspace, project.id)); await assert.rejects(writeWorkbench(workspace, project.id, 1, data()));
  assert.equal(await readFile(target, "utf8"), broken);
});

test("saved work rejects junction storage escapes and foreign-origin writes", async () => {
  const { workspace, folder, project } = await fixture(); const outside = path.join(workspace, "not-this-paper"); await mkdir(outside);
  await symlink(outside, path.join(folder, ".paperfocus"), "junction");
  await assert.rejects(readWorkbench(workspace, project.id), /symbolic links|junctions/);
  await assert.rejects(writeWorkbench(workspace, project.id, 0, data()), /symbolic links|junctions/);
  let handler: any; const configure = latexPlugin(workspace).configureServer;
  (configure as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  const response: any = { setHeader: () => undefined, end: (raw: string) => { response.body = JSON.parse(raw); } };
  const request = Object.assign(Readable.from([JSON.stringify({ projectId: project.id, revision: 0, data: data() })]), { url: "/api/paperfocus/workbench", method: "POST", headers: { host: "127.0.0.1:4173", origin: "https://unrelated.example" } });
  await handler(request, response, () => assert.fail("must not fall through")); assert.equal(response.statusCode, 403);
});

test("workbench HTTP endpoint hydrates without cache and distinguishes stale writes from invalid input", async () => {
  const { workspace, project } = await fixture(); let handler: any;
  (latexPlugin(workspace).configureServer as Function)({ middlewares: { use: (value: unknown) => { handler = value; } } });
  async function call(method: string, body?: unknown) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { method, url: `/api/paperfocus/workbench?projectId=${project.id}`, headers: { host: "127.0.0.1:4173", origin: "http://127.0.0.1:4173" } });
    const res: any = { setHeader: () => undefined, end: (raw: string) => { res.body = JSON.parse(raw); } };
    await handler(req, res, () => assert.fail("must not fall through")); return res;
  }
  assert.equal((await call("GET")).body.revision, 0);
  assert.equal((await call("POST", { projectId: project.id, revision: 0, data: data() })).statusCode, 200);
  assert.deepEqual(workbenchData(receiveWorkbench(state(), (await call("GET")).body)), data());
  assert.equal((await call("POST", { projectId: project.id, revision: 0, data: emptyWorkbench() })).statusCode, 409);
  assert.equal((await call("POST", { projectId: project.id, revision: 1, data: { attentionTasks: null } })).statusCode, 400);
  assert.equal((await call("DELETE")).statusCode, 405);
});
