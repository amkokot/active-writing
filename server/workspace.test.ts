import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProject, registerProject, saveEdits } from "./projects.ts";
import { focusedDocument } from "./focus.ts";
import type { ManuscriptNode, Paragraph } from "../src/types.ts";
import { defaultHandoff, handoffContext, initialCollapsed, outlineRows, themeGap, themePassages, thinkingLevels, visiblePreviewNodes } from "../src/workspaceTools.ts";
import { chooseManuscriptScope, manuscriptBlockWindow, manuscriptScope, normalizeBlockWindow, restrictNodesToParagraphs, windowScrollStep } from "../src/manuscriptView.ts";
import { freshTurbo } from "../src/turbo.ts";
import { replyReturnBookmark } from "../src/attention.ts";
import type { AppState } from "../src/types.ts";
import { reelCandidate, reelOpacity, reelRange } from "../src/blockReel.ts";
import { attachProofLinks } from "../src/proofLinks.ts";
import { adjacentManuscriptSection, sectionEdgeStep, type SectionEdgeIntent } from "../src/manuscriptView.ts";

test("section edges accept a lighter gesture while rejecting arrival momentum and rapid chaining", () => {
  let intent: SectionEdgeIntent = {at: 0, started: 0, amount: 0, sign: 0, armed: false, cooldown: 0};
  const step = (now: number, delta: number, extra: Partial<Parameters<typeof sectionEdgeStep>[1]> = {}) => {
    const result = sectionEdgeStep(intent, {now, delta, atEdge: true, allowed: true, blocked: false, ...extra}); intent = result.intent; return result.direction;
  };
  assert.equal(step(1000, 100, {atEdge: false}), 0);
  for (let now = 1100; now <= 2000; now += 100) assert.equal(step(now, 300), 0, "arrival momentum never arms");
  assert.equal(step(2200, 90), 0, "a shorter pause arms it");
  assert.equal(step(2260, 90), 0, "enough distance but insufficient dwell");
  assert.equal(step(2340, 30), 1, "210 pixels suffice, not the old 600");
  assert.equal(step(3000, 3000), 0, "no rapid chained section changes");
  assert.equal(step(4200, -120), 0);
  assert.equal(step(4350, -120), -1, "two deliberate wheel steps suffice");
  assert.equal(step(6000, 400, {blocked: true}), 0);
  assert.equal(step(6400, 400, {allowed: false}), 0);
});

test("section navigation skips hidden sections and nested statements, preserving level", () => {
  const nodes: ManuscriptNode[] = [
    {id: "a", kind: "section", depth: 0, title: "A", paragraphIds: []},
    {id: "sub", parentId: "a", kind: "subsection", depth: 1, title: "Sub", paragraphIds: []},
    {id: "lem", parentId: "a", kind: "lemma", environment: "lemma", depth: 1, title: "Fact", paragraphIds: []},
    {id: "b", kind: "section", depth: 0, title: "B", paragraphIds: []},
    {id: "c", kind: "section", depth: 0, title: "C", paragraphIds: []},
  ];
  assert.equal(adjacentManuscriptSection(nodes, "a", [], 1)?.id, "b");
  assert.equal(adjacentManuscriptSection(nodes, "a", ["b"], 1)?.id, "c");
  assert.equal(adjacentManuscriptSection(nodes, "c", [], -1)?.id, "b");
  assert.equal(adjacentManuscriptSection(nodes, "a", [], -1), undefined);
  assert.equal(adjacentManuscriptSection(nodes, "lem", [], 1), undefined);
  assert.equal(adjacentManuscriptSection(nodes, "sub", [], 1), undefined);
});

test("section-edge UI saves before navigation, fences other actions, and never recompiles or checks work", async () => {
  const app = await readFile("src/App.tsx", "utf8"), source = await readFile("src/components/Manuscript.tsx", "utf8"), preview = await readFile("src/components/Preview.tsx", "utf8");
  const move = app.slice(app.indexOf("async function moveSection"), app.indexOf("function scrollBlockWindow"));
  assert.match(move, /await savePaper\(\)/);
  assert.match(move, /current.focusedNodeId !== departingSection/);
  assert.match(move, /latestDocument.current\?\.project.mainFile !== owner.project.mainFile/);
  assert.doesNotMatch(move, /compileLatex\(|setPreviewFormat\(|progressByNode|checkParagraph|resolve/);
  for (const pane of [source, preview]) {
    assert.match(pane, /sectionWheel\(event\)/);
    assert.match(pane, /sectionNavigation\?\.previous && <button/);
    assert.match(pane, /sectionNavigation\?\.next && <button/);
  }
});

test("proof headings link conservatively without using proof-body references or guessing duplicate labels", () => {
  const linked: ManuscriptNode[] = [
    { id: "a", kind: "theorem", title: "Theorem 1", depth: 2, paragraphIds: [] },
    { id: "b", kind: "lemma", title: "Lemma 2.1", depth: 2, paragraphIds: [] },
    { id: "shared", kind: "proof", title: "Proof", depth: 2, environmentTitle: String.raw`Proof of \cref{a,b}`, paragraphIds: [] },
    { id: "named", kind: "proof", title: "Proof", depth: 2, environmentTitle: "Proof of Lemma~2.1.", paragraphIds: [] },
    { id: "unknown", kind: "proof", title: "Proof", depth: 2, environmentTitle: String.raw`Proof of \ref{unknown}`, paragraphIds: [] },
    { id: "duplicate", kind: "proof", title: "Proof", depth: 2, environmentTitle: String.raw`Proof of \ref{dup}`, paragraphIds: [] },
    { id: "untitled", kind: "proof", title: "Proof", depth: 2, paragraphIds: [] },
  ];
  const label = (key: string, nodeId: string) => ({ key, nodeId, file: "main.tex", line: 1 });
  attachProofLinks(linked, [label("a", "a"), label("b", "b"), label("dup", "a"), label("dup", "b")]);
  assert.deepEqual(linked[2].proofFor, ["a", "b"]);
  assert.deepEqual(linked[3].proofFor, ["b"]);
  assert.equal(linked[4].proofFor, undefined); assert.equal(linked[5].proofFor, undefined); assert.equal(linked[6].proofFor, undefined);
  linked.push({ id: "b2", kind: "lemma", title: "Lemma 2.1", depth: 2, paragraphIds: [] });
  attachProofLinks(linked, []); assert.equal(linked[3].proofFor, undefined, "ambiguous names do not link");
});

test("a focused result brings forward appendix proofs while keeping source IDs, order and edit destination", async () => {
  const root = await mkdtemp(path.join(process.cwd(), ".paperfocus", "trials", "linked-proof-"));
  await mkdir(path.join(root, "paper"));
  const main = String.raw`\documentclass{article}
\usepackage{amsthm,hyperref}
\newtheorem{theorem}{Theorem}\newtheorem{lemma}{Lemma}
\begin{document}\section{Results}
\begin{theorem}\label{thm:a}First statement.\end{theorem}
\begin{lemma}\label{lem:b}Second statement.\end{lemma}
\input{appendix}\end{document}`;
  const appendix = String.raw`\section{Appendix}
\begin{proof}[Proof of Theorem~\ref{thm:a}]
Original appendix argument.
\end{proof}
\begin{proof}[Proof of \hyperref[lem:b]{Lemma 1}]
Second appendix argument.
\end{proof}
\begin{proof}[Unrelated calculation]
We use \ref{thm:a}, but do not prove it here.
\end{proof}`;
  await writeFile(path.join(root, "paper/main.tex"), main);
  await writeFile(path.join(root, "paper/appendix.tex"), appendix);
  const project = await registerProject(root, "paper"), parsed = await parseProject(root, project.id);
  const theorem = parsed.nodes.find(node => node.kind === "theorem")!, lemma = parsed.nodes.find(node => node.kind === "lemma")!;
  const proofs = parsed.nodes.filter(node => node.kind === "proof"), appendixNode = parsed.nodes.find(node => node.title === "Appendix")!;
  assert.deepEqual(proofs[0].proofFor, [theorem.id]); assert.deepEqual(proofs[1].proofFor, [lemma.id]);
  assert.equal(proofs[1].environmentTitle, String.raw`Proof of \hyperref[lem:b]{Lemma 1}`);
  assert.equal(proofs[0].parentId, appendixNode.id, "source ancestry is still the appendix");
  const focused = visiblePreviewNodes(parsed.nodes, "paper", theorem.id);
  assert.deepEqual(focused.map(node => node.id), [theorem.id, proofs[0].id]);
  assert.deepEqual(visiblePreviewNodes(parsed.nodes, "proofs", theorem.id).map(node => node.id), [theorem.id, proofs[0].id]);
  assert.deepEqual(visiblePreviewNodes(parsed.nodes, "paper", theorem.id, [appendixNode.id]).map(node => node.id), [theorem.id]);
  assert.deepEqual(visiblePreviewNodes(parsed.nodes, "paper").map(node => node.id), parsed.nodes.map(node => node.id));
  const context = handoffContext(theorem, parsed.nodes, parsed.paragraphs, {}, "section");
  assert.ok(context.includes("Original appendix argument.")); assert.ok(!context.includes("Second appendix argument."));
  const excerpt = focusedDocument(parsed, { focusNodeId: theorem.id });
  assert.ok(excerpt.indexOf("First statement.") < excerpt.indexOf("Original appendix argument."));
  assert.ok(!excerpt.includes("Second appendix argument.")); assert.ok(!excerpt.includes("Unrelated calculation"));
  const sourceParagraph = parsed.paragraphs.find(p => p.nodeId === proofs[0].id)!;
  const window = manuscriptBlockWindow(parsed.nodes, parsed.paragraphs, "paper", [], { radius: 0, paragraphId: theorem.paragraphIds[0] });
  assert.deepEqual(window.paragraphs.map(p => p.id), theorem.paragraphIds, "a local window is never silently enlarged");
  await saveEdits(root, project.id, { [sourceParagraph.id]: "Edited original appendix argument." }, parsed.revision);
  assert.equal(await readFile(path.join(root, "paper/main.tex"), "utf8"), main);
  assert.equal(await readFile(path.join(root, "paper/appendix.tex"), "utf8"), appendix.replace("Original appendix argument.", "Edited original appendix argument."));
  const refreshed = await parseProject(root, project.id);
  assert.equal(refreshed.paragraphs.find(p => p.id === sourceParagraph.id)?.text, "Edited original appendix argument.");
  assert.deepEqual(refreshed.nodes.find(node => node.id === proofs[0].id)?.proofFor, [theorem.id]);
});

test("source reel overscan stays bounded without changing the real window", () => {
  assert.deepEqual(reelRange(1000, 500, 3), { start: 492, end: 511 });
  assert.deepEqual(reelRange(1000, 500, 9, 1000), { start: 484, end: 525 });
  assert.deepEqual(reelRange(5, 0, 1), { start: 0, end: 5 });
  const core = manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 0, paragraphId: "c" });
  reelRange(core.total, core.before, core.paragraphs.length);
  assert.deepEqual(core.paragraphs.map(p => p.id), ["c"], "overscan never enters compile context");
});

test("reel context fades in graduated steps and tall blocks remain focusable", () => {
  assert.equal(reelOpacity(1, 1), 1);
  assert.ok(reelOpacity(2, 1) > reelOpacity(3, 1));
  assert.ok(reelOpacity(3, 1) > reelOpacity(6, 1));
  assert.equal(reelOpacity(100, 1), 0.16);
  assert.equal(reelCandidate([{ id: "a", top: -1000, bottom: 400 }, { id: "b", top: 410, bottom: 450 }], 300), "a");
  assert.equal(reelCandidate([{ id: "a", top: 0, bottom: 80 }, { id: "b", top: 100, bottom: 180 }], 120), "b");
  assert.equal(reelCandidate([], 300), undefined);
});

const nodes: ManuscriptNode[] = [
  { id: "intro", title: "Introduction", kind: "section", depth: 0, paragraphIds: ["a"] },
  { id: "detail", parentId: "intro", title: "Detail", kind: "subsection", depth: 1, paragraphIds: ["b"] },
  { id: "lemma", parentId: "detail", title: "Lemma", kind: "lemma", depth: 2, paragraphIds: ["c"] },
  { id: "proof", parentId: "lemma", title: "Proof", kind: "proof", depth: 2, paragraphIds: ["d"] },
  { id: "conclusion", title: "Conclusion", kind: "section", depth: 0, paragraphIds: ["e"] },
];
const paragraphs: Paragraph[] = nodes.map((node, index) => ({ id: node.paragraphIds[0], nodeId: node.id, file: index > 0 ? "sections/theory.tex" : "main.tex", text: `Passage ${index} with $x  + y$ and \\ref{bound}.` }));

test("moving windows cross section/file boundaries and include technical blocks without marking work done", () => {
  const window = manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 1, paragraphId: "d" });
  assert.deepEqual(window.paragraphs.map(p => p.id), ["c", "d", "e"]);
  assert.equal(window.index, 3); assert.equal(window.before, 2); assert.equal(window.after, 0);
  assert.equal(window.total, 5);
  assert.deepEqual(manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 0, paragraphId: "c" }).paragraphs.map(p => p.id), ["c"]);
  assert.deepEqual(manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 4, paragraphId: "c" }).paragraphs, paragraphs);
  assert.deepEqual(manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 4, paragraphId: "e" }).paragraphs, paragraphs, "a large window on a short paper still shows the whole paper at an edge");
  assert.deepEqual(manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 1, paragraphId: "a" }).paragraphs.map(p => p.id), ["a", "b", "c"]);
  assert.deepEqual(manuscriptBlockWindow(nodes, paragraphs, "paper", [], { radius: 1, paragraphId: "c" }, "d").paragraphs.map(p => p.id), ["b", "c", "d"], "editing a neighbor does not shift the window");
});

test("windows honor hidden ancestors/proof filters and handle stale cursors and empty papers", () => {
  const hidden = manuscriptBlockWindow(nodes, paragraphs, "paper", ["detail"], { radius: 1, paragraphId: "c" }, "e");
  assert.deepEqual(hidden.paragraphs.map(p => p.id), ["a", "e"]);
  const proofs = manuscriptBlockWindow(nodes, paragraphs, "proofs", [], { radius: 1, paragraphId: "a" });
  assert.deepEqual(proofs.paragraphs.map(p => p.id), ["c", "d"]);
  const empty = manuscriptBlockWindow(nodes, paragraphs, "paper", ["intro", "conclusion"], { radius: 4 });
  assert.deepEqual(empty.paragraphs, []); assert.equal(empty.total, 0); assert.equal(empty.before, 0); assert.equal(empty.after, 0);
});

test("empty section insertion appears in order rather than at the end of a block window", () => {
  const empty: Paragraph = { id: "empty", nodeId: "blank", text: "", emptySource: true, file: "main.tex" };
  const orderedNodes: ManuscriptNode[] = [{ id: "blank", title: "Blank", depth: 0, kind: "section", paragraphIds: ["empty"] }, ...nodes];
  const window = manuscriptBlockWindow(orderedNodes, [...paragraphs, empty], "paper", [], { radius: 1, paragraphId: "a" });
  assert.deepEqual(window.paragraphs.map(p => p.id), ["empty", "a", "b"]);
  assert.equal(window.before, 0); assert.equal(window.after, 3);
});

test("scope changes leave drafts, comments, progress, and hidden sections intact; section scope uses the enclosing section", () => {
  const state = { activeNodeId: "proof", activeParagraphId: "d", focusedNodeId: "intro", lens: "paper", turbo: { ...freshTurbo(), enabled: true },
    paragraphEdits: { d: "Unsaved" }, attentionTasks: [{ id: "comment", status: "queued" }], progressByNode: { proof: "blank" }, hiddenNodeIds: ["conclusion"] } as unknown as AppState;
  const window = chooseManuscriptScope(state, "window", nodes);
  assert.equal(manuscriptScope(window), "window"); assert.equal(window.focusedNodeId, undefined); assert.equal(window.turbo.enabled, false);
  assert.deepEqual(window.blockWindow, { radius: 1, paragraphId: "d" });
  const section = chooseManuscriptScope(window, "section", nodes);
  assert.equal(manuscriptScope(section), "section"); assert.equal(section.focusedNodeId, "intro");
  const all = chooseManuscriptScope(section, "all", nodes);
  assert.equal(manuscriptScope(all), "all"); assert.equal(all.blockWindow, undefined); assert.equal(all.focusedNodeId, undefined);
  for (const next of [window, section, all]) {
    assert.equal(next.paragraphEdits, state.paragraphEdits); assert.equal(next.attentionTasks, state.attentionTasks);
    assert.equal(next.progressByNode, state.progressByNode); assert.equal(next.hiddenNodeIds, state.hiddenNodeIds);
    assert.deepEqual(next.turbo.reviews, {});
  }
});

test("window sizing/cursor survives JSON storage and reply bookmarks; malformed sizes are bounded", () => {
  for (const radius of [0, 1, 2, 4]) assert.deepEqual(normalizeBlockWindow(JSON.parse(JSON.stringify({ radius, paragraphId: "d" }))), { radius, paragraphId: "d" });
  assert.equal(normalizeBlockWindow(undefined), undefined);
  assert.equal(normalizeBlockWindow("invalid"), undefined);
  assert.deepEqual(normalizeBlockWindow({ radius: 1000, paragraphId: 2 }), { radius: 1, paragraphId: undefined });
  const state = { activeNodeId: "proof", activeParagraphId: "d", lens: "paper", destination: "manuscript", previewMode: "split",
    blockWindow: { radius: 2, paragraphId: "c" }, notebookEntries: [], turbo: freshTurbo() } as unknown as AppState;
  assert.deepEqual(replyReturnBookmark(state, { id: "other" } as never).blockWindow, state.blockWindow);
});

test("reading/editor window filters retain node headings without unrelated paragraphs or duplicate nodes", () => {
  assert.deepEqual(restrictNodesToParagraphs(nodes, ["c", "d", "e"]).map(n => [n.id, n.paragraphIds]), [["lemma", ["c"]], ["proof", ["d"]], ["conclusion", ["e"]]]);
  assert.deepEqual(restrictNodesToParagraphs(nodes, []), []);
  assert.equal(restrictNodesToParagraphs(nodes), nodes);
  const repeated = [{ ...nodes[0], paragraphIds: ["a", "z"] }, ...nodes.slice(1)];
  assert.deepEqual(restrictNodesToParagraphs(repeated, ["a", "c", "z"]).map(n => [n.id, n.paragraphIds]), [["intro", ["a"]], ["lemma", ["c"]], ["intro", ["z"]]], "prose after an object stays after it, not regrouped under an earlier heading");
});

test("edge scrolling advances one block with an intent threshold; selection, busy tools, ends and ordinary scrolling don't advance", () => {
  const initial = { amount: 0, at: 0, lastAdvance: 0 };
  const event = { deltaY: 120, deltaMode: 0, now: 1000, scrollTop: 0, scrollHeight: 300, clientHeight: 500, before: 2, after: 3, blocked: false };
  const down = windowScrollStep(initial, event); assert.equal(down.direction, 1);
  assert.equal(windowScrollStep(down.intent, { ...event, now: 1500 }).direction, undefined, "inertia cannot sprint through the paper");
  assert.equal(windowScrollStep(initial, { ...event, blocked: true }).direction, undefined);
  assert.equal(windowScrollStep(initial, { ...event, scrollHeight: 1000 }).direction, undefined);
  assert.equal(windowScrollStep(initial, { ...event, after: 0 }).direction, undefined);
  assert.equal(windowScrollStep(initial, { ...event, deltaY: -120 }).direction, -1);
  assert.equal(windowScrollStep(initial, { ...event, deltaY: -120, before: 0 }).direction, undefined);
  const small = windowScrollStep(initial, { ...event, deltaY: 60 }); assert.equal(small.direction, undefined);
  assert.equal(windowScrollStep(small.intent, { ...event, deltaY: 60, now: 1100 }).direction, 1);
  assert.equal(windowScrollStep(small.intent, { ...event, deltaY: -60, now: 1100 }).direction, undefined, "reversing direction resets intent");
  assert.equal(windowScrollStep(initial, { ...event, deltaY: 8, deltaMode: 1 }).direction, 1);
  assert.equal(windowScrollStep(initial, { ...event, deltaY: 1, deltaMode: 2 }).direction, 1);
});

test("contents branches really collapse; proof objects stay grouped with their ancestors", () => {
  assert.deepEqual(initialCollapsed(nodes, "detail"), ["lemma"]);
  assert.deepEqual(outlineRows(nodes, "paper", ["detail"]).map((row) => row.node.id), ["intro", "detail", "conclusion"]);
  assert.deepEqual(outlineRows(nodes, "proofs").map((row) => row.node.id), ["intro", "detail", "lemma", "proof"]);
  assert.deepEqual(outlineRows(nodes, "proofs", ["lemma"]).map((row) => row.node.id), ["intro", "detail", "lemma"]);
  const proof = outlineRows(nodes, "proofs").find((row) => row.node.id === "proof")!;
  assert.equal(proof.depth, 3, "use actual ancestry rather than parser display depth");
  assert.equal(proof.expandable, false);
  assert.equal(outlineRows(nodes, "paper")[0].expandable, true);
});

test("uncompiled previews honor deep focus, proof lenses, and hidden ancestors", () => {
  assert.deepEqual(visiblePreviewNodes(nodes, "paper", "intro").map((node) => node.id), ["intro", "detail", "lemma", "proof"]);
  assert.deepEqual(visiblePreviewNodes(nodes, "proofs", "lemma").map((node) => node.id), ["lemma", "proof"]);
  assert.deepEqual(visiblePreviewNodes(nodes, "proofs", "intro", ["detail"]), []);
  assert.deepEqual(visiblePreviewNodes(nodes, "paper", "intro", ["intro"]), []);
});

test("section handoffs include nested statements and proofs from their original files", () => {
  const text = handoffContext(nodes[0], nodes, paragraphs, { c: "Edited $x  + y$ with \\ref{bound}." }, "section");
  assert.match(text, /### Lemma/); assert.match(text, /### Proof/);
  assert.ok(text.includes("Edited $x  + y$ with \\ref{bound}."));
  assert.ok(!text.includes("Passage 4"), "never include unrelated branches");
  assert.equal(handoffContext(nodes[0], nodes, paragraphs, {}, "paragraph", "b"), paragraphs[1].text);
  assert.equal(handoffContext(nodes[0], nodes, paragraphs, {}, "paragraph", "missing"), "", "missing excerpt cannot silently expand context");
  assert.equal(handoffContext(nodes[0], nodes, paragraphs, {}, "none"), "");
});

test("theme excerpts follow manuscript order and gaps contain only the intervening source", () => {
  assert.deepEqual(themePassages(paragraphs, ["e", "c", "a", "missing"]).map((paragraph) => paragraph.id), ["a", "c", "e"]);
  assert.deepEqual(themeGap(paragraphs, "a", "d").map((paragraph) => paragraph.id), ["b", "c"]);
  assert.deepEqual(themeGap(paragraphs, "e", "a"), []);
  assert.deepEqual(themeGap(paragraphs, "missing", "e"), []);
});

test("handoff defaults preserve lighter choices and make paragraph scope explicit in Turbo", () => {
  assert.deepEqual(thinkingLevels, ["Quick", "Light", "Medium", "High", "Maximum"]);
  assert.equal(defaultHandoff("chatgpt", true).scope, "paragraph");
  assert.equal(defaultHandoff("codex").scope, "section");
  assert.equal(defaultHandoff("codex").effort, 1);
});

test("section-numbered theorem/shared corollary counters survive multi-file focused builds", async () => {
  const base = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "counter-")); await mkdir(path.join(workspace, "paper"));
  const main = "\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}[section]\n\\newtheorem{corollary}[theorem]{Corollary}\n\\begin{document}\n\\section{First}\n\\begin{theorem}First.\\end{theorem}\n\\begin{corollary}Shared.\\end{corollary}\n\\section*{Unnumbered}\n\\begin{theorem}Still first section.\\end{theorem}\n\\input{second}\n\\end{document}";
  await writeFile(path.join(workspace, "paper", "main.tex"), main);
  await writeFile(path.join(workspace, "paper", "second.tex"), "\\section{Second}\n\\begin{theorem}Second section.\\end{theorem}\n\\begin{proof}A proof.\\end{proof}\n");
  const project = await registerProject(workspace, "paper"); const parsed = await parseProject(workspace, project.id);
  assert.deepEqual(parsed.nodes.filter((node) => node.environment && node.kind !== "proof").map((node) => node.title), ["Theorem 1.1", "Corollary 1.2", "Theorem 1.3", "Theorem 2.1"]);
  const theorem = parsed.nodes.find((node) => node.title === "Theorem 2.1")!;
  const focused = focusedDocument(parsed, { focusNodeId: theorem.id });
  assert.ok(focused.includes("\\setcounter{section}{2}"));
  assert.ok(focused.includes("\\setcounter{theorem}{0}"));
  assert.ok(focused.includes("A proof.")); assert.ok(!focused.includes("Shared."));
  assert.equal(await readFile(path.join(workspace, "paper", "main.tex"), "utf8"), main);
});

test("aliascnt names share section counters across files, without guessing cyclic aliases", async () => {
  const base = path.join(process.cwd(), ".paperfocus", "trials"); await mkdir(base, { recursive: true });
  const workspace = await mkdtemp(path.join(base, "alias-counter-")); await mkdir(path.join(workspace, "paper"));
  await writeFile(path.join(workspace, "paper/main.tex"), String.raw`\documentclass{article}
\newtheorem{theorem}{Theorem}[section]
\newaliascnt{lemma}{theorem}\newtheorem{lemma}[lemma]{Lemma}
\newaliascnt{claim}{lemma}\newtheorem{claim}[claim]{Claim}
\newaliascnt{bad}{cycle}\newaliascnt{cycle}{bad}\newtheorem{bad}[bad]{Bad}
\begin{document}\section{First}
\begin{theorem}One.\end{theorem}\begin{lemma}Two.\end{lemma}
\begin{claim}Three.\end{claim}\begin{bad}No guessed number.\end{bad}
\input{second}\end{document}`);
  await writeFile(path.join(workspace, "paper/second.tex"), String.raw`\section{Second}
\begin{lemma}Reset.\end{lemma}\begin{proof}Reason.\end{proof}`);
  const project = await registerProject(workspace, "paper"); const parsed = await parseProject(workspace, project.id);
  assert.deepEqual(parsed.nodes.filter((node) => node.environment && node.kind !== "proof").map((node) => node.title), ["Theorem 1.1", "Lemma 1.2", "Claim 1.3", "Bad", "Lemma 2.1"]);
  const lemma = parsed.nodes.find((node) => node.title === "Lemma 2.1")!;
  assert.equal(lemma.environmentCounter, "theorem");
  const focused = focusedDocument(parsed, { focusNodeId: lemma.id });
  assert.ok(focused.includes("\\setcounter{theorem}{0}"));
  assert.ok(focused.includes("Reason."));
});
