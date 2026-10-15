import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { chunkAtOffset, hasTrailingLineBreak, joinChunkAtStart, removeEmptyChunk, sourceChunks } from "../src/sourceChunks.ts";
import { joinParagraphs, undoParagraphJoin } from "./paragraphEditing.ts";
import { deleteSourceText, editableText } from "../src/editableText.ts";
import { acknowledgeSave, reconcileEditorSave } from "../src/acknowledgedSave.ts";
import { newNotebookEntry } from "../src/notebook.ts";
import { makeReviewComment, reviewCommentTarget } from "../src/review.ts";
import { locateSavedPassage } from "../src/sourceRefresh.ts";
import { emptyChunkHasContext, locateReturnAnchor, validateReturnAnchor } from "../src/sourceAnchors.ts";
import { checkTaskSource } from "../src/taskSource.ts";
import { freshTurbo } from "../src/turbo.ts";
import type { AppState } from "../src/types.ts";
import { parseProject, publicDocument, registerProject, saveEdits } from "./projects.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { emptyWorkbench } from "../src/workbench.ts";
import { createServer } from "vite";
import { latexPlugin } from "./latexPlugin.ts";

test("visual chunks preserve whitespace, LaTeX and an empty next block exactly", () => {
  for (const text of ["", "Single\nline", "First\n\nSecond", "First\r\n \r\n\t\r\nSecond", "\n\nStart\n\n", "$$x=1$$\n\n\\label{a} Words."]) {
    const chunks = sourceChunks(text);
    assert.equal(chunks.map(c => c.text + c.separator).join(""), text);
    for (const c of chunks) assert.equal(text.slice(c.start, c.end), c.text);
  }
  assert.equal(sourceChunks("First\nline").length, 1);
  assert.equal(sourceChunks("First\n").length, 1);
  assert.equal(hasTrailingLineBreak("First\n"), true);
  assert.equal(hasTrailingLineBreak("First\n\n"), true);
  assert.equal(hasTrailingLineBreak("First\nSecond"), false);
  const chunks = sourceChunks("First\n\n");
  assert.equal(chunks.length, 2); assert.equal(chunks[1].text, "");
  assert.equal(chunkAtOffset(chunks, 7), chunks[1]);
  assert.equal(sourceChunks("First\n\n\n\n").length, 2);
});

test("empty block removal keeps neighboring text and uses exactly one action", () => {
  assert.deepEqual(removeEmptyChunk("First\n\n", 7), { text: "First", caret: 5, start: 7, end: 7 });
  assert.equal(removeEmptyChunk("First\n\n  ", 9)?.text, "First");
  assert.equal(removeEmptyChunk("\n\nSecond", 0)?.text, "Second");
  assert.equal(removeEmptyChunk("First\n", 6), undefined);
  assert.equal(removeEmptyChunk("First\n\nSecond", 7), undefined);
});

test("saved prose splits on free blank lines while theorem and proof spacing stays inside the environment", async () => {
  const trials = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "chunk-newlines-")); await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\begin{document}\n\\section{Trial}\nProse.\n\\begin{theorem}\nStatement.\n\\end{theorem}\n\\begin{proof}\nProof.\n\\end{proof}\n\\end{document}\n");
  const project = await registerProject(workspace, "paper");
  const before = await parseProject(workspace, project.id), originals = before.paragraphs;
  const singles = Object.fromEntries(originals.map(p => [p.id, p.text + "\nSame block."]));
  const singleSaved = await saveEdits(workspace, project.id, singles, before.revision);
  assert.equal(singleSaved.paragraphs.length, originals.length);
  for (const p of singleSaved.paragraphs) { assert.equal(sourceChunks(p.text).length, 1); assert.match(p.text, /\nSame block\.$/); }
  const doubles = Object.fromEntries(singleSaved.paragraphs.map(p => [p.id, p.text + "\n\nNew block."]));
  const doubleSaved = await saveEdits(workspace, project.id, doubles, singleSaved.revision);
  assert.equal(doubleSaved.paragraphs.length, originals.length + 1);
  for (const p of originals) {
    const group = doubleSaved.paragraphs.filter(next => next.nodeId === p.nodeId);
    const enclosing = Boolean(doubleSaved.nodes.find(node => node.id === p.nodeId)?.environment);
    assert.equal(group.length, enclosing ? 1 : 2);
    if (enclosing) assert.equal(group[0].text, doubles[p.id]);
    else assert.equal(group[1].text, "New block.");
  }
});

test("extra blank lines never split open or closed math, nested environments, groups and literal code", () => {
  const syntax = ["$x\n\n+y$", "$$x\n\n+y$$", String.raw`\[x`+"\n\n"+String.raw`+y\]`, String.raw`\(x`+"\n\n"+String.raw`+y\)`,
    "\\begin{align}\nx&=1\n\n+y\\end{align}", "\\begin{itemize}\n\\item A\n\n\\begin{enumerate}\n\\item B\n\nC\\end{enumerate}\n\\end{itemize}",
    "\\textbf{A\n\nB}", "\\verb|$\n\n$|", "\\begin{verbatim}\n$\\begin{ignored}\n\n\\end{verbatim}"];
  for (const body of syntax) {
    const text = `Before.\r\n\r\n${body}\n\nAfter.`, chunks = sourceChunks(text);
    assert.equal(chunks.length, 3, body); assert.equal(chunks[1].text, body);
    assert.equal(chunks.map(chunk => chunk.text + chunk.separator).join(""), text);
  }
  for (const body of ["$x", "$$x", String.raw`\[x`, String.raw`\(x`, "\\begin{unknown}\nA", "\\begin{outer}\\begin{inner}A\\end{outer}", "\\textbf{A"]) {
    const text = `Before.\n\n${body}\n\nMore unfinished source.`;
    assert.equal(sourceChunks(text).length, 2, body);
  }
  assert.equal(sourceChunks("Statement.\n\nMore spacing.", true).length, 1);
  assert.equal(sourceChunks(String.raw`Cost \$5.`+"\n\nNext.").length, 2);
  assert.equal(sourceChunks("A. % $ \\begin{fake}\n\nNext.").length, 2);
  assert.equal(sourceChunks(String.raw`\newcommand{\foo}{\begin{list}}`+"\n\nNext.").length, 2);
});

test("Backspace merges a nonempty unsaved chunk without deleting text or swallowing comments", () => {
  assert.deepEqual(joinChunkAtStart("First.\n\nSecond.", 8), { text: "First. Second.", caret: 7 });
  assert.deepEqual(joinChunkAtStart("First. % note\n\nSecond.", 15), { text: "First. % note\nSecond.", caret: 14 });
  assert.equal(joinChunkAtStart("First.\n\nSecond.", 0), undefined);
  assert.equal(joinChunkAtStart("First.\n\nSecond.", 9), undefined);
  assert.equal(joinChunkAtStart("$$A\n\nB$$", 5), undefined);
});

test("typing then deleting a new block needs exactly one extra Backspace", () => {
  let value = "First\n\nabc";
  for (let i = 0; i < 3; i++) value = deleteSourceText(value, value.length, value.length, "backward").text;
  assert.equal(value, "First\n\n");
  assert.deepEqual(removeEmptyChunk(value, value.length), { text: "First", caret: 5, start: 7, end: 7 });
  // Native deletion used to strand the caret in a separator and add a BR.
  assert.equal(removeEmptyChunk("First\n\n\n", 7)?.text, "First");
  assert.equal(removeEmptyChunk("First\n\n", 6)?.text, "First");
  assert.equal(removeEmptyChunk("First\n\n", 5), undefined);
});

test("literal deletion respects selections, graphemes and intentional single Enter", () => {
  assert.deepEqual(deleteSourceText("A👩‍🔬B", 6, 6, "backward"), { text: "AB", caret: 1 });
  assert.deepEqual(deleteSourceText("Ae\u0301B", 1, 1, "forward"), { text: "AB", caret: 1 });
  assert.deepEqual(deleteSourceText("abc def", 1, 5, "backward"), { text: "aef", caret: 1 });
  assert.deepEqual(deleteSourceText("First\n", 6, 6, "backward"), { text: "First", caret: 5 });
  assert.deepEqual(deleteSourceText("First", 0, 0, "backward"), { text: "First", caret: 0 });
  assert.deepEqual(deleteSourceText("", 0, 0, "backward"), { text: "", caret: 0 });
});

test("a native placeholder in an emptied chunk is not saved as a source newline", () => {
  const br = { nodeType: 1, tagName: "BR", childNodes: [] };
  const node = (childNodes: unknown[]) => ({ nodeType: 1, tagName: "SPAN", childNodes, matches: () => true });
  assert.equal(editableText(node([br]) as unknown as Node), "");
  assert.equal(editableText(node([{ ...br, getAttribute: (key: string) => key === "data-source-break" ? "true" : null }]) as unknown as Node), "\n");
  assert.equal(editableText(node([{ nodeType: 3, textContent: "", childNodes: [] }, br]) as unknown as Node), "");
  assert.equal(editableText(node([{ nodeType: 3, textContent: "Line", childNodes: [] }, br]) as unknown as Node), "Line\n");
});

async function fixture() {
  const trials = path.join(process.cwd(), ".paperfocus/trials"); await mkdir(trials, { recursive: true });
  const workspace = await mkdtemp(path.join(trials, "chunk-notes-")); await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Trial}\nFirst sentence. Second sentence.\n\nUnrelated text.\n\\end{document}\n");
  const project = await registerProject(workspace, "paper");
  const parsed = await parseProject(workspace, project.id), before = publicDocument(parsed), p = before.paragraphs[0];
  const state: AppState = { destination: "manuscript", notebookEntries: [], suggestions: { relation: "unrelated", minimized: true }, turbo: freshTurbo(), lens: "paper", displayMode: "source", activeNodeId: p.nodeId, activeParagraphId: p.id, hiddenNodeIds: [], progressByNode: {}, paragraphEdits: {}, rewriteSessions: [], attentionTasks: [], themeLenses: [], activeThemeId: "", previewMode: "hidden" };
  return { workspace, project, before, p, state };
}

test("saved block joins retain notes and exact quote anchors; guarded undo restores the source", async () => {
  const f = await fixture(), current = f.before.paragraphs[1], original = await import("node:fs/promises").then(fs => fs.readFile(path.join(f.workspace, "paper/main.tex"), "utf8"));
  const selection = { paragraphId: current.id, nodeId: current.nodeId, start: 0, end: current.text.length, text: current.text, x: 0, y: 0 };
  const comment = makeReviewComment(f.before, {}, selection, "Human review stays open.");
  f.state.attentionTasks = [comment]; f.state.notebookEntries = [newNotebookEntry(f.before, f.state, selection)]; f.state.notebookEntries[0].notes = "Saved research evidence.";
  const result = await joinParagraphs(f.workspace, { projectId: f.project.id, mainFile: "main.tex", revision: f.before.revision, previousId: f.p.id, currentId: current.id });
  const after = publicDocument(result.parsed), joined = after.paragraphs[0];
  assert.equal(after.paragraphs.length, 1); assert.equal(joined.text, `${f.p.text} ${current.text}`);
  const confirmed = acknowledgeSave(f.state, f.before, after, {}, result.parsed.saveAcknowledgement).state;
  assert.equal(confirmed.attentionTasks[0].status, "queued"); assert.deepEqual(confirmed.attentionTasks[0].review, comment.review);
  assert.equal(reviewCommentTarget(confirmed.attentionTasks[0], after)?.start, f.p.text.length + 1);
  assert.equal(locateSavedPassage(confirmed.notebookEntries[0].source, after, {})?.id, joined.id);
  assert.equal(confirmed.notebookEntries[0].notes, "Saved research evidence.");
  const restored = await undoParagraphJoin(f.workspace, result.undo);
  assert.deepEqual(restored.paragraphs.map(p => p.text), f.before.paragraphs.map(p => p.text));
  assert.equal(await import("node:fs/promises").then(fs => fs.readFile(path.join(f.workspace, "paper/main.tex"), "utf8")), original);
  const submitted = { [joined.id]: result.undo.text.slice(0, result.undo.start) + result.undo.separator + result.undo.text.slice(result.undo.end) };
  const undone = acknowledgeSave(confirmed, after, publicDocument(restored), submitted, restored.saveAcknowledgement).state;
  assert.equal(reviewCommentTarget(undone.attentionTasks[0], publicDocument(restored))?.start, 0);
  const second = await joinParagraphs(f.workspace, { projectId: f.project.id, mainFile: "main.tex", revision: restored.revision, previousId: restored.paragraphs[0].id, currentId: restored.paragraphs[1].id });
  await saveEdits(f.workspace, f.project.id, { [second.undo.paragraphId]: second.undo.text + " Later human edit." }, second.parsed.revision);
  await assert.rejects(undoParagraphJoin(f.workspace, second.undo), /Source changed/);
});

test("joins preserve intervening source comments and paragraph markers on undo and refuse section boundaries", async () => {
  const f = await fixture();
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{Trial}\n% paperfocus:paragraph=first\nFirst.\n\n% Keep this source comment.\n% paperfocus:paragraph=second\nSecond.\n\\section{Other}\nThird.\n\\end{document}\n";
  await writeFile(path.join(f.workspace, "paper/main.tex"), source);
  const before = await parseProject(f.workspace, f.project.id), [first, second, third] = before.paragraphs;
  const request = { projectId: f.project.id, mainFile: "main.tex", revision: before.revision, previousId: first.id, currentId: second.id };
  await assert.rejects(joinParagraphs(f.workspace, { ...request, currentId: third.id }), /same section/);
  await assert.rejects(joinParagraphs(f.workspace, { ...request, revision: "stale" }), /source changed/);
  const result = await joinParagraphs(f.workspace, request);
  assert.equal(result.parsed.paragraphs[0].text, "First.\n% Keep this source comment.\nSecond.");
  const undone = await undoParagraphJoin(f.workspace, result.undo);
  assert.deepEqual(undone.paragraphs.map(p => p.id), before.paragraphs.map(p => p.id));
  assert.equal(await import("node:fs/promises").then(fs => fs.readFile(path.join(f.workspace, "paper/main.tex"), "utf8")), source);
});

test("saved math with extra spacing remains one block; unfinished math does not invent later headings", async () => {
  const f = await fixture();
  for (const closed of [true, false]) {
    await writeFile(path.join(f.workspace, "paper/main.tex"), "\\documentclass{article}\n\\begin{document}\n\\section{Trial}\nBefore.\n\n$$x\n\n\\text{\\section{Not a heading}}\n\n+y" + (closed ? "$$\n\nAfter." : "") + "\n\\end{document}\n");
    const parsed = await parseProject(f.workspace, f.project.id);
    assert.equal(parsed.nodes.filter(n => n.id !== "document").length, 1);
    assert.equal(parsed.paragraphs.length, closed ? 3 : 2);
    assert.ok(parsed.paragraphs[1].text.includes("\n\n"));
  }
});

test("block merge endpoint requires the editor origin and rejects stale saves without changing source", async () => {
  const f = await fixture();
  const server = await createServer({ configFile: false, root: f.workspace, plugins: [latexPlugin(f.workspace)], server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  try {
    await server.listen(); const address = server.httpServer!.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`;
    const request = { projectId: f.project.id, mainFile: "main.tex", revision: f.before.revision, previousId: f.p.id, currentId: f.before.paragraphs[1].id };
    const post = (body: unknown, from = origin) => fetch(origin + "/api/paperfocus/paragraph-join", { method: "POST", headers: { Origin: from, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await fetch(origin + "/api/paperfocus/paragraph-join")).status, 405);
    assert.equal((await post(request, "http://unrelated.example")).status, 403);
    assert.equal((await post({ ...request, revision: "stale" })).status, 409);
    assert.equal((await parseProject(f.workspace, f.project.id)).revision, f.before.revision);
    const response = await post(request); assert.equal(response.status, 200); const merged = await response.json();
    assert.equal(merged.document.paragraphs.length, 1); assert.ok(merged.saveAcknowledgement.paragraphMap[request.currentId].length);
    const undo = await post({ undo: merged.undo }); assert.equal(undo.status, 200);
    assert.equal((await undo.json()).document.paragraphs.length, 2);
  } finally { await server.close(); }
});

test("own splits move return links and exact quote ranges without rewriting notes or resolving comments", async () => {
  const f = await fixture(), quote = "Second sentence.", start = f.p.text.indexOf(quote);
  const selection = { paragraphId: f.p.id, nodeId: f.p.nodeId, start, end: start + quote.length, text: quote, x: 0, y: 0 };
  const comment = makeReviewComment(f.before, {}, selection, "Keep this human note.");
  const entry = newNotebookEntry(f.before, f.state, selection); entry.notes = "Research notes.";
  f.state.attentionTasks = [comment]; f.state.notebookEntries = [entry];
  const submitted = { [f.p.id]: "First sentence.\n\nSecond sentence." }; f.state.paragraphEdits = submitted;
  const saved = await saveEdits(f.workspace, f.project.id, submitted, f.before.revision), after = publicDocument(saved);
  const result = acknowledgeSave(f.state, f.before, after, submitted, saved.saveAcknowledgement).state;
  const c = result.attentionTasks[0], e = result.notebookEntries[0], second = after.paragraphs.find(p => p.text === quote)!;
  assert.equal(c.status, "queued"); assert.deepEqual(c.review, comment.review);
  assert.deepEqual(c.sourceSnapshot!.paragraphs, comment.sourceSnapshot!.paragraphs);
  assert.equal(e.source!.excerpt, quote); assert.equal(e.notes, entry.notes); assert.equal(e.source!.paragraphText, f.p.text);
  assert.equal(checkTaskSource(c.sourceSnapshot, after).target?.paragraphId, second.id);
  assert.equal(locateSavedPassage(e.source, after, {})?.id, second.id);
  assert.deepEqual(reviewCommentTarget(c, after), { paragraphId: second.id, nodeId: second.nodeId, start: 0, end: quote.length, text: quote });
  validateNotebookEntries(result.notebookEntries);
  validateWorkbench({ ...emptyWorkbench(), attentionTasks: result.attentionTasks });
  const edited = { [second.id]: "Replacement text." }, next = await saveEdits(f.workspace, f.project.id, edited, after.revision);
  const again = acknowledgeSave({ ...result, paragraphEdits: edited }, after, publicDocument(next), edited, next.saveAcknowledgement).state;
  assert.equal(again.attentionTasks[0].status, "queued"); assert.equal(again.attentionTasks[0].review?.kind, "comment");
  assert.equal(reviewCommentTarget(again.attentionTasks[0], publicDocument(next)), undefined);
  assert.equal(again.notebookEntries[0].notes, "Research notes.");
});

test("notes created on a new unsaved chunk follow settled saves and ongoing typing", async () => {
  const f = await fixture(), quote = "Second sentence.", first = { [f.p.id]: "First sentence.\n\nSecond sentence." };
  const selection = { paragraphId: f.p.id, nodeId: f.p.nodeId, start: first[f.p.id].indexOf(quote), end: first[f.p.id].length, text: quote, x: 0, y: 0 };
  f.state.paragraphEdits = first;
  f.state.attentionTasks = [makeReviewComment(f.before, first, selection)];
  f.state.notebookEntries = [newNotebookEntry(f.before, f.state, selection)];
  const saved = await saveEdits(f.workspace, f.project.id, first, f.before.revision);
  const live = { ...f.state, paragraphEdits: { [f.p.id]: first[f.p.id] + " Continued typing." } };
  const continued = reconcileEditorSave(live, f.before, publicDocument(saved), first, saved.saveAcknowledgement!);
  assert.equal(continued.state.attentionTasks[0].sourceSnapshot!.returnAnchor!.revision, continued.document.revision);
  const edits = continued.state.paragraphEdits;
  const next = await saveEdits(f.workspace, f.project.id, edits, continued.document.revision, continued.state.sourceSaveContinuation!.ranges);
  const settled = reconcileEditorSave(continued.state, continued.document, publicDocument(next), edits, next.saveAcknowledgement!);
  assert.equal(reviewCommentTarget(settled.state.attentionTasks[0], settled.document)?.start, 0);
  assert.match(locateSavedPassage(settled.state.notebookEntries[0].source, settled.document, {})!.text, /^Second sentence/);
  assert.equal(settled.state.attentionTasks[0].status, "queued");
});

test("themes follow edited and split passages on confirmed own saves, keeping pins, exclusions and drafts", async () => {
  const f = await fixture(), other = f.before.paragraphs[1];
  f.state.lens = "themes"; f.state.activeThemeId = "theme";
  f.state.themeLenses = [{ id: "theme", name: "Editable theme", seedParagraphId: f.p.id,
    matches: [{ paragraphId: f.p.id, score: .8, pinned: true }, { paragraphId: other.id, score: .2, excluded: true }],
    drafts: [{ id: "draft", text: "Unplaced draft.", createdAt: "now" }], composerText: "Still writing." }];
  const submitted = { [f.p.id]: "A revised first paragraph.\n\nA new second paragraph." };
  const saved = await saveEdits(f.workspace, f.project.id, submitted, f.before.revision), after = publicDocument(saved);
  const result = acknowledgeSave({ ...f.state, paragraphEdits: submitted }, f.before, after, submitted, saved.saveAcknowledgement).state;
  const theme = result.themeLenses[0], first = after.paragraphs.find(p => p.text === "A revised first paragraph.")!, second = after.paragraphs.find(p => p.text === "A new second paragraph.")!;
  assert.equal(theme.seedParagraphId, first.id);
  assert.deepEqual(theme.matches.filter(m => !m.excluded).map(m => m.paragraphId), [first.id, second.id]);
  assert.ok(theme.matches.filter(m => !m.excluded).every(m => m.pinned && m.score === .8));
  assert.equal(theme.matches.find(m => m.excluded)?.paragraphId, after.paragraphs.find(p => p.text === other.text)!.id);
  assert.deepEqual(theme.drafts, f.state.themeLenses[0].drafts); assert.equal(theme.composerText, "Still writing.");
  const edited = { [second.id]: "Another revision to the second paragraph." };
  const next = await saveEdits(f.workspace, f.project.id, edited, after.revision), nextDocument = publicDocument(next);
  const again = acknowledgeSave({ ...result, paragraphEdits: edited }, after, nextDocument, edited, next.saveAcknowledgement).state.themeLenses[0];
  assert.equal(again.matches.filter(m => !m.excluded).length, 2);
  assert.ok(again.matches.some(m => m.pinned && nextDocument.paragraphs.find(p => p.id === m.paragraphId)?.text === edited[second.id]));
});

test("theme joins keep one included match and refuse unverified source ranges", async () => {
  const f = await fixture(), other = f.before.paragraphs[1], joined = { ...f.p, id: "joined", text: `${f.p.text} ${other.text}` };
  const after = { ...f.before, revision: "joined-revision", paragraphs: [joined], nodes: [{ ...f.before.nodes[0], paragraphIds: [joined.id] }] };
  const acknowledgement = { baseRevision: f.before.revision, savedRevision: after.revision, sourceRanges: [], paragraphMap: {
    [f.p.id]: [{ paragraphId: joined.id, start: 0, end: f.p.text.length, targetStart: 0 }],
    [other.id]: [{ paragraphId: joined.id, start: 0, end: other.text.length, targetStart: f.p.text.length + 1 }],
  } };
  f.state.themeLenses = [{ id: "theme", name: "Join", seedParagraphId: f.p.id,
    matches: [{ paragraphId: f.p.id, score: .7, pinned: true, excluded: true }, { paragraphId: other.id, score: .9 }] }];
  const result = acknowledgeSave(f.state, f.before, after, {}, acknowledgement).state.themeLenses[0];
  assert.deepEqual(result.matches, [{ paragraphId: joined.id, score: .9, pinned: true, excluded: false }]);
  assert.equal(result.seedParagraphId, joined.id);
  const foreignFile = { ...after, paragraphs: [{ ...joined, file: "other.tex" }] };
  const invalid = acknowledgeSave(f.state, f.before, foreignFile, {}, acknowledgement).state.themeLenses[0];
  assert.deepEqual(invalid.matches, []); assert.equal(invalid.seedParagraphId, "");
});

test("navigation anchors validate ranges and never disambiguate duplicates across unknown revisions", () => {
  const a = { paragraphId: "p", paragraphText: "same", revision: "r", file: "main.tex", duplicateAtCapture: true, start: 0, end: 4 };
  validateReturnAnchor(a);
  for (const change of [{ end: 5 }, { start: -1 }, { end: undefined }, { start: 1.2 }]) assert.throws(() => validateReturnAnchor({ ...a, ...change }), /navigation anchor/);
  const document = { revision: "new", paragraphs: [{ id: "p", file: "main.tex", text: "same" }] } as any;
  assert.equal(locateReturnAnchor(a, document), undefined);
  assert.equal(locateReturnAnchor(a, { ...document, revision: "r" })?.id, "p");
});

test("blank boxes protect attached or uncertain notes, not unrelated preceding context", async () => {
  const f = await fixture(), text = f.p.text + "\n\n", start = text.length;
  const entry = newNotebookEntry(f.before, f.state, { paragraphId: f.p.id, nodeId: f.p.nodeId, start: 0, end: f.p.text.length, text: f.p.text, x: 0, y: 0 });
  f.state.notebookEntries = [entry];
  assert.equal(emptyChunkHasContext(f.state, f.before, f.p.id, text, start, start), false);
  entry.source!.returnAnchor = { paragraphId: f.p.id, paragraphText: text, revision: f.before.revision, file: f.p.file, start, end: start };
  entry.source!.excerpt = "";
  assert.equal(emptyChunkHasContext(f.state, f.before, f.p.id, text, start, start), true);
  entry.source!.returnAnchor = { ...entry.source!.returnAnchor!, start: undefined, end: undefined };
  assert.equal(emptyChunkHasContext(f.state, f.before, f.p.id, text, start, start), true);
  assert.equal(emptyChunkHasContext(f.state, f.before, "unrelated", text, start, start), false);
});
