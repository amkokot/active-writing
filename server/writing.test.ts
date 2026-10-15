import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppState, AttentionTask, ProjectDocument } from "../src/types.ts";
import { acceptWritingParagraph, dropWritingParagraph, editWritingDraft, editWritingFeedback, makeWritingRequest, parseWritingReply, placeWritingDraft, reconcileWritingReviews, unlockWritingParagraph, validateWritingText, writingDecisions, writingLocks, writingMarkers, writingReviewText, writingRoundTheme, writingSnapshot, writingTarget } from "../src/writing.ts";
import { receiveHandoffReply } from "../src/handoffs.ts";
import { archiveAttentionTask, reopenAttentionTask } from "../src/attention.ts";
import { freshTurbo } from "../src/turbo.ts";
import { acknowledgeSave } from "../src/acknowledgedSave.ts";
import { emptyWorkbench, workbenchData, receiveWorkbench } from "../src/workbench.ts";
import { readWorkbench, validateWorkbench, writeWorkbench } from "./workbenchStore.ts";
import { parseProject, registerProject, saveEdits } from "./projects.ts";
import { desktopServer } from "../scripts/desktopServer.mjs";
import { writingCommand, writingOptions } from "../scripts/awWriting.ts";

function document(): ProjectDocument {
  return { project: { id: "paper", name: "Writing trial", folder: "paper", mainFile: "main.tex", createdAt: "now" }, revision: "first", files: ["main.tex", "sections/discussion.tex"], rootFiles: ["main.tex"],
    nodes: [{ id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["p1", "p2"] }, { id: "discussion", title: "Discussion", kind: "section", depth: 0, paragraphIds: ["p3"] }],
    paragraphs: [{ id: "p1", nodeId: "intro", file: "main.tex", text: "A bound is useful only under its stated assumptions." }, { id: "p2", nodeId: "intro", file: "main.tex", text: "The assumptions must precede the conclusion." }, { id: "p3", nodeId: "discussion", file: "sections/discussion.tex", text: "The experiments illustrate the limitation." }] };
}
function state(tasks: AttentionTask[] = []): AppState {
  return { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "editing", activeNodeId: "intro", activeParagraphId: "p1", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: tasks, themeLenses: [], activeThemeId: "", previewMode: "split" };
}
function request(doc = document()) { return makeWritingRequest(writingSnapshot(doc, {}, "paper", doc.nodes[0].id, doc.paragraphs[0].id), "Explain the distinction between a guarantee and numerical evidence, using my phrasing.", "paper", "codex"); }
function reply(req: AttentionTask, action = "replace", second = true) {
  return JSON.stringify({ version: 1, connection: "Introduce the limitation, then echo it in the discussion.", nextStep: "Check the transition to the main result.", proposals: [
    { id: "opening", paragraphId: req.sourceSnapshot!.paragraphs[0].id, action, purpose: "Introduce the limitation", rationale: "Keep the hypotheses explicit; do not claim experiments prove the bound.", text: "The guarantee holds under the stated hypotheses, whereas numerical examples illustrate its scope." },
    ...(second ? [{ id: "echo", paragraphId: req.sourceSnapshot!.paragraphs.at(-1)!.id, action: "replace", purpose: "Echo the limitation", rationale: "Connect the discussion to the introduction without strengthening the claim.", text: "These experiments illustrate the guarantee but do not replace its mathematical proof." }] : []),
  ] });
}
function received(req = request()) { return receiveHandoffReply(state([req]), req.id, reply(req)); }

test("import queues a small connected round without editing source, navigating or approving words", () => {
  const req = request(), before = state([req]), next = receiveHandoffReply(before, req.id, reply(req));
  assert.deepEqual(next.paragraphEdits, {}); assert.equal(next.destination, before.destination); assert.equal(next.activeNodeId, before.activeNodeId);
  assert.equal(next.attentionTasks.length, 3); assert.equal(next.attentionTasks[0].status, "ready");
  for (const t of next.attentionTasks.slice(1)) { assert.equal(t.status, "queued"); assert.equal(t.writing?.kind, "paragraph"); assert.equal(t.writing?.kind === "paragraph" && t.writing.decision, undefined); }
  assert.equal(receiveHandoffReply(next, req.id, reply(req), "same"), next);
  assert.deepEqual(before.attentionTasks, [req]);
  assert.deepEqual(writingRoundTheme(next.attentionTasks, document(), {}, req.id)?.matches.map(m => m.paragraphId), ["p1", "p3"]);
});

test("malformed, bulk, locked, outside-scope and approval-bearing replies are rejected atomically", () => {
  const req = request(), data = JSON.parse(reply(req));
  for (const change of [
    { ...data, accepted: true }, { ...data, proposals: [...data.proposals, { ...data.proposals[0], id: "x" }, { ...data.proposals[1], id: "y" }] },
    { ...data, proposals: [{ ...data.proposals[0], decision: "accepted" }] }, { ...data, proposals: [{ ...data.proposals[0], paragraphId: "unknown" }] },
    { ...data, proposals: [{ ...data.proposals[0], text: "First paragraph.\n\nSecond paragraph." }] },
    { ...data, proposals: [{ ...data.proposals[0], text: "word ".repeat(351) }] },
  ]) {
    assert.throws(() => parseWritingReply(JSON.stringify(change), req));
    const failed = receiveHandoffReply(state([req]), req.id, JSON.stringify(change)); assert.equal(failed.attentionTasks.length, 1); assert.ok(failed.attentionTasks[0].error); assert.deepEqual(failed.paragraphEdits, {});
  }
  for (const text of ["\\section{New} Text.", "\\input{other}", "\\begin{proof} A proof.\\end{proof}"]) assert.throws(() => validateWritingText(text));
  const locked = { ...req, writing: { ...req.writing!, lockedParagraphIds: ["p1"] } } as AttentionTask;
  assert.throws(() => parseWritingReply(reply(locked), locked), /locked/);
  assert.equal(parseWritingReply("```json\n" + reply(req) + "\n```", req).proposals.length, 2);
});

test("placing remains pending; Queue check cannot bypass exact manual curation; locks can be deliberately reopened", () => {
  const doc = document(), req = request(doc), pending = received(req), id = pending.attentionTasks[1].id;
  const placed = placeWritingDraft(pending, doc, id), task = placed.attentionTasks[1];
  assert.notEqual(placed.paragraphEdits.p1, doc.paragraphs[0].text); assert.equal(task.status, "queued");
  assert.equal(archiveAttentionTask(placed, id), placed);
  assert.throws(() => acceptWritingParagraph(placed, doc, id, "Different wording"), /changed/);
  const accepted = acceptWritingParagraph(placed, doc, id, placed.paragraphEdits.p1);
  assert.equal(accepted.attentionTasks[1].status, "reviewed"); assert.equal(accepted.attentionTasks[2].status, "queued");
  assert.equal(writingLocks(accepted.attentionTasks, doc, accepted.paragraphEdits).get("p1")?.id, id);
  assert.equal(writingMarkers(accepted.attentionTasks, doc, accepted.paragraphEdits).p1.locked, true);
  const unlocked = unlockWritingParagraph(accepted, id); assert.equal(writingLocks(unlocked.attentionTasks, doc, unlocked.paragraphEdits).size, 0);
  const reopened = reopenAttentionTask(accepted, id); validateWorkbench(workbenchData(reopened)); assert.equal(reopened.attentionTasks[1].status, "queued");
  const changed = { ...accepted, paragraphEdits: { p1: "Later edits require another look." } };
  assert.equal(reconcileWritingReviews(changed, doc).attentionTasks[1].status, "queued");
  assert.equal(reconcileWritingReviews(accepted, doc), accepted);
});

test("drafts and optional human guidance persist, even when typing is temporarily incomplete", () => {
  const req = request(), current = received(req), id = current.attentionTasks[1].id;
  const next = editWritingFeedback(editWritingDraft(current, id, ""), id, "Avoid suggesting this argument again; use the example I described.");
  validateWorkbench(workbenchData(next));
  assert.match(writingDecisions(next.attentionTasks, req.id), /Human guidance: Avoid/);
  assert.throws(() => placeWritingDraft(next, document(), id), /short paragraph/);
});

test("changed, ambiguous and foreign source cannot be placed; later locked text blocks a waiting proposal", () => {
  const doc = document(), req = request(doc), next = received(req), id = next.attentionTasks[1].id;
  assert.throws(() => placeWritingDraft({ ...next, paragraphEdits: { p1: "An unrelated edit." } }, doc, id), /changed/);
  const repeated = { ...doc, revision: "second", paragraphs: [...doc.paragraphs, { ...doc.paragraphs[0], id: "dup" }] };
  assert.throws(() => placeWritingDraft(next, repeated, id), /ambiguous/);
  assert.throws(() => placeWritingDraft(next, { ...doc, project: { ...doc.project, mainFile: "notes.tex" } }, id), /changed/);
  const placed = placeWritingDraft(next, doc, id), accepted = acceptWritingParagraph(placed, doc, id, placed.paragraphEdits.p1);
  const staleRequest = makeWritingRequest(writingSnapshot(doc, accepted.paragraphEdits, "paragraph", "intro", "p1"), "Another round that was prepared before the lock.", "paragraph", "codex");
  const stale = receiveHandoffReply({ ...accepted, attentionTasks: [...accepted.attentionTasks, staleRequest] }, staleRequest.id, reply(staleRequest, "replace", false));
  assert.throws(() => placeWritingDraft(stale, doc, stale.attentionTasks.at(-1)!.id), /locked/);
});

test("undo preserves the original and refuses to erase later human changes", () => {
  const doc = document(), current = received(), id = current.attentionTasks[1].id;
  const dropped = dropWritingParagraph(current, doc, id); assert.equal(dropped.attentionTasks[1].status, "reviewed"); assert.deepEqual(dropped.paragraphEdits, {});
  const placed = placeWritingDraft(current, doc, id);
  assert.equal(dropWritingParagraph(placed, doc, id).paragraphEdits.p1, doc.paragraphs[0].text);
  assert.throws(() => dropWritingParagraph({ ...placed, paragraphEdits: { p1: "Human changes since placement." } }, doc, id), /later edits/);
});

test("theme context honors exclusions and includes locked passages only as context", () => {
  const theme = { id: "theme", name: "Guarantee versus evidence", seedParagraphId: "p1", matches: [{ paragraphId: "p1", score: 1 }, { paragraphId: "p2", score: .5, excluded: true }, { paragraphId: "p3", score: .6 }] };
  assert.deepEqual(writingSnapshot(document(), {}, "theme", "intro", "p1", theme).paragraphs.map(p => p.id), ["p1", "p3"]);
  assert.throws(() => writingSnapshot(document(), {}, "theme", "intro", "p1"), /theme/);
});

async function fixture() {
  await mkdir(".paperfocus/trials", { recursive: true });
  const workspace = await mkdtemp(path.resolve(".paperfocus/trials/writing-")), root = path.join(workspace, "paper");
  await mkdir(path.join(root, "sections"), { recursive: true });
  await writeFile(path.join(root, "main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nThe guarantee holds under assumptions.\n\nA second passage.\n\\input{sections/discussion}\n\\end{document}\n");
  await writeFile(path.join(root, "sections/discussion.tex"), "\\section{Discussion}\nNumerical evidence is not proof.\n");
  const project = await registerProject(workspace, root, "Isolated writing trial");
  return { workspace, root, project, doc: await parseProject(workspace, project.id) };
}

test("added paragraphs follow verified save offsets across included files; review/locks survive reload", async () => {
  const { workspace, root, project, doc } = await fixture(), req = request(doc);
  let current = receiveHandoffReply(state([req]), req.id, reply(req, "after"));
  const id = current.attentionTasks[1].id; current = placeWritingDraft(current, doc, id);
  const saved = await saveEdits(workspace, project.id, current.paragraphEdits, doc.revision);
  current = acknowledgeSave(current, doc, saved, current.paragraphEdits, saved.saveAcknowledgement).state;
  const task = current.attentionTasks.find(t => t.id === id)!;
  assert.equal(writingReviewText(task, saved, current.paragraphEdits), task.writing?.kind === "paragraph" ? task.writing.placement!.text : "bad");
  assert.notEqual(writingTarget(task, saved, {})?.id, doc.paragraphs[0].id);
  assert.equal(task.status, "queued");
  current = acceptWritingParagraph(current, saved, id, writingReviewText(task, saved, {})!);
  const stored = await writeWorkbench(workspace, project.id, 0, workbenchData(current));
  const reloaded = receiveWorkbench(state(), await readWorkbench(workspace, project.id));
  assert.equal(writingLocks(reloaded.attentionTasks, saved, {}).size, 1); assert.equal(stored.revision, 1);
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /The guarantee holds under assumptions\.\n\nThe guarantee holds/);
  assert.equal(await readFile(path.join(root, "sections/discussion.tex"), "utf8"), "\\section{Discussion}\nNumerical evidence is not proof.\n");
  const second = current.attentionTasks[2].id;
  current = placeWritingDraft(current, saved, second);
  const again = await saveEdits(workspace, project.id, current.paragraphEdits, saved.revision);
  current = acknowledgeSave(current, saved, again, current.paragraphEdits, again.saveAcknowledgement).state;
  assert.match(await readFile(path.join(root, "sections/discussion.tex"), "utf8"), /do not replace its mathematical proof/);
  assert.equal(writingTarget(current.attentionTasks[2], again, {})?.file, "sections/discussion.tex");
});

test("agent inspect/submit are scoped, revision guarded, preserve human work and never modify manuscripts", async () => {
  assert.equal(writingOptions(["--help"]).command, "help");
  assert.throws(() => writingOptions(["inspect", "--workspace", ".", "--project", "p", "--task", "t", "--url", "https://example.com"]), /local/);
  const { workspace, root, project, doc } = await fixture(), req = request(doc);
  const extra = { ...req, id: "unrelated", title: "Unrelated human work", packet: "Keep this" };
  await writeWorkbench(workspace, project.id, 0, { ...emptyWorkbench(), attentionTasks: [req, extra] });
  const unrelatedSaved = (await readWorkbench(workspace, project.id)).attentionTasks[1];
  const server = desktopServer(workspace); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number }, scope = ["--url", `http://127.0.0.1:${address.port}`, "--workspace", workspace, "--project", project.id, "--task", req.id];
  try {
    const inspected: any = await writingCommand(["inspect", ...scope]); assert.equal(inspected.revision, 1); assert.equal(inspected.mainFile, "main.tex"); assert.match(inspected.packet, /ONE idea/);
    const file = path.join(workspace, "proposal.json"); await writeFile(file, reply(req));
    const original = await readFile(path.join(root, "main.tex"), "utf8");
    const preview: any = await writingCommand(["submit", ...scope, "--revision", "1", "--file", file]); assert.equal(preview.preview, true); assert.equal((await readWorkbench(workspace, project.id)).revision, 1);
    await assert.rejects(writingCommand(["submit", ...scope, "--revision", "0", "--file", file, "--commit"]), /changed/);
    const committed: any = await writingCommand(["submit", ...scope, "--revision", "1", "--file", file, "--commit"]); assert.equal(committed.revision, 2);
    const stored = await readWorkbench(workspace, project.id); assert.deepEqual(stored.attentionTasks[1], unrelatedSaved); assert.equal(stored.attentionTasks[2].status, "queued");
    assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), original);
    await assert.rejects(writingCommand(["submit", ...scope, "--revision", "2", "--file", file, "--commit"]), /already/);
    await assert.rejects(writingCommand(["inspect", ...scope, "--workspace", "other"]), /repeated/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
