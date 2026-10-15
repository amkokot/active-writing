import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { clipSelectedChunks, notebookExcerpt, notebookSurroundingSource, selectedRewriteEdits, verifySelection } from "../src/selectionPassages.ts";
import { createRewriteSession } from "../src/rewrite.ts";
import { rewriteSourceMatches } from "../src/workbench.ts";
import { newNotebookEntry, notebookPacket, notebookTaskSource, proposalReplacement } from "../src/notebook.ts";
import { freshTurbo } from "../src/turbo.ts";
import { validateNotebookEntries } from "./notebookStore.ts";
import { validateWorkbench } from "./workbenchStore.ts";
import { refreshSourceState } from "../src/sourceRefresh.ts";
import { emptyChunkHasContext } from "../src/sourceAnchors.ts";
import type { AppState, PendingSelection, ProjectDocument } from "../src/types.ts";

const first = { id: "p1", nodeId: "n1", file: "main.tex", text: "Before. In order to show $x$, we argue.\n\nFurthermore, $y$ follows. After." };
const second = { id: "p2", nodeId: "n2", file: "appendix.tex", text: "We observe the result. Outside." };
const read = (id: string) => [first, second].find(p => p.id === id);
function selection(): PendingSelection {
  const spans = [...clipSelectedChunks(first, 8, first.text.indexOf(" After.")), ...clipSelectedChunks(second, 0, 22)];
  return { ...spans[0], text: spans.map(s => s.text).join("\n\n"), spans, x: 0, y: 0 };
}
function session() { return createRewriteSession({ ...selection(), paragraphText: first.text }); }

test("source select-all is pane-scoped, includes literal commands, copies exact source and protects cross-host edits", async () => {
  const source = await readFile(new URL("../src/components/Manuscript.tsx", import.meta.url), "utf8");
  assert.match(source, /event\.key\.toLowerCase\(\) === "a" && selectSource\(event\.target, event\.shiftKey\)/);
  assert.match(source, /querySelectorAll<HTMLElement>\("p\[data-paragraph-id\],textarea\.literal-source-command"\)/);
  assert.match(source, /!unit\.closest\('\[data-reel-held="true"\]'\)/);
  assert.match(source, /blockOnly && element instanceof HTMLTextAreaElement.*element\.select\(\)/);
  assert.match(source, /paragraph\?\.querySelector<HTMLElement>\('\.source-chunk\[data-active="true"\]'\) \?\? paragraph/);
  assert.match(source, /unit instanceof HTMLTextAreaElement \? unit\.value : editableText\(unit\)/);
  assert.match(source, /onCut=\{event=>\{if\(crossBlockRange\.current \|\| selectedSource\.current\)event\.preventDefault\(\)/);
  assert.match(source, /key==="Escape" && \(crossBlockRange\.current \|\| selectedSource\.current\)/);
  assert.match(source, /delete element\.dataset\.sourceSelected/);
  const keyboardSelection = source.slice(source.indexOf("const selectSource ="), source.indexOf("useEffect(()=>()=>{CSS.highlights"));
  assert.doesNotMatch(keyboardSelection, /dataset\.crossBlockSelection\s*=/);
  assert.match(keyboardSelection, /unit\.dataset\.sourceSelected = "true"/);
  assert.match(source, /element\.querySelector\('\[data-source-selected="true"\]'\)/);
  assert.doesNotMatch(source, /execCommand\(["']selectAll/);
});

test("multi-block selection clips exact partial blocks and retains UTF-16/CRLF positions", () => {
  assert.equal(verifySelection(selection(), read).length, 3);
  const p = { id: "unicode", nodeId: "node", text: "😀 First\r\n\r\nSecond\r\nline" };
  assert.deepEqual(clipSelectedChunks(p, 3, p.text.length).map(s => [s.start, s.end, s.text]), [[3, 8, "First"], [12, p.text.length, "Second\r\nline"]]);
  assert.deepEqual(clipSelectedChunks(p, 8, 12), []);
});
test("selection rejects stale, overlapping, empty and out-of-bounds captures", () => {
  const s = selection();
  assert.throws(() => verifySelection({ ...s, spans: [s.spans![0], s.spans![0]] }, read), /overlapping/);
  assert.throws(() => verifySelection({ ...s, spans: [] }, read), /between/);
  assert.throws(() => verifySelection({ ...s, spans: Array(201).fill(s.spans![0]) }, read), /between/);
  for (const change of [{ end: 999 }, { start: -1 }, { nodeId: "wrong" }, { text: "changed" }]) assert.throws(() => verifySelection({ ...s, spans: [{ ...s.spans![0], ...change }] }, read), /changed/);
});
test("combined rewrite atomically updates multiple blocks in one paragraph and another file", () => {
  const s = session(), candidate = "To show $x$, we argue.\n\nAlso, $y$ follows.\n\nWe see the result.";
  const edited = selectedRewriteEdits(s, candidate, id => read(id)?.text);
  assert.deepEqual(edited.edits, { p1: "Before. To show $x$, we argue.\n\nAlso, $y$ follows. After.", p2: "We see the result. Outside." });
  assert.equal(first.text, read("p1")!.text);
});
test("replacement never partially applies stale source, wrong block counts or moved math", () => {
  const s = session();
  assert.match(selectedRewriteEdits(s, "Merged prose", id => read(id)?.text).error!, /Keep 3 blocks/);
  const candidate = "To show $x$, we argue.\n\nAlso, $y$ follows.\n\nWe see the result.";
  const stale = selectedRewriteEdits(s, candidate, id => id === "p2" ? "New source" : read(id)?.text);
  assert.match(stale.error!, /changed/); assert.equal(stale.edits, undefined);
  const movedMath = selectedRewriteEdits(s, "To show $x$, we argue; $y$ follows.\n\nAlso, we conclude.\n\nWe see the result.", id => read(id)?.text);
  assert.match(movedMath.error!, /math and LaTeX/); assert.equal(movedMath.edits, undefined);
  assert.ok(selectedRewriteEdits({ ...s, selectionSpans: [] }, "", id => read(id)?.text).error);
});
test("multi-block rewrite drafts persist and reopen only when every source still matches", () => {
  const s = session();
  const stored = JSON.parse(JSON.stringify({ rewriteSessions: [s], attentionTasks: [], handoffDrafts: {}, recoveredDrafts: [] }));
  validateWorkbench(stored);
  assert.deepEqual(stored.rewriteSessions[0].selectionSpans, selection().spans);
  assert.equal(rewriteSourceMatches(s, first.text, id => read(id)?.text), true);
  assert.equal(rewriteSourceMatches(s, first.text, id => id === "p2" ? "changed" : read(id)?.text), false);
  for (const c of s.candidates) assert.ok(selectedRewriteEdits(s, c.text, id => read(id)?.text).edits);
});
const document = { project: { id: "trial", folder: "paper", mainFile: "main.tex" }, files: [], revision: "original", nodes: [{ id: "n1", title: "Main", paragraphIds: ["p1"] }, { id: "n2", title: "Proof", paragraphIds: ["p2"] }], paragraphs: [first, second] } as ProjectDocument;
const state = { paragraphEdits: {}, notebookEntries: [], lens: "paper", previewMode: "rendered", turbo: freshTurbo() } as unknown as AppState;
test("source refresh relocates all selected rewrite blocks without borrowing reused IDs", () => {
  const s = session(), before = document;
  const current = { ...state, hiddenNodeIds: [], rewriteSessions: [s], attentionTasks: [], themeLenses: [] };
  const after = { ...before, revision: "new", paragraphs: [{ ...first, id: "new-first" }, { ...second, id: "new-second" }] };
  const refreshed = refreshSourceState(current, before, after);
  assert.deepEqual(refreshed.rewriteSessions[0].selectionSpans!.map(s => s.paragraphId), ["new-first", "new-first", "new-second"]);
  assert.equal(refreshed.rewriteSessions[0].status, "draft");
  const missing = refreshSourceState(current, before, { ...after, paragraphs: [{ ...first, text: "Unrelated replacement" }, second] }).rewriteSessions[0];
  assert.equal(missing.status, "stale"); assert.ok(missing.paragraphId.startsWith("unlinked:"));
  assert.equal(missing.sourceText, s.sourceText); assert.deepEqual(missing.candidates, s.candidates);
});
test("a notebook capture protects notes on later blocks, not only the first block", () => {
  const entry = newNotebookEntry(document, state, selection());
  assert.equal(emptyChunkHasContext({ ...state, attentionTasks: [], notebookEntries: [entry] }, document, "p2", second.text, 0, 22), true);
  assert.equal(emptyChunkHasContext({ ...state, attentionTasks: [], notebookEntries: [entry] }, document, "unrelated", "", 0, 0), false);
});
test("questions capture all blocks and full source context without substituting new text", () => {
  const entry = newNotebookEntry(document, state, selection());
  validateNotebookEntries([entry]);
  assert.equal(notebookExcerpt(entry.source), selection().text);
  assert.equal(notebookSurroundingSource(entry.source), `${first.text}\n\n${second.text}`);
  const snapshot = notebookTaskSource(entry, { ...document, revision: "new", paragraphs: [] })!;
  assert.equal(snapshot.paragraphs.length, 2); assert.equal(snapshot.paragraphs[1].file, "appendix.tex");
  assert.equal(snapshot.revision, "original");
  assert.ok(notebookPacket(entry, document.project).includes(selection().text));
  assert.match(proposalReplacement(entry, first.text).error!, /several blocks/);
  const bad = structuredClone(entry); bad.source!.passages![1].end = 999;
  assert.throws(() => validateNotebookEntries([bad]), /range/);
  const overlapping = structuredClone(entry); overlapping.source!.passages![1] = { ...overlapping.source!.passages![0] };
  assert.throws(() => validateNotebookEntries([overlapping]), /overlap/);
});
