import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHandoff, readHandoff } from "./handoffs.ts";
import { parseProject, registerProject } from "./projects.ts";
import { newNotebookEntry } from "../src/notebook.ts";
import { externalStudyPacket, handoffSnapshot, makeStudyTurn, studyState } from "../src/study.ts";
import { receiveHandoffReply, refreshHandoffTicket, fetchHandoffTicket } from "../src/handoffs.ts";
import { freshTurbo } from "../src/turbo.ts";
import { createRewriteSession } from "../src/rewrite.ts";
import { suggestWork } from "../src/notebook.ts";
import { validateNotebookEntries, writeNotebook, readNotebook } from "./notebookStore.ts";
import type { AppState } from "../src/types.ts";

const base = path.join(process.cwd(), ".paperfocus", "trials");
async function fixture() {
  await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "handoff-"));
  const root = path.join(workspace, "paper"); await mkdir(root);
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{A}\nOriginal $x$ text.\n\\end{document}\n";
  await writeFile(path.join(root, "main.tex"), source);
  const project = await registerProject(workspace, root, "main.tex");
  const document = await parseProject(workspace, project.id);
  return { workspace, root, source, project, document };
}
function state(): AppState {
  return { destination: "notebook", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "editing", activeNodeId: "other-work", hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" };
}

test("refreshing moved request paths preserves replies, queue status, source and conversation history", async () => {
  const f = await fixture(), s = state(), entry = newNotebookEntry(f.document, s), turn = makeStudyTurn(entry, f.document);
  const ticket = await createHandoff(f.workspace, f.project.id, { id: turn.id, packet: "Retained request", transport: "files" });
  const old = { ...ticket, promptPath: "old/prompt.md", responsePath: "old/response.json", copyText: "Old instructions", replyHash: "retained-hash" };
  entry.study = { ...studyState(entry), turns: [{ ...turn, ticket: old, reply: "Author corrected reply" }] };
  s.notebookEntries = [entry]; s.paragraphEdits = { p: "Author draft" };
  s.attentionTasks = [{ id: "task", title: "Task", route: "codex", nodeId: "original-focus", status: "reviewed", ticket: old, reply: "Author corrected reply", createdAt: "now", updatedAt: "now" }];
  const refreshed = refreshHandoffTicket(s, "task", ticket);
  assert.equal(refreshed.attentionTasks[0].ticket!.promptPath, ticket.promptPath);
  assert.equal(refreshed.notebookEntries[0].study!.turns[0].ticket!.responsePath, ticket.responsePath);
  assert.equal(refreshed.attentionTasks[0].ticket!.replyHash, old.replyHash);
  assert.equal(refreshed.attentionTasks[0].status, "reviewed"); assert.equal(refreshed.attentionTasks[0].reply, "Author corrected reply");
  assert.deepEqual(refreshed.paragraphEdits, s.paragraphEdits); assert.equal(refreshed.activeNodeId, s.activeNodeId);
  assert.strictEqual(refreshHandoffTicket(refreshed, "task", ticket), refreshed);
  assert.strictEqual(refreshHandoffTicket(s, "task", { ...ticket, requestHash: "different" }), s);
  const mock = async (url: string) => {
    assert.ok(url.includes(`projectId=${f.project.id}`) && url.includes(`id=${turn.id}`));
    return new Response(JSON.stringify({ ticket }), { status: 200 });
  };
  const previous = globalThis.fetch; globalThis.fetch = mock as typeof fetch;
  try { assert.deepEqual(await fetchHandoffTicket(f.project.id, turn.id), ticket); } finally { globalThis.fetch = previous; }
});
test("provider-neutral exports are immutable, paper-scoped, retryable and source-preserving", async () => {
  const f = await fixture(); const id = randomUUID();
  const ticket = await createHandoff(f.workspace, f.project.id, { id, packet: "Continue: check the boundary case.", transport: "files", label: "My preferred agent" });
  assert.equal(ticket.label, "My preferred agent"); assert.match(ticket.copyText, /prompt.md/);
  assert.deepEqual(await createHandoff(f.workspace, f.project.id, { id, packet: "Continue: check the boundary case.", transport: "files", label: "My preferred agent" }), ticket);
  await assert.rejects(createHandoff(f.workspace, f.project.id, { id, packet: "Different prompt", transport: "files", label: "My preferred agent" }), /another request/);
  assert.equal((await readHandoff(f.workspace, f.project.id, id)).status, "pending");
  assert.match(await readFile(ticket.promptPath, "utf8"), /temporary file first/);
  const paste = await createHandoff(f.workspace, f.project.id, { packet: "A short continuation", transport: "paste", label: "Any chat" });
  assert.equal(paste.copyText, "A short continuation");
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.source);
  assert.ok(!(await parseProject(f.workspace, f.project.id)).files.some((file) => file.includes("handoffs")));
});

test("manual chat requests copy only the prompt and ignore even valid shared-folder response files", async () => {
  const f = await fixture();
  const packet = "Synthetic web client: continue our existing conversation.";
  const ticket = await createHandoff(f.workspace, f.project.id, { packet, transport: "paste", label: "Any web client" });
  assert.equal(ticket.copyText, packet);
  assert.equal(await readFile(ticket.promptPath, "utf8"), packet);
  await writeFile(ticket.responsePath, JSON.stringify({ version: 1, taskId: ticket.id, requestHash: ticket.requestHash, complete: true, reply: "Should not be imported for a manual ticket" }));
  const result = await readHandoff(f.workspace, f.project.id, ticket.id);
  assert.equal(result.status, "pending");
  assert.match(result.note!, /Paste the response/);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.source);
});
test("shared-folder completion requires valid JSON, explicit completion, task ID and exact request hash", async () => {
  const f = await fixture(); const ticket = await createHandoff(f.workspace, f.project.id, { packet: "Synthetic test only", transport: "files" });
  const envelope = { version: 1, taskId: ticket.id, requestHash: ticket.requestHash, complete: true, reply: "Synthetic transport fixture, not a model response." };
  await writeFile(ticket.responsePath, '{"complete":true,"reply":"unfinished');
  assert.equal((await readHandoff(f.workspace, f.project.id, ticket.id)).status, "pending");
  for (const patch of [{ complete: false }, { taskId: randomUUID() }, { requestHash: "stale" }, { version: 2 }, { reply: "" }]) {
    await writeFile(ticket.responsePath, JSON.stringify({ ...envelope, ...patch }));
    assert.equal((await readHandoff(f.workspace, f.project.id, ticket.id)).status, "pending");
  }
  await writeFile(ticket.responsePath, JSON.stringify(envelope));
  const result = await readHandoff(f.workspace, f.project.id, ticket.id);
  assert.equal(result.status, "ready"); assert.equal(result.reply, envelope.reply); assert.equal(result.requestHash, ticket.requestHash);
  await assert.rejects(readHandoff(f.workspace, f.project.id, "../../other"), /valid handoff ID/);
  await assert.rejects(readHandoff(f.workspace, "nonexistent-paper", ticket.id));
  await writeFile(ticket.responsePath, "x".repeat(400_001));
  await assert.rejects(readHandoff(f.workspace, f.project.id, ticket.id), /too large/);
  assert.equal(await readFile(path.join(f.root, "main.tex"), "utf8"), f.source);
});
test("handoff sidecars refuse junction escapes", async () => {
  const f = await fixture(); const outside = await mkdtemp(path.join(base, "outside-handoff-"));
  await mkdir(path.join(f.root, ".paperfocus"));
  await symlink(outside, path.join(f.root, ".paperfocus", "handoffs"), "junction");
  await assert.rejects(createHandoff(f.workspace, f.project.id, { packet: "No escape", transport: "files" }), /symbolic links|inside this paper/);
});
test("continuations include changed notes, preserve learning boundaries and offer a complete briefing", async () => {
  const f = await fixture(); const entry = newNotebookEntry(f.document, state());
  entry.title = "Boundary check"; entry.question = "Is the boundary compact?"; entry.notes = "First attempt: prove tightness.";
  entry.study = { ...studyState(entry), guidance: "hint", handoff: { transport: "paste", label: "Any chat", contextMode: "continuation" }, benchmark: { phase: "attempt", statement: "A target statement", citationKey: "secret-paper", locator: "Theorem 1", referenceNotes: "Do not leak the published proof" } };
  const first = externalStudyPacket(entry, f.document);
  assert.match(first, /First attempt/); assert.match(first, /one small hint/); assert.match(first, /do not browse/);
  assert.ok(!first.includes("secret-paper") && !first.includes(`${f.project.folder}/${f.project.mainFile}`) && !first.includes("Do not leak"));
  entry.study.turns = [{ ...makeStudyTurn(entry, f.document), handoffSnapshot: handoffSnapshot(entry) }];
  assert.ok(!externalStudyPacket(entry, f.document).includes("First attempt"));
  entry.notes = "Updated attempt: the first claim fails.";
  assert.match(externalStudyPacket(entry, f.document), /updated since previous request/);
  assert.match(externalStudyPacket(entry, f.document), /first claim fails/);
  entry.study.handoff.contextMode = "briefing";
  assert.match(externalStudyPacket(entry, f.document), /## Context/);
});

test("changing handoff destination transfers saved context once without assuming a shared conversation", async () => {
  const f = await fixture(), entry = newNotebookEntry(f.document, state());
  f.document.project.manuscriptPurposes = { [f.document.project.mainFile]: "publication" };
  entry.route = "chatgpt"; entry.notes = "Author premise: keep this assumption explicit.";
  entry.study = { ...studyState(entry), handoff: { transport: "paste", label: "Chat A", contextMode: "continuation" } };
  const turn = { ...makeStudyTurn(entry, f.document), handoffSnapshot: handoffSnapshot(entry), reply: "Prior deduction: residual and error differ.", status: "ready" as const };
  entry.study.turns.push(turn);
  assert.doesNotMatch(externalStudyPacket(entry, f.document), /Author premise|Prior deduction/);
  assert.match(externalStudyPacket(entry, f.document), /Use our conversation history/);
  entry.route = "codex"; entry.study.handoff = { transport: "files", label: "Coding assistant", contextMode: "continuation" };
  const packet = externalStudyPacket(entry, f.document);
  assert.match(packet, /Author premise/); assert.match(packet, /Prior deduction/);
  assert.match(packet, /unverified; conversation history is not shared automatically/);
  assert.doesNotMatch(packet, /Use our conversation history/);
  assert.match(packet, /Do not modify source files or mark claims verified/);
  const second = { ...makeStudyTurn(entry, f.document), handoffSnapshot: handoffSnapshot(entry), reply: "", status: "queued" as const };
  entry.study.turns.push(second);
  assert.doesNotMatch(externalStudyPacket(entry, f.document), /Author premise|Prior deduction/);
});

test("a new chat label or first external use after local work includes retained findings, never blank history assumptions", async () => {
  const f = await fixture(), entry = newNotebookEntry(f.document, state());
  entry.notes = "Saved premise"; entry.study = { ...studyState(entry), guidance: "hint" };
  entry.study.turns.push({ ...makeStudyTurn(entry, f.document), reply: "Local findings", status: "ready" });
  entry.route = "chatgpt"; entry.study.handoff = { transport: "paste", label: "Chat A", contextMode: "continuation" };
  assert.match(externalStudyPacket(entry, f.document), /Local findings/);
  entry.study.turns.push({ ...makeStudyTurn(entry, f.document), handoffSnapshot: handoffSnapshot(entry), reply: "New chat findings", status: "ready" });
  entry.study.handoff.label = "Chat B";
  const packet = externalStudyPacket(entry, f.document);
  assert.match(packet, /Saved premise/); assert.match(packet, /New chat findings/); assert.match(packet, /one small hint/);
  assert.doesNotMatch(packet, /Use our conversation history/);
  entry.study.turns.at(-1)!.reply = "x".repeat(7000);
  assert.match(externalStudyPacket(entry, f.document), /Reply excerpt shortened; ask for the rest/);
  assert.ok(externalStudyPacket(entry, f.document).length < 8000);
  entry.study.turns.at(-1)!.handoffSnapshot = "null";
  assert.doesNotThrow(() => externalStudyPacket(entry, f.document));
});
test("replies bind to the saved request without navigating or overwriting manual work; tickets survive disk reload", async () => {
  const f = await fixture(); const s = state(); const entry = newNotebookEntry(f.document, s);
  entry.route = "codex"; const turn = makeStudyTurn(entry, f.document);
  const ticket = await createHandoff(f.workspace, f.project.id, { id: turn.id, packet: "A fixture request", transport: "files" });
  entry.study = { ...studyState(entry), turns: [{ ...turn, ticket }], activeTurnId: turn.id };
  s.notebookEntries = [entry]; s.attentionTasks = [{ id: turn.id, notebookId: entry.id, studyTurnId: turn.id, title: "Fixture", route: "codex", nodeId: "original-focus", status: "queued", ticket, createdAt: "now", updatedAt: "now" }];
  const received = receiveHandoffReply(s, turn.id, "Synthetic finalized reply", "fixture-hash");
  assert.equal(received.activeNodeId, "other-work", "receipt never forces a focus change");
  assert.equal(received.notebookEntries[0].study!.turns[0].reply, "Synthetic finalized reply");
  assert.equal(received.attentionTasks[0].status, "ready");
  assert.strictEqual(receiveHandoffReply(received, turn.id, "Duplicate", "fixture-hash"), received);
  const edited = receiveHandoffReply(received, turn.id, "My corrected finding");
  assert.strictEqual(receiveHandoffReply(edited, turn.id, "Late replacement", "another-hash"), edited);
  const closed = structuredClone(s); closed.notebookEntries[0].study!.turns[0].closed = true;
  assert.strictEqual(receiveHandoffReply(closed, turn.id, "Too late", "late"), closed);
  validateNotebookEntries(edited.notebookEntries);
  await writeNotebook(f.workspace, f.project.id, 0, edited.notebookEntries);
  assert.deepEqual((await readNotebook(f.workspace, f.project.id)).entries, JSON.parse(JSON.stringify(edited.notebookEntries)));
});
test("structured alternatives preserve protected LaTeX and author-edited candidates, without applying them", () => {
  const s = state(); const text = "We use $x$ and \\ref{bound}.";
  const session = createRewriteSession({ paragraphId: "p", nodeId: "section", start: 0, end: text.length, text, paragraphText: text });
  session.candidates = []; s.rewriteSessions = [session];
  s.attentionTasks = [{ id: "manual-task", sessionId: session.id, title: "Any chat", nodeId: "section", route: "chatgpt", status: "queued", createdAt: "now", updatedAt: "now" }];
  const reply = JSON.stringify({ candidates: ["Apply $x$ and \\ref{bound}.", "Apply $y$ and \\ref{bound}.", "Remove the reference."] });
  const received = receiveHandoffReply(s, "manual-task", reply);
  assert.equal(received.rewriteSessions[0].candidates.length, 1);
  received.rewriteSessions[0].candidates[0].text = "My edited version with $x$ and \\ref{bound}.";
  const repeated = receiveHandoffReply(received, "manual-task", reply);
  assert.equal(repeated.rewriteSessions[0].candidates.length, 1);
  assert.equal(repeated.rewriteSessions[0].candidates[0].text, received.rewriteSessions[0].candidates[0].text);
  assert.deepEqual(repeated.paragraphEdits, {}, "a returned candidate is not a source edit");
});
test("next-work suggestions skip manuscript metadata rather than steering attention to tableofcontents", async () => {
  const f = await fixture(); const s = state(); s.destination = "manuscript"; s.suggestions.relation = "unrelated";
  const document = { ...f.document, paragraphs: [{ id: "metadata", nodeId: "document", text: "\\tableofcontents" }, ...f.document.paragraphs] };
  assert.notEqual(suggestWork(document, s)?.id, "metadata");
});
